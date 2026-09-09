// Koberlet - Copyright 2026 DNNS.es (Oberluss)
// SPDX-License-Identifier: Apache-2.0

// Kadena: saldo (suma por chains) y envío (firma ed25519 con tweetnacl + hash blake2b).
const nacl = require('tweetnacl');
const blake = require('blakejs');
const ktime = require('./kdatime'); // hora sincronizada con el nodo (inmune al reloj local)

function hashCmd(cmdStr) {
  const h = blake.blake2b(Buffer.from(cmdStr, 'utf8'), null, 32); // 32 bytes
  return { bytes: h, b64url: Buffer.from(h).toString('base64url') };
}
function secretKey64(secretHex) {
  return nacl.sign.keyPair.fromSeed(Buffer.from(secretHex, 'hex')).secretKey;
}
// Lee la respuesta del nodo de forma segura: Chainweb devuelve texto plano (no JSON) en errores
// de validación ("One or more of the following errors occurred: …"). Sin esto, res.json() revienta
// con "Unexpected token" y oculta el motivo real. Devuelve el objeto o lanza con el texto del nodo.
async function readJson(res, ctx) {
  const txt = await res.text();
  try { return JSON.parse(txt); }
  catch (_) { throw new Error((ctx || 'El nodo') + ' rechazó la transacción: ' + String(txt).replace(/\s+/g, ' ').trim().slice(0, 220)); }
}

// Auditoria Alex #5: valida la cuenta destino ANTES de interpolarla en el codigo Pact.
// La regla se ha contrastado (26/08/2026) contra la propia cadena: `coin.validate-account`
// (charset LATIN1, 3..256) e `is-principal` / `typeof-principal` para los 7 tipos de
// principal que reconoce Pact. Criterio: aceptar TODO lo que la cadena acepta, salvo lo
// que podria romper el literal de cadena Pact donde se interpola la cuenta.
//
//   k:<64 hex>                clave unica (keys-all)
//   w:<hash43>:<predicado>    keyset multifirma (keys-all, keys-any, keys-2, ns.pred...)
//   r:<nombre-keyset>         referencia a keyset con nombre
//   u:<modulo.funcion>:<h43>  user guard
//   c:<hash43>                capability guard  (las gasolineras van aqui)
//   p:<pactid43>:<nombre>     pact guard
//   m:<modulo>:<nombre>       module guard
//   <nombre>                  cuenta "vanity" antigua, sin prefijo reservado
//
// Un prefijo de UNA sola letra seguido de ':' esta reservado por Kadena (check-reserved del
// contrato coin): si lo lleva, tiene que ser un principal bien formado. Asi 'k:' con 63
// caracteres, o un 'x:' inventado, se cazan aqui y no acaban en una cuenta perdida.

// Trozos reutilizados. HASH43 es un blake2b-256 en base64url (43 caracteres, sin relleno).
const HASH43 = '[A-Za-z0-9_-]{43}';
// Nombre Pact (modulo, keyset, predicado, nombre de guard): identificador con puntos para
// el namespace. Charset conservador a proposito: cubre lo real sin abrir la mano de mas.
const PNAME = '[A-Za-z0-9_-]+(?:[.][A-Za-z0-9_-]+)*';
const PRINCIPAL = {
  k: new RegExp('^k:[0-9a-fA-F]{64}$'),
  w: new RegExp('^w:' + HASH43 + ':' + PNAME + '$'),
  r: new RegExp('^r:' + PNAME + '$'),
  u: new RegExp('^u:' + PNAME + ':' + HASH43 + '$'),
  c: new RegExp('^c:' + HASH43 + '$'),
  p: new RegExp('^p:' + HASH43 + ':' + PNAME + '$'),
  m: new RegExp('^m:' + PNAME + ':' + PNAME + '$')
};

