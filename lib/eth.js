// EVM (Ethereum y compatibles): saldo del nativo + ERC-20, y envío. ethers v6. La misma dirección vale en todas.
const { ethers } = require('ethers');

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function transfer(address to, uint256 amount) returns (bool)'
];
const provider = (rpc) => new ethers.JsonRpcProvider(rpc);

// Saldos en UNA red EVM: { native:number, tokens:[{symbol,address,amount}] }
async function getBalances(address, { rpc, tokens }) {
  const pr = provider(rpc);
  const out = { native: 0, tokens: [] };
  out.native = Number(ethers.formatEther(await pr.getBalance(address)));
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
