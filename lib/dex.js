// Koberlet - Copyright 2026 DNNS.es (Oberluss)
// SPDX-License-Identifier: Apache-2.0

// Mercado Kadena: cambiar cualquier token del DEX del fork por cualquier otro.
//
// El `lib/swap.js` de siempre solo sabe hacer KDA <-> kb-USDC, que es el par que usa el
// resto de la app. Esto es lo mismo pero general: se lee el mercado entero de la cadena y
// el usuario elige las dos puntas.
//
// Dos cosas que conviene tener claras sobre este DEX antes de tocar nada:
//
//  1. Casi todo son charcos. De los 82 pares, 44 no llegan a 1.000 KDA de fondo. Con esa
//     liquidez, cualquier cambio de tamaño normal mueve el precio una barbaridad.
//  2. Hay precios sin ningún sentido. `cBTC` cotiza a 104 KDA la unidad cuando un bitcoin
//     de verdad son cientos de miles; `bro` a 449.547 KDA. Nadie garantiza que el precio
//     del pool tenga que ver con el del mundo real.
//
// Por eso esto NO ofrece un catálogo bonito de tokens elegidos a mano: lee lo que hay,
// enseña el fondo y el precio que sale, y FRENA en seco por encima del 10% de impacto.
// El usuario decide, pero decide viendo los números.
const nacl = require('tweetnacl');
const blake = require('blakejs');
const ktime = require('./kdatime');

const AMM = 'kaddex.exchange';
const KDA = 'coin';
const FEE = 0.003;             // comisión del pool, 0,3%
const IMPACTO_MAX = 10;        // el freno, en %
const FONDO_MIN = 1000;        // por debajo de esto no se lista: es un charco
const GAS_1 = 8000, GAS_2 = 14000, GAS_PRECIO = 1e-8, TTL = 600;

// Comisión de servicio de Koberlet: se descuenta de lo que ENTRA, antes del cambio, y
// viaja en la misma transacción. Si el cambio revierte no se cobra nada, y si la
// comisión no se puede pagar no hay cambio. La cuenta y el porcentaje, en `comision.js`.
const { FEE: FEE_DNNS, KDA_CUENTA: CUENTA_DNNS, KDA_CLAVE: CLAVE_DNNS, reparto } = require('./comision');

const num = (v) => (v && typeof v === 'object') ? Number(v.decimal != null ? v.decimal : v.int) : Number(v);
const hashCmd = (s) => {
  const h = blake.blake2b(Buffer.from(s, 'utf8'), null, 32);
  return { bytes: h, b64url: Buffer.from(h).toString('base64url') };
};

async function local(cfg, code) {
  const cmd = {
    networkId: cfg.networkId, payload: { exec: { code, data: {} } }, signers: [],
    meta: { chainId: String(cfg.chain), sender: '', gasLimit: 150000, gasPrice: 1e-8, ttl: 60, creationTime: Math.floor(Date.now() / 1000) - 90 },
    nonce: String(Date.now())
  };
  const s = JSON.stringify(cmd);
  const r = await fetch(cfg.node + '/chainweb/0.0/' + cfg.networkId + '/chain/' + cfg.chain + '/pact/api/v1/local?signatureVerification=false&preflight=false',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cmd: s, hash: hashCmd(s).b64url, sigs: [] }) });
  const j = await r.json();
  return j.result || {};
}

// Todo el mercado en UNA sola llamada: el objeto del par ya trae las reservas dentro de
// leg0/leg1, así que los 82 pares caben en una petición en vez de 164.
//
// El `try` no es adorno: hay pares rotos en el DEX cuyo módulo ni siquiera carga, y sin
// él se caería la lectura entera por culpa de uno solo. Salen con r0 = -1 y se descartan.
//
// Aquí NO se pide la precisión de los tokens, aunque el modref del leg la sabría dar:
// `lago.USD2` está tan roto que preguntársela no da un error normal, da un «Execution
// Invariant error» del intérprete que ni `try` atrapa y que tumba la petición completa.
// La precisión se pide suelta, y solo del token que se vaya a usar.
const CODE_MERCADO = '(map (lambda (k)'
  + ' (try { "k": k, "cuenta": "", "r0": -1.0, "r1": -1.0 }'
  + '   (let ((p (' + AMM + '.get-pair-by-key k)))'
  + '     { "k": k, "cuenta": (at \'account p),'
  + '       "r0": (at \'reserve (at \'leg0 p)), "r1": (at \'reserve (at \'leg1 p)) })))'
  + ' (' + AMM + '.get-pairs))';

