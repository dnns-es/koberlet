// Swap USDC <-> ETH en Uniswap V2 (Ethereum mainnet), no custodial. Pensado para
// reponer ETH de gas con USDC sin salir del monedero. OJO: el propio swap gasta ETH
// en gas — hay que hacerlo ANTES de quedarse a cero.
const { ethers } = require('ethers');

const ROUTER = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D'; // Uniswap V2 Router02
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const R_ABI = [
  'function getAmountsOut(uint,address[]) view returns (uint[])',
  'function swapExactTokensForETH(uint,uint,address[],address,uint) returns (uint[])',
  'function swapExactETHForTokens(uint,address[],address,uint) payable returns (uint[])'
];
const E_ABI = ['function allowance(address,address) view returns (uint256)', 'function approve(address,uint256) returns (bool)'];
const SLIP = 0.005; // 0,5%
const GAS_SWAP = 200000n; // estimación holgada para mostrar el coste

// dir: 'usdc2eth' (entregas USDC, recibes ETH) | 'eth2usdc'
function pathAndDec(dir) {
  return dir === 'usdc2eth' ? { path: [USDC, WETH], decIn: 6, decOut: 18 } : { path: [WETH, USDC], decIn: 18, decOut: 6 };
}

async function quote({ rpc, dir, amount }) {
  const pr = new ethers.JsonRpcProvider(rpc);
  const { path, decIn, decOut } = pathAndDec(dir);
  const amtIn = ethers.parseUnits(String(amount), decIn);
  const r = new ethers.Contract(ROUTER, R_ABI, pr);
  const outs = await r.getAmountsOut(amtIn, path);
  const out = outs[outs.length - 1];
  const min = out - (out * 5n / 1000n);
  let gasEth = null;
  try { const fee = await pr.getFeeData(); if (fee.gasPrice) gasEth = Number(ethers.formatEther(fee.gasPrice * GAS_SWAP)); } catch (_) {}
  return { out: Number(ethers.formatUnits(out, decOut)), min: Number(ethers.formatUnits(min, decOut)), gasEth, slipPct: SLIP * 100 };
}

async function swap({ rpc, secretHex, dir, amount }, onStep = () => {}) {
  const pr = new ethers.JsonRpcProvider(rpc);
  const w = new ethers.Wallet('0x' + String(secretHex).replace(/^0x/, ''), pr);
  const r = new ethers.Contract(ROUTER, R_ABI, w);
  const { path, decIn } = pathAndDec(dir);
  const amtIn = ethers.parseUnits(String(amount), decIn);
  const outs = await r.getAmountsOut(amtIn, path); // precio fresco justo antes de firmar
  const min = outs[1] - (outs[1] * 5n / 1000n);
  const deadline = Math.floor(Date.now() / 1000) + 900;
  const out = {};
  let tx;
  if (dir === 'usdc2eth') {
    const t = new ethers.Contract(USDC, E_ABI, w);
    const allowance = await t.allowance(w.address, ROUTER);
    if (allowance < amtIn) { onStep({ step: 'approve', status: 'run', detail: 'Autorizando USDC…' }); const ap = await t.approve(ROUTER, amtIn); out.approveHash = ap.hash; await ap.wait(); onStep({ step: 'approve', status: 'ok', detail: ap.hash }); }
    else onStep({ step: 'approve', status: 'skip', detail: 'ya autorizado' });
    onStep({ step: 'swap', status: 'run', detail: 'Firmando swap…' });
    tx = await r.swapExactTokensForETH(amtIn, min, path, w.address, deadline);
  } else {
    onStep({ step: 'approve', status: 'skip', detail: 'no hace falta con ETH' });
    onStep({ step: 'swap', status: 'run', detail: 'Firmando swap…' });
    tx = await r.swapExactETHForTokens(min, path, w.address, deadline, { value: amtIn });
  }
  out.txHash = tx.hash;
  onStep({ step: 'swap', status: 'ok', detail: tx.hash });
  onStep({ step: 'confirm', status: 'run', detail: 'Esperando confirmación…' });
  const rc = await tx.wait();
  out.ok = rc.status === 1;
  onStep({ step: 'confirm', status: out.ok ? 'ok' : 'fail', detail: 'bloque ' + rc.blockNumber });
  return out;
}

module.exports = { quote, swap };