function validKdaAccount(acc) {
  if (typeof acc !== 'string') return false;
  const a = acc;
  // Longitud: la misma que exige coin.validate-account en cadena.
  if (a.length < 3 || a.length > 256) return false;
  // Recorrido unico de caracteres. Lo que se rechaza y por que:
  //  - 0x22 (") y 0x5c (barra invertida): son lo UNICO que puede escapar del literal
  //    "..." de Pact donde se interpola la cuenta. Cerrarlos mata la inyeccion.
  //  - control (< 0x20) y 0x7f: ademas ensucian el JSON del comando firmado.
  //  - > 0xff: coin.validate-account exige charset LATIN1, la cadena lo rechazaria
  //    igualmente (japones, emoji...); mejor avisar aqui que fallar tras firmar.
  // Todo lo demas -espacios, parentesis, &, @, #, %, acentos, enyes- es inofensivo
  // DENTRO del literal y la cadena lo admite: rechazarlo solo bloqueaba cuentas buenas.
  for (let i = 0; i < a.length; i++) {
    const c = a.charCodeAt(i);
    if (c < 0x20 || c === 0x22 || c === 0x5c || c === 0x7f || c > 0xff) return false;
  }
  // Prefijo reservado de una letra: tiene que ser un principal bien formado de ese tipo.
  const m = /^([A-Za-z]):/.exec(a);
  if (m) { const re = PRINCIPAL[m[1]]; return re ? re.test(a) : false; }
  return true;                                      // cuenta "vanity" antigua: la cadena la admite
}
function assertKdaAccount(acc, rol) { if (!validKdaAccount(acc)) throw new Error(`Cuenta Kadena ${rol || 'destino'} inválida o con caracteres no permitidos.`); }
// Auditoría Alex #8: un único decimal canónico para el code Y la capability (evita "1e-7" vs "0.000000100000").
function canonDecimal(v) { return Number(v).toFixed(12); }

async function local(node, networkId, chain, code) {
  const base = `${node}/chainweb/0.0/${networkId}/chain/${chain}/pact/api/v1`;
  const cmd = {
    networkId, payload: { exec: { code, data: {} } }, signers: [],
    meta: { chainId: String(chain), sender: '', gasLimit: 150000, gasPrice: 1e-8, ttl: 60, creationTime: Math.floor(Date.now() / 1000) - 90 },
    nonce: String(Date.now())
  };
  const cmdStr = JSON.stringify(cmd);
  const { b64url } = hashCmd(cmdStr);
  const res = await fetch(base + '/local?signatureVerification=false&preflight=false', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cmd: cmdStr, hash: b64url, sigs: [] })
  });
  const j = await readJson(res);
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

// Saldo de tokens fungibles KDA arbitrarios (PCO y futuros): `(<module>.get-balance "acc")`
// en la chain del token. Los `tokens` vienen SOLO del DEFAULT del código (main.js), nunca de la
// config del usuario (modelo Alex #4: el renderer no puede inyectar contratos de token hostiles).
// Devuelve [{ symbol, module, chain, cg, amount }] — amount 0 si la cuenta no tiene fila en ese token.
async function getTokenBalances(account, { node, networkId, tokens }) {
  if (!Array.isArray(tokens) || !tokens.length) return [];
  assertKdaAccount(account, 'consulta');   // Alex #5: valida antes de interpolar en el code Pact
  const CHAINS = Array.from({ length: 20 }, (_, i) => i);
  return Promise.all(tokens.map(async (tk) => {
    // el módulo es dato del código, pero se acota por si acaso (namespace.modulo, sin comillas/paréntesis)
    const safeMod = /^[A-Za-z0-9_.-]+$/.test(String(tk.module)) ? String(tk.module) : null;
    let amount = 0; const perChain = {};
    if (safeMod) {
      // El token puede vivir en cualquier chain (Antonio los movió a la 2): sumar las 20, como el KDA nativo.
      await Promise.all(CHAINS.map(async (ch) => {
        try {
          const r = await local(node, networkId, String(ch), `(${safeMod}.get-balance "${account}")`);
          if (r && r.status === 'success') {
            const v = typeof r.data === 'object' ? Number(r.data.decimal != null ? r.data.decimal : r.data) : Number(r.data);
            if (!isNaN(v) && v > 0) { perChain[ch] = v; amount += v; }
          }
        } catch (_) { /* la cuenta no existe en ese token/chain */ }
      }));
    }
    return { symbol: tk.symbol, module: tk.module, chain: tk.chain, cg: tk.cg || null, amount, perChain };
  }));
}

