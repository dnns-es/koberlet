// DCA de KoberluSW: planes de compra periodica sobre el contrato free.ksw-dca2
// (fork comunitario, mainnet01, chain 2).
//
// Reparto de papeles, importante para entender el codigo:
//   - el CONTRATO custodia el bote y hace la compra
//   - un VIGILANTE externo dispara las compras y paga SU PROPIO gas
//   - Koberlet NO ejecuta compras: solo crea, recarga, pausa, reanuda y cierra
//
// La transaccion se arma aqui y la firma el usuario. No se le pide a ningun servidor
// que nos prepare lo que vamos a firmar: un monedero entiende lo que firma, o no firma.
const nacl = require('tweetnacl');
const blake = require('blakejs');
const kda = require('./kda');
const ktime = require('./kdatime');

// Reglas leidas del contrato desplegado (28/08/2026). Se repiten aqui para poder avisar
// al usuario ANTES de firmar y gastar gas, no para sustituir al contrato.
const LIMITES = {
  idPrefijo: 10,        // ID-PREFIX-LEN: el id debe empezar por (take 10 owner)
  periodoMin: 300,      // MIN-PERIOD, segundos
  periodoMax: 31536000, // MAX-PERIOD, 365 dias
  slippageMax: 0.5,     // MAX-SLIPPAGE
  planesPorCuenta: 10,  // MAX-PLANS-PER-OWNER
  minKda: 100,          // MIN-IN-KDA   por compra
  minUsdc: 1            // MIN-IN-USDC  por compra
};
const MODULO_OK = /^[A-Za-z0-9_][A-Za-z0-9_.-]{1,120}$/;
const ID_OK = /^[A-Za-z0-9:_-]{3,64}$/;

function modOk(m, rol) {
  const s = String(m);
  if (!MODULO_OK.test(s)) throw new Error('Modulo ' + (rol || '') + ' no valido: ' + s);
  return s;
}
function idOk(id) {
  const s = String(id);
  if (!ID_OK.test(s)) throw new Error('Identificador de plan no valido.');
  return s;
}
// Un unico decimal canonico: el MISMO texto va al codigo Pact y a la capability. Si no
// coinciden, la firma no cubre exactamente lo que se ejecuta.
function dec(v, precision) {
  const n = Number(v);
  if (!isFinite(n) || n <= 0) throw new Error('Cantidad no valida.');
  return n.toFixed(Math.max(1, Math.min(12, precision | 0)));
}
// REGLA DEL CONTRATO (enforce-safe-id): el id tiene que empezar por los 10 primeros
// caracteres del dueño. Misma convencion que KoberluSW, para que los planes creados
// desde el monedero y desde la web sean indistinguibles.
function nuevoId(owner, ahora) {
  return String(owner).slice(0, LIMITES.idPrefijo) + '-' + (ahora || Date.now());
}

async function leer(cfg, code) {
  const r = await kda.local(cfg.node, cfg.networkId, cfg.chain, code);
  if (!r || r.status !== 'success') {
    throw new Error(String((r && r.error && r.error.message) || 'la cadena no respondio').slice(0, 200));
  }
  return r.data;
}

/**
 * Ordenes limite abiertas de una cuenta (contrato free.ksw2).
 * OJO: ese contrato NO tiene `orders-of`, solo `list-open`, que devuelve las de TODO el
 * mundo. Hay que filtrar por dueño aqui. Hoy son dos docenas y no duele, pero si eso
 * crece habra que pedirle al contrato una lectura por dueño.
 */
async function todasLasOrdenes(cfg) {
  if (!cfg.moduloOrdenes) return [];
  return (await leer(cfg, '(' + modOk(cfg.moduloOrdenes, 'de ordenes') + '.list-open)')) || [];
}
async function ordenesDe(cfg, cuenta) {
  kda.assertKdaAccount(cuenta, 'de consulta');
  return (await todasLasOrdenes(cfg)).filter((o) => String(o.owner) === String(cuenta));
}

const custodia = (cfg) => leer(cfg, '(' + modOk(cfg.modulo, 'DCA') + '.custody-account)');
const pausado = (cfg) => leer(cfg, '(' + modOk(cfg.modulo, 'DCA') + '.paused)');
const plan = (cfg, id) => leer(cfg, '(' + modOk(cfg.modulo, 'DCA') + '.get-plan "' + idOk(id) + '")');
function planesDe(cfg, cuenta) {
  kda.assertKdaAccount(cuenta, 'de consulta');
  return leer(cfg, '(' + modOk(cfg.modulo, 'DCA') + '.plans-of "' + cuenta + '")');
}

