// Swap KDA <-> kb-USDC en el AMM del fork (kaddex.exchange, chain 2), no custodial.
// Reutiliza la firma ed25519 del monedero. Formato del swap = el mismo que KoberluSW en producción.
const nacl = require('tweetnacl');
const blake = require('blakejs');

// Config mainnet del fork (par KDA/kb-USDC en kaddex.exchange). Estable — es el ecosistema del fork.
const C = {
  node: 'https://api.chainweb-community.org',
  networkId: 'mainnet01',
  chain: '2',
  amm: 'kaddex.exchange',
  tokenKda: 'coin',
  tokenUsdc: 'n_e595727b657fbbb3b8e362a05a7bb8d12865c1ff.kb-USDC',
  pairAccount: '-qXygkgY9Y_Ld50QdjBng12LIXRqki4EovuF_OJ6DmA',
  decKda: 12, decUsdc: 6,
  feePool: 0.003,      // comisión del pool (0,3%)
  slippage: 0.005,     // tolerancia por defecto (0,5%)
  gasLimit: 8000, gasPrice: 1e-8, ttl: 600
};

const num = (v) => (v && typeof v === 'object') ? Number(v.decimal ?? v.int) : Number(v);
function hashCmd(s) { const h = blake.blake2b(Buffer.from(s, 'utf8'), null, 32); return { bytes: h, b64url: Buffer.from(h).toString('base64url') }; }

async function local(code) {
  const cmd = { networkId: C.networkId, payload: { exec: { code, data: {} } }, signers: [], meta: { chainId: C.chain, sender: '', gasLimit: 150000, gasPrice: 1e-8, ttl: 60, creationTime: Math.floor(Date.now() / 1000) - 90 }, nonce: String(Date.now()) };
  const cmdStr = JSON.stringify(cmd);
  const { b64url } = hashCmd(cmdStr);
  const base = `${C.node}/chainweb/0.0/${C.networkId}/chain/${C.chain}/pact/api/v1`;
  const r = await fetch(base + '/local?signatureVerification=false&preflight=false', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cmd: cmdStr, hash: b64url, sigs: [] }) });
  const j = await r.json();
  return j.result || {};
}

// Reservas del par -> { rk (KDA), ru (kb-USDC), precio (USDC por KDA) }
async function reservas() {
  const clave = `${C.tokenKda}:${C.tokenUsdc}`;
  const code = `(let ((p (${C.amm}.get-pair-by-key "${clave}"))) [(${C.amm}.reserve-for p ${C.tokenKda}) (${C.amm}.reserve-for p ${C.tokenUsdc})])`;
  const res = await local(code);
  if (res.status !== 'success') throw new Error('no pude leer la liquidez del pool: ' + JSON.stringify(res.error || res).slice(0, 140));
  const lista = res.data || [];
  const rk = num(lista[0]), ru = num(lista[1]);
  if (!(rk > 0) || !(ru > 0)) throw new Error('reservas no positivas');
  return { rk, ru, precio: ru / rk };
}

// AMM x*y=k con fee del pool. dir='compra' (kb-USDC->KDA) | 'venta' (KDA->kb-USDC)
function amountOut(dir, amountIn, rk, ru, slippage = C.slippage) {
  const [rin, rout] = dir === 'compra' ? [ru, rk] : [rk, ru];
  const ef = amountIn * (1 - C.feePool);
  const esperada = ef * rout / (rin + ef);
  const minimo = esperada * (1 - slippage);
  return { esperada, minimo };
}

async function quote(dir, amountIn) {
  const amt = Number(amountIn);
  if (!(amt > 0)) throw new Error('cantidad debe ser > 0');
  const { rk, ru, precio } = await reservas();
  const { esperada, minimo } = amountOut(dir, amt, rk, ru);
  const rin = dir === 'compra' ? ru : rk;
  const impacto = amt / (rin + amt) * 100;
  return {
    dir, amountIn: amt, esperada, minimo, precio, impacto,
    slippagePct: C.slippage * 100,
    tokenIn: dir === 'compra' ? 'kb-USDC' : 'KDA',
    tokenOut: dir === 'compra' ? 'KDA' : 'kb-USDC',
    decOut: dir === 'compra' ? C.decKda : C.decUsdc
  };
}

// Firma y envía el swap. minOut ya calculado (o se recalcula fresco). account=k:, secret=seed 64hex, pub=64hex.
async function swap({ dir, amountIn, account, publicHex, secretHex, slippage }) {
  if (!/^k:[0-9a-fA-F]{64}$/.test(String(account))) throw new Error('Cuenta Kadena inválida.'); // Alex #5: no interpolar cuentas sin validar
  const { rk, ru } = await reservas();                          // lectura fresca justo antes de firmar
  const { minimo } = amountOut(dir, Number(amountIn), rk, ru, slippage ?? C.slippage);
  const minOut = minimo.toFixed(dir === 'compra' ? C.decKda : C.decUsdc);
  const [tin, tout] = dir === 'compra' ? [C.tokenUsdc, C.tokenKda] : [C.tokenKda, C.tokenUsdc];
  const code = `(${C.amm}.swap-exact-in (read-decimal "amountIn") (read-decimal "amountOutMin") [${tin} ${tout}] "${account}" "${account}" (read-keyset "ks"))`;
  const envData = { amountIn: { decimal: String(amountIn) }, amountOutMin: { decimal: String(minOut) }, ks: { keys: [publicHex], pred: 'keys-all' } };
  const clist = [
    { name: 'coin.GAS', args: [] },
    { name: `${tin}.TRANSFER`, args: [account, C.pairAccount, { decimal: String(amountIn) }] }
  ];
  const cmdObj = { networkId: C.networkId, payload: { exec: { code, data: envData } }, signers: [{ pubKey: publicHex, clist }], meta: { chainId: C.chain, sender: account, gasLimit: C.gasLimit, gasPrice: C.gasPrice, ttl: C.ttl, creationTime: Math.floor(Date.now() / 1000) - 90 }, nonce: 'monedero-swap:' + Date.now() };
  const cmdStr = JSON.stringify(cmdObj);
  const { bytes, b64url } = hashCmd(cmdStr);
  const kp = nacl.sign.keyPair.fromSeed(Buffer.from(secretHex, 'hex'));
  const sig = Buffer.from(nacl.sign.detached(bytes, kp.secretKey)).toString('hex');
  const base = `${C.node}/chainweb/0.0/${C.networkId}/chain/${C.chain}/pact/api/v1`;
  const res = await fetch(base + '/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cmds: [{ hash: b64url, sigs: [{ sig }], cmd: cmdStr }] }) });
  const j = await res.json();
  if (!j.requestKeys) throw new Error('el nodo rechazó el swap: ' + JSON.stringify(j).slice(0, 200));
  return { requestKey: j.requestKeys[0], minOut };
}

module.exports = { quote, swap, reservas, C };
