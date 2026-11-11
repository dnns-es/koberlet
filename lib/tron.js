// Koberlet - Copyright 2026 DNNS.es (Oberluss)
// SPDX-License-Identifier: Apache-2.0

// Tron: direcciones, saldo de TRX + TRC-20, estimación de coste y envío.
//
// La transacción se CONSTRUYE AQUÍ, byte a byte (protobuf de Tron), no la monta el nodo.
// Es la misma regla que en Ethereum: no se firma nada que no hayamos construido nosotros.
// Del nodo solo se usa: el último bloque (para la referencia de bloque), las lecturas y la
// emisión de la transacción ya firmada. Un nodo hostil podría mentir en un saldo, pero no
// puede colar otro destino, otra cantidad u otro contrato en lo que se firma.
//
// Tron usa la misma curva que Ethereum (secp256k1): la dirección son los mismos 20 bytes
// que daría Ethereum con esa clave, con 0x41 delante y en Base58Check (empieza por "T").
const { ethers } = require('ethers');

const PREFIJO = '41';
const TIPO_TRANSFER = 1;     // TransferContract (TRX)
const TIPO_TRIGGER = 31;     // TriggerSmartContract (TRC-20 y contratos)
const URL_TIPO = {
  [TIPO_TRANSFER]: 'type.googleapis.com/protocol.TransferContract',
  [TIPO_TRIGGER]: 'type.googleapis.com/protocol.TriggerSmartContract'
};
const SUN = 1000000n;        // 1 TRX = 1.000.000 sun
const TRC20_ABI = new ethers.Interface([
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address) view returns (uint256)'
]);

// ---- Direcciones ------------------------------------------------------------------------

const hex = (b) => Buffer.from(b).toString('hex');

// 20 bytes "estilo Ethereum" (0x…) → dirección Tron (T…)
function desdeHex20(h20) {
  const cuerpo = '0x' + PREFIJO + h20.replace(/^0x/i, '').toLowerCase();
  if (cuerpo.length !== 44) throw new Error('Dirección de 20 bytes no válida.');
  const suma = ethers.sha256(ethers.sha256(cuerpo)).slice(2, 10);
  return ethers.encodeBase58(cuerpo + suma);
}

// Dirección Tron (T…) → 21 bytes (41 + 20) en hex sin 0x. Comprueba la suma de control:
// una letra cambiada da error, no una dirección "parecida" a la que se envía el dinero.
function aHex21(dir) {
  const s = String(dir || '').trim();
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(s)) throw new Error('Dirección Tron no válida: ' + s);
  const h = ethers.toBeHex(ethers.decodeBase58(s), 25).slice(2);
  const cuerpo = h.slice(0, 42), suma = h.slice(42);
  if (!cuerpo.startsWith(PREFIJO)) throw new Error('Dirección Tron no válida: ' + s);
  if (ethers.sha256(ethers.sha256('0x' + cuerpo)).slice(2, 10) !== suma) throw new Error('Dirección Tron con la suma de control mal (¿una letra equivocada?): ' + s);
  return cuerpo;
}
const aHex20 = (dir) => '0x' + aHex21(dir).slice(2);   // para meterla en el ABI de un contrato
const esDireccion = (dir) => { try { aHex21(dir); return true; } catch (_) { return false; } };

// Clave privada secp256k1 → dirección Tron
function desdePrivada(privHex) {
  const w = new ethers.Wallet('0x' + String(privHex).replace(/^0x/i, ''));
  return { address: desdeHex20(w.address), public: w.signingKey.publicKey, secret: w.privateKey.slice(2) };
}

// ---- Protobuf (solo lo que usa una transacción de Tron) ---------------------------------

function varint(n) {
  let v = BigInt(n); if (v < 0n) throw new Error('varint negativo');
  const out = [];
  do { let b = Number(v & 0x7fn); v >>= 7n; if (v) b |= 0x80; out.push(b); } while (v);
  return Buffer.from(out);
}
const clave = (campo, tipo) => varint((campo << 3) | tipo);
const campoVarint = (campo, v) => (BigInt(v) === 0n ? Buffer.alloc(0) : Buffer.concat([clave(campo, 0), varint(v)]));
const campoBytes = (campo, b) => { b = Buffer.from(b); return b.length ? Buffer.concat([clave(campo, 2), varint(b.length), b]) : Buffer.alloc(0); };

