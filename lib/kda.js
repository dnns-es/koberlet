// Kadena: saldo (suma por chains) y envío (firma ed25519 con tweetnacl + hash blake2b).
const nacl = require('tweetnacl');
const blake = require('blakejs');

function hashCmd(cmdStr) {
  const h = blake.blake2b(Buffer.from(cmdStr, 'utf8'), null, 32); // 32 bytes
  return { bytes: h, b64url: Buffer.from(h).toString('base64url') };
}
function secretKey64(secretHex) {
  return nacl.sign.keyPair.fromSeed(Buffer.from(secretHex, 'hex')).secretKey;
}

async function local(node, networkId, chain, code) {
  const base = `${node}/chainweb/0.0/${networkId}/chain/${chain}/pact/api/v1`;
  const cmd = {
    networkId, payload: { exec: { code, data: {} } }, signers: [],
    meta: { chainId: String(chain), sender: '', gasLimit: 150000, gasPrice: 1e-8, ttl: 60, creationTime: Math.floor(Date.now() / 1000) },
    nonce: String(Date.now())
  };
  const cmdStr = JSON.stringify(cmd);
  const { b64url } = hashCmd(cmdStr);
  const res = await fetch(base + '/local?signatureVerification=false&preflight=false', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cmd: cmdStr, hash: b64url, sigs: [] })
  });
  const j = await res.json();
  return j.result;
}

// Saldo total sumando las chains indicadas (por defecto 0..19)
async function getBalance(account, { node, networkId, chains }) {
  const list = chains || Array.from({ length: 20 }, (_, i) => i);
  const perChain = {};
  let total = 0;
  await Promise.all(list.map(async (ch) => {
    try {
      const r = await local(node, networkId, ch, `(coin.get-balance "${account}")`);
      if (r && r.status === 'success') {
        const v = typeof r.data === 'object' ? Number(r.data.decimal || r.data) : Number(r.data);
        if (!isNaN(v) && v > 0) { perChain[ch] = v; total += v; }
      }
    } catch (_) { /* cuenta no existe en esa chain */ }
  }));
  return { total, perChain };
}

// Envía KDA en una chain. secretHex/publicHex = claves del remitente.
async function transfer({ node, networkId, chain, from, to, amount, secretHex, publicHex, gasLimit = 2500, gasPrice = 1e-8 }) {
  const amt = Number(amount);
  const clist = [
    { name: 'coin.GAS', args: [] },
    { name: 'coin.TRANSFER', args: [from, to, { decimal: String(amt) }] }
  ];
  const cmd = {
    networkId,
    payload: { exec: { code: `(coin.transfer "${from}" "${to}" ${amt.toFixed(12)})`, data: {} } },
    signers: [{ pubKey: publicHex, clist }],
    meta: { chainId: String(chain), sender: from, gasLimit, gasPrice, ttl: 600, creationTime: Math.floor(Date.now() / 1000) },
    nonce: 'monedero-dnns:' + Date.now()
  };
  const cmdStr = JSON.stringify(cmd);
  const { bytes, b64url } = hashCmd(cmdStr);
  const sig = Buffer.from(nacl.sign.detached(bytes, secretKey64(secretHex))).toString('hex');
  const body = { cmds: [{ hash: b64url, sigs: [{ sig }], cmd: cmdStr }] };
  const base = `${node}/chainweb/0.0/${networkId}/chain/${chain}/pact/api/v1`;
  const res = await fetch(base + '/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await res.json();
  if (!j.requestKeys) throw new Error('send falló: ' + JSON.stringify(j));
  return { requestKey: j.requestKeys[0], chain };
}

module.exports = { getBalance, transfer, local };
