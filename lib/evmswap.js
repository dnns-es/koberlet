// Koberlet - Copyright 2026 DNNS.es (Oberluss)
// SPDX-License-Identifier: Apache-2.0

// Swap de tokens ERC-20 en Uniswap V3 (Ethereum). Pensado para pasar USDT a USDC antes
// de cruzar el puente a Kadena: en Kadena el unico con mercado es kb-USDC, asi que un
// USDT que llegue como kb-USDT se queda sin poder cambiarse a KDA.
//
// No custodial y sin intermediarios: la llamada se construye aqui y se firma con la
// clave del usuario. NO se usa ningun agregador (1inch, 0x...) a proposito; eso seria
// firmar unos datos que no hemos construido nosotros, y en un monedero eso no vale.
const { ethers } = require('ethers');
const nodo = require('./evmnodo');   // proveedor con tope de grupo + espera de recibo sin escanear bloques

// Direcciones fijas de Uniswap V3 en Ethereum. Van aqui, en el codigo, y NUNCA las
// manda el renderer (modelo Alex #4: nadie de fuera elige a que contrato firmamos).
const SWAP_ROUTER = '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45';  // SwapRouter02
const QUOTER      = '0x61fFE014bA17989E743c5F6cB21bF9697530B21e';  // QuoterV2

// Comisiones de pool a tantear, de menor a mayor. Para dos estables lo normal es que
// gane la de 0,01%, pero se prueban todas y se coge la que mas devuelva.
const FEES = [100, 500, 3000];

const QUOTER_ABI = ['function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 ticks,uint256 gasEstimate)'];
const ROUTER_ABI = ['function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)'];
// OJO con el ABI de approve: USDT NO devuelve bool, al contrario de lo que dice el
// estandar ERC-20. Si se declara `returns (bool)`, ethers revienta al descodificar la
// respuesta de una transaccion que en realidad ha ido bien. Se declara sin retorno.
const ERC20_ABI = [
  'function approve(address,uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function balanceOf(address) view returns (uint256)'
];

function dir(a, rol) {
  try { return ethers.getAddress(a); }
  catch (_) { throw new Error(`Direccion ${rol} invalida: ${a}`); }
}

/**
 * Cotiza cuanto saldria de un swap, probando las comisiones de pool y quedandose con
 * la mejor. Solo lectura: no firma nada ni gasta gas.
 */
async function cotizar({ rpc, tokenIn, tokenOut, decIn, decOut, amount }) {
  const pr = nodo.proveedor(rpc);
  const q = new ethers.Contract(QUOTER, QUOTER_ABI, pr);
  const entrada = ethers.parseUnits(String(amount), decIn);
  if (entrada <= 0n) throw new Error('Cantidad invalida.');
  let mejor = null;
  for (const fee of FEES) {
    try {
      const r = await q.quoteExactInputSingle.staticCall(
        { tokenIn: dir(tokenIn, 'de origen'), tokenOut: dir(tokenOut, 'de destino'), amountIn: entrada, fee, sqrtPriceLimitX96: 0 });
      if (!mejor || r[0] > mejor.bruto) mejor = { fee, bruto: r[0] };
    } catch (_) { /* ese pool no existe o no tiene fondo: se prueba el siguiente */ }
  }
  if (!mejor) throw new Error('No hay ningun pool de Uniswap para ese par.');
  const salida = Number(ethers.formatUnits(mejor.bruto, decOut));
  return { fee: mejor.fee, salida, salidaBruta: mejor.bruto.toString(), precio: salida / Number(amount) };
}

/**
 * Ejecuta el swap. Dos transacciones como mucho: el permiso (approve) si hace falta,
 * y el intercambio. `slippage` es el porcentaje que se tolera perder respecto a la
 * cotizacion; por debajo de eso, la propia Uniswap revierte y no pierdes el dinero.
 */
async function swap({ rpc, secretHex, tokenIn, tokenOut, decIn, decOut, amount, slippage = 0.5 }, aviso = () => {}) {
  const pr = nodo.proveedor(rpc);
  const firmante = new ethers.Wallet(secretHex.startsWith('0x') ? secretHex : '0x' + secretHex, pr);
  const yo = await firmante.getAddress();
  const tIn = dir(tokenIn, 'de origen'), tOut = dir(tokenOut, 'de destino');
  const entrada = ethers.parseUnits(String(amount), decIn);

  const token = new ethers.Contract(tIn, ERC20_ABI, firmante);
  const saldo = await token.balanceOf(yo);
  if (saldo < entrada) throw new Error(`No tienes suficiente: hay ${ethers.formatUnits(saldo, decIn)} y quieres cambiar ${amount}.`);

  aviso('Consultando el precio…');
  const c = await cotizar({ rpc, tokenIn: tIn, tokenOut: tOut, decIn, decOut, amount });
  const minimo = (BigInt(c.salidaBruta) * BigInt(Math.round((100 - Number(slippage)) * 100))) / 10000n;

  // --- Permiso ---
  const actual = await token.allowance(yo, SWAP_ROUTER);
  if (actual < entrada) {
    // Segunda mania de USDT: NO deja pasar de un permiso distinto de cero a otro
    // distinto de cero. Hay que dejarlo en cero primero o la transaccion revierte.
    if (actual > 0n) {
      aviso('Retirando el permiso anterior (lo exige USDT)…');
      const ap0 = await token.approve(SWAP_ROUTER, 0n); await nodo.esperarRecibo(pr, ap0.hash);
    }
    aviso('Dando permiso al contrato de Uniswap…');
    const ap1 = await token.approve(SWAP_ROUTER, entrada); await nodo.esperarRecibo(pr, ap1.hash);
  }

  // --- Intercambio ---
  aviso('Cambiando en Uniswap…');
  const router = new ethers.Contract(SWAP_ROUTER, ROUTER_ABI, firmante);
  const tx = await router.exactInputSingle({
    tokenIn: tIn, tokenOut: tOut, fee: c.fee, recipient: yo,
    amountIn: entrada, amountOutMinimum: minimo, sqrtPriceLimitX96: 0
  });
  const rec = await nodo.esperarRecibo(pr, tx.hash);
  if (!rec || rec.status !== 1) throw new Error('El intercambio fallo en la red.');
  return {
    hash: tx.hash, fee: c.fee,
    esperado: c.salida,
    minimo: Number(ethers.formatUnits(minimo, decOut)),
    gasUsado: rec.gasUsed ? rec.gasUsed.toString() : null
  };
}

module.exports = { cotizar, swap, SWAP_ROUTER, QUOTER, FEES };
