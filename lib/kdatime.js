// Hora sincronizada con el reloj REAL del nodo Kadena, inmune al reloj local (zona horaria/fecha mal).
// Chainweb valida el creationTime de la tx contra el RELOJ DEL NODO (no el block-time): la rechaza si va
// por delante (unos segundos de tolerancia) o si `creationTime + ttl` ya pasó (caducada). Con ttl 600 la
// ventana buena es [nodo-580s, nodo]. Tomamos el reloj del nodo de la cabecera HTTP `Date` (fiable, común
// a todas las chains, no depende de que las chains estén al día) y fechamos 45s atrás: centrado y seguro.
// (Probado empíricamente contra el fork: +15s→futuro, 0..-580s→OK, -600s→caducada.)

const _off = {}; // { [node]: { at, offset } }  offset = segundos(reloj nodo) - segundos(reloj local)

async function fetchOffset(node, networkId) {
  const local = Math.floor(Date.now() / 1000);
  const r = await fetch(`${node}/chainweb/0.0/${networkId}/cut`, { method: 'GET' });
  const d = r.headers.get('date');
  const nodeSec = Math.floor(new Date(d).getTime() / 1000);
  if (!nodeSec || isNaN(nodeSec)) throw new Error('cabecera Date ilegible');
  return nodeSec - local;
}

// Desfase cacheado con el nodo (2 min). Si no se puede leer, cae a 0 (usará solo el buffer local).
async function offsetFor(node, networkId) {
  const c = _off[node];
  if (c && Date.now() - c.at < 120000) return c.offset;
  try { const offset = await fetchOffset(node, networkId); _off[node] = { at: Date.now(), offset }; return offset; }
  catch (_) { return c ? c.offset : 0; }
}

// creationTime alineado con el reloj del nodo, 45s atrás (centro de la ventana válida).
// El parámetro `chain` se ignora (la validación es del nodo, no por chain); se mantiene por compatibilidad.
async function creationTime(node, networkId, _chain, buffer = 45) {
  const offset = await offsetFor(node, networkId);
  return Math.floor(Date.now() / 1000) + offset - buffer;
}

module.exports = { creationTime, offsetFor };
