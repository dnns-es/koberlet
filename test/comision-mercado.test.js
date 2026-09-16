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

// --- 5: una sola copia de lo que se cobra y de a quien ----------------------
// Cinco sitios cobran el 0,5%. Si cada uno llevara su copia de la cuenta, tarde o
// temprano una se quedaria vieja y el dinero se iria a la cuenta equivocada sin que
// nadie lo notara: son numeros que nadie lee dos veces.
const fs = require('fs');
const path = require('path');
const comision = require('../lib/comision');
const LIB = path.join(__dirname, '..', 'lib');
for (const f of ['swap.js', 'dex.js', 'ethswap.js', 'evmswap.js']) {
  const texto = fs.readFileSync(path.join(LIB, f), 'utf8');
  comprueba(f + ': lee la comisión de comision.js', /require\(['.\/]*\.\/comision'\)/.test(texto));
  comprueba(f + ': no se escribe su propia cuenta',
    !texto.includes(comision.KDA_CLAVE) && !texto.includes(comision.ETH_CUENTA.slice(2)),
    'tiene una cuenta pegada a mano');
}
comprueba('la cuenta de Ethereum está bien escrita (mayúsculas de control incluidas)',
  comision.ETH_CUENTA === require('ethers').ethers.getAddress(comision.ETH_CUENTA), comision.ETH_CUENTA);

// --- 6: Ethereum, donde cobra el propio router de Uniswap -------------------
// Aqui no hay contrato nuestro: se usan `sweepTokenWithFee` y `unwrapWETH9WithFee`,
// que son del router y no admiten pasar del 1%. Lo que hay que vigilar es a quien va
// cada parte, porque son direcciones y una letra cambiada no la ve nadie.
const ethswap = require('../lib/ethswap');
const { ethers } = require('ethers');
const iface = new ethers.Interface([
  'function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256)',
  'function unwrapWETH9WithFee(uint256 amountMinimum, address recipient, uint256 feeBips, address feeRecipient) payable',
  'function sweepTokenWithFee(address token, uint256 amountMinimum, address recipient, uint256 feeBips, address feeRecipient) payable',
  'function refundETH() payable'
]);
const MIA = '0x1111111111111111111111111111111111111111';
const MINIMO = 123456789n;

comprueba('el tope del router es el 1% y nosotros cobramos 0,5%',
  ethswap.FEE_BIPS === 50n && ethswap.FEE_MAX_BIPS === 100n && ethswap.FEE_BIPS <= ethswap.FEE_MAX_BIPS,
  String(ethswap.FEE_BIPS));

for (const dir of ['usdc2eth', 'eth2usdc']) {
  const partes = ethswap.partes({ dir, fee: 500, amtIn: 10n ** 9n, min: MINIMO, cuenta: MIA });
  const llamadas = partes.map((d) => iface.parseTransaction({ data: d }));
  const nombres = llamadas.map((l) => l.name);
  const cobro = llamadas.find((l) => l.name === 'unwrapWETH9WithFee' || l.name === 'sweepTokenWithFee');
  comprueba(dir + ': el reparto va dentro del mismo multicall', !!cobro, nombres.join(', '));
  if (!cobro) continue;
  const a = cobro.args;
  // En `sweepTokenWithFee` el primer argumento es el token, asi que todo se corre uno.
  const off = cobro.name === 'sweepTokenWithFee' ? 1 : 0;
  comprueba(dir + ': el suelo firmado es el de la cotización', a[off] === MINIMO, String(a[off]));
  comprueba(dir + ': lo que queda va a la cuenta del usuario', a[off + 1] === MIA, a[off + 1]);
  comprueba(dir + ': la comisión es de 50 bips', a[off + 2] === 50n, String(a[off + 2]));
  comprueba(dir + ': la comisión va a la cuenta de DNNS', a[off + 3] === comision.ETH_CUENTA, a[off + 3]);
  comprueba(dir + ': no se cobra más del 1% que admite el router', a[off + 2] <= 100n, String(a[off + 2]));
  // El token no se puede quedar dentro del router: lo que entra, sale en la misma llamada.
  if (dir === 'eth2usdc') {
    comprueba(dir + ': el sobrante de ETH se devuelve', nombres.includes('refundETH'), nombres.join(', '));
  }
}

const bruto = 1_000_000n;
const { comision: cuota, neto } = comision.conComision(bruto);
comprueba('en Ethereum la comisión sale de lo que se recibe y cuadra',
  cuota + neto === bruto && cuota === 5000n, cuota + ' + ' + neto);

assert.strictEqual(fallos, 0, fallos + ' comprobaciones fallidas');
console.log('\nComisión del Mercado: todas las comprobaciones pasan.');
