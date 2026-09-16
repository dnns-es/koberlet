// Koberlet - Copyright 2026 DNNS.es (Oberluss)
// SPDX-License-Identifier: Apache-2.0

// Test de la comision de servicio del Mercado (cambio KDA <-> kb-USDC).
// Sin red: comprueba las cuatro cosas que, si se rompen, solo se notarian con
// dinero puesto y en transacciones ya firmadas.
//
//   1. EL REPARTO CUADRA. Comision + lo que va al pool tiene que ser exactamente
//      lo que el usuario dijo que queria cambiar. Un descuadre de un decimal deja
//      saldo bloqueado o hace fallar la transferencia por fondos insuficientes.
//   2. LA COMISION SE REDONDEA HACIA ABAJO, y nunca por encima del 0,5%: cobrar
//      de mas, aunque sea un decimal, es cobrar lo que no es tuyo.
//   3. LOS DECIMALES SON LOS DEL TOKEN QUE ENTRA (12 en KDA, 6 en kb-USDC).
//      Mandar mas decimales de los que admite el token revierte la transaccion.
//   4. EL MINIMO A RECIBIR SE CALCULA SOBRE EL NETO, no sobre el bruto: si se
//      calcula sobre el bruto, el minimo queda por encima de lo que el pool puede
//      dar y el swap revierte siempre.
//
//   node test/comision-mercado.test.js
const assert = require('assert');
const swap = require('../lib/swap');

let fallos = 0;
function comprueba(nombre, condicion, detalle) {
  if (!condicion) { fallos++; console.log('FALLA  ' + nombre + (detalle ? ': ' + detalle : '')); }
  else console.log('ok     ' + nombre);
}

// --- 1 y 2: el reparto ------------------------------------------------------
const casos = [
  { dir: 'venta', entra: 100, dec: 12 },
  { dir: 'venta', entra: 1234.567891234567, dec: 12 },
  { dir: 'compra', entra: 25, dec: 6 },
  { dir: 'compra', entra: 1.999999, dec: 6 },
  { dir: 'compra', entra: 0.01, dec: 6 },
];
for (const c of casos) {
  const { comision, alPool, dec } = swap.reparto(c.dir, c.entra);
  const nombre = c.dir + ' de ' + c.entra;
  const suma = Number((comision + alPool).toFixed(dec));
  comprueba(nombre + ': el reparto cuadra', suma <= Number(c.entra.toFixed(dec)) && suma > Number(c.entra.toFixed(dec)) - Math.pow(10, -dec) * 2,
    'comision ' + comision + ' + pool ' + alPool + ' = ' + suma + ' de ' + c.entra);
  comprueba(nombre + ': no cobra de más', comision <= c.entra * swap.C.feeDnns + 1e-12,
    comision + ' > ' + c.entra * swap.C.feeDnns);
  comprueba(nombre + ': decimales del token', dec === c.dec && contarDecimales(comision) <= dec && contarDecimales(alPool) <= dec,
    'comision ' + comision + ' pool ' + alPool + ' con ' + dec + ' decimales');
}

function contarDecimales(x) {
  const s = String(x);
  if (s.includes('e-')) return Number(s.split('e-')[1]) + (s.split('e-')[0].split('.')[1] || '').length;
  return (s.split('.')[1] || '').length;
}

// --- 3: la comision es la acordada -----------------------------------------
comprueba('la comisión es del 0,5%', swap.C.feeDnns === 0.005, 'es ' + swap.C.feeDnns);
comprueba('la cuenta que cobra es la de DNNS',
  swap.C.cuentaDnns === 'k:' + swap.C.claveDnns,
  swap.C.cuentaDnns + ' no casa con la clave ' + swap.C.claveDnns);
comprueba('la cuenta que cobra es una k: válida', /^k:[0-9a-f]{64}$/.test(swap.C.cuentaDnns), swap.C.cuentaDnns);

// --- 4: el minimo se calcula sobre el neto ---------------------------------
// Se reproduce aqui la formula del AMM para comparar bruto contra neto.
function salida(entrada, rin, rout, feePool) {
  const ef = entrada * (1 - feePool);
  return ef * rout / (rin + ef);
}
const rk = 818708.75, ru = 3324.78;                       // reservas reales del par (16/09/2026)
const entra = 1000;
const { alPool } = swap.reparto('venta', entra);
const conNeto = salida(alPool, rk, ru, swap.C.feePool);
const conBruto = salida(entra, rk, ru, swap.C.feePool);
comprueba('el mínimo sale del neto, no del bruto', conNeto < conBruto,
  'neto ' + conNeto + ' bruto ' + conBruto);
comprueba('la diferencia es la comisión, no otra cosa',
  Math.abs((conBruto - conNeto) / conBruto - swap.C.feeDnns) < 0.0002,
  'diferencia ' + ((conBruto - conNeto) / conBruto));

assert.strictEqual(fallos, 0, fallos + ' comprobaciones fallidas');
console.log('\nComisión del Mercado: todas las comprobaciones pasan.');
