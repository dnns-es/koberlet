// Test del trato con el nodo EVM (lib/evmnodo.js y los saldos del puente). Sin red:
// todo va a loopback o a objetos de mentira. Recoge lo que se aprendio el 2026-09-09,
// cuando el nodo de fabrica se cayo y hubo que cambiarlo DOS veces en el mismo dia.
//
//   1. ESPERAR EL RECIBO NO PUEDE DEPENDER DE LOS BLOQUES. tx.wait() de ethers, mientras
//      no ve el recibo, escanea bloques por si te reemplazaron la transaccion, y para eso
//      pide getBlock(n, true). publicnode dejo de servir esa llamada y la espera reventaba
//      DESPUES de firmar y enviar, con la transaccion ya en la cadena. Si alguien vuelve a
//      meter un getBlock por aqui, el fallo reaparece y solo se ve con dinero puesto.
//   2. UN FALLO DEL NODO NO ES UN SALDO DE CERO. Devolver 0 ante una excepcion hacia que la
//      ventana del puente dijera "no tienes fondos" cuando lo que pasaba es que no se pudo
//      preguntar. En una cartera esa mentira es de las caras.
//   3. LOS GRUPOS DE LLAMADAS. ethers junta hasta 100 llamadas en un envio y hay nodos que
//      tumban el grupo ENTERO al pasarse. eth.drpc.org corta en 3 y dejo los CUATRO saldos
//      del puente a cero teniendo saldo. Por eso hay un tope, y por eso el proveedor se
//      construye en un solo sitio: diez sitios haciendolo a mano es diez sitios que olvidar.
//
//   node test/nodo-evm.test.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const nodo = require('../lib/evmnodo');
const bridge = require('../lib/bridge');

let fallos = 0, casos = 0;
function comprueba(nombre, dio, esperado) {
  casos++;
  if (dio !== esperado) { fallos++; console.log('FALLA  ' + nombre + ': esperaba ' + esperado + ' y dio ' + dio); }
}
// Nodo muerto sin salir de la maquina: loopback en un puerto donde no escucha nadie.
// Falla al instante y no depende de DNS ni de tener internet.
const NODO_MUERTO = 'http://127.0.0.1:1';

// ethers avisa por consola de que no puede detectar la red cuando el nodo no responde.
// Aqui eso es lo que se esta provocando a proposito, asi que se calla para no ensuciar
// la salida del test y que un fallo de verdad se vea a la primera.
async function sinRuido(fn) {
  const log = console.log, err = console.error;
  console.log = console.error = () => {};
  try { return await fn(); } finally { console.log = log; console.error = err; }
}

// --- 1. El tope de grupo ---------------------------------------------------------
const pr = nodo.proveedor(NODO_MUERTO);
comprueba('el proveedor limita el tamano del grupo', pr._getOption('batchMaxCount'), nodo.TOPE_GRUPO);
comprueba('el tope es pequeno de verdad (drpc corta en 3)', nodo.TOPE_GRUPO <= 3, true);
const prExtra = nodo.proveedor(NODO_MUERTO, { staticNetwork: true });
comprueba('se pueden pasar opciones extra sin perder el tope', prExtra._getOption('batchMaxCount'), nodo.TOPE_GRUPO);
pr.destroy(); prExtra.destroy();

