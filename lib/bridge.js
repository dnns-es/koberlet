// Koberlet - Copyright 2026 DNNS.es (Oberluss)
// SPDX-License-Identifier: Apache-2.0

// Puente Kinesis (Hyperlane del fork). Dry-run (sin firmar) y envío real en ambas direcciones:
// Kadena→EVM (mailbox.dispatch en Pact) y EVM→Kadena (transferRemote en Solidity).
const blake = require('blakejs');
const { ethers } = require('ethers');
const nodo = require('./evmnodo');   // proveedor con tope de grupo + espera de recibo sin escanear bloques
const ktime = require('./kdatime'); // hora sincronizada con el nodo (inmune al reloj local)
const NS = 'n_e595727b657fbbb3b8e362a05a7bb8d12865c1ff';

// dirección EVM -> 32 bytes (12 ceros + 20 addr) base64url (recipient para Kadena→EVM)
function evmRecipient(addr) {
  const a = String(addr).replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]{40}$/.test(a)) throw new Error('Dirección EVM inválida (0x + 40 hex).');
  return Buffer.concat([Buffer.alloc(12), Buffer.from(a, 'hex')]).toString('base64url');
}
// k:account -> recipient EVM→Kadena. El fork exige el CUSTODIO (keyset/guardián) de la cuenta.
// CONFIRMADO por Pascal (core dev, 2026-07-12): el _recipient debe ser la representación EN CADENA (string) del
// keyset — el JSON tal cual {"pred":"keys-all","keys":["<pubkey>"]}, NO en base64. bytes = utf8(JSON).
function kadenaRecipientKeyset(kAccount) {
  const pk = String(kAccount).replace(/^k:/, '');
  if (!/^[0-9a-fA-F]{64}$/.test(pk)) throw new Error('Cuenta Kadena destino debe ser k:<64 hex>.');
  const keyset = JSON.stringify({ pred: 'keys-all', keys: [pk] });
  return '0x' + Buffer.from(keyset, 'utf8').toString('hex');
}
// (obsoleto — enviaba la pubkey en crudo, la orilla Kadena lo rechazaba como custodio inválido)
function kadenaRecipient32(kAccount) {
  const pk = String(kAccount).replace(/^k:/, '');
  if (!/^[0-9a-fA-F]{64}$/.test(pk)) throw new Error('Cuenta Kadena destino debe ser k:<64 hex>.');
  return '0x' + pk;
}

