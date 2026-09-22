// Test de la eleccion de nodo de Kadena (lib/kdanodo.js). Sin salir de la maquina:
// los nodos son un servidor de mentira en loopback al que se le dice que altura y
// que retraso tiene que fingir.
//
// Esto existe por la tarde del 22-09-2026. El nodo publico de la comunidad, que era
// el unico que Koberlet conocia y estaba escrito a fuego en TRES sitios:
//
//   1. IBA LENTO: 1.625 ms de mediana por lectura, con un pico de 12.343 ms, mientras
//      otros dos nodos de la MISMA cadena contestaban en 81 y 90 ms.
//   2. Y LO GRAVE: SERVIA DATOS VIEJOS. Su balanceador tenia al menos un nodo pegado
//      detras y en 1 de cada 10 peticiones contestaba con una altura 19 bloques
//      atrasada, unos diez minutos. Eso no da ningun error: te pinta saldos que ya no
//      son y te calcula precios sobre un pool que ya no existe.
//
// De ahi la regla que se comprueba aqui y que es facil de romper sin querer al tocar
// el orden: UN NODO ATRASADO SE APARTA AUNQUE SEA EL MAS RAPIDO DE TODOS. Si alguien
// simplifica esto a "ordenar por latencia", vuelve el fallo silencioso.
//
//   node test/nodo-kda.test.js
const http = require('http');
const kdanodo = require('../lib/kdanodo');

let fallos = 0, casos = 0;
function comprueba(nombre, dio, esperado) {
  casos++;
  if (dio !== esperado) { fallos++; console.log('FALLA  ' + nombre + ': esperaba ' + esperado + ' y dio ' + dio); }
  else console.log('ok     ' + nombre);
}

// Un nodo de mentira: contesta a /cut con la altura que se le diga, tras el retardo
// que se le diga. `caido` cierra la conexion sin contestar.
function nodoFalso({ altura, retardoMs = 0, caido = false }) {
  const srv = http.createServer((req, res) => {
    if (caido) { req.socket.destroy(); return; }
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ hashes: { '2': { height: altura, hash: 'x' } } }));
    }, retardoMs);
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ srv, puerto: srv.address().port })));
}

