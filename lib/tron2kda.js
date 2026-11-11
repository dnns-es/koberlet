// Koberlet - Copyright 2026 DNNS.es (Oberluss)
// SPDX-License-Identifier: Apache-2.0

// USDT de Tron → KDA, de un tirón. Diseño: DISENO_TRON_A_KDA.md.
//
//   Tron ──① Legacy Mesh──► Ethereum ──② Uniswap──► USDC ──③ puente──► kb-USDC ──④ Mercatus──► KDA
//
// ① es el puente OFICIAL de Tether (USDT0 Legacy Mesh, sobre LayerZero): 0,03 %. En el mismo
//   envío se pide a LayerZero que deje un poco de ETH en la dirección de destino (nativeDrop),
//   así quien viene de Tron no necesita tener ETH para los pasos ② y ③.
// ② ③ ④ son piezas que Koberlet ya usa (evmswap, bridge, dex); aquí solo se encadenan.
//
// Todo va a cuentas DEL USUARIO (su Tron, su Ethereum, su Kadena en Koberlet): si algo se
// para a medias, el dinero está en una de sus cuentas, nunca en el aire ni en otra mano.
//
// REANUDABLE: la operación se guarda tras cada paso, y el identificador de cada transacción
// se guarda ANTES de emitirla (en Tron se conoce antes: es el sha256 de lo que se firma).
// Si la app se cierra, al volver se mira en qué quedó cada cosa y NUNCA se repite un envío
// que ya salió. Donde no hay identificador previo (Uniswap, puente) se decide por saldos.
//
// Este módulo no sabe de Electron ni de la bóveda: todo lo de fuera le llega en `deps`,
// para poder probarlo con una cadena de mentira (test/tron2kda.test.js).
const { ethers } = require('ethers');
const tron = require('./tron');

const USDT_TRON = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const OFT_TRON = 'TFG4wBaDQ8sHWWP1ACeSGnoNR6RRzevLPt';   // Legacy Mesh (UsdtOFT) en Tron, docs.usdt0.to
const EID_ETHEREUM = 30101;                              // LayerZero: Ethereum mainnet
const MIN_USDT = 10;            // por debajo, las comisiones fijas se lo comen y la gasolinera de Kadena no paga (<5)
const ENERGIA_ENVIO = 260000;   // estimación del envío por el puente cuando aún no se puede simular (sin permiso)
const GAS_PASOS_ETH = 450000;   // approve USDT + Uniswap + approve USDC + puente, con margen
const DROP_MIN = 300000000000000n;    // 0,0003 ETH
const DROP_MAX = 3000000000000000n;   // 0,003 ETH

const ifc = new ethers.Interface([
  'function approve(address,uint256) returns (bool)',
  'function allowance(address,address) view returns (uint256)',
  'function quoteOFT((uint32 dstEid,bytes32 to,uint256 amountLD,uint256 minAmountLD,bytes extraOptions,bytes composeMsg,bytes oftCmd)) view returns ((uint256 minAmountLD,uint256 maxAmountLD),(int256 feeAmountLD,string description)[],(uint256 amountSentLD,uint256 amountReceivedLD))',
  'function quoteSend((uint32 dstEid,bytes32 to,uint256 amountLD,uint256 minAmountLD,bytes extraOptions,bytes composeMsg,bytes oftCmd),bool) view returns ((uint256 nativeFee,uint256 lzTokenFee))',
  'function send((uint32 dstEid,bytes32 to,uint256 amountLD,uint256 minAmountLD,bytes extraOptions,bytes composeMsg,bytes oftCmd),(uint256 nativeFee,uint256 lzTokenFee),address) payable returns ((bytes32 guid,uint64 nonce,(uint256 nativeFee,uint256 lzTokenFee) fee),(uint256 amountSentLD,uint256 amountReceivedLD))'
]);

// Opción LayerZero tipo 3 con un nativeDrop: entrega `wei` de ETH a `destino` en Ethereum.
// [0x0003][worker 01][largo 0x0031 = 1+16+32][tipo 02][cantidad uint128][destinatario bytes32]
function opcionesDrop(wei, destino) {
  if (!wei || BigInt(wei) === 0n) return '0x';
  return '0x0003' + '01' + '0031' + '02' + BigInt(wei).toString(16).padStart(32, '0') + ethers.zeroPadValue(ethers.getAddress(destino), 32).slice(2);
}

