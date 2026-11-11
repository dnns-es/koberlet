// Tron: direcciones, derivación desde semilla, codificación de la transacción y firma.
// Lo más importante: que lo que construye lib/tron.js sea BYTE A BYTE lo mismo que construye
// el nodo oficial (fixtures-tron.json). Si no, firmaríamos algo que Tron rechaza o, peor,
// algo distinto de lo que creemos.
const assert = require('assert');
const { ethers } = require('ethers');
const tron = require('../lib/tron');
const wallets = require('../lib/wallets');
const fx = require('./fixtures-tron.json');

let n = 0;
const ok = (cond, m) => { assert.ok(cond, m); n++; };
const igual = (a, b, m) => { assert.strictEqual(a, b, m); n++; };
const lanza = (fn, m) => { assert.throws(fn, m); n++; };

(async () => {
  // ---- Direcciones
  igual(tron.desdeHex20('0xa614f803b6fd780986a42c78ec9c7f77e6ded13c'), 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', 'USDT: hex → T…');
  igual(tron.aHex21('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'), '41a614f803b6fd780986a42c78ec9c7f77e6ded13c', 'USDT: T… → hex');
  lanza(() => tron.aHex21('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6u'), 'una letra cambiada se rechaza');
  lanza(() => tron.aHex21('0xa614f803b6fd780986a42c78ec9c7f77e6ded13c'), 'una dirección 0x no es de Tron');
  lanza(() => tron.aHex21(''), 'vacía');
  ok(tron.esDireccion('TCLBgkbfVkJroVBJVqBEsxtPNQEQMTQCLQ') && !tron.esDireccion('TCLBgkbfVkJroVBJVqBEsxtPNQEQMTQCLq'), 'esDireccion');

  // ---- Derivación: la misma ruta que Trust Wallet y TronLink (m/44'/195'/0'/0/i)
  const ABANDONO = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
  const t0 = wallets.deriveTron(ABANDONO, 0);
  igual(t0.address, 'TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH', 'vector conocido de la semilla de pruebas');
  ok(wallets.deriveTron(ABANDONO, 1).address !== t0.address, 'índice 1 distinto del 0');
  igual(tron.desdePrivada(t0.secret).address, t0.address, 'privada → misma dirección');
  igual(wallets.tronFromPriv('0x' + t0.secret).address, t0.address, 'importar por privada (con 0x)');

  // ---- Codificación: decodificar lo del nodo, volver a codificar y obtener los mismos bytes
  for (const [nombre, f] of [['TRX', fx.trx], ['TRC-20', fx.trc20]]) {
    const raw = Buffer.from(f.raw_data_hex, 'hex');
    igual(ethers.sha256(raw).slice(2), f.txID, nombre + ': txID = sha256(raw)');
    const d = tron.decodificarRaw(raw);
    const v = f.raw_data.contract[0].parameter.value;
    igual(d.owner, v.owner_address, nombre + ': origen');
    igual(d.expiration, f.raw_data.expiration, nombre + ': caducidad');
    igual(d.refBytes, f.raw_data.ref_block_bytes, nombre + ': ref_block_bytes');
    igual(d.refHash, f.raw_data.ref_block_hash, nombre + ': ref_block_hash');
    const ref = { bytes: Buffer.from(d.refBytes, 'hex'), hash: Buffer.from(d.refHash, 'hex') };
    let parametro;
    if (d.tipo === tron.TIPO_TRANSFER) {
      igual(d.to, v.to_address, nombre + ': destino'); igual(d.amount, BigInt(v.amount), nombre + ': cantidad');
      parametro = tron.paramTransfer({ owner: d.owner, to: d.to, amount: d.amount });
    } else {
      igual(d.contract, v.contract_address, nombre + ': contrato'); igual(d.data.slice(2), v.data, nombre + ': datos');
      igual(d.feeLimit, f.raw_data.fee_limit, nombre + ': fee_limit');
      parametro = tron.paramTrigger({ owner: d.owner, contract: d.contract, callValue: d.callValue, data: d.data });
    }
    const nuestro = tron.codificarRaw({ ref, expiration: d.expiration, timestamp: d.timestamp, tipo: d.tipo, parametro, feeLimit: d.feeLimit });
    igual(nuestro.toString('hex'), f.raw_data_hex, nombre + ': nuestra codificación = la del nodo, byte a byte');
  }

  // ---- comprobar(): acepta lo pedido y rechaza cualquier cambio
  const dest = fx.destino, origen = fx.trc20.raw_data.contract[0].parameter.value.owner_address;
  const USDT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
  const ahora = { bytes: Buffer.from('0102', 'hex'), hash: Buffer.from('0102030405060708', 'hex') };
  const exp = Date.now() + 60000;
  const data = (to, amt) => new ethers.Interface(['function transfer(address,uint256)']).encodeFunctionData('transfer', [tron.aHex20(to), amt]);
  const rawTok = (to, amt, contrato = USDT, callValue = 0) => tron.codificarRaw({ ref: ahora, expiration: exp, timestamp: Date.now(), tipo: tron.TIPO_TRIGGER,
    parametro: tron.paramTrigger({ owner: origen, contract: contrato, callValue, data: data(to, amt) }), feeLimit: 30e6 }).toString('hex');
  const pide = { from: origen, to: dest, amount: '2.5', token: USDT, decimals: 6 };
  ok(tron.comprobar(rawTok(dest, 2500000n), pide), 'TRC-20 correcto: se acepta');
  lanza(() => tron.comprobar(rawTok(origen, 2500000n), pide), 'otro destino: se rechaza');
  lanza(() => tron.comprobar(rawTok(dest, 2500001n), pide), 'otra cantidad: se rechaza');
  lanza(() => tron.comprobar(rawTok(dest, 2500000n, 'TCLBgkbfVkJroVBJVqBEsxtPNQEQMTQCLQ'), pide), 'otro contrato: se rechaza');
  lanza(() => tron.comprobar(rawTok(dest, 2500000n, USDT, 5), pide), 'TRX adjuntos: se rechaza');
  const rawTrx = (to, amt) => tron.codificarRaw({ ref: ahora, expiration: exp, timestamp: Date.now(), tipo: tron.TIPO_TRANSFER, parametro: tron.paramTransfer({ owner: origen, to, amount: amt }) }).toString('hex');
  const pideTrx = { from: origen, to: dest, amount: '1.5', token: null, decimals: 6 };
  ok(tron.comprobar(rawTrx(dest, 1500000n), pideTrx), 'TRX correcto: se acepta');
  lanza(() => tron.comprobar(rawTrx(dest, 1500001n), pideTrx), 'TRX otra cantidad: se rechaza');
  lanza(() => tron.comprobar(rawTok(dest, 1500000n), pideTrx), 'TRX pedido pero es una llamada a contrato: se rechaza');

  // ---- Firma: recupera la misma dirección que firma
  const raw = Buffer.from(fx.trx.raw_data_hex, 'hex');
  const { txID, firma } = tron.firmar(raw, t0.secret);
  igual(txID, ethers.sha256(raw).slice(2), 'txID de la firma');
  igual(firma.length, 130, 'firma de 65 bytes');
  ok(['1b', '1c'].includes(firma.slice(128)), 'v = 27/28');
  igual(tron.desdeHex20(ethers.recoverAddress('0x' + txID, '0x' + firma).slice(2)), t0.address, 'la firma recupera la dirección');
  ok(tron.transaccionHex(raw, firma).startsWith('0a' + raw.length.toString(16)), 'transacción firmada empieza por raw_data');

  // ---- Cuenta secuestrada (permiso de dueño cambiado): forma real de la de la semilla pública
  const mia = t0.address, otro = 'TUmdykWXNWHbRk3V4wFGKGHKMdh6jHzijm';
  ok(!tron.cuentaAjena({}, mia), 'sin permiso explícito: es tuya');
  ok(!tron.cuentaAjena({ owner_permission: { threshold: 1, keys: [{ address: mia, weight: 1 }] } }, mia), 'dueño = tu clave: es tuya');
  ok(tron.cuentaAjena({ owner_permission: { permission_name: 'lol', threshold: 1, keys: [{ address: otro, weight: 1 }] } }, mia), 'dueño ajeno: secuestrada');
  ok(tron.cuentaAjena({ owner_permission: { threshold: 2, keys: [{ address: mia, weight: 1 }, { address: otro, weight: 1 }] } }, mia), 'multifirma donde tú solo no llegas: no es tuya');

  console.log('OK: ' + n + ' comprobaciones de Tron');
})().catch(e => { console.error('FALLO:', e.message); process.exit(1); });