// Envía un TOKEN fungible KDA (p.ej. PCO) en una chain. El gas se paga en KDA (coin.GAS),
// así que el remitente necesita algo de KDA en esa chain. `module` = namespace.contrato fungible-v2;
// el llamador (main.js) lo saca del catálogo del DEFAULT, no de datos del renderer (modelo Alex #4).
// gasLimit 3000: Kadena DEVUELVE el gas que sobra (se cobra el usado, no el tope), asi que
// pasarse no cuesta nada -solo exige tener ese KDA disponible al firmar, 0,00003 KDA-, mientras
// que quedarse corto tira la transaccion y quema el gas igual. Los kb-* del puente envuelven el
// transfer en su router-iface y gastan mas que un fungible pelado como PCO; 1500 iba justo.
async function transferToken({ node, networkId, chain, module, from, to, amount, secretHex, publicHex, precision = 12, gasLimit = 3000, gasPrice = 1e-8 }) {
  assertKdaAccount(from, 'origen'); assertKdaAccount(to, 'destino');
  if (!/^[A-Za-z0-9_.-]+$/.test(String(module))) throw new Error('Módulo de token no válido.');
  const amt = Number(amount);
  if (!(amt > 0)) throw new Error('Cantidad inválida.');
  const canon = Number(amt).toFixed(Math.max(0, Math.min(12, precision | 0))); // mismo string para code y clist
  const isK = to.startsWith('k:');
  const code = isK
    ? `(${module}.transfer-create "${from}" "${to}" (read-keyset "ks") ${canon})`
    : `(${module}.transfer "${from}" "${to}" ${canon})`;
  const data = isK ? { ks: { keys: [to.slice(2)], pred: 'keys-all' } } : {};
  const clist = [
    { name: 'coin.GAS', args: [] },
    { name: `${module}.TRANSFER`, args: [from, to, { decimal: canon }] }
  ];
  const cmd = {
    networkId,
    payload: { exec: { code, data } },
    signers: [{ pubKey: publicHex, clist }],
    meta: { chainId: String(chain), sender: from, gasLimit, gasPrice, ttl: 600, creationTime: await ktime.creationTime(node, networkId, chain) },
    nonce: 'koberlet-tok:' + Date.now()
  };
  const cmdStr = JSON.stringify(cmd);
  const { bytes, b64url } = hashCmd(cmdStr);
  const sig = Buffer.from(nacl.sign.detached(bytes, secretKey64(secretHex))).toString('hex');
  const base = `${node}/chainweb/0.0/${networkId}/chain/${chain}/pact/api/v1`;
  const res = await fetch(base + '/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cmds: [{ hash: b64url, sigs: [{ sig }], cmd: cmdStr }] }) });
  const j = await readJson(res);
  if (!j.requestKeys) throw new Error('send falló: ' + JSON.stringify(j));
  return { requestKey: j.requestKeys[0], chain };
}

// Envía KDA en una chain. secretHex/publicHex = claves del remitente.
async function transfer({ node, networkId, chain, from, to, amount, secretHex, publicHex, gasLimit = 2500, gasPrice = 1e-8 }) {
  assertKdaAccount(from, 'origen'); assertKdaAccount(to, 'destino');
  const amt = Number(amount);
  if (!(amt > 0)) throw new Error('Cantidad inválida.');
  const canon = canonDecimal(amt); // mismo string para code y clist
  const clist = [
    { name: 'coin.GAS', args: [] },
    { name: 'coin.TRANSFER', args: [from, to, { decimal: canon }] }
  ];
  const cmd = {
    networkId,
    payload: { exec: { code: `(coin.transfer "${from}" "${to}" ${canon})`, data: {} } },
    signers: [{ pubKey: publicHex, clist }],
    meta: { chainId: String(chain), sender: from, gasLimit, gasPrice, ttl: 600, creationTime: await ktime.creationTime(node, networkId, chain) },
    nonce: 'monedero-dnns:' + Date.now()
  };
  const cmdStr = JSON.stringify(cmd);
  const { bytes, b64url } = hashCmd(cmdStr);
  const sig = Buffer.from(nacl.sign.detached(bytes, secretKey64(secretHex))).toString('hex');
  const body = { cmds: [{ hash: b64url, sigs: [{ sig }], cmd: cmdStr }] };
  const base = `${node}/chainweb/0.0/${networkId}/chain/${chain}/pact/api/v1`;
  const res = await fetch(base + '/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await readJson(res);
  if (!j.requestKeys) throw new Error('send falló: ' + JSON.stringify(j));
  return { requestKey: j.requestKeys[0], chain };
}

// Como transfer, pero crea la cuenta destino si no existe (transfer-create con keyset del k:).
// Solo vale para destinos "k:<pubkey>" (el guard se deriva del propio nombre).
async function transferCreate({ node, networkId, chain, from, to, amount, secretHex, publicHex, gasLimit = 2500, gasPrice = 1e-8 }) {
  assertKdaAccount(from, 'origen'); assertKdaAccount(to, 'destino');
  if (!to.startsWith('k:')) throw new Error('El destino debe ser una cuenta k:.');
  const amt = Number(amount);
  if (!(amt > 0)) throw new Error('Cantidad inválida.');
  const canon = canonDecimal(amt);
  const clist = [
    { name: 'coin.GAS', args: [] },
    { name: 'coin.TRANSFER', args: [from, to, { decimal: canon }] }
  ];
  const cmd = {
    networkId,
    payload: { exec: { code: `(coin.transfer-create "${from}" "${to}" (read-keyset "ks") ${canon})`, data: { ks: { keys: [to.slice(2)], pred: 'keys-all' } } } },
    signers: [{ pubKey: publicHex, clist }],
    meta: { chainId: String(chain), sender: from, gasLimit, gasPrice, ttl: 600, creationTime: await ktime.creationTime(node, networkId, chain) },
    nonce: 'monedero-dnns:' + Date.now()
  };
  const cmdStr = JSON.stringify(cmd);
  const { bytes, b64url } = hashCmd(cmdStr);
  const sig = Buffer.from(nacl.sign.detached(bytes, secretKey64(secretHex))).toString('hex');
  const body = { cmds: [{ hash: b64url, sigs: [{ sig }], cmd: cmdStr }] };
  const base = `${node}/chainweb/0.0/${networkId}/chain/${chain}/pact/api/v1`;
  const res = await fetch(base + '/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await readJson(res);
  if (!j.requestKeys) throw new Error('send falló: ' + JSON.stringify(j));
  return { requestKey: j.requestKeys[0], chain };
}

// Envío ENTRE CHAINS distintas (cross-chain) en dos pasos, ambos firmados por el monedero:
//   1) en la chain ORIGEN: coin.transfer-crosschain (quema y deja el endoso SPV).
//   2) prueba SPV del nodo + continuación (step 1) en la chain DESTINO (acuña).
// El gas de la redención en destino lo paga `gasPayer` (por defecto, el propio remitente:
// requiere que tenga algo de KDA en la chain destino; en la devnet se le puede pasar sender00).
async function transferCrossChain({ node, networkId, sourceChain, targetChain, from, to, amount, secretHex, publicHex, gasPayer, onProgress }) {
  assertKdaAccount(from, 'origen'); assertKdaAccount(to, 'destino');
  if (!to.startsWith('k:')) throw new Error('El destino debe ser una cuenta k: para cross-chain.');
  if (String(sourceChain) === String(targetChain)) throw new Error('Origen y destino son la misma chain.');
  const amt = Number(amount); if (!(amt > 0)) throw new Error('Cantidad inválida.');
  const canon = canonDecimal(amt);
  const say = (m) => { try { onProgress && onProgress(m); } catch (_) {} };

  // --- Paso 1: transfer-crosschain en la chain origen ---
  const clist = [
    { name: 'coin.GAS', args: [] },
    { name: 'coin.TRANSFER_XCHAIN', args: [from, to, { decimal: canon }, String(targetChain)] }
  ];
  const cmd = {
    networkId,
    payload: { exec: { code: `(coin.transfer-crosschain "${from}" "${to}" (read-keyset "ks") "${targetChain}" ${canon})`, data: { ks: { keys: [to.slice(2)], pred: 'keys-all' } } } },
    signers: [{ pubKey: publicHex, clist }],
    meta: { chainId: String(sourceChain), sender: from, gasLimit: 4000, gasPrice: 1e-8, ttl: 600, creationTime: await ktime.creationTime(node, networkId, sourceChain) },
    nonce: 'monedero-dnns-xc:' + Date.now()
  };
  const cmdStr = JSON.stringify(cmd);
  const { bytes, b64url } = hashCmd(cmdStr);
  const sig = Buffer.from(nacl.sign.detached(bytes, secretKey64(secretHex))).toString('hex');
  const baseSrc = `${node}/chainweb/0.0/${networkId}/chain/${sourceChain}/pact/api/v1`;
  say('Enviando desde la chain ' + sourceChain + '…');
  let res = await fetch(baseSrc + '/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cmds: [{ hash: b64url, sigs: [{ sig }], cmd: cmdStr }] }) });
  let j = await readJson(res);
  if (!j.requestKeys) throw new Error('send origen falló: ' + JSON.stringify(j));
  const pactId = j.requestKeys[0];

  // Esperar el minado del paso 1
  const r1 = await pollResult({ node, networkId, chain: sourceChain, requestKey: pactId, tries: 20 });
  if (!r1 || !r1.result || r1.result.status !== 'success') {
    throw new Error('El paso de salida no se minó: ' + JSON.stringify((r1 && r1.result && r1.result.error && r1.result.error.message) || 'sin respuesta'));
  }

  // --- Paso 2: prueba SPV + continuación en la chain destino ---
  say('Obteniendo prueba SPV…');
  let proof = null;
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const pr = await fetch(`${node}/chainweb/0.0/${networkId}/chain/${sourceChain}/pact/spv`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestKey: pactId, targetChainId: String(targetChain) })
    });
    if (pr.ok) { proof = (await pr.text()).replace(/^"|"$/g, ''); break; }
  }
  if (!proof) throw new Error('No se pudo obtener la prueba SPV (reintenta más tarde con el requestKey ' + pactId + ').');

  say('Acuñando en la chain ' + targetChain + '…');
  const gp = gasPayer || { account: from, secretHex, publicHex };
  const contObj = {
    networkId,
    payload: { cont: { pactId, step: 1, rollback: false, data: {}, proof } },
    signers: [{ pubKey: gp.publicHex, clist: [{ name: 'coin.GAS', args: [] }] }],
    meta: { chainId: String(targetChain), sender: gp.account, gasLimit: 1000, gasPrice: 1e-8, ttl: 600, creationTime: await ktime.creationTime(node, networkId, targetChain) },
    nonce: 'monedero-dnns-xc2:' + Date.now()
  };
  const contStr = JSON.stringify(contObj);
  const ch = hashCmd(contStr);
  const csig = Buffer.from(nacl.sign.detached(ch.bytes, secretKey64(gp.secretHex))).toString('hex');
  const baseTgt = `${node}/chainweb/0.0/${networkId}/chain/${targetChain}/pact/api/v1`;
  res = await fetch(baseTgt + '/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cmds: [{ hash: ch.b64url, sigs: [{ sig: csig }], cmd: contStr }] }) });
  j = await readJson(res);
  if (!j.requestKeys) throw new Error('send destino falló: ' + JSON.stringify(j));
  const r2 = await pollResult({ node, networkId, chain: targetChain, requestKey: j.requestKeys[0], tries: 20 });
  if (!r2 || !r2.result || r2.result.status !== 'success') {
    throw new Error('La acuñación en destino no se confirmó (los fondos quedan recuperables con el pactId ' + pactId + '): ' + JSON.stringify((r2 && r2.result && r2.result.error && r2.result.error.message) || 'sin respuesta'));
  }
  return { pactId, sourceChain, targetChain, requestKeyRedeem: j.requestKeys[0] };
}

// Envío INTELIGENTE: manda `amount` a `to` recibiéndolo en `targetChain`, JUNTANDO saldo de
// varias chains si una sola no llega. Consolida con cross-chain (a la propia cuenta) hacia
// targetChain y luego hace el envío final. `gasPayer` paga el gas de las redenciones (en la
// devnet, sender00). Deja un colchón RESERVE de KDA por chain para el gas.
async function sendSmart({ node, networkId, targetChain, from, to, amount, secretHex, publicHex, gasPayer, onProgress }) {
  assertKdaAccount(from, 'origen'); assertKdaAccount(to, 'destino');
  const need = Number(amount); if (!(need > 0)) throw new Error('Cantidad inválida.');
  const RESERVE = 0.11;
  const say = (m) => { try { onProgress && onProgress(m); } catch (_) {} };
  const tgt = Number(targetChain);

  const bal = await getBalance(from, { node, networkId, chains: Array.from({ length: 20 }, (_, i) => i) });
  const per = bal.perChain || {};
  const onTarget = per[tgt] || 0;
  // La chain destino debe acabar con need + RESERVE (para tener gas del envío final).
  let stillNeed = (need + RESERVE) - onTarget;

  if (stillNeed > 0) {
    // Comprobar que sumando todas las chains hay bastante (con su colchón de gas)
    const disponible = Object.keys(per).reduce((s, c) => s + Math.max(0, per[c] - RESERVE), 0);
    if (disponible < need - 1e-6) throw new Error('No hay saldo suficiente ni sumando todas las chains (disponible ~' + disponible.toFixed(4) + ' KDA, dejando gas).');
    const otras = Object.keys(per).map(Number).filter(c => c !== tgt && per[c] > RESERVE).sort((a, b) => per[b] - per[a]);
    for (const c of otras) {
      if (stillNeed <= 1e-6) break;
      const avail = per[c] - RESERVE;
      const move = Math.floor(Math.min(avail, stillNeed) * 1e6) / 1e6;
      if (move <= 0) continue;
      say(`Juntando ${move} KDA de la chain ${c}…`);
      await transferCrossChain({ node, networkId, sourceChain: c, targetChain: tgt, from, to: from, amount: move, secretHex, publicHex, gasPayer, onProgress });
      stillNeed -= move;
    }
    if (stillNeed > 1e-6) throw new Error('No se pudo juntar lo suficiente (faltan ~' + stillNeed.toFixed(4) + ' KDA).');
  }

  say(`Enviando ${need} KDA desde la chain ${tgt}…`);
  const fn = to.startsWith('k:') ? transferCreate : transfer;
  const r = await fn({ node, networkId, chain: tgt, from, to, amount: need, secretHex, publicHex });
  const res = await pollResult({ node, networkId, chain: tgt, requestKey: r.requestKey, tries: 20 });
  if (res && res.result && res.result.status === 'failure') {
    throw new Error('El envío final falló: ' + ((res.result.error && res.result.error.message) || 'error'));
  }
  return { requestKey: r.requestKey, targetChain: tgt };
}

// Difunde un comando Pact YA FIRMADO fuera de aquí (p.ej. por un Ledger): {cmd, hash, sigs}.
async function sendSigned({ node, networkId, chain, cmdObj }) {
  const base = `${node}/chainweb/0.0/${networkId}/chain/${chain}/pact/api/v1`;
  const res = await fetch(base + '/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cmds: [cmdObj] }) });
  const j = await readJson(res);
  if (!j.requestKeys) throw new Error('send falló: ' + JSON.stringify(j));
  return { requestKey: j.requestKeys[0], chain };
}

// Espera a que una tx quede minada consultando /poll. Devuelve el resultado o null si agota los intentos.
async function pollResult({ node, networkId, chain, requestKey, tries = 12, delayMs = 3000 }) {
  const base = `${node}/chainweb/0.0/${networkId}/chain/${chain}/pact/api/v1`;
  for (let i = 0; i < tries; i++) {
    await new Promise(r => setTimeout(r, delayMs));
    try {
      const res = await fetch(base + '/poll', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestKeys: [requestKey] }) });
      const j = await readJson(res);
      if (j && j[requestKey]) return j[requestKey];
    } catch (_) {}
  }
  return null;
}

