// USDT de Tron → KDA (lib/tron2kda.js) contra una cadena de mentira.
// Lo que de verdad importa aquí: que si la app se corta a mitad, al reanudar NO se repita
// ningún envío que ya salió (doble gasto), y que si algo se para el dinero esté en una
// cuenta del usuario.
const assert = require('assert');
const { ethers } = require('ethers');
const tron = require('../lib/tron');
const t2k = require('../lib/tron2kda');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const igual = (a, b, m) => { assert.strictEqual(a, b, m); n++; };

const TRON = tron.desdePrivada('22'.repeat(32)).address;
const ETH = '0x1111111111111111111111111111111111111111';
const KDA = 'k:' + 'ab'.repeat(32);

// ---- Cadena de mentira -------------------------------------------------------------------
function mundo() {
  const m = { permiso: 0n, usdtEth: 3000000n /* ya tenía 3 USDT de antes */, usdcEth: 0n, kb: 1, txs: {}, emitidos: [],
    swaps: 0, puentes: 0, mercatus: 0, cortarEn: null };
  const recibe = (c) => c - c * 3n / 10000n;
  tron.simular = async ({ data }) => {
    const sel = data.slice(0, 10);
    const f = t2k.ifc.getFunction(sel);
    if (f.name === 'allowance') return { ok: true, datos: t2k.ifc.encodeFunctionResult('allowance', [m.permiso]), energia: 300 };
    if (f.name === 'quoteOFT') { const [p] = t2k.ifc.decodeFunctionData('quoteOFT', data); return { ok: true, datos: t2k.ifc.encodeFunctionResult('quoteOFT', [[0n, 10n ** 15n], [], [p[2], recibe(p[2])]]), energia: 2000 }; }
    if (f.name === 'quoteSend') return { ok: true, datos: t2k.ifc.encodeFunctionResult('quoteSend', [[8000000n, 0n]]), energia: 50000 };
    if (f.name === 'approve') return { ok: true, datos: '0x', energia: 100000 };
    return { ok: true, datos: '0x', energia: 200000 };
  };
  tron.prepararLlamada = async ({ from, contract, data, callValue = 0n }) => {
    const raw = tron.codificarRaw({ ref: { bytes: Buffer.from('0102', 'hex'), hash: Buffer.alloc(8, 7) }, expiration: Date.now() + 60000, timestamp: Date.now(),
      tipo: tron.TIPO_TRIGGER, parametro: tron.paramTrigger({ owner: from, contract, callValue: BigInt(callValue), data }), feeLimit: 50e6 });
    return { raw: raw.toString('hex'), simulada: true, coste: { trx: 1 } };
  };
  tron.emitir = async (rawHex) => {
    const id = ethers.sha256('0x' + rawHex).slice(2);
    m.emitidos.push(id);
    const d = tron.decodificarRaw(Buffer.from(rawHex, 'hex'));
    const f = t2k.ifc.parseTransaction({ data: d.data });
    if (f.name === 'approve') m.permiso = f.args[1];
    if (f.name === 'send') { assert.ok(m.permiso >= f.args[0][2], 'el envío nunca sale sin permiso'); m.usdtEth += f.args[0][3]; }
    m.txs[id] = true;
    if (m.cortarEn === 'tras-emitir-' + f.name) { m.cortarEn = null; throw new Error('CORTE'); }
    return id;
  };
  tron.esperar = async (txID) => ({ txID, quemado: 1 });
  tron.estadoTx = async (txID) => (m.txs[txID] ? { ok: true, resultado: 'SUCCESS', quemado: 1 } : null);
  tron.getBalances = async () => ({ native: 100, tokens: [{ address: t2k.USDT_TRON, symbol: 'USDT', amount: 500 }], activada: true, energia: 0, banda: 600, ajena: false });
  tron.nodoTron = async () => ({ chainParameter: [{ key: 'getEnergyFee', value: 100 }] });

  const ops = {};
  const deps = {
    tronCfg: {}, tronSecret: '22'.repeat(32), espera: { cada: 1, tope: 50 },
    guardar: async (op) => { ops[op.id] = JSON.parse(JSON.stringify(op)); },
    aviso: () => {},
    precioGasEth: async () => 100000000n,          // 0,1 gwei
    saldoEth: async () => 0n,
    saldoUsdtEth: async () => m.usdtEth,
    saldoUsdcEth: async () => m.usdcEth,
    cotizarUniswap: async (x) => ({ salida: x }),
    cotizarMercatus: async (x) => ({ esperada: Number(x) * 150, minimo: Number(x) * 148, impacto: 1.2, frenado: !!m.frenar }),
    cambiarUsdtUsdc: async (x) => {
      m.swaps++; const v = ethers.parseUnits(x, 6); assert.ok(m.usdtEth >= v, 'no se cambia más USDT del que hay'); m.usdtEth -= v; m.usdcEth += v;
      if (m.cortarEn === 'tras-uniswap') { m.cortarEn = null; throw new Error('CORTE'); }
      return { hash: '0xswap' };
    },
    enviarPuente: async (x) => {
      m.puentes++; const v = ethers.parseUnits(x, 6); assert.ok(m.usdcEth >= v, 'no se manda más USDC del que hay'); m.usdcEth -= v; m.kb += Number(x);
      if (m.cortarEn === 'tras-puente') { m.cortarEn = null; throw new Error('CORTE'); }
      return { txHash: '0xpuente', messageId: '0xmsg' };
    },
    saldoKbUsdc: async () => m.kb,
    cambiarMercatus: async () => { m.mercatus++; return { requestKey: 'rk' + m.mercatus }; },
    esperarKadena: async () => ({ ok: true, recibido: 1499 })
  };
  return { m, deps, ops };
}
const op0 = (deps) => t2k.crear({ cantidad: '10', tronAddr: TRON, ethAddr: ETH, kdaCuenta: KDA, dropWei: '300000000000000', kdaMinimo: 1480 }, {});
async function hastaQueAcabe(op, deps) { for (let i = 0; i < 10; i++) { try { return await t2k.avanzar(op, deps); } catch (e) { if (e.message !== 'CORTE') throw e; op = JSON.parse(JSON.stringify(op)); } } throw new Error('no acaba'); }