// Pact devuelve las referencias a modulo como objeto o como texto, segun version.
function refMod(v) {
  if (typeof v === 'string') return v;
  const r = (v && v.refName) || v;
  if (r && r.name) return (r.namespace ? r.namespace + '.' : '') + r.name;
  throw new Error('No se pudo leer el token del plan.');
}

function hashCmd(s) {
  const h = blake.blake2b(Buffer.from(s, 'utf8'), null, 32);
  return { bytes: h, b64url: Buffer.from(h).toString('base64url') };
}

async function firmarYEnviar(cfg, opciones) {
  const cmd = {
    networkId: cfg.networkId,
    payload: { exec: { code: opciones.code, data: opciones.data || {} } },
    signers: [{ pubKey: opciones.publicHex, clist: opciones.clist }],
    meta: {
      chainId: String(cfg.chain), sender: opciones.from, gasLimit: opciones.gasLimit || 6000,
      gasPrice: 1e-8, ttl: 600,
      creationTime: await ktime.creationTime(cfg.node, cfg.networkId, cfg.chain)
    },
    nonce: 'koberlet-dca:' + Date.now()
  };
  const cmdStr = JSON.stringify(cmd);
  const h = hashCmd(cmdStr);
  const par = nacl.sign.keyPair.fromSeed(Buffer.from(opciones.secretHex, 'hex'));
  const sig = Buffer.from(nacl.sign.detached(h.bytes, par.secretKey)).toString('hex');
  const base = cfg.node + '/chainweb/0.0/' + cfg.networkId + '/chain/' + cfg.chain + '/pact/api/v1';
  const res = await fetch(base + '/send', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cmds: [{ cmd: cmdStr, hash: h.b64url, sigs: [{ sig: sig }] }] })
  });
  const txt = await res.text();
  let j;
  try { j = JSON.parse(txt); }
  catch (_) { throw new Error('El nodo rechazo la transaccion: ' + txt.replace(/\s+/g, ' ').slice(0, 200)); }
  const rk = (j.requestKeys && j.requestKeys[0]) || null;
  if (!rk) throw new Error('El nodo no devolvio requestKey: ' + JSON.stringify(j).slice(0, 200));
  return { requestKey: rk };
}

// La cuenta tiene que ser el principal de SU clave: el contrato lo exige y, si no, el
// plan quedaria a nombre de un guard que no controlas.
function exigirDueno(owner, publicHex) {
  kda.assertKdaAccount(owner, 'de origen');
  if (!/^k:[0-9a-fA-F]{64}$/.test(owner)) {
    throw new Error('El DCA solo admite cuentas k: — el contrato exige que la cuenta sea el principal de su clave.');
  }
  if (owner.slice(2).toLowerCase() !== String(publicHex).toLowerCase()) {
    throw new Error('Esta wallet no es la dueña de esa cuenta.');
  }
}

/**
 * Crear un plan. Se firman EXACTAMENTE dos capabilities y ninguna mas:
 *   coin.GAS  y  <token-in>.TRANSFER dueño -> custodia por el deposito.
 */