// Lee un mensaje protobuf: { campo: [valor, …] } (varint → BigInt, longitud → Buffer)
function leerProto(buf) {
  const out = {}; let i = 0;
  const leerVarint = () => { let r = 0n, s = 0n, b; do { if (i >= buf.length) throw new Error('protobuf cortado'); b = buf[i++]; r |= BigInt(b & 0x7f) << s; s += 7n; } while (b & 0x80); return r; };
  while (i < buf.length) {
    const k = Number(leerVarint()), campo = k >> 3, tipo = k & 7;
    let v;
    if (tipo === 0) v = leerVarint();
    else if (tipo === 2) { const n = Number(leerVarint()); if (i + n > buf.length) throw new Error('protobuf cortado'); v = buf.subarray(i, i + n); i += n; }
    else throw new Error('tipo protobuf no soportado: ' + tipo);
    (out[campo] = out[campo] || []).push(v);
  }
  return out;
}

// Parámetro de cada tipo de contrato
function paramTransfer({ owner, to, amount }) {
  return Buffer.concat([campoBytes(1, Buffer.from(aHex21(owner), 'hex')), campoBytes(2, Buffer.from(aHex21(to), 'hex')), campoVarint(3, amount)]);
}
function paramTrigger({ owner, contract, callValue, data }) {
  return Buffer.concat([campoBytes(1, Buffer.from(aHex21(owner), 'hex')), campoBytes(2, Buffer.from(aHex21(contract), 'hex')),
    campoVarint(3, callValue || 0), campoBytes(4, Buffer.from(String(data).replace(/^0x/i, ''), 'hex'))]);
}

// Transaction.raw. `ref` sale del último bloque: { bytes: 2 bytes, hash: 8 bytes }
function codificarRaw({ ref, expiration, timestamp, tipo, parametro, feeLimit }) {
  const any = Buffer.concat([campoBytes(1, Buffer.from(URL_TIPO[tipo])), campoBytes(2, parametro)]);
  const contrato = Buffer.concat([campoVarint(1, tipo), campoBytes(2, any)]);
  return Buffer.concat([
    campoBytes(1, ref.bytes), campoBytes(4, ref.hash), campoVarint(8, expiration),
    campoBytes(11, contrato), campoVarint(14, timestamp), campoVarint(18, feeLimit || 0)
  ]);
}

// Lo contrario: de los bytes del raw a lo que dice de verdad. Se usa para comprobar, antes
// de firmar, que lo construido dice exactamente lo que se pidió (y en los tests, contra
// transacciones construidas por el nodo oficial).
function decodificarRaw(raw) {
  const r = leerProto(Buffer.from(raw));
  if (!r[11] || r[11].length !== 1) throw new Error('la transacción debe llevar exactamente un contrato');
  const c = leerProto(r[11][0]);
  const tipo = Number((c[1] || [0n])[0]);
  const any = leerProto(c[2][0]);
  const url = any[1][0].toString();
  if (url !== URL_TIPO[tipo]) throw new Error('tipo de contrato inesperado: ' + url);
  const p = leerProto(any[2] ? any[2][0] : Buffer.alloc(0));
  const dir = (b) => desdeHex20(hex(b).slice(2));
  const out = {
    tipo, refBytes: hex(r[1][0]), refHash: hex(r[4][0]),
    expiration: Number(r[8][0]), timestamp: Number((r[14] || [0n])[0]), feeLimit: Number((r[18] || [0n])[0]),
    owner: dir(p[1][0])
  };
  if (tipo === TIPO_TRANSFER) { out.to = dir(p[2][0]); out.amount = (p[3] || [0n])[0]; }
  else { out.contract = dir(p[2][0]); out.callValue = (p[3] || [0n])[0]; out.data = '0x' + hex((p[4] || [Buffer.alloc(0)])[0]); }
  return out;
}

// ---- Firma ------------------------------------------------------------------------------

// txID = sha256(raw). La firma es secp256k1 sobre ese hash: r || s || v (v = 27/28).
function firmar(raw, privHex) {
  const txID = ethers.sha256(raw);
  const sig = new ethers.SigningKey('0x' + String(privHex).replace(/^0x/i, '')).sign(txID);
  return { txID: txID.slice(2), firma: sig.serialized.slice(2) };
}
// Transaction { raw_data = 1, signature = 2 } → lo que acepta /wallet/broadcasthex
const transaccionHex = (raw, firmaHex) => hex(Buffer.concat([campoBytes(1, raw), campoBytes(2, Buffer.from(firmaHex, 'hex'))]));