// Firma y envía una transacción de NFT (el código lo arma lib/nft: el ledger de
// cada red es distinto, así que aquí solo se firma y se manda).
async function enviarNft({ node, networkId, chain, code, data, clist, from, secretHex, publicHex,
                           gasLimit = 3000, gasPrice = 1e-8 }) {
  assertKdaAccount(from, 'origen');
  const cmd = {
    networkId,
    payload: { exec: { code, data } },
    signers: [{ pubKey: publicHex, clist }],
    meta: { chainId: String(chain), sender: from, gasLimit, gasPrice, ttl: 600,
            creationTime: await ktime.creationTime(node, networkId, chain) },
    nonce: 'koberlet-nft:' + Date.now()
  };
  const cmdStr = JSON.stringify(cmd);
  const { bytes, b64url } = hashCmd(cmdStr);
  const sig = Buffer.from(nacl.sign.detached(bytes, secretKey64(secretHex))).toString('hex');
  const base = `${node}/chainweb/0.0/${networkId}/chain/${chain}/pact/api/v1`;
  const res = await fetch(base + '/send', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cmds: [{ hash: b64url, sigs: [{ sig }], cmd: cmdStr }] }) });
  const j = await readJson(res);
  if (!j.requestKeys) throw new Error('send falló: ' + JSON.stringify(j));
  return { requestKey: j.requestKeys[0], chain };
}

// Simula una transacción SIN firmarla (para saber si el contrato la aceptaría).
async function simularFirmada({ node, networkId, chain, code, data, clist, from, publicHex }) {
  const cmd = JSON.stringify({
    networkId, payload: { exec: { code, data } },
    signers: [{ pubKey: publicHex, clist }],
    meta: { chainId: String(chain), sender: from, gasLimit: 150000, gasPrice: 1e-8, ttl: 600,
            creationTime: Math.floor(Date.now() / 1000) - 90 },
    nonce: 'koberlet-sim'
  });
  const { b64url } = hashCmd(cmd);
  const base = `${node}/chainweb/0.0/${networkId}/chain/${chain}/pact/api/v1`;
  const res = await fetch(base + '/local?signatureVerification=false&preflight=false',
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cmd, hash: b64url, sigs: [] }) });
  const j = await readJson(res);
  return (j && j.result) || { status: 'failure', error: { message: 'sin respuesta del nodo' } };
}

module.exports = { enviarNft, simularFirmada, getBalance, getTokenBalances, transfer, transferToken, transferCreate, transferCrossChain, sendSmart, sendSigned, pollResult, local, validKdaAccount, assertKdaAccount, canonDecimal };