const u6 = (x) => ethers.parseUnits(String(x), 6);
const f6 = (x) => ethers.formatUnits(BigInt(x), 6);
const dormir = (ms) => new Promise(r => setTimeout(r, ms));

// ---- Legacy Mesh ------------------------------------------------------------------------

function sendParam(cantidad, minimo, ethAddr, dropWei) {
  return [EID_ETHEREUM, ethers.zeroPadValue(ethers.getAddress(ethAddr), 32), BigInt(cantidad), BigInt(minimo), opcionesDrop(dropWei, ethAddr), '0x', '0x'];
}
async function leer(fn, args, from, cfg) {
  const r = await tron.simular({ from, contract: fn === 'allowance' ? USDT_TRON : OFT_TRON, data: ifc.encodeFunctionData(fn, args) }, cfg);
  if (!r.ok) throw new Error('El puente de Tether no responde (' + fn + '): ' + r.motivo);
  return ifc.decodeFunctionResult(fn, r.datos);
}
async function cotizarMesh({ from, cantidad, ethAddr, dropWei }, cfg) {
  const p0 = sendParam(cantidad, 0n, ethAddr, dropWei);
  const [limites, , recibo] = await leer('quoteOFT', [p0], from, cfg);
  if (BigInt(cantidad) > limites[1]) throw new Error('El puente de Tether no admite tanto de una vez ahora mismo.');
  const recibe = recibo[1];
  const p = sendParam(cantidad, recibe, ethAddr, dropWei);
  const [fee] = await leer('quoteSend', [p, false], from, cfg);
  return { recibe, nativeFee: fee[0], sendParam: p };
}

// El cambio en Mercatus se firma con un mínimo de KDA a recibir: es lo único que impide que
// alguien mueva el precio justo antes (sandwich) y se quede la diferencia. Si ese mínimo sale
// a 0 o muy por debajo de lo esperado, algo está mal calculado y NO se cambia. (11-11-2026:
// un deslizamiento pasado como «1» en vez de «0,01» daba un mínimo de 0 KDA.)
function exigirProteccion(q) {
  if (!(Number(q.minimo) > 0) || Number(q.minimo) < Number(q.esperada) * 0.95) {
    throw new Error('La protección de precio del cambio en Mercatus no está bien (mínimo ' + q.minimo + ' para ' + q.esperada + ' esperados). No se cambia.');
  }
}

// ---- Cotización completa ----------------------------------------------------------------