// Precisión por token, cacheada: la misma pregunta no se repite en toda la sesión.
const PREC = new Map();
async function precisionDe(cfg, modulo) {
  if (modulo === KDA) return 12;
  if (PREC.has(modulo)) return PREC.get(modulo);
  const r = await local(cfg, '(' + modulo + '.precision)');
  if (r.status !== 'success') {
    throw new Error('El token ' + modulo.split('.').pop() + ' no responde: su contrato está roto o no existe.');
  }
  const p = Number(num(r.data));
  if (!(p >= 0 && p <= 30)) throw new Error('El token ' + modulo.split('.').pop() + ' devuelve una precisión rara.');
  PREC.set(modulo, p);
  return p;
}

/**
 * El mercado tal y como está ahora mismo: qué se puede cambiar por qué, con cuánto fondo.
 * Solo se listan los pares contra KDA, que son los que permiten enrutar cualquier cosa
 * con cualquier cosa pasando por el medio.
 */
async function mercado(cfg) {
  const r = await local(cfg, CODE_MERCADO);
  if (r.status !== 'success') {
    throw new Error('No pude leer el mercado: ' + String((r.error && r.error.message) || '').slice(0, 160));
  }
  const pares = [];
  for (const x of (r.data || [])) {
    const [a, b] = String(x.k).split(':');
    if (!a || !b) continue;
    const ra = num(x.r0), rb = num(x.r1);
    if (!(ra > 0) || !(rb > 0)) continue;
    pares.push({
      clave: x.k, cuenta: String(x.cuenta), t0: a, t1: b, r0: ra, r1: rb
    });
  }
  // Un token por cada par contra KDA. Los pares entre dos tokens sin KDA en medio se
  // ignoran: enrutar por ellos complicaría el camino sin ganar nada.
  const tokens = [];
  for (const p of pares) {
    const conKda = p.t0 === KDA ? 1 : (p.t1 === KDA ? 0 : -1);
    if (conKda < 0) continue;
    const modulo = conKda === 1 ? p.t1 : p.t0;
    const reservaKda = conKda === 1 ? p.r0 : p.r1;
    const reservaTok = conKda === 1 ? p.r1 : p.r0;
    if (reservaKda < FONDO_MIN) continue;
    tokens.push({
      modulo, simbolo: modulo.split('.').pop(),
      fondoKda: reservaKda, reservaTok, precioKda: reservaKda / reservaTok,
      par: p.clave, cuentaPar: p.cuenta
    });
  }
  tokens.sort((x, y) => y.fondoKda - x.fondoKda);
  return { tokens, pares, kda: { modulo: KDA, simbolo: 'KDA', precision: 12 } };
}

// AMM x*y=k con la comisión del pool ya descontada.
function salidaHop(entrada, rin, rout) {
  const ef = entrada * (1 - FEE);
  return ef * rout / (rin + ef);
}

function buscaPar(m, a, b) {
  const p = m.pares.find(x => (x.t0 === a && x.t1 === b) || (x.t0 === b && x.t1 === a));
  if (!p) return null;
  const dir = p.t0 === a;
  return { par: p, rin: dir ? p.r0 : p.r1, rout: dir ? p.r1 : p.r0 };
}

