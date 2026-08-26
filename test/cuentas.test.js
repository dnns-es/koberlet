// Test del validador de cuentas Kadena. Sin red: es la foto de lo que la cadena acepta,
// contrastada el 26/08/2026 contra coin.validate-account e is-principal en mainnet
// (nodo api.chainweb-community.org, chain 2). Si algun dia cambia el contrato, se repite
// la comprobacion en cadena y se actualiza esta tabla.
//
//   node test/cuentas.test.js
const assert = require('assert');
const kda = require('../lib/kda');
const nft = require('../lib/nft');

const H64 = 'e7f7634e925541f368b827ad5c72421905100f6205285a78c19d7b4a38711805';
const B43 = 'Mq0gKlGBdjKvkBJLr4ECCu3_OxQ4_GJOzlYS0Ems-CY';
const CH = String.fromCharCode;
const COMILLA = CH(34), BARRA = CH(92), APOS = CH(39);

// [nombre, cuenta, se espera que valga]
const CASOS = [
  // --- Los 7 tipos de principal que reconoce Pact ---
  ['k: clave unica',          'k:' + H64, true],
  ['k: hex en mayusculas',    'k:' + H64.toUpperCase(), true],
  ['w: keys-all',             'w:' + B43 + ':keys-all', true],
  ['w: keys-any',             'w:' + B43 + ':keys-any', true],
  ['w: keys-2 (con digito)',  'w:' + B43 + ':keys-2', true],
  ['w: predicado con ns',     'w:' + B43 + ':free.mi-pred', true],
  ['r: keyset con nombre',    'r:mi-keyset', true],
  ['r: con namespace',        'r:free.mi-keyset', true],
  ['u: user guard',           'u:free.modulo.fun:' + B43, true],
  ['c: capability (gasolinera)', 'c:' + B43, true],
  ['p: pact guard',           'p:' + B43 + ':nombre', true],
  ['m: module guard',         'm:free.modulo:nombre', true],
  ['m: sin namespace',        'm:coin:nombre', true],

  // --- Cuentas "vanity" antiguas: la cadena solo pide LATIN1 y longitud 3..256 ---
  ['vanity simple',           'alice', true],
  ['vanity con punto',        'bob.smith', true],
  ['vanity hex pelado',       H64, true],
  ['vanity con espacios',     'cuenta con espacio', true],
  ['vanity con enye y tilde', 'cañon josé', true],
  ['vanity con simbolos',     'cuenta&+%@!#*$:()', true],
  ['vanity con apostrofe',    'o' + APOS + 'brien', true],
  ['longitud minima (3)',     'abc', true],
  ['longitud maxima (256)',   'a'.repeat(256), true],

  // --- Prefijo reservado de UNA letra mal formado. coin.enforce-reserved impide crear
  //     estas cuentas, asi que no existen: rechazarlas es cazar la errata a tiempo. ---
  ['k: con 63 hex',           'k:' + H64.slice(0, 63), false],
  ['k: que no es hex',        'k:' + 'z'.repeat(64), false],
  ['w: con hash corto',       'w:' + B43.slice(0, 40) + ':keys-all', false],
  ['u: sin hash',             'u:free.modulo.fun', false],
  ['c: con hash corto',       'c:' + B43.slice(0, 40), false],
  ['prefijo x: inventado',    'x:' + B43, false],
  ['prefijo t: inventado',    't:' + B43, false],

  // --- Fuera de lo que admite la cadena (charset LATIN1, longitud) ---
  ['fuera de LATIN1',         '日本', false],
  ['emoji',                   'a' + CH(0xd83d, 0xde00) + 'b', false],
  ['1 caracter',              'a', false],
  ['2 caracteres',            'ab', false],
  ['257 caracteres',          'a'.repeat(257), false],

  // --- Inyeccion: lo unico que puede escapar del literal "..." de Pact ---
  ['comilla doble',           'x' + COMILLA + ' (coin.transfer', false],
  ['barra invertida',         'x' + BARRA + COMILLA + ' (enforce false', false],
  ['salto de linea',          'cuenta' + CH(10) + 'x', false],
  ['byte nulo',               'cuenta' + CH(0) + 'x', false],
  ['tabulador',               'cuenta' + CH(9) + 'x', false],
  ['DEL (0x7f)',              'cuenta' + CH(127) + 'x', false],

  // --- No-cadenas ---
  ['null',                    null, false],
  ['numero',                  12345, false],
];

let fallos = 0;
for (const [nombre, cuenta, esperado] of CASOS) {
  const dio = kda.validKdaAccount(cuenta);
  if (dio !== esperado) { fallos++; console.log('FALLA  ' + nombre + ': esperaba ' + esperado + ' y dio ' + dio); }
  // lib/nft.js debe opinar exactamente lo mismo (delega en lib/kda.js).
  if (nft.cuentaValida(cuenta) !== dio) { fallos++; console.log('FALLA  ' + nombre + ': nft.js no coincide con kda.js'); }
}

// Comprobacion de bulto: la gasolinera de KoberluSW tiene que valer como destino normal.
assert.ok(kda.validKdaAccount('c:' + B43));

console.log(fallos === 0 ? 'OK: ' + CASOS.length + ' casos, 0 fallos' : 'HAY ' + fallos + ' FALLOS');
process.exit(fallos === 0 ? 0 : 1);