// Lo que verá el usuario antes de firmar nada. Cada número sale de una cotización real.
async function cotizar({ cantidad, tronAddr, ethAddr, kdaCuenta }, deps) {
  const cfg = deps.tronCfg;
  if (!(Number(cantidad) >= MIN_USDT)) throw new Error('El mínimo para traer USDT de Tron a KDA es ' + MIN_USDT + ' USDT: por debajo, las comisiones se comen el cambio.');
  const c = u6(cantidad);
  const saldo = await tron.getBalances(tronAddr, cfg);
  if (saldo.ajena) throw new Error('Esta cuenta de Tron tiene OTRO dueño: alguien cambió sus permisos y tu clave ya no puede firmar. No envíes nada a esta dirección.');
  const usdt = (saldo.tokens.find(t => t.address === USDT_TRON) || {}).amount || 0;
  if (u6(usdt) < c) throw new Error('No hay USDT suficiente en Tron: tienes ' + usdt + '.');

  // ETH para los pasos en Ethereum: si ya lo tiene, no se pide; si no, lo trae LayerZero.
  const precioGas = await deps.precioGasEth();
  const necesario = BigInt(GAS_PASOS_ETH) * precioGas * 2n;
  const ethYa = await deps.saldoEth(ethAddr);
  let drop = 0n;
  if (ethYa < necesario) { drop = BigInt(GAS_PASOS_ETH) * precioGas * 3n; if (drop < DROP_MIN) drop = DROP_MIN; if (drop > DROP_MAX) drop = DROP_MAX; }

  const mesh = await cotizarMesh({ from: tronAddr, cantidad: c, ethAddr, dropWei: drop }, cfg);
  const permiso = (await leer('allowance', [tron.aHex20(tronAddr), tron.aHex20(OFT_TRON)], tronAddr, cfg))[0];
  const red = await tron.nodoTron(cfg, '/wallet/getchainparameters', {});
  const solEnergia = Number(((red.chainParameter || []).find(x => x.key === 'getEnergyFee') || {}).value || 100);
  const eAprobar = permiso >= c ? 0 : (await tron.simular({ from: tronAddr, contract: USDT_TRON, data: ifc.encodeFunctionData('approve', [tron.aHex20(OFT_TRON), c]) }, cfg)).energia;
  const energia = Math.max(0, eAprobar + ENERGIA_ENVIO - saldo.energia);
  const trxTotal = (energia * solEnergia + Number(mesh.nativeFee)) / 1e6;

  const uni = await deps.cotizarUniswap(f6(mesh.recibe));
  const mer = await deps.cotizarMercatus(uni.salida);
  exigirProteccion(mer);
  return {
    cantidad: f6(c), llegaEth: f6(mesh.recibe), comisionTether: f6(c - mesh.recibe),
    tasaLayerZeroTrx: Number(mesh.nativeFee) / 1e6, gasEthTraido: ethers.formatEther(drop),
    energiaEstimada: eAprobar + ENERGIA_ENVIO, trxEstimados: Math.round(trxTotal * 100) / 100, trxDisponible: saldo.native,
    faltaTrx: saldo.native < trxTotal * 1.1, necesitaPermiso: permiso < c,
    usdc: uni.salida, kdaEsperado: mer.esperada, kdaMinimo: mer.minimo, impacto: mer.impacto, frenado: mer.frenado,
    dropWei: drop.toString(), tronAddr, ethAddr, kdaCuenta
  };
}

// ---- La operación -----------------------------------------------------------------------

function crear(q, ids) {
  return {
    id: 't2k-' + Date.now().toString(36), creada: new Date().toISOString(), estado: 'inicio',
    wallets: ids, cantidad: q.cantidad, tronAddr: q.tronAddr, ethAddr: q.ethAddr, kdaCuenta: q.kdaCuenta,
    dropWei: q.dropWei, kdaMinimoVisto: q.kdaMinimo, pasos: {}
  };
}

// Emite en Tron guardando ANTES el txID; si ya había uno guardado, mira en qué quedó.
async function pasoTron(op, clave, construir, deps) {
  const cfg = deps.tronCfg;
  const ya = op.pasos[clave];
  if (ya && ya.txID) {
    const e = await tron.estadoTx(ya.txID, cfg);
    if (e && e.ok) return;   // ya entró bien: no se repite
    if (e && !e.ok) throw new Error('La transacción de Tron falló (' + e.resultado + '). Mira ' + ya.txID + ' en Tronscan.');
    // Sin noticias: si aún no ha caducado (60 s desde que se hizo), se espera a que entre.
    if (Date.now() - (ya.ts || 0) < 90000) { await tron.esperar(ya.txID, cfg, { tope: 90000 }); return; }
    // Caducada sin entrar: no existe para la red, se puede rehacer sin riesgo de doble envío.
  }
  const { raw, comprobarCon } = await construir();
  tron.comprobarLlamada(raw, comprobarCon);
  const txID = ethers.sha256('0x' + raw).slice(2);
  op.pasos[clave] = { txID, ts: Date.now() };
  await deps.guardar(op);
  await tron.emitir(raw, deps.tronSecret, cfg);
  const r = await tron.esperar(txID, cfg, { tope: 120000 });
  if (r.pendiente) throw new Error('Tron no confirma la transacción ' + txID + ' todavía. Vuelve a pulsar Continuar en un minuto.');
  op.pasos[clave].quemado = r.quemado;
  await deps.guardar(op);
}