// ---- Nodo -------------------------------------------------------------------------------

// TronGrid público: 3 peticiones por segundo y castiga 5 s si te pasas. Con clave de API
// el límite es mucho mayor. Se espacian todas las llamadas para no tropezar nunca.
let _ultima = 0;
async function nodoTron({ node, apiKey }, ruta, cuerpo) {
  const hueco = apiKey ? 120 : 400;
  const espera = _ultima + hueco - Date.now();
  _ultima = Math.max(Date.now(), _ultima + hueco);
  if (espera > 0) await new Promise(r => setTimeout(r, espera));
  const headers = { 'content-type': 'application/json' };
  if (apiKey) headers['TRON-PRO-API-KEY'] = apiKey;
  const r = await fetch(String(node).replace(/\/$/, '') + ruta, cuerpo === undefined ? { headers } : { method: 'POST', headers, body: JSON.stringify(cuerpo) });
  const txt = await r.text();
  let j; try { j = JSON.parse(txt); } catch (_) { throw new Error('El nodo de Tron no ha contestado bien (' + r.status + ').'); }
  if (j && j.Error) throw new Error('Nodo de Tron: ' + j.Error);
  return j;
}
const textoNodo = (m) => { try { return m ? Buffer.from(m, 'hex').toString('utf8') : ''; } catch (_) { return String(m); } };

// Referencia al último bloque. La transacción caduca a los 60 s (lo normal en Tron): si no
// entra en ese tiempo, no entra nunca, en vez de quedarse colgada y entrar horas después.
async function referenciaBloque(cfg) {
  const b = await nodoTron(cfg, '/wallet/getnowblock', {});
  const num = BigInt(b.block_header.raw_data.number);
  const ts = Number(b.block_header.raw_data.timestamp);
  return {
    ref: { bytes: Buffer.from(ethers.toBeHex(num, 8).slice(2), 'hex').subarray(6, 8), hash: Buffer.from(b.blockID, 'hex').subarray(8, 16) },
    expiration: ts + 60 * 1000, timestamp: Date.now()
  };
}

async function parametrosRed(cfg) {
  const j = await nodoTron(cfg, '/wallet/getchainparameters', {});
  const v = (k, def) => { const p = (j.chainParameter || []).find(x => x.key === k); return p && p.value !== undefined ? Number(p.value) : def; };
  return { solEnergia: v('getEnergyFee', 100), solByte: v('getTransactionFee', 1000), crearCuenta: v('getCreateAccountFee', 100000) + v('getCreateNewAccountFeeInSystemContract', 1000000) };
}

// Tron deja cambiar quién manda en una cuenta (permiso "owner"). Es una estafa conocida: quien
// consigue tu clave un momento se pone él de dueño, y a partir de ahí tu clave ya no firma
// nada aunque sigas viendo el saldo. Comprobado en vivo (11-11-2026) con la semilla pública
// de pruebas: su cuenta tiene un dueño ajeno con el permiso llamado "lol".
// Si nuestra propia dirección no basta para llegar al umbral del dueño, la cuenta NO es nuestra.
function cuentaAjena(cuenta, address) {
  const p = cuenta.owner_permission;
  if (!p || !Array.isArray(p.keys)) return false;   // sin permiso explícito: manda la propia clave
  const peso = p.keys.filter(k => k.address === address || k.address === aHex21(address)).reduce((s, k) => s + Number(k.weight || 0), 0);
  return peso < Number(p.threshold || 1);
}