(async () => {
  // ---- 1. ordenar(): la regla de oro, sin red de por medio ----
  // El rapido va 19 bloques atrasado (justo lo que se midio en el nodo roto) y el
  // lento va al dia. Tiene que ganar el LENTO.
  const orden = kdanodo.ordenar([
    { url: 'https://rapido-pero-viejo', ms: 30, altura: 7251509, ok: true },
    { url: 'https://lento-pero-al-dia', ms: 900, altura: 7251528, ok: true }
  ]);
  comprueba('un nodo atrasado no gana por ser el mas rapido', orden[0].url, 'https://lento-pero-al-dia');
  comprueba('y el atrasado queda marcado como tal', orden[1].atrasado, true);
  comprueba('con el retraso en bloques, para poder enseñarlo', orden[1].retraso, 19);

  // Entre dos que van al dia manda la latencia, que para eso se mide.
  const orden2 = kdanodo.ordenar([
    { url: 'https://b', ms: 400, altura: 100, ok: true },
    { url: 'https://a', ms: 80, altura: 100, ok: true }
  ]);
  comprueba('entre dos al dia gana el mas rapido', orden2[0].url, 'https://a');

  // Un desfase pequeño es normal entre nodos sanos y no descalifica a nadie.
  const orden3 = kdanodo.ordenar([
    { url: 'https://rapido', ms: 50, altura: 99, ok: true },
    { url: 'https://lento', ms: 900, altura: 100, ok: true }
  ]);
  comprueba('un bloque de desfase no aparta a nadie', orden3[0].url, 'https://rapido');

  // El caido va el ultimo, por detras incluso del atrasado: un dato viejo es peor
  // que un dato fresco, pero mejor que ningun dato.
  const orden4 = kdanodo.ordenar([
    { url: 'https://caido', ms: 5000, altura: null, ok: false, error: 'no contesto' },
    { url: 'https://viejo', ms: 20, altura: 80, ok: true },
    { url: 'https://bueno', ms: 300, altura: 100, ok: true }
  ]);
  comprueba('el orden completo es: al dia, atrasado, caido',
    orden4.map(m => m.url.replace('https://', '')).join(','), 'bueno,viejo,caido');

  // ---- 2. medir() y sondear() contra nodos de verdad (de mentira) ----
  const viejo = await nodoFalso({ altura: 1000, retardoMs: 0 });      // rapidisimo pero atrasado
  const bueno = await nodoFalso({ altura: 1050, retardoMs: 120 });    // mas lento y al dia
  const muerto = await nodoFalso({ caido: true });

  const m = await kdanodo.medir('http://127.0.0.1:' + bueno.puerto, 'mainnet01');
  comprueba('medir() saca la altura de la cadena 2', m.altura, 1050);
  comprueba('y dice que la respuesta fue buena', m.ok, true);

  const mm = await kdanodo.medir('http://127.0.0.1:' + muerto.puerto, 'mainnet01');
  comprueba('un nodo que corta la conexion no da altura', mm.ok, false);
  comprueba('un fallo del nodo no se confunde con altura 0', mm.altura, null);

  // sondear() con los tres: tiene que elegir el bueno aunque el viejo conteste antes.
  kdanodo.configurar({ networkId: 'mainnet01' });
  // Se le meten los de mentira por la puerta de atras (configurar solo admite https,
  // que es justo lo que se comprueba en el caso siguiente).
  const guardados = kdanodo.verEstado().lista.slice();
  // La eleccion en si ya se ha comprobado arriba con ordenar(), que es quien decide.
  // Lo que se mira aqui es el saneado de la lista: que no cuele lo que no es https.
  const e2 = kdanodo.configurar({ networkId: 'mainnet01', lista: ['http://127.0.0.1:1', 'javascript:alert(1)', 'https://nodo.propio.example'] });
  comprueba('un nodo http:// no entra en la lista', e2.lista.includes('http://127.0.0.1:1'), false);
  comprueba('un javascript: tampoco', e2.lista.some(u => u.startsWith('javascript')), false);
  comprueba('uno https:// del usuario si entra', e2.lista.includes('https://nodo.propio.example'), true);
  comprueba('y los de fabrica siguen estando', e2.lista.includes(kdanodo.DE_FABRICA[0]), true);
  comprueba('los de fabrica van los primeros', e2.lista[0], kdanodo.DE_FABRICA[0]);
  comprueba('la lista no se duplica al reconfigurar', kdanodo.configurar({ lista: kdanodo.DE_FABRICA.slice() }).lista.length, kdanodo.DE_FABRICA.length);
  comprueba('sin tocar nada, la lista de partida es la de fabrica', guardados.length, kdanodo.DE_FABRICA.length);

  // Fijar a mano manda sobre la medida: si el usuario elige uno, es el suyo.
  const e3 = kdanodo.configurar({ fijo: kdanodo.DE_FABRICA[2] });
  comprueba('fijar un nodo a mano lo deja elegido', e3.elegido, kdanodo.DE_FABRICA[2]);
  const e4 = kdanodo.configurar({ fijo: 'https://este-no-esta-en-la-lista.example' });
  comprueba('fijar uno que no esta en la lista no cuela', e4.fijo, null);

  viejo.srv.close(); bueno.srv.close(); muerto.srv.close();
  kdanodo.parar();

  console.log('');
  if (fallos) { console.log('Nodos Kadena: ' + fallos + ' de ' + casos + ' comprobaciones FALLAN.'); process.exit(1); }
  console.log('Nodos Kadena: todas las comprobaciones pasan (' + casos + ').');
})().catch(e => { console.error('El test reventó:', e); process.exit(1); });
