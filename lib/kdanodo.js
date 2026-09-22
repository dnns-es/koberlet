// Koberlet - Copyright 2026 DNNS.es (Oberluss)
// SPDX-License-Identifier: Apache-2.0

// El unico sitio donde se decide a que nodo de Kadena se le pregunta.
//
// Existe por lo del 22-09-2026. Koberlet tenia el nodo escrito a fuego en TRES
// sitios distintos (main.js dos veces y lib/swap.js) y los tres apuntaban al
// publico de la comunidad, que esa tarde:
//
//   - tardaba 1.625 ms de mediana en una lectura, con un pico de 12.343 ms,
//     mientras otros dos nodos de la misma cadena contestaban en 81 y 90 ms, y
//   - servia datos VIEJOS: su balanceador tiene al menos un nodo pegado detras y
//     en 1 de cada 10 peticiones contestaba con una altura 19 bloques atrasada,
//     unos diez minutos.
//
// Lo segundo es lo peligroso, y ademas no se ve: un nodo rapido con datos viejos
// te pinta saldos que ya no son y te calcula precios sobre un pool que ya no
// existe, sin dar un solo error. Por eso aqui NO se mide solo la latencia: se
// mide tambien la frescura, y un nodo atrasado se aparta aunque sea el mas
// rapido de los tres.
//
// Lo que se ofrece fuera es `mejor()`, que devuelve una URL. Asi los 54 sitios
// que leen `red.node` no se enteran de nada: siguen viendo un texto.

// Cuantos bloques de retraso se le toleran a un nodo antes de apartarlo. La
// cadena 2 saca un bloque cada ~30 s, asi que 3 bloques son minuto y medio: de
// sobra para un desfase normal entre nodos sanos, y muy lejos de los 19 bloques
// que se midieron en el que estaba roto.
const TOLERANCIA_BLOQUES = 3;

// Lo que se espera a un nodo en la sonda. Corto a proposito: los buenos
// contestan en menos de 150 ms, y aqui no estamos operando, estamos midiendo.
const ESPERA_SONDA_MS = 5000;

// Cada cuanto se vuelve a medir. Un nodo no se pone lento de un segundo para
// otro, y sondear mas a menudo es molestar a cuatro servidores para nada.
const CADA_MS = 10 * 60 * 1000;

// La cadena por la que se mide la frescura. Es donde vive todo (Mercatus, el
// puente, el DCA), asi que es la que importa que este al dia.
const CADENA_TESTIGO = '2';

// Los de fabrica, en el orden en que se midieron el 22-09-2026 (mediana / peor
// caso de 25 lecturas seguidas). El orden de esta lista no decide nada -- lo
// decide la sonda -- pero deja constancia de por que estan estos y no otros:
//   chainweb.eckowallet.com        81 ms /    102 ms
//   chainweb.chaddex.com           90 ms /    778 ms
//   api.chainweb-community.org  1.625 ms / 12.343 ms  y ademas servia datos viejos
// El de la comunidad se queda el ultimo, no se quita: si los otros dos cayeran
// a la vez, mas vale un nodo lento que ningun nodo.
const DE_FABRICA = [
  'https://chainweb.eckowallet.com',
  'https://chainweb.chaddex.com',
  'https://api.chainweb-community.org'
];

const estado = {
  networkId: 'mainnet01',
  lista: DE_FABRICA.slice(),   // candidatos actuales (fabrica + los que anada el usuario)
  fijo: null,                  // si el usuario elige uno a mano, manda y no se le cambia
  medidas: [],                 // ultima sonda, para enseñarla en Red
  cuando: null,                // cuando se midio
  elegido: DE_FABRICA[0],      // el que se esta usando ahora mismo
  temporizador: null,
  alCambiar: null              // aviso al que quiera enterarse de que cambio el nodo
};

function urlValida(u) {
  try { return new URL(u).protocol === 'https:'; } catch (_) { return false; }
}

// Una medida de un nodo: cuanto tarda y por que altura va.
// Se pregunta por /cut y no por la cabecera de la cadena: `header?limit=1`
// devuelve el bloque en base64 salvo que se pida la codificacion en objeto, y
// esa cabecera no la sirven todos igual (probado el 22-09: eckowallet contesta
// con una cadena base64 y revienta si se le pide el objeto). /cut es JSON
// llano, lo entienden los tres y cuesta 26-39 ms.
async function medir(url, networkId) {
  const t0 = Date.now();
  const corte = new AbortController();
  const reloj = setTimeout(() => corte.abort(), ESPERA_SONDA_MS);
  try {
    const r = await fetch(
      `${url}/chainweb/0.0/${networkId}/cut`,
      { signal: corte.signal, headers: { Accept: 'application/json' } }
    );
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    const testigo = j && j.hashes && j.hashes[CADENA_TESTIGO];
    const altura = testigo ? Number(testigo.height) : NaN;
    if (!Number.isFinite(altura)) throw new Error('sin altura en la respuesta');
    return { url, ms: Date.now() - t0, altura, ok: true, error: null };
  } catch (e) {
    return { url, ms: Date.now() - t0, altura: null, ok: false,
             error: (e && e.name === 'AbortError') ? 'no contesto en ' + (ESPERA_SONDA_MS / 1000) + ' s'
                                                   : String((e && e.message) || e).slice(0, 80) };
  } finally {
    clearTimeout(reloj);
  }
}

