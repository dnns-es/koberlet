// Test de las cuentas de las ordenes limite (contrato free.ksw2). Sin red: comprueba
// las dos cosas que romperian en silencio y solo se notarian con dinero puesto.
//
//   1. El TRUNCADO. Si el minimo a recibir se redondea hacia arriba, aunque sea en el
//      ultimo decimal, la ejecucion revierte por "insufficient output amount" y el
//      vigilante la reintenta sin fin: la orden nunca entra y el deposito se queda ahi.
//   2. La INVERSION DEL TRIGGER en las compras. El contrato compara
//      token-in -> token-out, asi que comprar KDA a 0,003 se guarda como 333,33.
//      Equivocarse aqui crea ordenes que no disparan nunca o disparan al reves.
//
// La formula del minimo es la misma que usa KoberluSW en produccion (app.py,
// api_orden_preparar): reservas proyectadas al precio de disparo con k = rk*ru
// constante, y el calculo hecho sobre el NETO despues de la comision del contrato.
// Contrastada contra el pool real el 05/09/2026 (kaddex.exchange, chain 2 del fork).
//
//   node test/ordenes.test.js
const assert = require('assert');
const ordenes = require('../lib/ordenes');

let fallos = 0;
function comprueba(nombre, dio, esperado) {
  if (dio !== esperado) { fallos++; console.log('FALLA  ' + nombre + ': esperaba ' + esperado + ' y dio ' + dio); }
}

// --- 1. Truncado: SIEMPRE hacia abajo, nunca al vecino mas cercano ---------------
const TRUNCADO = [
  ['corta y no redondea',        0.1234569, 6, '0.123456'],
  ['no sube el ultimo decimal',  0.9999999, 6, '0.999999'],
  ['deja los ceros de la cola',  1.5,       6, '1.500000'],
  ['12 decimales de KDA',        1 / 258.39, 12, '0.003870118812'],
  ['cero se queda en cero',      0,         6, '0.000000']
];
for (const [nombre, n, prec, esperado] of TRUNCADO) comprueba(nombre, ordenes.fijo(n, prec), esperado);

// toFixed redondearia al alza justo en el caso peligroso: por eso no se usa.
assert.notStrictEqual(ordenes.fijo(0.9999999, 6), (0.9999999).toFixed(6));

// --- 2. Normalizar: el precio se enseña SIEMPRE en kb-USDC por KDA ---------------
const PAR = {
  kda: { modulo: 'coin', precision: 12, simbolo: 'KDA' },
  usdc: { modulo: 'n_e595727b657fbbb3b8e362a05a7bb8d12865c1ff.kb-USDC', precision: 6, simbolo: 'kb-USDC' }
};
// Pact devuelve los modulos como {refName:{namespace,name}} y los decimales como {decimal}.
const modRef = (ns, name) => ({ refName: { namespace: ns, name: name } });

const venta = ordenes.normalizar({
  id: 'k:abc-1', owner: 'k:abc', status: 'open',
  'token-in': modRef(null, 'coin'), 'token-out': modRef('n_e595727b657fbbb3b8e362a05a7bb8d12865c1ff', 'kb-USDC'),
  'amount-in': { decimal: '200.0' }, 'trigger-price': { decimal: '0.0046' }, 'min-out': { decimal: '0.87' },
  'expires-at': { timep: '2126-01-01T00:00:00Z' }
}, PAR);
comprueba('venta: lado', venta.lado, 'venta');
comprueba('venta: el precio se enseña tal cual', venta.precio, 0.0046);
comprueba('venta: entrega KDA', venta.simIn, 'KDA');

const compra = ordenes.normalizar({
  id: 'k:abc-2', owner: 'k:abc', status: 'open',
  'token-in': modRef('n_e595727b657fbbb3b8e362a05a7bb8d12865c1ff', 'kb-USDC'), 'token-out': modRef(null, 'coin'),
  'amount-in': { decimal: '5.0' }, 'trigger-price': { decimal: '250.0' }, 'min-out': { decimal: '1200.0' },
  'expires-at': { timep: '2126-01-01T00:00:00Z' }
}, PAR);
comprueba('compra: lado', compra.lado, 'compra');
// 250 kb-USDC por KDA seria absurdo: el contrato lo guarda invertido y hay que darle la vuelta.
comprueba('compra: el trigger se invierte para enseñarlo', compra.precio, 1 / 250);
comprueba('compra: entrega kb-USDC', compra.simIn, 'kb-USDC');

// Ida y vuelta: lo que se enseña al usuario vuelve a ser el trigger que firma el contrato.
comprueba('compra: ida y vuelta del precio', ordenes.fijo(1 / compra.precio, 1), '250.0');

console.log(fallos === 0 ? 'OK: ' + (TRUNCADO.length + 7) + ' casos, 0 fallos' : 'HAY ' + fallos + ' FALLOS');
process.exit(fallos === 0 ? 0 : 1);
