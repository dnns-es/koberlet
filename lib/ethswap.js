// Swap USDC <-> ETH en Uniswap V3 (Ethereum mainnet), no custodial. Pensado para
// reponer ETH de gas con USDC sin salir del monedero. OJO: el propio swap gasta ETH
// en gas — hay que hacerlo ANTES de quedarse a cero.
//
// Antes usaba Uniswap V2. Medido el 27/08/2026, V3 devuelve un 0,25% mas de ETH por
// los mismos USDC, asi que se migro. A cambio, en V3 el ETH nativo no es directo:
// el pool es de WETH, y hay que envolver/desenvolver dentro de un multicall.
const { ethers } = require('ethers');
const nodo = require('./evmnodo');   // proveedor con tope de grupo + espera de recibo sin escanear bloques

const ROUTER = '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45'; // SwapRouter02
const QUOTER = '0x61fFE014bA17989E743c5F6cB21bF9697530B21e'; // QuoterV2
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

// SwapRouter02 usa dos direcciones magicas como destinatario: address(1) = "quien
// llama" y address(2) = "el propio router". La segunda hace falta para que el router
// se quede el WETH y lo pueda desenvolver en el mismo multicall.
const MSG_SENDER = '0x0000000000000000000000000000000000000001';
const ADDRESS_THIS = '0x0000000000000000000000000000000000000002';

const FEES = [500, 3000, 100];   // 0,05% / 0,3% / 0,01%: en USDC-ETH suele ganar la de 0,05%
const R_ABI = [
  'function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256)',
  'function unwrapWETH9(uint256 amountMinimum, address recipient) payable',
  'function refundETH() payable',
  'function multicall(bytes[] data) payable returns (bytes[])'
];
const Q_ABI = ['function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns (uint256 amountOut,uint160 a,uint32 b,uint256 c)'];
const E_ABI = ['function allowance(address,address) view returns (uint256)', 'function approve(address,uint256) returns (bool)'];
const SLIP = 0.005;        // 0,5%
const GAS_SWAP = 200000n;  // estimación holgada para mostrar el coste

// dir: 'usdc2eth' (entregas USDC, recibes ETH) | 'eth2usdc'
function pathAndDec(dir) {
  return dir === 'usdc2eth' ? { tokenIn: USDC, tokenOut: WETH, decIn: 6, decOut: 18 } : { tokenIn: WETH, tokenOut: USDC, decIn: 18, decOut: 6 };
}

// Prueba las comisiones de pool y se queda con la que mas devuelva.
async function mejorPool(pr, tokenIn, tokenOut, amtIn) {
  const q = new ethers.Contract(QUOTER, Q_ABI, pr);
  let mejor = null;
  for (const fee of FEES) {
    try {
      const r = await q.quoteExactInputSingle.staticCall({ tokenIn, tokenOut, amountIn: amtIn, fee, sqrtPriceLimitX96: 0 });
      if (!mejor || r[0] > mejor.out) mejor = { fee, out: r[0] };
    } catch (_) { /* ese pool no existe o esta seco */ }
  }
  if (!mejor) throw new Error('No hay pool de Uniswap para ese par.');
  return mejor;
}

async function quote({ rpc, dir, amount }) {
  const pr = nodo.proveedor(rpc);
  const { tokenIn, tokenOut, decIn, decOut } = pathAndDec(dir);
  const amtIn = ethers.parseUnits(String(amount), decIn);
  const { fee, out } = await mejorPool(pr, tokenIn, tokenOut, amtIn);
  const min = out - (out * 5n / 1000n);
  let gasEth = null;
  try { const f = await pr.getFeeData(); if (f.gasPrice) gasEth = Number(ethers.formatEther(f.gasPrice * GAS_SWAP)); } catch (_) {}
  return { out: Number(ethers.formatUnits(out, decOut)), min: Number(ethers.formatUnits(min, decOut)), gasEth, slipPct: SLIP * 100, fee };
}