/**
 * Cotización. Si hay par directo se va por él; si no, se pasa por KDA en dos saltos,
 * que el `swap-exact-in` del AMM admite un camino entero en una sola transacción.
 *
 * El impacto se mide contra el precio que tendría el pool si el cambio fuese infinitamente
 * pequeño: es lo que de verdad se paga de más por mover el precio, comisión aparte.
 */
async function cotizar(cfg, m, de, a, cantidad, slippage) {
  const cant = Number(cantidad);
  if (!(cant > 0)) throw new Error('La cantidad tiene que ser mayor que cero.');
  if (de === a) throw new Error('Son el mismo token.');
  const slip = slippage == null ? 0.005 : Number(slippage);

  let camino, hops;
  const directo = buscaPar(m, de, a);
  if (directo) {
    camino = [de, a];
    hops = [directo];
  } else {
    const h1 = buscaPar(m, de, KDA), h2 = buscaPar(m, KDA, a);
    if (!h1 || !h2) throw new Error('No hay camino entre esos dos tokens en este mercado.');
    camino = [de, KDA, a];
    hops = [h1, h2];
  }

  // La comisión de Koberlet se aparta ANTES: al pool entra lo que queda. Si el mínimo
  // se calculase sobre el bruto quedaría por encima de lo que el pool puede dar con el
  // neto, y el cambio revertiría siempre.
  const decIn = await precisionDe(cfg, de);
  const { comision, alPool, comisionStr, alPoolStr } = reparto(cant, decIn);
  if (!(alPool > 0)) throw new Error('Esa cantidad es demasiado pequeña para este token.');

  // Precio si el cambio fuese infinitamente pequeño, encadenando los saltos.
  let spot = 1;
  for (const h of hops) spot *= h.rout / h.rin;
  // Salida de verdad: cada salto es su propio pool y come de lo que salió del anterior.
  let x = alPool;
  for (const h of hops) x = salidaHop(x, h.rin, h.rout);

  // El impacto se mide sobre lo que de verdad entra en el pool: la comisión se enseña
  // aparte y contarla aquí la contaría dos veces, además de acercar el freno del 10%.
  const ideal = alPool * spot;
  const impacto = ideal > 0 ? Math.max(0, (1 - x / ideal) * 100) : 100;
  // El minimo de salida tiene que caber en la precision del token, o el contrato lo
  // rechaza por `enforce-unit`. Doce decimales para un token de seis no valen.
  const decOut = await precisionDe(cfg, a);
  const minimo = x * (1 - slip);
  return {
    camino, esperada: x, minimo, minimoStr: minimo.toFixed(decOut), decOut,
    impacto, impactoMax: IMPACTO_MAX, frenado: impacto > IMPACTO_MAX,
    comision, alPool, comisionStr, alPoolStr, decIn, comisionPct: FEE_DNNS * 100,
    precioEfectivo: x / cant, precioSpot: spot, slippagePct: slip * 100,
    cuentaPrimerPar: hops[0].par.cuenta, saltos: hops.length,
    fondoEntrada: hops[0].rin
  };
}

/**
 * Firma y envía el cambio. Se relee el mercado justo antes: entre que se cotiza y se firma
 * el pool ha podido moverse, y el mínimo de salida tiene que salir de reservas frescas.
 *
 * El freno del 10% se vuelve a comprobar aquí, no solo en la pantalla: el renderer puede
 * mentir, la cadena no.
 */