(async () => {
  // ---- Camino feliz
  { const { m, deps } = mundo(); const op = op0();
    const r = await t2k.avanzar(op, deps);
    ok(r.hecho, 'camino completo: hecho');
    igual(op.estado, 'hecho', 'estado final');
    igual(m.emitidos.length, 2, 'Tron: un permiso y un envío');
    igual(m.swaps, 1, 'un solo cambio en Uniswap'); igual(m.puentes, 1, 'un solo envío por el puente'); igual(m.mercatus, 1, 'un solo cambio en Mercatus');
    igual(op.llegaEth, '9997000', 'llega lo cotizado (10 − 0,03 %)');
    igual(m.usdtEth, 3000000n, 'el USDT que ya había en Ethereum no se toca');
    igual(op.usdc, '9997000', 'se cambia y se puentea exactamente lo que llegó');
  }
  // ---- Permiso que ya estaba: no se pide otra vez
  { const { m, deps } = mundo(); m.permiso = 10n ** 12n; const op = op0();
    await t2k.avanzar(op, deps); igual(m.emitidos.length, 1, 'con permiso previo solo se firma el envío'); }

  // ---- Cortes a mitad: al reanudar no se repite nada
  for (const corte of ['tras-emitir-approve', 'tras-emitir-send', 'tras-uniswap', 'tras-puente']) {
    const { m, deps } = mundo(); m.cortarEn = corte;
    const op = await (async () => { const o = op0(); try { await t2k.avanzar(o, deps); } catch (e) { if (e.message !== 'CORTE') throw e; } return o; })();
    ok(op.estado !== 'hecho', corte + ': se ha quedado a medias');
    const fin = await hastaQueAcabe(op, deps);
    ok(fin.hecho, corte + ': al reanudar termina');
    igual(m.emitidos.length, 2, corte + ': en Tron no se emite nada dos veces');
    igual(m.swaps, 1, corte + ': Uniswap una sola vez'); igual(m.puentes, 1, corte + ': puente una sola vez'); igual(m.mercatus, 1, corte + ': Mercatus una sola vez');
  }

  // ---- LayerZero tarda: queda pendiente, sin error, y luego sigue
  { const { m, deps } = mundo(); const op = op0();
    const real = deps.saldoUsdtEth; let tarde = true; deps.saldoUsdtEth = async (a) => (tarde && op.estado === 'tron_enviado' ? 3000000n : real(a));
    const r = await t2k.avanzar(op, deps);
    ok(r.pendiente && r.motivo === 'eth', 'si no ha llegado a Ethereum: pendiente, no fallo');
    igual(op.estado, 'tron_enviado', 'se queda en «enviado desde Tron»');
    igual(t2k.dondeEsta(op), 'camino_eth', 'el dinero está de camino a Ethereum');
    tarde = false; const r2 = await t2k.avanzar(op, deps);
    ok(r2.hecho, 'cuando llega, sigue hasta el final'); igual(m.emitidos.length, 2, 'y sin reenviar nada desde Tron');
  }

  // ---- Mercatus demasiado fino: se para con el dinero como kb-USDC del usuario
  { const { m, deps } = mundo(); m.frenar = true; const op = op0();
    await assert.rejects(() => t2k.avanzar(op, deps), /kb-USDC/); n++;
    igual(op.estado, 'kda_llegado', 'parado antes de Mercatus');
    igual(t2k.dondeEsta(op), 'kda_kbusdc', 'el dinero está en su cuenta Kadena como kb-USDC');
    igual(m.mercatus, 0, 'no se ha cambiado nada en Mercatus');
  }

  // ---- Protección de precio en Mercatus: con mínimo 0 NO se cambia (el fallo del «1» en vez de «0,01»)
  { const { m, deps } = mundo(); const op = op0();
    deps.cotizarMercatus = async (x) => ({ esperada: Number(x) * 150, minimo: 0, impacto: 1, frenado: false });
    await assert.rejects(() => t2k.avanzar(op, deps), /protección de precio/); n++;
    igual(m.mercatus, 0, 'con mínimo 0 no se firma el cambio');
    igual(t2k.dondeEsta(op), 'kda_kbusdc', 'y el dinero queda como kb-USDC del usuario');
  }

  // ---- Opciones de LayerZero: forma exacta del nativeDrop
  igual(t2k.opcionesDrop(0n, ETH), '0x', 'sin ETH no hay opciones');
  const o = t2k.opcionesDrop(500000000000000n, ETH);
  igual(o.length, 2 + 2 * (2 + 1 + 2 + 1 + 16 + 32), 'tamaño del nativeDrop');
  ok(o.startsWith('0x0003010031' + '02'), 'cabecera tipo 3, ejecutor, nativeDrop');
  ok(o.endsWith(ETH.slice(2).toLowerCase()), 'el ETH va a la dirección del usuario');

  // ---- Mínimo
  { const { deps } = mundo(); await assert.rejects(() => t2k.cotizar({ cantidad: '9.99', tronAddr: TRON, ethAddr: ETH, kdaCuenta: KDA }, deps), /mínimo/); n++; }

  console.log('OK: ' + n + ' comprobaciones de Tron → KDA');
})().catch(e => { console.error('FALLO:', e.message); process.exit(1); });