// Saldos: { native: TRX, tokens:[{symbol,address,amount}], activada, energia, banda, ajena }
async function getBalances(address, cfg) {
  const j = await nodoTron(cfg, '/v1/accounts/' + address);
  const c = (j.data && j.data[0]) || null;
  const out = { native: c ? Number(c.balance || 0) / 1e6 : 0, tokens: [], activada: !!c, energia: 0, banda: 0, ajena: !!(c && cuentaAjena(c, address)) };
  for (const t of (cfg.tokens || [])) {
    let bruto = 0n;
    for (const x of (c && c.trc20) || []) if (x[t.address] !== undefined) bruto = BigInt(x[t.address]);
    out.tokens.push({ symbol: t.symbol, address: t.address, amount: Number(ethers.formatUnits(bruto, t.decimals)) });
  }
  if (c) {
    const re = await nodoTron(cfg, '/wallet/getaccountresource', { address, visible: true });
    out.energia = Math.max(0, (re.EnergyLimit || 0) - (re.EnergyUsed || 0));
    out.banda = Math.max(0, (re.freeNetLimit || 0) - (re.freeNetUsed || 0)) + Math.max(0, (re.NetLimit || 0) - (re.NetUsed || 0));
  }
  return out;
}
async function cuentaActivada(address, cfg) {
  const j = await nodoTron(cfg, '/wallet/getaccount', { address, visible: true });
  return !!(j && j.address);
}

// ---- Preparar un envío (sin firmar): qué se va a firmar y cuánto cuesta -----------------

// Bytes que ocupará la transacción firmada (para el ancho de banda): raw + firma + cabeceras.
const bytesFirmada = (raw) => raw.length + 65 + 8;

async function preparar({ from, to, amount, token }, cfg) {
  aHex21(from); aHex21(to);
  if (from === to) throw new Error('El destino es la misma cuenta.');
  const red = await parametrosRed(cfg);
  const [orig, destActiva] = await Promise.all([getBalances(from, cfg), cuentaActivada(to, cfg)]);
  if (!orig.activada) throw new Error('Esta cuenta de Tron aún no está activada: necesita recibir algo de TRX primero.');
  if (orig.ajena) throw new Error('Esta cuenta de Tron tiene OTRO dueño: alguien cambió sus permisos y tu clave ya no puede firmar. No envíes nada a esta dirección.');
  const ref = await referenciaBloque(cfg);
  let raw, energia = 0, cantidad, simbolo, decimales;
  if (!token) {
    simbolo = 'TRX'; decimales = 6;
    cantidad = ethers.parseUnits(String(amount), 6);
    if (cantidad <= 0n) throw new Error('Cantidad no válida.');
    raw = codificarRaw({ ...ref, tipo: TIPO_TRANSFER, parametro: paramTransfer({ owner: from, to, amount: cantidad }) });
  } else {
    const t = (cfg.tokens || []).find(x => x.address === token);
    if (!t) throw new Error('Token de Tron no soportado.');
    simbolo = t.symbol; decimales = t.decimals;
    cantidad = ethers.parseUnits(String(amount), t.decimals);
    if (cantidad <= 0n) throw new Error('Cantidad no válida.');
    const data = TRC20_ABI.encodeFunctionData('transfer', [aHex20(to), cantidad]);
    // Simulación en el nodo con el estado real: da la energía exacta (incluida la penalización
    // del contrato de USDT, que es muy usado) y avisa si fallaría, ANTES de firmar nada.
    const s = await nodoTron(cfg, '/wallet/triggerconstantcontract', { owner_address: from, contract_address: t.address, data: data.slice(2), visible: true });
    if (!s.result || !s.result.result) throw new Error('El envío fallaría: ' + (textoNodo(s.result && s.result.message) || 'el contrato lo rechaza'));
    energia = Number(s.energy_used || 0) + Number(s.energy_penalty || 0);
    // fee_limit: lo máximo que se permite quemar. Lo estimado + 30 %, nunca más de 100 TRX.
    const feeLimit = Math.min(100 * 1e6, Math.ceil(energia * red.solEnergia * 1.3));
    raw = codificarRaw({ ...ref, tipo: TIPO_TRIGGER, parametro: paramTrigger({ owner: from, contract: t.address, callValue: 0, data }), feeLimit });
  }
  // Coste en TRX quemados: la energía que no cubra la que tiene + los bytes que no cubra su ancho de banda.
  const quemaEnergia = Math.max(0, energia - orig.energia) * red.solEnergia;
  const bytes = bytesFirmada(raw);
  const quemaBanda = orig.banda >= bytes ? 0 : bytes * red.solByte;
  const activar = !token && !destActiva ? red.crearCuenta : 0;   // enviar TRX a una cuenta nueva la crea
  const costeSun = quemaEnergia + quemaBanda + activar;
  // Comprobación de saldos aquí, con números claros, y no un rechazo críptico del nodo después.
  const trxNecesario = BigInt(costeSun) + (!token ? cantidad : 0n);
  if (BigInt(Math.round(orig.native * 1e6)) < trxNecesario) {
    throw new Error(`No hay TRX suficiente: hacen falta ${ethers.formatUnits(trxNecesario, 6)} TRX${token ? ' para la energía' : ''} y hay ${orig.native}.`);
  }
  if (token) {
    const tk = orig.tokens.find(x => x.address === token);
    if (!tk || ethers.parseUnits(String(tk.amount), decimales) < cantidad) throw new Error(`No hay ${simbolo} suficiente.`);
  }
  return {
    raw: hex(raw), resumen: { from, to, cantidad: ethers.formatUnits(cantidad, decimales), simbolo },
    coste: { trx: Number(costeSun) / 1e6, energia, cubreEnergia: Math.min(energia, orig.energia), bytes, activarDestino: activar > 0, destinoActivado: destActiva }
  };
}

