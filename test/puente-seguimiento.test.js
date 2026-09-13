// Test del seguimiento de un envio por el puente (lib/bridge.js, parte de "entregado o no").
// Sin red. Recoge lo aprendido el 2026-09-13, cuando un envio de 30 USDC Kadena→Ethereum
// tardo mas de los 6 minutos que esperaba la app y el historial se quedo diciendo
// "pendiente relayer" para siempre, con el dinero ya entregado.
//
//   1. EL ID DEL MENSAJE ES EL MISMO EN LAS DOS ORILLAS, ESCRITO DISTINTO. Ethereum lo maneja
//      en hex (bytes32) y el mailbox Pact lo guarda en base64url. Si se pregunta a Kadena con
//      el hex, contesta "no entregado" para un mensaje entregado (probado contra la cadena).
//   2. LA PREGUNTA A ETHEREUM ES delivered(bytes32), selector e495f1d4, y los datos van
//      exactamente asi: 4 bytes de selector + 32 del id. Un byte de mas o de menos y el nodo
//      contesta con un revert que parece "no entregado".
//   3. EL ID SALE DEL RECIBO en Ethereum→Kadena: evento DispatchId(bytes32) del mailbox.
//      Con el recibo de la tx real de 250 USDC del 2026-09 se comprobo que es ese evento.
//
//   node test/puente-seguimiento.test.js
const bridge = require('../lib/bridge');

let fallos = 0, casos = 0;
function comprueba(nombre, dio, esperado) {
  casos++;
  if (dio !== esperado) { fallos++; console.log('FALLA  ' + nombre + ': esperaba ' + esperado + ' y dio ' + dio); }
}

// Pareja real: mensaje 493 del puente (1 USDC Ethereum→Kadena, 2026-07-12). El mailbox Pact
// dijo delivered=true con la forma base64url y false con la hex.
const HEX = '0xbe84ea68911396dde5fa6ec6cf3d2c880b751fbd9872e2296538f2e664ae88a4';
const B64 = 'voTqaJETlt3l-m7Gzz0siAt1H72YcuIpZTjy5mSuiKQ';

// 1. conversiones
comprueba('hex con 0x se queda igual (en minusculas)', bridge.messageIdHex(HEX.toUpperCase().replace('0X', '0x')), HEX);
comprueba('hex sin 0x recibe el 0x', bridge.messageIdHex(HEX.slice(2)), HEX);
comprueba('base64url (lo que devuelve el dispatch en Kadena) pasa a hex', bridge.messageIdHex(B64), HEX);
comprueba('el dispatch puede venir envuelto en {data}', bridge.messageIdHex({ data: B64 }), HEX);
comprueba('hex pasa a base64url para preguntar a Pact', bridge.messageIdB64(HEX), B64);
comprueba('ida y vuelta', bridge.messageIdB64(bridge.messageIdHex(B64)), B64);
comprueba('basura no cuela', bridge.messageIdHex('hola'), null);
comprueba('vacio no cuela', bridge.messageIdHex(''), null);
comprueba('null no revienta', bridge.messageIdHex(null), null);
comprueba('31 bytes en base64url no cuela', bridge.messageIdHex(B64.slice(0, 42)), null);

// 2. datos de la llamada delivered(bytes32)
const datos = bridge.datosDelivered(HEX);
comprueba('selector e495f1d4', datos.slice(0, 10), '0xe495f1d4');
comprueba('4 + 32 bytes justos', datos.length, 2 + 8 + 64);
comprueba('el id va tal cual detras del selector', datos.slice(10), HEX.slice(2));
comprueba('acepta el id en base64url y lo pone en hex', bridge.datosDelivered(B64), datos);
let reviento = false; try { bridge.datosDelivered('nada'); } catch (_) { reviento = true; }
comprueba('con un id malo no se pregunta nada', reviento, true);

// 3. el id sale del recibo (evento DispatchId del mailbox)
comprueba('topic DispatchId(bytes32) es el conocido', bridge.TOPIC_DISPATCH_ID, '0x788dbc1b7152732178210e7f4d9d010ef016f9eafbe66786bd7169f56e0c353a');
const MID = '0x4932fdce168d734dcfa171900a1a0a678c14854031c41edf719cbfd565544d55'; // tx real 0x207deaca… (250 USDC)
const recibo = { logs: [
  { topics: ['0x769f711d20c679153d382254f59892613b58a97cc876b249134ac25c80f9c814', '0x0000000000000000000000000000000000000000000000000000000000000001'] },
  { topics: [bridge.TOPIC_DISPATCH_ID, MID] }
] };
comprueba('saca el messageId del evento DispatchId', bridge.messageIdDeRecibo(recibo), MID);
comprueba('sin ese evento no inventa nada', bridge.messageIdDeRecibo({ logs: [recibo.logs[0]] }), null);
comprueba('recibo vacio', bridge.messageIdDeRecibo({}), null);
comprueba('recibo null', bridge.messageIdDeRecibo(null), null);
comprueba('el id del recibo se convierte para Pact', bridge.messageIdB64(MID), 'STL9zhaNc03PoXGQChoKZ4wUhUAxxB7fcZy_1WVUTVU');

// 4. sin nodo no se miente: null, no false
// (ethers avisa por consola de que no detecta la red: aqui es a proposito, se calla)
async function sinRuido(fn) {
  const log = console.log, err = console.error;
  console.log = console.error = () => {};
  try { return await fn(); } finally { console.log = log; console.error = err; }
}
(async () => {
  const r = await sinRuido(() => bridge.entregadoEnEvm({ rpc: 'http://127.0.0.1:1', mailbox: '0x82A729A4c7B2aeBDdbFCCF533e7B75c61c45c23c', messageId: HEX }));
  comprueba('nodo EVM caido = "no se sabe" (null), no "no entregado"', r, null);
  const k = await bridge.entregadoEnKadena({ node: 'http://127.0.0.1:1', networkId: 'mainnet01', chain: 2, messageId: HEX });
  comprueba('nodo Kadena caido = null', k, null);
  comprueba('id invalido hacia Kadena = null sin preguntar', await bridge.entregadoEnKadena({ node: 'http://127.0.0.1:1', networkId: 'mainnet01', chain: 2, messageId: 'x' }), null);
  console.log((fallos ? 'FALLOS: ' + fallos : 'OK') + ' (' + casos + ' comprobaciones)');
  process.exit(fallos ? 1 : 0);
})();