async function cambiar(cfg, o) {
  if (!/^k:[0-9a-fA-F]{64}$/.test(String(o.cuenta))) throw new Error('Cuenta Kadena no válida.');
  if (String(o.cuenta).slice(2).toLowerCase() !== String(o.publicHex).toLowerCase()) {
    throw new Error('Esta wallet no es la dueña de esa cuenta.');
  }
  const m = await mercado(cfg);
  const q = await cotizar(cfg, m, o.de, o.a, o.cantidad, o.slippage);
  if (q.frenado) {
    throw new Error('Cambio detenido: moverías el precio un ' + q.impacto.toFixed(1) +
      '%, y el límite está en el ' + IMPACTO_MAX + '%. Prueba con menos cantidad: en este pool no hay fondo para tanto.');
  }

  const camino = q.camino.join(' ');
  const cambio = '(' + AMM + '.swap-exact-in (read-decimal "amountIn") (read-decimal "amountOutMin") ['
    + camino + '] "' + o.cuenta + '" "' + o.cuenta + '" (read-keyset "ks"))';
  // El cambio y el cobro, atados en una sola transacción: o pasan las dos cosas o no
  // pasa ninguna. `transfer-create` porque la cuenta que cobra puede no existir aún en
  // el token que entra.
  const code = q.comision > 0
    ? '(let ((r ' + cambio + ')) (' + o.de + '.transfer-create "' + o.cuenta + '" "' + CUENTA_DNNS
      + '" (read-keyset "ks-koberlet") (read-decimal "comision")) r)'
    : cambio;
  const envData = {
    amountIn: { decimal: q.alPoolStr },
    amountOutMin: { decimal: q.minimoStr },
    ks: { keys: [o.publicHex], pred: 'keys-all' }
  };
  const clist = [
    { name: 'coin.GAS', args: [] },
    // La primera pata sale de la cuenta del usuario y entra en el pool del primer salto.
    { name: o.de + '.TRANSFER', args: [o.cuenta, q.cuentaPrimerPar, { decimal: q.alPoolStr }] }
  ];
  if (q.comision > 0) {
    envData.comision = { decimal: q.comisionStr };
    envData['ks-koberlet'] = { keys: [CLAVE_DNNS], pred: 'keys-all' };
    // La firma acota el cobro: esa cuenta y esa cifra exacta, ni un céntimo más.
    clist.push({ name: o.de + '.TRANSFER', args: [o.cuenta, CUENTA_DNNS, { decimal: q.comisionStr }] });
  }
  const cmd = {
    networkId: cfg.networkId,
    payload: { exec: { code, data: envData } },
    signers: [{ pubKey: o.publicHex, clist }],
    meta: {
      chainId: String(cfg.chain), sender: o.cuenta,
      // Con la comisión la transacción lleva una transferencia más: el gas sube con ella.
      gasLimit: (q.saltos === 1 ? GAS_1 : GAS_2) + (q.comision > 0 ? 4000 : 0),
      gasPrice: GAS_PRECIO, ttl: TTL,
      creationTime: await ktime.creationTime(cfg.node, cfg.networkId, cfg.chain)
    },
    nonce: 'koberlet-dex:' + Date.now()
  };
  const cmdStr = JSON.stringify(cmd);
  const { bytes, b64url } = hashCmd(cmdStr);
  const kp = nacl.sign.keyPair.fromSeed(Buffer.from(o.secretHex, 'hex'));
  const sig = Buffer.from(nacl.sign.detached(bytes, kp.secretKey)).toString('hex');
  const res = await fetch(cfg.node + '/chainweb/0.0/' + cfg.networkId + '/chain/' + cfg.chain + '/pact/api/v1/send',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cmds: [{ hash: b64url, sigs: [{ sig }], cmd: cmdStr }] }) });
  const txt = await res.text();
  let j;
  try { j = JSON.parse(txt); }
  catch (_) { throw new Error('El nodo rechazó el cambio: ' + txt.replace(/\s+/g, ' ').slice(0, 200)); }
  if (!j.requestKeys || !j.requestKeys[0]) {
    throw new Error('El nodo no devolvió requestKey: ' + JSON.stringify(j).slice(0, 200));
  }
  return {
    requestKey: j.requestKeys[0], chain: String(cfg.chain), minimo: q.minimoStr,
    camino: q.camino, impacto: q.impacto, comision: q.comisionStr, alPool: q.alPoolStr
  };
}

module.exports = {
  mercado, cotizar, cambiar, precisionDe, reparto,
  IMPACTO_MAX, FONDO_MIN, FEE_DNNS, CUENTA_DNNS, CLAVE_DNNS
};
