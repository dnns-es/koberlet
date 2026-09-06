// Ventas directas (Launch): comprar un token a precio fijo contra su contrato, sin pool
// y sin comisión. La primera es SPT, el token de Alex, que se vende desde KoberluSW.
//
// No hay AMM por medio: el contrato guarda una reserva y te la vende al precio que
// tenga puesto. Por eso no hay deslizamiento que valga — o hay reserva o no la hay.
//
// El catálogo de lanzamientos vive en el DEFAULT de main.js, nunca en la configuración
// del usuario: el renderer elige por clave, no manda direcciones de contrato.
const nacl = require('tweetnacl');
const blake = require('blakejs');
const kda = require('./kda');
const ktime = require('./kdatime');

const MODULO_OK = /^[A-Za-z0-9_][A-Za-z0-9_.-]{1,120}$/;
const GAS_MARGEN = 0.02;        // el gas real ronda 0,0001 KDA; margen holgado

function modOk(m, rol) {
  const s = String(m);
  if (!MODULO_OK.test(s)) throw new Error('Modulo ' + (rol || '') + ' no valido: ' + s);
  return s;
}

async function leer(cfg, code) {
  const r = await kda.local(cfg.node, cfg.networkId, cfg.chain, code);
  if (!r || r.status !== 'success') {
    throw new Error(String((r && r.error && r.error.message) || 'la cadena no respondio').slice(0, 200));
  }
  return r.data;
}
function num(v) {
  const n = Number(typeof v === 'object' && v ? (v.decimal != null ? v.decimal : v.int) : v);
  return isFinite(n) ? n : 0;
}

/**
 * Coste EXACTO, con enteros. El contrato hace `(floor (* amount price) 12)` y la
 * capability que firma el comprador tiene que llevar ESE mismo número: si se calcula
 * con coma flotante, un céntimo de diferencia y la firma no cubre la transferencia.
 */
function coste(cantidad, precio, decimales) {
  const d = decimales == null ? 12 : decimales;
  const esc = (x) => {
    const [ent, dec = ''] = String(x).split('.');
    return BigInt(ent + (dec + '0'.repeat(d)).slice(0, d));      // escalado a 10^d
  };
  const prod = esc(cantidad) * esc(precio);                       // ahora va a 10^(2d)
  const truncado = prod / (10n ** BigInt(d));                     // floor a 10^d
  const s = truncado.toString().padStart(d + 1, '0');
  return (s.slice(0, -d) + '.' + s.slice(-d)).replace(/^(-?)0+(\d)/, '$1$2');
}

/** Todo lo que hay que saber de una venta antes de comprar. */
async function estado(cfg) {
  const m = modOk(cfg.modulo, 'de la venta');
  const tok = modOk(cfg.token, 'del token');
  const [activa, precio, precioMin, cReserva, cIngresos] = await Promise.all([
    leer(cfg, '(' + m + '.is-active)'),
    leer(cfg, '(' + m + '.get-price)'),
    leer(cfg, '(' + m + '.get-min-price)').catch(() => null),
    leer(cfg, '(' + m + '.reserve-account)'),
    leer(cfg, '(' + m + '.proceeds-account)')
  ]);
  const restante = await leer(cfg, '(' + tok + '.get-balance "' + cReserva + '")').catch(() => 0);
  return {
    activa: !!activa, precio: num(precio), precioMin: precioMin == null ? null : num(precioMin),
    restante: num(restante), cuentaReserva: String(cReserva), cuentaIngresos: String(cIngresos),
    chain: String(cfg.chain), modulo: m, token: tok
  };
}

/**
 * Comprar. El comprador firma EXACTAMENTE dos capabilities:
 *   coin.GAS  y  coin.TRANSFER comprador -> cuenta de ingresos, por el coste.
 * El `SPT.TRANSFER` desde la reserva lo instala el contrato por dentro; el comprador
 * no tiene por qué firmar nada del token que recibe.
 *
 * OJO con la chain: la venta vive en la 0 y Koberlet opera en la 2. Aquí no basta con
 * tener gas — hace falta el importe ENTERO en esa chain, y por eso se avisa antes.
 */
