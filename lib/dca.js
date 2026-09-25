// Koberlet - Copyright 2026 DNNS.es (Oberluss)
// SPDX-License-Identifier: Apache-2.0

// DCA de KoberluSW: planes de compra periodica sobre los contratos free.ksw-dca2
// (KDA <-> kb-USDC) y free.ksw-dca3 (kb-ETH, FLUX y bro contra KDA), en el fork
// comunitario, mainnet01, chain 2. El modulo llega siempre en cfg.modulo.
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

// Topes que exige el contrato de la gasolinera. Pasarse de aqui y la tx no se paga.
const GASO_LIMITE = 8000;      // MAX-GASLIMIT del contrato
const GASO_PRECIO = 1e-8;      // MAX-GASPRICE
const GASO_MIN = 0.05;         // por debajo se da por vacia y paga el usuario

/**
 * (cuenta, saldo) de la gasolinera, o null si no puede pagar.
 * Nunca se deja una operacion sin poder firmarse por esto: si la gasolinera no
 * responde o esta seca, se vuelve a que pague el usuario.
 */
async function gasolinera(cfg) {
  if (!cfg.gasolinera) return null;
  try {
    const mod = modOk(cfg.gasolinera, 'de la gasolinera');
    const [cuenta, saldo] = await Promise.all([leer(cfg, '(' + mod + '.cuenta)'), leer(cfg, '(' + mod + '.saldo)')]);
    const s = Number(typeof saldo === 'object' && saldo ? (saldo.decimal != null ? saldo.decimal : saldo) : saldo);
    if (!cuenta || !isFinite(s) || s < GASO_MIN) return null;
    return { cuenta: String(cuenta), saldo: s, modulo: mod };
  } catch (_) { return null; }
}

async function firmarYEnviar(cfg, opciones) {
  // Si la gasolinera de KoberluSW puede, paga ella: asi no hace falta tener KDA suelto
  // en la chain 2 para operar. Su GAS_PAYER exige `tx-type` y `exec-code` en el mensaje
  // -al comprar el gas, Chainweb NO le pasa el resto del envData- y respeta sus topes.
  const g = await gasolinera(cfg);
  let sender = opciones.from;
  let gasLimit = opciones.gasLimit || 6000;
  let clist = opciones.clist;
  let data = opciones.data || {};
  if (g) {
    sender = g.cuenta;
    gasLimit = GASO_LIMITE;
    // La GAS_PAYER va la PRIMERA, como en KoberluSW. Se conservan las demas.
    clist = [{ name: g.modulo + '.GAS_PAYER', args: [opciones.from, GASO_LIMITE, GASO_PRECIO] }].concat(opciones.clist);
    data = Object.assign({}, data, { 'tx-type': 'exec', 'exec-code': [opciones.code] });
  }

  const cmd = {
    networkId: cfg.networkId,
    payload: { exec: { code: opciones.code, data: data } },
    signers: [{ pubKey: opciones.publicHex, clist: clist }],
    meta: {
      chainId: String(cfg.chain), sender: sender, gasLimit: gasLimit,
      gasPrice: GASO_PRECIO, ttl: 600,
      creationTime: await ktime.creationTime(cfg.node, cfg.networkId, cfg.chain)
    },
    // El nonce identifica de que parte del monedero sale la tx (DCA u ordenes limite).
    nonce: (opciones.nonce || 'koberlet-dca') + ':' + Date.now()
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

/**
 * Aviso ANTES de firmar cuando el gas lo va a pagar el usuario y no le queda KDA libre.
 *
 * El gas se paga SIEMPRE en KDA y en la chain del contrato, sea cual sea el token que
 * se deposita. Si el que firma no tiene KDA suelto ahi -o va a depositar hasta el
 * ultimo-, el nodo suelta un "Attempt to buy gas failed" que no dice nada de nada. Le
 * paso a Antonio el 29/08/2026 teniendo 24.379 KDA: los tenia, pero los depositaba.
 *
 * Solo se comprueba cuando NO paga la gasolinera: si paga ella, da igual el saldo.
 */
async function avisarGas(cfg, { owner, tokenIn, deposito, hayGasolinera }) {
  if (hayGasolinera) return;
  const MARGEN = 0.01;                       // el gas real ronda 0,00008 KDA; margen holgado
  let libre = 0;
  try {
    const r = await kda.local(cfg.node, cfg.networkId, cfg.chain, '(coin.get-balance "' + owner + '")');
    if (r && r.status === 'success') {
      libre = Number(typeof r.data === 'object' ? (r.data.decimal != null ? r.data.decimal : r.data) : r.data);
    } else {
      // Que la lectura falle porque la cuenta NO EXISTE en esta chain no es un fallo del
      // nodo: es saldo cero, y desde luego no puede pagar el gas. Cualquier otro error
      // si es del nodo, y por eso no se bloquea al usuario.
      const m = String((r && r.error && r.error.message) || '');
      if (!/no value found|row not found|no such key/i.test(m)) return;
      libre = 0;
    }
  } catch (_) { return; }
  if (!isFinite(libre)) return;
  const necesita = (tokenIn === 'coin' ? Number(deposito) : 0) + MARGEN;
  if (libre >= necesita) return;
  throw new Error(
    'Te faltan KDA en la chain ' + cfg.chain + ' para pagar el gas. Tienes ' + libre +
    ' y hacen falta al menos ' + necesita.toFixed(2) +
    (tokenIn === 'coin' ? ' (el deposito mas un poco para el gas).' : ' para el gas.') +
    ' Manda algo de KDA a esa chain y vuelve a intentarlo.'
  );
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
  // El minimo es por token (MIN-IN del contrato); main lo pasa desde la config.
  const minimo = o.minCuota != null ? Number(o.minCuota) : (tIn === 'coin' ? LIMITES.minKda : LIMITES.minUsdc);
  if (Number(q) < minimo) {
    throw new Error('La cuota minima por compra es ' + minimo + ' ' + (o.simIn || (tIn === 'coin' ? 'KDA' : 'kb-USDC')) + '.');
  }

  // Comprobaciones que el contrato tambien hace, pero mejor fallar antes de gastar gas.
  const abiertos = await leer(cfg, '(' + mod + '.open-plans "' + o.owner + '")');
  const n = Number(abiertos && abiertos.int != null ? abiertos.int : abiertos);
  if (n >= LIMITES.planesPorCuenta) {
    throw new Error('Ya tienes ' + n + ' planes abiertos y el maximo es ' + LIMITES.planesPorCuenta + '.');
  }
  if (await pausado(cfg)) throw new Error('El contrato DCA esta pausado ahora mismo.');

  const cust = await custodia(cfg);
  await avisarGas(cfg, { owner: o.owner, tokenIn: tIn, deposito: dep, hayGasolinera: !!(await gasolinera(cfg)) });
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
  await avisarGas(cfg, { owner: o.owner, tokenIn: tIn, deposito: amt, hayGasolinera: !!(await gasolinera(cfg)) });
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

// Las ordenes limite (lib/ordenes.js) reutilizan la fontaneria de aqui en vez de
// duplicarla: misma firma, misma gasolinera, mismo aviso de gas. Si eso se copiara,
// al arreglar un fallo en uno quedaria vivo en el otro.
module.exports = { LIMITES, gasolinera, planesDe, ordenesDe, todasLasOrdenes, plan, custodia, pausado, crearPlan, recargar, accion, nuevoId, refMod,
  firmarYEnviar, avisarGas, exigirDueno, leer, dec, modOk, idOk };