// Arma la llamada del multicall. Aparte para poder probarla sin firmar (eth_call).
function partes({ dir, fee, amtIn, min, cuenta }) {
  const iface = new ethers.Interface(R_ABI);
  const { tokenIn, tokenOut } = pathAndDec(dir);
  if (dir === 'usdc2eth') {
    // El router se queda el WETH (ADDRESS_THIS) y lo desenvuelve a ETH nativo para el
    // usuario. El suelo se aplica en unwrapWETH9, que revierte si sale menos.
    return [
      iface.encodeFunctionData('exactInputSingle', [{ tokenIn, tokenOut, fee, recipient: ADDRESS_THIS, amountIn: amtIn, amountOutMinimum: 0n, sqrtPriceLimitX96: 0 }]),
      iface.encodeFunctionData('unwrapWETH9', [min, cuenta])
    ];
  }
  // ETH -> USDC: el ETH va como `value` y el router lo envuelve solo. refundETH
  // devuelve lo que sobre, que si no se quedaria atrapado en el contrato.
  return [
    iface.encodeFunctionData('exactInputSingle', [{ tokenIn, tokenOut, fee, recipient: MSG_SENDER, amountIn: amtIn, amountOutMinimum: min, sqrtPriceLimitX96: 0 }]),
    iface.encodeFunctionData('refundETH', [])
  ];
}

async function swap({ rpc, secretHex, dir, amount, minOut }, onStep = () => {}) {
  const pr = nodo.proveedor(rpc);
  const w = new ethers.Wallet('0x' + String(secretHex).replace(/^0x/, ''), pr);
  const { tokenIn, tokenOut, decIn, decOut } = pathAndDec(dir);
  const amtIn = ethers.parseUnits(String(amount), decIn);
  const { fee, out } = await mejorPool(pr, tokenIn, tokenOut, amtIn);

  // SEGURIDAD (revisión 2026-07-21 #3): el suelo de slippage se ENLAZA al `min` que el usuario confirmó en el
  // quote. Antes se recalculaba del RPC justo antes de firmar, de modo que un RPC hostil podía mentir en el quote
  // (para colar su control visual) y volver a mentir al firmar (sandwich). Ahora se firma el mínimo aceptado.
  const min = (minOut != null && Number(minOut) > 0)
    ? ethers.parseUnits(Number(minOut).toFixed(decOut), decOut)
    : out - (out * 5n / 1000n);   // compat: sin quote enlazado, cae al cálculo fresco

  const out_ = {};
  const r = new ethers.Contract(ROUTER, R_ABI, w);
  if (dir === 'usdc2eth') {
    const t = new ethers.Contract(USDC, E_ABI, w);
    const allowance = await t.allowance(w.address, ROUTER);
    if (allowance < amtIn) { onStep({ step: 'approve', status: 'run', detail: 'Autorizando USDC…' }); const ap = await t.approve(ROUTER, amtIn); out_.approveHash = ap.hash; await nodo.esperarRecibo(pr, ap.hash); onStep({ step: 'approve', status: 'ok', detail: ap.hash }); }
    else onStep({ step: 'approve', status: 'skip', detail: 'ya autorizado' });
  } else {
    onStep({ step: 'approve', status: 'skip', detail: 'no hace falta con ETH' });
  }
  onStep({ step: 'swap', status: 'run', detail: 'Firmando swap…' });
  const datos = partes({ dir, fee, amtIn, min, cuenta: w.address });
  const tx = await r.multicall(datos, dir === 'eth2usdc' ? { value: amtIn } : {});
  out_.txHash = tx.hash;
  onStep({ step: 'swap', status: 'ok', detail: tx.hash });
  onStep({ step: 'confirm', status: 'run', detail: 'Esperando confirmación…' });
  const rc = await nodo.esperarRecibo(pr, tx.hash);
  out_.ok = rc.status === 1;
  onStep({ step: 'confirm', status: out_.ok ? 'ok' : 'fail', detail: 'bloque ' + rc.blockNumber });
  return out_;
}

module.exports = { quote, swap, partes, pathAndDec, ROUTER, USDC, WETH };