// --- 2. esperarRecibo: solo recibos, JAMAS bloques -------------------------------
const RECIBO = { hash: '0xabc', blockNumber: 100, status: 1 };
function proveedorFalso(guion) {
  let n = 0;
  return {
    tocoBloque: false,
    async getTransactionReceipt() { const p = guion[Math.min(n++, guion.length - 1)]; if (p instanceof Error) throw p; return p; },
    async getBlockNumber() { return 101; },
    async getBlock() { this.tocoBloque = true; throw new Error('este nodo no sirve bloques'); },
  };
}
(async () => {
  let p = proveedorFalso([RECIBO]);
  let r = await nodo.esperarRecibo(p, '0xabc', { intervaloMs: 1 });
  comprueba('devuelve el recibo cuando ya esta', r, RECIBO);
  comprueba('NO pide bloques para eso', p.tocoBloque, false);

  // El fallo original: un nodo que sirve recibos pero no bloques tiene que valer.
  p = proveedorFalso([null, null, RECIBO]);
  r = await nodo.esperarRecibo(p, '0xabc', { intervaloMs: 1 });
  comprueba('espera a que aparezca el recibo', r, RECIBO);
  comprueba('sigue sin pedir bloques mientras espera', p.tocoBloque, false);

  // Un error del nodo es "todavia no se sabe", no un no: hay que reintentar.
  p = proveedorFalso([new Error('502 del nodo'), new Error('502 del nodo'), RECIBO]);
  r = await nodo.esperarRecibo(p, '0xabc', { intervaloMs: 1 });
  comprueba('un fallo suelto del nodo no aborta la espera', r, RECIBO);

  // Confirmaciones: 101 - 100 + 1 = 2, asi que con 2 vale y con 5 no llega.
  p = proveedorFalso([RECIBO]);
  comprueba('cuenta confirmaciones cuando se piden', await nodo.esperarRecibo(p, '0xabc', { confirmaciones: 2, intervaloMs: 1 }), RECIBO);

  // Al agotarse el plazo, el mensaje TIENE que avisar de que la tx puede estar minada:
  // un "fallo" a secas invita a reenviar, que es la forma de pagar dos veces.
  p = proveedorFalso([null]);
  let err = null;
  try { await nodo.esperarRecibo(p, '0xdef', { timeoutMs: 30, intervaloMs: 5 }); } catch (e) { err = e; }
  comprueba('el plazo agotado lanza error', !!err, true);
  comprueba('  ...avisa de que puede estar YA en la cadena', /YA en la cadena/.test(err && err.message), true);
  comprueba('  ...lleva el hash para poder mirarlo', /0xdef/.test(err && err.message), true);
  comprueba('  ...y se puede distinguir del resto', err && err.sinConfirmar, true);

  // --- 3. Un fallo del nodo vale null, nunca 0 -----------------------------------
  const rutas = [
    { symbol: 'USDC', kadenaModule: 'kb-USDC', evmToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
    { symbol: 'USDT', kadenaModule: 'kb-USDT', evmToken: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
  ];
  const evm = await sinRuido(() => bridge.getEvmBalances({ rpc: NODO_MUERTO, address: '0x28C6c06298d514Db089934071355E5743bf21d60', routes: rutas }));
  comprueba('EVM con el nodo caido: null', evm.every(x => x.balance === null), true);
  comprueba('  ...y NINGUNO finge un cero', evm.some(x => x.balance === 0), false);
  comprueba('  ...y dice por que', evm.every(x => typeof x.error === 'string' && x.error.length > 0), true);

  const kdaCaido = await sinRuido(() => bridge.getKadenaBalances({ node: NODO_MUERTO, networkId: 'mainnet01', chain: 2, routes: rutas, account: 'k:' + '0'.repeat(64) }));
  comprueba('Kadena con el nodo caido: null', kdaCaido.every(x => x.balance === null), true);
  comprueba('  ...y ninguno finge un cero', kdaCaido.some(x => x.balance === 0), false);

  // Pero "row not found" SI es un cero de verdad: la cuenta aun no tiene ese token.
  // Se levanta un nodo Pact de mentira en loopback para provocar cada respuesta.
  const responde = (cuerpo) => new Promise((res) => {
    const s = http.createServer((_q, r) => { r.writeHead(200, { 'content-type': 'application/json' }); r.end(JSON.stringify(cuerpo)); });
    s.listen(0, '127.0.0.1', () => res(s));
  });
  let s = await responde({ result: { status: 'failure', error: { message: 'with-read: row not found: k:abc' } } });
  let k = await bridge.getKadenaBalances({ node: 'http://127.0.0.1:' + s.address().port, networkId: 'mainnet01', chain: 2, routes: [rutas[0]], account: 'k:x' });
  comprueba('Kadena "row not found" SI es cero de verdad', k[0].balance, 0);
  s.close();

  s = await responde({ result: { status: 'failure', error: { message: 'Database exception: node on fire' } } });
  k = await bridge.getKadenaBalances({ node: 'http://127.0.0.1:' + s.address().port, networkId: 'mainnet01', chain: 2, routes: [rutas[0]], account: 'k:x' });
  comprueba('Kadena: otro fallo cualquiera NO es cero', k[0].balance, null);
  s.close();

  s = await responde({ result: { status: 'success', data: { decimal: '12.5' } } });
  k = await bridge.getKadenaBalances({ node: 'http://127.0.0.1:' + s.address().port, networkId: 'mainnet01', chain: 2, routes: [rutas[0]], account: 'k:x' });
  comprueba('Kadena: un saldo bueno se lee bien', k[0].balance, 12.5);
  s.close();

  // --- 4. Que nadie vuelva a construir el proveedor por su cuenta ----------------
  // Diez sitios lo hacian a mano; el tope de grupo y la espera sin bloques solo sirven
  // si TODO pasa por lib/evmnodo.js. Esto se comprueba leyendo el codigo, que es la
  // unica forma de que salte cuando alguien anada el sitio numero once.
  const dirLib = path.join(__dirname, '..', 'lib');
  const sueltos = [], esperas = [];
  for (const f of fs.readdirSync(dirLib).filter(f => f.endsWith('.js') && f !== 'evmnodo.js')) {
    const txt = fs.readFileSync(path.join(dirLib, f), 'utf8');
    // Se ignoran los comentarios: en ellos se explica justamente por que no se hace.
    const codigo = txt.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
    if (/new\s+ethers\.JsonRpcProvider/.test(codigo)) sueltos.push(f);
    if (/\.wait\(\s*\)/.test(codigo)) esperas.push(f);
  }
  comprueba('nadie construye un JsonRpcProvider fuera de evmnodo.js', sueltos.join(',') || '(ninguno)', '(ninguno)');
  comprueba('nadie usa tx.wait() (escanea bloques): se usa esperarRecibo', esperas.join(',') || '(ninguno)', '(ninguno)');

  console.log(fallos === 0 ? 'OK: ' + casos + ' casos, 0 fallos' : 'HAY ' + fallos + ' FALLOS');
  process.exit(fallos === 0 ? 0 : 1);
})();