// Espera con tope a que una lectura cumpla. Devuelve false si se acaba el tiempo (no es un fallo).
async function esperarQue(cond, { cada = 15000, tope = 30 * 60000 } = {}) {
  const fin = Date.now() + tope;
  for (;;) {
    try { if (await cond()) return true; } catch (_) { /* un fallo de lectura no decide nada */ }
    if (Date.now() > fin) return false;
    await dormir(cada);
  }
}

const ORDEN = ['inicio', 'tron_permiso', 'tron_enviado', 'eth_llegado', 'usdc', 'puente_enviado', 'kda_llegado', 'hecho'];

// Avanza la operación todo lo que pueda. `aviso(op)` se llama en cada cambio para la pantalla.
async function avanzar(op, deps) {
  const cfg = deps.tronCfg;
  const pasar = async (estado, extra) => { Object.assign(op, extra || {}); op.estado = estado; op.error = null; await deps.guardar(op); deps.aviso(op); };
  const c = u6(op.cantidad);
  try {
    // ① a: permiso exacto al puente de Tether (si no lo tiene ya)
    if (op.estado === 'inicio') {
      const permiso = (await leer('allowance', [tron.aHex20(op.tronAddr), tron.aHex20(OFT_TRON)], op.tronAddr, cfg))[0];
      if (permiso < c) {
        deps.aviso(op, 'tron_permiso');
        const data = ifc.encodeFunctionData('approve', [tron.aHex20(OFT_TRON), c]);
        await pasoTron(op, 'permiso', async () => {
          const p = await tron.prepararLlamada({ from: op.tronAddr, contract: USDT_TRON, data }, cfg);
          return { raw: p.raw, comprobarCon: { from: op.tronAddr, contract: USDT_TRON, data } };
        }, deps);
      }
      await pasar('tron_permiso');
    }
    // ① b: envío por Legacy Mesh a la dirección de Ethereum del usuario (+ ETH para el gas)
    if (op.estado === 'tron_permiso') {
      deps.aviso(op, 'tron_enviando');
      if (!op.pasos.envio) op.usdtEthAntes = (await deps.saldoUsdtEth(op.ethAddr)).toString();
      await pasoTron(op, 'envio', async () => {
        const m = await cotizarMesh({ from: op.tronAddr, cantidad: c, ethAddr: op.ethAddr, dropWei: BigInt(op.dropWei || 0) }, cfg);
        op.llegaEth = m.recibe.toString();
        const data = ifc.encodeFunctionData('send', [m.sendParam, [m.nativeFee, 0n], tron.aHex20(op.tronAddr)]);
        const p = await tron.prepararLlamada({ from: op.tronAddr, contract: OFT_TRON, data, callValue: m.nativeFee }, cfg);
        return { raw: p.raw, comprobarCon: { from: op.tronAddr, contract: OFT_TRON, data, callValue: m.nativeFee } };
      }, deps);
      await pasar('tron_enviado');
    }
    // ② llegada a Ethereum: el USDT aparece en la dirección del usuario (LayerZero tarda unos minutos)
    if (op.estado === 'tron_enviado') {
      deps.aviso(op, 'eth_esperando');
      const objetivo = BigInt(op.usdtEthAntes) + BigInt(op.llegaEth);
      const ok = await esperarQue(async () => (await deps.saldoUsdtEth(op.ethAddr)) >= objetivo, deps.espera);
      if (!ok) return { pendiente: true, motivo: 'eth' };
      await pasar('eth_llegado');
    }
    // ③ USDT → USDC en Uniswap. Sin hash previo: se decide por saldos al reanudar.
    if (op.estado === 'eth_llegado') {
      deps.aviso(op, 'uniswap');
      const usdt = await deps.saldoUsdtEth(op.ethAddr);
      // Por diferencia con lo que había antes: si la dirección ya tenía USDT de antes, mirar
      // solo «hay al menos lo que llegó» volvería a cambiar al reanudar algo ya cambiado.
      if (op.usdcAntes === undefined || usdt >= BigInt(op.usdtEthAntes) + BigInt(op.llegaEth)) {
        // Aún no se ha cambiado (el USDT sigue ahí): se cambia lo que llegó, ni más ni menos.
        if (op.usdcAntes === undefined) { op.usdcAntes = (await deps.saldoUsdcEth(op.ethAddr)).toString(); await deps.guardar(op); }
        const r = await deps.cambiarUsdtUsdc(f6(op.llegaEth));
        op.pasos.uniswap = { hash: r.hash };
      }
      const usdc = (await deps.saldoUsdcEth(op.ethAddr)) - BigInt(op.usdcAntes);
      if (usdc <= 0n) throw new Error('El cambio a USDC no se ve todavía en Ethereum. Vuelve a pulsar Continuar en un minuto.');
      await pasar('usdc', { usdc: usdc.toString() });
    }
    // ④ a: USDC → kb-USDC por el puente a la cuenta Kadena del usuario
    if (op.estado === 'usdc') {
      deps.aviso(op, 'puente');
      const usdcAhora = await deps.saldoUsdcEth(op.ethAddr);
      if (op.kbAntes === undefined || usdcAhora >= BigInt(op.usdcAntes) + BigInt(op.usdc)) {
        // El USDC sigue en Ethereum: no ha salido, se manda.
        if (op.kbAntes === undefined) { op.kbAntes = String(await deps.saldoKbUsdc(op.kdaCuenta)); await deps.guardar(op); }
        const r = await deps.enviarPuente(f6(op.usdc));
        op.pasos.puente = { hash: r.txHash, messageId: r.messageId || null };
      }
      await pasar('puente_enviado');
    }
    // ④ b: espera del relé del puente (5-15 min, a veces más)
    if (op.estado === 'puente_enviado') {
      deps.aviso(op, 'kda_esperando');
      const objetivo = Number(op.kbAntes) + Number(f6(op.usdc)) * 0.999;
      const ok = await esperarQue(async () => (await deps.saldoKbUsdc(op.kdaCuenta)) >= objetivo, deps.esperaPuente || deps.espera);
      if (!ok) return { pendiente: true, motivo: 'puente' };
      await pasar('kda_llegado');
    }
    // ⑤ kb-USDC → KDA en Mercatus
    if (op.estado === 'kda_llegado') {
      deps.aviso(op, 'mercatus');
      if (!op.pasos.mercatus) {
        const q = await deps.cotizarMercatus(f6(op.usdc));
        if (q.frenado) throw new Error('Mercatus está muy fino ahora (moverías el precio un ' + Number(q.impacto).toFixed(1) + '%). Tu dinero está a salvo como kb-USDC en tu cuenta Kadena: puedes cambiarlo a KDA desde el Mercado cuando quieras, o en partes.');
        exigirProteccion(q);
        const r = await deps.cambiarMercatus(f6(op.usdc));
        op.pasos.mercatus = { requestKey: r.requestKey };
        await deps.guardar(op);
      }
      const res = await deps.esperarKadena(op.pasos.mercatus.requestKey);
      if (!res.ok) { const rk = op.pasos.mercatus.requestKey; delete op.pasos.mercatus; await deps.guardar(op); throw new Error('El cambio en Mercatus no salió (' + res.motivo + ', ' + rk + '). Tu kb-USDC sigue en tu cuenta Kadena.'); }
      await pasar('hecho', { kdaRecibido: res.recibido || null });
    }
    return { hecho: op.estado === 'hecho' };
  } catch (e) {
    op.error = String((e && e.message) || e);
    await deps.guardar(op);
    deps.aviso(op);
    throw e;
  }
}

// Dónde está el dinero según el estado: lo que se le dice al usuario si algo se para.
function dondeEsta(op) {
  if (['inicio', 'tron_permiso'].includes(op.estado) && !(op.pasos && op.pasos.envio)) return 'tron';
  if (['tron_permiso', 'tron_enviado'].includes(op.estado)) return 'camino_eth';
  if (op.estado === 'eth_llegado') return 'eth_usdt';
  if (op.estado === 'usdc') return 'eth_usdc';
  if (op.estado === 'puente_enviado') return 'camino_kda';
  if (op.estado === 'kda_llegado') return 'kda_kbusdc';
  return 'kda';
}

module.exports = { cotizar, crear, avanzar, dondeEsta, opcionesDrop, sendParam, cotizarMesh, ORDEN, MIN_USDT, OFT_TRON, USDT_TRON, EID_ETHEREUM, ifc };
