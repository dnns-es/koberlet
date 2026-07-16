// Hora sincronizada con el NODO Kadena, inmune al reloj local (zona horaria/fecha mal puestas).
// Chainweb valida el creationTime de la tx contra el block-time de ESA chain. Pedimos ese block-time,
// calculamos el desfase con el reloj local y lo aplicamos: así la tx nunca "va al futuro" aunque
// el PC tenga la hora mal. OJO: cada chain tiene su propia hora de bloque (pueden diferir ~40s entre
// sí), así que se cachea el desfase POR CHAIN, no por nodo. Cache 2 min.
const blake = require('blakejs');

const _off = {}; // { [node|chain]: { at, offset } }  offset = segundos(block-time de esa chain) - segundos(local)

async function fetchOffset(node, networkId, chain) {
  const localSec = Math.floor(Date.now() / 1000);
  const cmd = JSON.stringify({
    networkId, payload: { exec: { code: '(at "block-time" (chain-data))', data: {} } }, signers: [],
    meta: { chainId: String(chain), sender: '', gasLimit: 150000, gasPrice: 1e-8, ttl: 60, creationTime: localSec - 90 },
    nonce: String(Date.now())
  });
  const hash = Buffer.from(blake.blake2b(Buffer.from(cmd, 'utf8'), null, 32)).toString('base64url');
  const base = `${node}/chainweb/0.0/${networkId}/chain/${chain}/pact/api/v1`;
  const r = await fetch(base + '/local?signatureVerification=false&preflight=false', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cmd, hash, sigs: [] }) });
  const j = await r.json();
  const bt = j && j.result && j.result.data;
  const iso = bt && (bt.timep || bt.time || bt);
  const nodeSec = Math.floor(new Date(iso).getTime() / 1000);
  if (!nodeSec || isNaN(nodeSec)) throw new Error('block-time ilegible');
  return nodeSec - localSec;
}

// Desfase cacheado POR CHAIN. Si no se puede leer, cae a un margen conservador (que la tx quede en el pasado).
async function offsetFor(node, networkId, chain) {
  const key = node + '|' + chain;
  const c = _off[key];
  if (c && Date.now() - c.at < 120000) return c.offset;
  try { const offset = await fetchOffset(node, networkId, chain); _off[key] = { at: Date.now(), offset }; return offset; }
  catch (_) { return c ? c.offset : -45; } // sin lectura: 45s atrás, margen seguro
}

// creationTime alineado con el reloj del nodo. `buffer` segundos extra hacia atrás (margen de seguridad).
async function creationTime(node, networkId, chain, buffer = 15) {
  const offset = await offsetFor(node, networkId, chain);
  return Math.floor(Date.now() / 1000) + offset - buffer;
}

module.exports = { creationTime, offsetFor };