async function crearPlan(cfg, o) {
  exigirDueno(o.owner, o.publicHex);
  const mod = modOk(cfg.modulo, 'DCA');
  const tIn = modOk(o.tokenIn, 'de entrada');
  const tOut = modOk(o.tokenOut, 'de salida');
  if (tIn === tOut) throw new Error('El token que entregas y el que compras tienen que ser distintos.');

  const per = Math.round(Number(o.periodo));
  const sl = Number(o.slippage);
  if (!(per >= LIMITES.periodoMin)) throw new Error('El periodo minimo es ' + LIMITES.periodoMin + ' segundos (5 minutos).');
  if (!(per <= LIMITES.periodoMax)) throw new Error('El periodo maximo es un año.');
  if (!(sl >= 0 && sl <= LIMITES.slippageMax)) throw new Error('El deslizamiento va de 0 a 0,5 (50%).');

  const dep = dec(o.deposito, o.precIn);
  const q = dec(o.cuota, o.precIn);
  if (Number(q) > Number(dep)) throw new Error('La cuota no puede superar el deposito.');
  const minimo = tIn === 'coin' ? LIMITES.minKda : LIMITES.minUsdc;
  if (Number(q) < minimo) {
    throw new Error('La cuota minima por compra es ' + minimo + ' ' + (tIn === 'coin' ? 'KDA' : 'kb-USDC') + '.');
  }

  // Comprobaciones que el contrato tambien hace, pero mejor fallar antes de gastar gas.
  const abiertos = await leer(cfg, '(' + mod + '.open-plans "' + o.owner + '")');
  const n = Number(abiertos && abiertos.int != null ? abiertos.int : abiertos);
  if (n >= LIMITES.planesPorCuenta) {
    throw new Error('Ya tienes ' + n + ' planes abiertos y el maximo es ' + LIMITES.planesPorCuenta + '.');
  }
  if (await pausado(cfg)) throw new Error('El contrato DCA esta pausado ahora mismo.');

  const cust = await custodia(cfg);
  const id = nuevoId(o.owner);
  const code = '(' + mod + '.create-plan "' + id + '" "' + o.owner + '" (read-keyset "ks") '
    + tIn + ' ' + tOut + ' ' + dep + ' ' + q + ' ' + per.toFixed(1) + ' ' + sl + ')';
  const clist = [
    { name: 'coin.GAS', args: [] },
    { name: tIn + '.TRANSFER', args: [o.owner, cust, { decimal: dep }] }
  ];
  const r = await firmarYEnviar(cfg, {
    code: code,
    data: { ks: { keys: [o.publicHex], pred: 'keys-all' } },
    clist: clist,
    from: o.owner, secretHex: o.secretHex, publicHex: o.publicHex, gasLimit: 12000
  });
  return Object.assign({}, r, { id: id });
}

/**
 * Recargar el bote.
 * AVISO QUE YA COSTO UN BUG EN KOBERLUSW: hay que firmar la capability del token DEL
 * BOTE, que no siempre es kb-USDC — si el plan es de venta, el bote es KDA. Firmar el
 * cap equivocado revierte SIEMPRE. Por eso se lee el plan y se usa su token-in.
 */
async function recargar(cfg, o) {
  exigirDueno(o.owner, o.publicHex);
  const mod = modOk(cfg.modulo, 'DCA');
  const p = await plan(cfg, o.id);
  if (String(p.owner) !== String(o.owner)) throw new Error('Ese plan no es de esta wallet.');
  if (String(p.status) === 'closed') throw new Error('Ese plan ya esta cerrado.');
  const tIn = modOk(refMod(p['token-in']), 'del bote');
  const prec = (o.precisiones && o.precisiones[tIn] != null) ? o.precisiones[tIn] : 12;
  const cust = await custodia(cfg);
  const amt = dec(o.cantidad, prec);
  return firmarYEnviar(cfg, {
    code: '(' + mod + '.topup "' + idOk(o.id) + '" ' + amt + ')',
    clist: [
      { name: 'coin.GAS', args: [] },
      { name: tIn + '.TRANSFER', args: [o.owner, cust, { decimal: amt }] }
    ],
    from: o.owner, secretHex: o.secretHex, publicHex: o.publicHex, gasLimit: 10000
  });
}

// Pausar, reanudar y cerrar solo exigen la firma del dueño (enforce-guard del plan):
// no llevan mas capability que el gas. Al cerrar, el contrato devuelve el bote restante.
async function accion(cfg, o) {
  exigirDueno(o.owner, o.publicHex);
  const fn = { pausar: 'pause-plan', reanudar: 'resume-plan', cerrar: 'close-plan' }[o.que];
  if (!fn) throw new Error('Accion no valida.');
  const p = await plan(cfg, o.id);
  if (String(p.owner) !== String(o.owner)) throw new Error('Ese plan no es de esta wallet.');
  return firmarYEnviar(cfg, {
    code: '(' + modOk(cfg.modulo, 'DCA') + '.' + fn + ' "' + idOk(o.id) + '")',
    clist: [{ name: 'coin.GAS', args: [] }],
    from: o.owner, secretHex: o.secretHex, publicHex: o.publicHex, gasLimit: 10000
  });
}

module.exports = { LIMITES, planesDe, ordenesDe, todasLasOrdenes, plan, custodia, pausado, crearPlan, recargar, accion, nuevoId, refMod };