async function comprar(cfg, o) {
  const m = modOk(cfg.modulo, 'de la venta');
  kda.assertKdaAccount(o.comprador, 'de origen');
  if (!/^k:[0-9a-fA-F]{64}$/.test(o.comprador)) {
    throw new Error('La compra solo admite cuentas k:: el contrato crea tu cuenta del token con tu clave.');
  }
  if (o.comprador.slice(2).toLowerCase() !== String(o.publicHex).toLowerCase()) {
    throw new Error('Esta wallet no es la dueña de esa cuenta.');
  }

  const est = await estado(cfg);
  if (!est.activa) throw new Error('La venta no está abierta ahora mismo.');
  const cant = Number(o.cantidad);
  if (!(cant > 0)) throw new Error('Cantidad no válida.');
  if (cant > est.restante) {
    throw new Error('Solo quedan ' + est.restante + ' en la reserva y pides ' + cant + '.');
  }

  const cantStr = Number(cant).toFixed(cfg.precision == null ? 12 : cfg.precision);
  const costeStr = coste(cantStr, est.precio, 12);

  // Aviso antes de firmar: aquí hace falta el importe entero MÁS el gas, en esta chain.
  let libre = 0;
  try {
    const r = await kda.local(cfg.node, cfg.networkId, cfg.chain, '(coin.get-balance "' + o.comprador + '")');
    if (r && r.status === 'success') libre = num(r.data);
    else if (/no value found|row not found|no such key/i.test(String((r && r.error && r.error.message) || ''))) libre = 0;
    else libre = null;                                   // nodo raro: no se bloquea
  } catch (_) { libre = null; }
  if (libre !== null && libre < Number(costeStr) + GAS_MARGEN) {
    throw new Error(
      'Te faltan KDA en la chain ' + cfg.chain + '. La compra cuesta ' + costeStr +
      ' KDA más el gas, y ahí tienes ' + libre + '. La venta vive en la chain ' + cfg.chain +
      ' y Koberlet opera en la 2, así que manda antes el KDA a esa chain.'
    );
  }

  const code = '(' + m + '.buy "' + o.comprador + '" (read-keyset "ks") ' + cantStr + ')';
  const clist = [
    { name: 'coin.GAS', args: [] },
    { name: 'coin.TRANSFER', args: [o.comprador, est.cuentaIngresos, { decimal: costeStr }] }
  ];
  const cmd = {
    networkId: cfg.networkId,
    payload: { exec: { code: code, data: { ks: { keys: [o.publicHex], pred: 'keys-all' } } } },
    signers: [{ pubKey: o.publicHex, clist: clist }],
    meta: {
      chainId: String(cfg.chain), sender: o.comprador, gasLimit: 12000, gasPrice: 1e-8, ttl: 600,
      creationTime: await ktime.creationTime(cfg.node, cfg.networkId, cfg.chain)
    },
    nonce: 'koberlet-launch:' + Date.now()
  };
  const cmdStr = JSON.stringify(cmd);
  const h = blake.blake2b(Buffer.from(cmdStr, 'utf8'), null, 32);
  const par = nacl.sign.keyPair.fromSeed(Buffer.from(o.secretHex, 'hex'));
  const sig = Buffer.from(nacl.sign.detached(h, par.secretKey)).toString('hex');
  const base = cfg.node + '/chainweb/0.0/' + cfg.networkId + '/chain/' + cfg.chain + '/pact/api/v1';
  const res = await fetch(base + '/send', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cmds: [{ cmd: cmdStr, hash: Buffer.from(h).toString('base64url'), sigs: [{ sig: sig }] }] })
  });
  const txt = await res.text();
  let j;
  try { j = JSON.parse(txt); }
  catch (_) { throw new Error('El nodo rechazo la compra: ' + txt.replace(/\s+/g, ' ').slice(0, 200)); }
  const rk = (j.requestKeys && j.requestKeys[0]) || null;
  if (!rk) throw new Error('El nodo no devolvio requestKey: ' + JSON.stringify(j).slice(0, 200));
  return { requestKey: rk, chain: String(cfg.chain), cantidad: cantStr, coste: costeStr };
}

module.exports = { estado, comprar, coste };
