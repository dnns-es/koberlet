// EVM (Ethereum y compatibles): saldo del nativo + ERC-20, y envío. ethers v6. La misma dirección vale en todas.
const { ethers } = require('ethers');

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function transfer(address to, uint256 amount) returns (bool)'
];
// Un provider por RPC, reutilizado. Dos motivos, y los dos han dado la cara:
// - crear uno nuevo en cada consulta obliga a ethers a redescubrir la red cada vez;
// - sin `staticNetwork`, ethers v6 lanza una peticion de deteccion de red ANTES de cada
//   llamada. Contra un RPC publico con limite de peticiones esa deteccion falla con
//   "could not detect network" y se lleva por delante la consulta entera de saldos, que
//   es la diferencia entre ver tu saldo y ver un cartel de "sin conexion".
const _providers = new Map();
const provider = (rpc) => {
  let p = _providers.get(rpc);
  if (!p) { p = new ethers.JsonRpcProvider(rpc, undefined, { staticNetwork: true }); _providers.set(rpc, p); }
  return p;
};

// Tira el provider de un RPC (tras un fallo, o si el usuario cambia de nodo).
const olvidar = (rpc) => {
  const p = _providers.get(rpc);
  if (!p) return;
  _providers.delete(rpc);
  try { p.destroy && p.destroy(); } catch (_) { /* ya estaba muerto */ }
};

// Saldos en UNA red EVM: { native:number, tokens:[{symbol,address,amount}] }
async function getBalances(address, { rpc, tokens }) {
  const pr = provider(rpc);
  const out = { native: 0, tokens: [] };
  try {
    out.native = Number(ethers.formatEther(await pr.getBalance(address)));
  } catch (e) {
    // Un provider que no ha llegado ni a arrancar se queda reintentando la deteccion de red
    // en segundo plano indefinidamente. Si la consulta falla se tira y la proxima vez se crea
    // uno limpio: mejor pagar el arranque otra vez que dejar un zombie latiendo cada segundo.
    olvidar(rpc);
    throw e;
  }
  for (const t of (tokens || [])) {
    try {
      const c = new ethers.Contract(t.address, ERC20_ABI, pr);
      const [bal, dec] = await Promise.all([c.balanceOf(address), c.decimals()]);
      const amount = Number(ethers.formatUnits(bal, dec));
      if (amount > 0) out.tokens.push({ symbol: t.symbol, address: t.address, amount });
    } catch (_) { /* token ilegible en esta red */ }
  }
  return out;
}

async function sendNative({ rpc, secretHex, to, amount }) {
  const w = new ethers.Wallet('0x' + secretHex.replace(/^0x/, ''), provider(rpc));
  const tx = await w.sendTransaction({ to, value: ethers.parseEther(String(amount)) });
  return { hash: tx.hash };
}
async function sendToken({ rpc, secretHex, token, to, amount }) {
  const w = new ethers.Wallet('0x' + secretHex.replace(/^0x/, ''), provider(rpc));
  const c = new ethers.Contract(token, ERC20_ABI, w);
  const dec = await c.decimals();
  const tx = await c.transfer(to, ethers.parseUnits(String(amount), dec));
  return { hash: tx.hash };
}

module.exports = { getBalances, sendNative, sendToken };