// Ordena las medidas: primero se apartan los que van atrasados, luego se ordena
// por latencia. Devuelve la lista entera (tambien los apartados, marcados) para
// poder enseñarla tal cual en la pantalla de Red.
function ordenar(medidas) {
  const vivos = medidas.filter(m => m.ok);
  const puntaAltura = vivos.length ? Math.max(...vivos.map(m => m.altura)) : null;
  const conRetraso = medidas.map(m => ({
    ...m,
    retraso: (m.ok && puntaAltura !== null) ? puntaAltura - m.altura : null,
    atrasado: !!(m.ok && puntaAltura !== null && (puntaAltura - m.altura) > TOLERANCIA_BLOQUES)
  }));
  // Orden: los sanos por latencia, despues los atrasados, y al final los caidos.
  return conRetraso.sort((a, b) => {
    const rango = (m) => (!m.ok ? 2 : (m.atrasado ? 1 : 0));
    if (rango(a) !== rango(b)) return rango(a) - rango(b);
    if (!a.ok && !b.ok) return 0;
    return a.ms - b.ms;
  });
}

// Mide todos los candidatos a la vez y se queda con el mejor.
// Si el usuario ha fijado uno a mano, se mide igual (para poder enseñarle como
// va) pero no se le cambia: fijar significa fijar.
async function sondear() {
  const lista = estado.lista.filter(urlValida);
  if (!lista.length) return estado.medidas;
  const medidas = ordenar(await Promise.all(lista.map(u => medir(u, estado.networkId))));
  estado.medidas = medidas;
  estado.cuando = Date.now();
  const antes = estado.elegido;
  if (estado.fijo && lista.includes(estado.fijo)) {
    estado.elegido = estado.fijo;
  } else {
    const sano = medidas.find(m => m.ok && !m.atrasado);
    // Si TODOS van atrasados no hay nada mejor que hacer que coger el mas
    // adelantado: quedarse sin nodo es peor que tener uno con un minuto de
    // retraso, y la pantalla de Red lo enseña.
    const apano = medidas.find(m => m.ok);
    estado.elegido = (sano || apano || { url: lista[0] }).url;
  }
  if (estado.elegido !== antes && typeof estado.alCambiar === 'function') {
    try { estado.alCambiar(estado.elegido, antes); } catch (_) { /* que un aviso falle no rompe la sonda */ }
  }
  return medidas;
}

function mejor() { return estado.elegido; }

function verEstado() {
  return {
    elegido: estado.elegido,
    fijo: estado.fijo,
    cuando: estado.cuando,
    lista: estado.lista.slice(),
    deFabrica: DE_FABRICA.slice(),
    medidas: estado.medidas
  };
}

// Se le pasa lo que el usuario tenga guardado (su lista y su nodo fijo) y se
// deja todo listo. Las URL que no sean https se tiran aqui: el renderer no
// puede colar un endpoint por http ni un javascript:.
function configurar({ networkId, lista, fijo } = {}) {
  if (networkId) estado.networkId = networkId;
  const suyas = Array.isArray(lista) ? lista.filter(urlValida) : [];
  // Los de fabrica van siempre; los del usuario se añaden detras, sin repetir.
  estado.lista = DE_FABRICA.concat(suyas.filter(u => !DE_FABRICA.includes(u)));
  estado.fijo = (fijo && estado.lista.includes(fijo)) ? fijo : null;
  if (estado.fijo) estado.elegido = estado.fijo;
  else if (!estado.lista.includes(estado.elegido)) estado.elegido = estado.lista[0];
  return verEstado();
}

// Arranca la sonda periodica. `unref` para que el temporizador no impida cerrar
// la aplicacion: si el usuario cierra, se cierra.
function arrancar(alCambiar) {
  if (typeof alCambiar === 'function') estado.alCambiar = alCambiar;
  if (estado.temporizador) clearInterval(estado.temporizador);
  estado.temporizador = setInterval(() => { sondear().catch(() => {}); }, CADA_MS);
  if (typeof estado.temporizador.unref === 'function') estado.temporizador.unref();
  return sondear().catch(() => estado.medidas);
}

function parar() {
  if (estado.temporizador) { clearInterval(estado.temporizador); estado.temporizador = null; }
}

module.exports = {
  DE_FABRICA, TOLERANCIA_BLOQUES, CADA_MS,
  medir, ordenar, sondear, mejor, verEstado, configurar, arrancar, parar, urlValida
};