// ---- /local Kadena (sin firma). preflight=true para simular tx; false para lecturas puras ----
async function kdaLocal(node, networkId, chain, code, signers, sender, preflight = true) {
  const o = { networkId, payload: { exec: { code, data: {} } }, signers: signers || [], meta: { chainId: String(chain), sender: sender || '', gasLimit: 150000, gasPrice: 1e-8, ttl: 600, creationTime: Math.floor(Date.now() / 1000) - 90 }, nonce: String(Date.now()) };
  const cmd = JSON.stringify(o);
  const hash = Buffer.from(blake.blake2b(Buffer.from(cmd, 'utf8'), null, 32)).toString('base64url');
  const base = `${node}/chainweb/0.0/${networkId}/chain/${chain}/pact/api/v1`;
  const r = await fetch(base + `/local?signatureVerification=false&preflight=${preflight}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cmd, hash, sigs: [] }) });
  return r.json();
}

// Peaje del puente en el lado Kadena: el IGP cobra en KDA (coin.transfer al tesoro de relayers) al despachar.
// Techo absoluto del peaje (KDA). El quote lo da el nodo (no autenticado); un nodo manipulado podría inflarlo.
// Aunque el módulo on-chain solo cobra el real, capamos aquí para no firmar una cap coin.TRANSFER desorbitada,
// y validamos que la cuenta destino del peaje tenga forma de cuenta Kadena (revisión 2026-07-21, hardening #5).
const IGP_MAX_TOLL = 100; // muy por encima del peaje real (~37 KDA hacia Ethereum): solo corta valores absurdos
async function igpInfo(node, networkId, chain, evmDomain) {
  const j = await kdaLocal(node, networkId, chain, `[${NS}.igp.IGP_ACCOUNT (${NS}.igp.quote-gas-payment ${evmDomain})]`, [], '', false);
  const r = j.result || {};
  if (r.status !== 'success') throw new Error('no pude leer el peaje del puente: ' + JSON.stringify(r.error || r).slice(0, 120));
  const igpAccount = r.data[0];
  const q = r.data[1];
  const quote = (q && typeof q === 'object') ? Number(q.decimal ?? q.int) : Number(q);
  if (typeof igpAccount !== 'string' || !igpAccount || igpAccount.length > 200) throw new Error('la cuenta del peaje del puente no es válida (posible nodo manipulado).');
  if (!Number.isFinite(quote) || quote < 0 || quote > IGP_MAX_TOLL) throw new Error('peaje del puente fuera de rango (' + quote + ' KDA); operación cancelada por seguridad.');
  return { igpAccount, quote };
}
// Código + capabilities del dispatch. OJO: destination va tipado {int} (un 1 "a pelo" se parsea como
// decimal y la cap firmada no encaja → "Keyset failure"); y hay que firmar coin.TRANSFER del peaje al IGP.
function dispatchParts({ senderAccount, kadenaModule, evmDomain, rec, amount, igpAccount, maxPay }) {
  const code = `(${NS}.mailbox.dispatch ${NS}.${kadenaModule} ${evmDomain} "${rec}" ${Number(amount).toFixed(12)})`;
  const clist = [
    { name: 'coin.GAS', args: [] },
    { name: `${NS}.${kadenaModule}.TRANSFER_REMOTE`, args: [{ int: evmDomain }, senderAccount, rec, Number(amount)] },
    { name: 'coin.TRANSFER', args: [senderAccount, igpAccount, { decimal: maxPay }] }
  ];
  return { code, clist };
}

// KADENA -> EVM (quema kb-* y despacha)
async function dryRunKda2Evm({ node, networkId, chain, senderAccount, senderPubKey, kadenaModule, evmDomain, recipientEvmAddr, amount }) {
  const rec = evmRecipient(recipientEvmAddr);
  const { igpAccount, quote } = await igpInfo(node, networkId, chain, evmDomain);
  const maxPay = (quote * 1.05).toFixed(12); // margen 5% por si el oráculo mueve el peaje entre cotizar y minar
  const { code, clist } = dispatchParts({ senderAccount, kadenaModule, evmDomain, rec, amount, igpAccount, maxPay });
  const j = await kdaLocal(node, networkId, chain, code, [{ pubKey: senderPubKey, clist }], senderAccount);
  const pf = j.preflightResult; const result = pf ? pf.result : (j.result || j);
  return { code, result, gas: pf ? pf.gas : j.gas, toll: quote };
}

// ENVÍO REAL KADENA -> EVM: firma ed25519 el mailbox.dispatch (quema kb-* y emite el mensaje) y espera al minado.
const nacl = require('tweetnacl');
async function sendKda2Evm({ node, networkId, chain, senderAccount, senderPubKey, secretHex, kadenaModule, evmDomain, recipientEvmAddr, amount }, onStep = () => {}) {
  const rec = evmRecipient(recipientEvmAddr);
  const { igpAccount, quote } = await igpInfo(node, networkId, chain, evmDomain);
  const maxPay = (quote * 1.05).toFixed(12);
  onStep({ step: 'dispatch', status: 'run', detail: `peaje del puente: ${quote.toFixed(2)} KDA` });
  const { code, clist } = dispatchParts({ senderAccount, kadenaModule, evmDomain, rec, amount, igpAccount, maxPay });
  const ct = await ktime.creationTime(node, networkId, chain);
  const cmdObj = { networkId, payload: { exec: { code, data: {} } }, signers: [{ pubKey: senderPubKey, clist }], meta: { chainId: String(chain), sender: senderAccount, gasLimit: 60000, gasPrice: 1e-8, ttl: 600, creationTime: ct }, nonce: 'monedero-bridge:' + Date.now() };
  const cmdStr = JSON.stringify(cmdObj);
  const hb = blake.blake2b(Buffer.from(cmdStr, 'utf8'), null, 32);
  const hash = Buffer.from(hb).toString('base64url');
  const kp = nacl.sign.keyPair.fromSeed(Buffer.from(String(secretHex).replace(/^0x/, ''), 'hex'));
  const sig = Buffer.from(nacl.sign.detached(hb, kp.secretKey)).toString('hex');
  const base = `${node}/chainweb/0.0/${networkId}/chain/${chain}/pact/api/v1`;
  onStep({ step: 'dispatch', status: 'run', detail: 'Firmando y enviando en Kadena…' });
  const r = await fetch(base + '/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cmds: [{ hash, sigs: [{ sig }], cmd: cmdStr }] }) });
  const j = await r.json();
  if (!j.requestKeys) throw new Error('el nodo rechazó la tx: ' + JSON.stringify(j).slice(0, 200));
  const rk = j.requestKeys[0];
  onStep({ step: 'dispatch', status: 'ok', detail: rk });
  // esperar el minado (poll)
  onStep({ step: 'kdaconfirm', status: 'run', detail: 'Esperando confirmación en Kadena…' });
  const sleep = (ms) => new Promise(res => setTimeout(res, ms));
  for (let i = 0; i < 18; i++) {
    await sleep(10000);
    try {
      const p = await fetch(base + '/poll', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestKeys: [rk] }) });
      const pj = await p.json();
      const res = pj && pj[rk] && pj[rk].result;
      if (res) {
        if (res.status !== 'success') { onStep({ step: 'kdaconfirm', status: 'fail', detail: JSON.stringify(res.error || res).slice(0, 160) }); return { requestKey: rk, minedOk: false, error: res.error }; }
        onStep({ step: 'kdaconfirm', status: 'ok', detail: 'minado' });
        return { requestKey: rk, minedOk: true };
      }
    } catch (_) {}
  }
  onStep({ step: 'kdaconfirm', status: 'pending', detail: 'sin confirmación aún (mira el historial en unos minutos)' });
  return { requestKey: rk, minedOk: null };
}

// ABI real del fork Kinesis: transferRemote(destination, bytes recipient, amount, uint16 kadenaChain)
const ROUTER_ABI = ['function quoteGasPayment(uint32) view returns (uint256)', 'function transferRemote(uint32,bytes,uint256,uint16) payable returns (bytes32)'];

// EVM -> KADENA (bloquea el token real en el warp route y emite el mensaje)
async function dryRunEvm2Kda({ rpc, router, evmToken, fromAddress, kadenaAccount, amount, decimals, kadenaDomain, kadenaChain }) {
  const pr = nodo.proveedor(rpc);
  // ethers deja el proveedor reintentando la deteccion de red cada segundo para siempre si el
  // nodo no contesta. Destruirlo al salir no es opcional: es la unica forma de soltarlo.
  try {
    const erc = ['function allowance(address,address) view returns (uint256)', 'function balanceOf(address) view returns (uint256)'];
    const c = new ethers.Contract(router, ROUTER_ABI, pr);
    const t = new ethers.Contract(evmToken, erc, pr);
    const recipient = kadenaRecipientKeyset(kadenaAccount);
    const amt = ethers.parseUnits(String(amount), decimals);
    let quote = 0n; try { quote = await c.quoteGasPayment(kadenaDomain); } catch (_) {}
    // Sin .catch(() => 0n): si el nodo falla aqui, fabricar ceros hacia que la simulacion dijera a la
    // vez "no tienes saldo suficiente" y "falta autorizar el token", que son dos mentiras. Mejor que
    // suba el error y el boton de simular lo ensene: el renderer ya tiene un try/catch para eso.
    const [allowance, balance] = await Promise.all([t.allowance(fromAddress, router), t.balanceOf(fromAddress)]);
    const code = `${router}.transferRemote(${kadenaDomain}, ${recipient}, ${amt.toString()}, chain ${kadenaChain})  · gas: ${quote.toString()} wei`;
    const data = c.interface.encodeFunctionData('transferRemote', [kadenaDomain, recipient, amt, kadenaChain]);
    let result;
    try { const ret = await pr.call({ to: router, from: fromAddress, data, value: quote }); result = { status: 'success', ret }; }
    catch (e) { result = { status: 'failure', error: { message: e.shortMessage || e.reason || e.message } }; }
    return { code, result, quote: quote.toString(), allowance: Number(ethers.formatUnits(allowance, decimals)), balance: Number(ethers.formatUnits(balance, decimals)), need: Number(amount), missingApprove: allowance < amt, enoughBalance: balance >= amt };
  } finally { pr.destroy(); }
}

// Saldos de los tokens del puente en KADENA (kb-*) para una cuenta
async function getKadenaBalances({ node, networkId, chain, routes, account }) {
  return Promise.all(routes.map(async (t) => {
    try {
      const j = await kdaLocal(node, networkId, chain, `(${NS}.${t.kadenaModule}.get-balance "${account}")`, [], '', false);
      const r = j.result || {};
      if (r.status === 'success') {
        const d = r.data; const bal = (d && typeof d === 'object') ? Number(d.decimal ?? d) : Number(d);
        return { symbol: t.symbol, module: t.kadenaModule, balance: isNaN(bal) ? null : bal, ...(isNaN(bal) ? { error: 'respuesta ilegible del nodo' } : {}) };
      }
      // OJO a la diferencia: que la cuenta no tenga aun ese token SI es un cero de verdad
      // ("row not found"), y hay que ensenarlo como cero. Cualquier otro fallo es "no se sabe".
      const err = JSON.stringify(r.error || r);
      if (/row not found|No value found|does not exist/i.test(err)) return { symbol: t.symbol, module: t.kadenaModule, balance: 0 };
      return { symbol: t.symbol, module: t.kadenaModule, balance: null, error: err.slice(0, 200) };
    } catch (e) { return { symbol: t.symbol, module: t.kadenaModule, balance: null, error: String((e && e.message) || e).slice(0, 200) }; }
  }));
}

// ENVÍO REAL EVM -> Kadena: approve (si falta) + transferRemote. Firma y mueve fondos.
// Firma con clave software (secretHex) o EN un Ledger (ledgerIndex): approve + transferRemote son
// transacciones EVM normales, así que este sentido del puente funciona también con monedero físico.
async function sendEvm2Kda({ rpc, secretHex, ledgerIndex, router, token, kadenaAccount, amount, decimals, kadenaDomain, kadenaChain }, onStep = () => {}) {
  const pr = nodo.proveedor(rpc);
  // ethers deja el proveedor reintentando la deteccion de red cada segundo para siempre si el
  // nodo no contesta. Destruirlo al salir no es opcional: es la unica forma de soltarlo.
  try {
    const viaLedger = (ledgerIndex !== undefined && ledgerIndex !== null);
    const ledger = viaLedger ? require('./ledger') : null;
    const erc = ['function allowance(address,address) view returns (uint256)', 'function approve(address,uint256) returns (bool)'];
    const t = new ethers.Contract(token, erc, pr);
    const rc = new ethers.Contract(router, ROUTER_ABI, pr);
    const from = viaLedger ? (await ledger.getAccount('evm', ledgerIndex, false)).address
                           : new ethers.Wallet('0x' + String(secretHex).replace(/^0x/, '')).address;
    // enviar una llamada a contrato con el firmante que toque; devuelve {hash, wait()}
    const send = async (to, data, value) => {
      if (viaLedger) { const r = await ledger.sendContract({ index: ledgerIndex, rpc, to, data, valueWei: value || 0n }); return { hash: r.hash, wait: () => nodo.esperarRecibo(pr, r.hash) }; }
      const w = new ethers.Wallet('0x' + String(secretHex).replace(/^0x/, ''), pr);
      return w.sendTransaction({ to, data, value: value || 0n });
    };
    const recipient = kadenaRecipientKeyset(kadenaAccount);
    const amt = ethers.parseUnits(String(amount), decimals);
    const out = {};
    const allowance = await t.allowance(from, router);
    if (allowance < amt) {
      onStep({ step: 'approve', status: 'run', detail: viaLedger ? 'Autoriza el token EN el Ledger…' : 'Autorizando el token…' });
      const ap = await send(token, t.interface.encodeFunctionData('approve', [router, amt]));
      out.approveHash = ap.hash; await nodo.esperarRecibo(pr, ap.hash); onStep({ step: 'approve', status: 'ok', detail: ap.hash });
    }
    else onStep({ step: 'approve', status: 'skip', detail: 'ya autorizado' });
    let quote = 0n; try { quote = await rc.quoteGasPayment(kadenaDomain); } catch (_) {}
    onStep({ step: 'transfer', status: 'run', detail: viaLedger ? 'Firma el envío EN el Ledger…' : 'Firmando y enviando…' });
    const tx = await send(router, rc.interface.encodeFunctionData('transferRemote', [kadenaDomain, recipient, amt, kadenaChain]), quote);
    out.txHash = tx.hash;
    onStep({ step: 'transfer', status: 'ok', detail: tx.hash });
    onStep({ step: 'ethconfirm', status: 'run', detail: 'Esperando confirmación en Ethereum…' });
    const rcpt = await nodo.esperarRecibo(pr, tx.hash);
    onStep({ step: 'ethconfirm', status: rcpt.status === 1 ? 'ok' : 'fail', detail: 'bloque ' + rcpt.blockNumber });
    out.receiptOk = rcpt.status === 1;
    return out;
  } finally { pr.destroy(); }
}

// Saldos de los tokens del puente en EVM (USDC, USDT…) para una dirección
async function getEvmBalances({ rpc, address, routes }) {
  const pr = nodo.proveedor(rpc);
  // ethers deja el proveedor reintentando la deteccion de red cada segundo para siempre si el
  // nodo no contesta. Destruirlo al salir no es opcional: es la unica forma de soltarlo.
  try {
    const abi = ['function balanceOf(address) view returns (uint256)'];
    return await Promise.all(routes.map(async (t) => {
      try { const c = new ethers.Contract(t.evmToken, abi, pr); const b = await c.balanceOf(address); return { symbol: t.symbol, balance: Number(ethers.formatUnits(b, t.decimals)) }; }
      // Un fallo del nodo NO es un saldo de cero. Devolviendo 0 aqui, la ventana del puente decia
      // "no tienes fondos" cuando lo que pasaba es que no se habia podido preguntar. Paso de verdad
      // el 2026-09-09: un nodo que rechazaba los grupos de mas de 3 llamadas pinto los CUATRO tokens
      // a cero teniendo saldo, y el fallo se busco durante un rato donde no estaba.
      // balance null = "no se sabe"; quien lo pinte tiene que ensenarlo distinto de un cero.
      catch (e) { return { symbol: t.symbol, balance: null, error: String((e && (e.shortMessage || e.message)) || e).slice(0, 200) }; }
    }));
  } finally { pr.destroy(); }
}

module.exports = { dryRunKda2Evm, dryRunEvm2Kda, sendEvm2Kda, sendKda2Evm, getKadenaBalances, getEvmBalances, evmRecipient, NS };