// Antes de firmar se vuelve a leer lo construido y se compara con lo pedido. Es la red de
// seguridad contra un fallo nuestro de codificación: si no dice exactamente eso, no se firma.
function comprobar(rawHex, { from, to, amount, token, decimals }) {
  const d = decodificarRaw(Buffer.from(rawHex, 'hex'));
  const cantidad = ethers.parseUnits(String(amount), decimals);
  const mal = [];
  if (d.owner !== from) mal.push('origen');
  if (d.expiration - Date.now() > 5 * 60 * 1000) mal.push('caducidad');
  if (!token) {
    if (d.tipo !== TIPO_TRANSFER) mal.push('tipo');
    if (d.to !== to) mal.push('destino');
    if (d.amount !== cantidad) mal.push('cantidad');
  } else {
    if (d.tipo !== TIPO_TRIGGER) mal.push('tipo');
    if (d.contract !== token) mal.push('contrato');
    if (d.callValue !== 0n) mal.push('TRX adjuntos');
    let args = null; try { args = TRC20_ABI.decodeFunctionData('transfer', d.data); } catch (_) { mal.push('datos'); }
    if (args && desdeHex20(args[0].slice(2)) !== to) mal.push('destino');
    if (args && args[1] !== cantidad) mal.push('cantidad');
    if (d.feeLimit > 100 * 1e6) mal.push('fee_limit');
  }
  if (mal.length) throw new Error('La transacción construida no coincide con lo pedido (' + mal.join(', ') + '). No se firma.');
  return d;
}

// ---- Emitir y esperar -------------------------------------------------------------------

async function emitir(rawHex, privHex, cfg) {
  const raw = Buffer.from(rawHex, 'hex');
  const { txID, firma } = firmar(raw, privHex);
  const r = await nodoTron(cfg, '/wallet/broadcasthex', { transaction: transaccionHex(raw, firma) });
  if (!r.result) throw new Error('Tron no ha aceptado la transacción: ' + (textoNodo(r.message) || r.code || 'sin motivo'));
  return txID;
}

// Espera el recibo. Ojo: en Tron una llamada a contrato puede ENTRAR en un bloque y aun así
// fallar (sin energía, revertida…): eso se distingue y se dice, no se da por bueno.
async function esperar(txID, cfg, { tope = 90000 } = {}) {
  const fin = Date.now() + tope;
  while (Date.now() < fin) {
    await new Promise(r => setTimeout(r, 3000));
    const i = await nodoTron(cfg, '/wallet/gettransactioninfobyid', { value: txID });
    if (i && i.id) {
      const res = i.receipt && i.receipt.result;
      if (res && res !== 'SUCCESS') throw new Error('La transacción entró pero falló en Tron (' + res + '). Mira ' + txID + ' en Tronscan.');
      return { txID, bloque: i.blockNumber, quemado: Number(i.fee || 0) / 1e6, energia: (i.receipt && i.receipt.energy_usage_total) || 0 };
    }
  }
  return { txID, pendiente: true };
}

module.exports = {
  desdeHex20, aHex21, aHex20, esDireccion, desdePrivada,
  codificarRaw, decodificarRaw, paramTransfer, paramTrigger, firmar, transaccionHex,
  getBalances, cuentaAjena, preparar, comprobar, emitir, esperar, nodoTron,
  TIPO_TRANSFER, TIPO_TRIGGER, SUN
};
