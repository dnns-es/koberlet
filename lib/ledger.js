// Ledger (monedero físico): las claves privadas viven DENTRO del aparato y NUNCA salen de él.
// Aquí solo hay transporte USB-HID (proceso main) y armado de parámetros; la transacción se
// construye y firma EN el Ledger, que muestra los datos en su pantalla para que el usuario confirme.
// App Kadena = SmartPacts/app-kadena (continuación de la de Zondax, la que instala ledger.dnns.es).
// App Ethereum = la oficial de Ledger. Paths estándar: KDA m/44'/626'/i'/0/0 · EVM m/44'/60'/i'/0/0.
const { KadenaApp } = require('@zondax/ledger-kadena');
const EthApp = require('@ledgerhq/hw-app-eth').default;
const TransportNodeHid = require('@ledgerhq/hw-transport-node-hid-noevents').default;
const { ethers } = require('ethers');

const kdaPath = (i) => `m/44'/626'/${i | 0}'/0/0`;
const ethPath = (i) => `m/44'/60'/${i | 0}'/0/0`;

// Traduce los errores del aparato a mensajes en cristiano (códigos APDU habituales).
function friendly(e) {
  const s = String((e && (e.message || e.errorMessage)) || e || '');
  const code = Number((e && (e.statusCode || e.returnCode)) || 0);
  if (code === 0x6985 || /denied|rejected|refused/i.test(s)) return new Error('Operación rechazada en el Ledger.');
  if (code === 0x5515 || /locked/i.test(s)) return new Error('El Ledger está bloqueado: introduce el PIN en el aparato.');
  if ([0x6e00, 0x6e01, 0x6d00, 0x6511].includes(code) || /CLA_NOT_SUPPORTED|INS_NOT_SUPPORTED|UNKNOWN_APDU|app does not seem to be open/i.test(s))
    return new Error('Abre la app correcta en el Ledger (Kadena para KDA, Ethereum para EVM) y reintenta.');
  if (/cannot open device|no device|NoDevice|not found|access denied/i.test(s))
    return new Error('No veo ningún Ledger. Conéctalo por USB, desbloquéalo y cierra Ledger Live si está abierto.');
  return new Error('Ledger: ' + s.slice(0, 160));
}

// Abre el transporte, ejecuta y CIERRA siempre (si queda abierto, el siguiente uso falla con "device busy").
async function withDevice(fn) {
  let t = null;
  try { t = await TransportNodeHid.open(); } catch (e) { throw friendly(e); }
  try { return await fn(t); }
  catch (e) { throw friendly(e); }
  finally { if (t) { try { await t.close(); } catch (_) {} } }
}

// Versiones antiguas de la lib devuelven {returnCode, errorMessage} en vez de lanzar; se normaliza aquí.
const chk = (r) => { if (r && r.returnCode !== undefined && Number(r.returnCode) !== 0x9000) throw new Error(r.errorMessage || ('código ' + r.returnCode)); return r; };

// Abre la app pedida EN el aparato (mismos APDU que Ledger Live): salir al dashboard (0xB0A7,
// falla inofensivamente si ya está) + abrir por nombre (0xE0D8). El cambio de app re-enumera el
// USB → hay que cerrar el transporte y esperar antes de reabrir. Verificado en vivo con Nano S+.
const _sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function _tryOpenApp(name) {
  try { const t = await TransportNodeHid.open(); try { await t.send(0xb0, 0xa7, 0, 0); } catch (_) {} finally { try { await t.close(); } catch (_) {} } } catch (_) {}
  await _sleep(900);
  try { const t = await TransportNodeHid.open(); try { await t.send(0xe0, 0xd8, 0, 0, Buffer.from(name, 'ascii')); } finally { try { await t.close(); } catch (_) {} } } catch (_) {}
  await _sleep(2500);
}
// Ejecuta fn y, si el fallo es "app equivocada/cerrada", intenta abrir la app correcta y reintenta UNA vez.
async function autoApp(kind, fn) {
  try { return await fn(); }
  catch (e) {
    if (!/Abre la app correcta/.test(String(e && e.message))) throw e;
    await _tryOpenApp(kind === 'kda' ? 'Kadena' : 'Ethereum');
    return fn();
  }
}

// Lee la cuenta del aparato en el índice dado (no toca claves). verify=true la muestra además
// en la pantalla del Ledger para que el usuario la coteje.
async function getAccount(kind, index, verify) {
  return autoApp(kind, () => withDevice(async (t) => {
    if (kind === 'kda') {
      const app = new KadenaApp(t);
      const r = chk(await app.getAddressAndPubKey(kdaPath(index), !!verify));
      const pub = Buffer.from(r.pubkey).toString('hex');
      return { kind: 'kda', index: index | 0, account: 'k:' + pub, public: pub };
    }
    const app = new EthApp(t);
    const r = await app.getAddress(ethPath(index), !!verify, false);
    return { kind: 'evm', index: index | 0, address: ethers.getAddress(r.address), public: r.publicKey || null };
  }));
}

// Transferencia KDA firmada EN el aparato: la app Kadena construye la transacción completa
// (transfer o transfer-create) y devuelve el comando Pact firmado {cmd, hash, sigs}, listo
// para POST /send. Solo admite destinos k:<pubkey> (la app firma contra esa pubkey).
async function signKdaTransfer({ index, isCreate, toPubkey, amount, chainId, networkId, gasPrice, gasLimit, ttl, creationTime, nonce }) {
  return autoApp('kda', () => withDevice(async (t) => {
    const app = new KadenaApp(t);
    const params = {
      recipient: String(toPubkey), amount: String(amount), chainId: Number(chainId), network: String(networkId),
      gasPrice: String(gasPrice), gasLimit: String(gasLimit), creationTime: Number(creationTime), ttl: String(ttl), nonce: String(nonce)
    };
    const r = chk(isCreate ? await app.signTransferCreateTx(kdaPath(index), params) : await app.signTransferTx(kdaPath(index), params));
    if (!r.pact_command || !r.pact_command.cmd) throw new Error('el aparato no devolvió la transacción firmada.');
    return r.pact_command;
  }));
}

// Firma y difunde una tx EVM. El aparato muestra destino/importe (para ERC-20 puede pedir
// "blind signing" activado en los ajustes de la app Ethereum del Ledger).
async function _sendEvmTx({ index, rpc, to, valueWei, data }) {
  const pr = new ethers.JsonRpcProvider(rpc);
  const from = await autoApp('evm', () => withDevice(async (t) => (await new EthApp(t).getAddress(ethPath(index), false, false)).address));
  const [nonce, fee, net, gasLimit] = await Promise.all([
    pr.getTransactionCount(from), pr.getFeeData(), pr.getNetwork(),
    pr.estimateGas({ from, to, value: valueWei || 0n, data: data || '0x' })
  ]);
  const txReq = (fee.maxFeePerGas != null)
    ? { type: 2, chainId: Number(net.chainId), nonce, to, value: valueWei || 0n, data: data || '0x', gasLimit, maxFeePerGas: fee.maxFeePerGas, maxPriorityFeePerGas: fee.maxPriorityFeePerGas }
    : { type: 0, chainId: Number(net.chainId), nonce, to, value: valueWei || 0n, data: data || '0x', gasLimit, gasPrice: fee.gasPrice };
  const unsigned = ethers.Transaction.from(txReq).unsignedSerialized.slice(2);
  // Resolución de metadatos (nombre del token, etc.) para que el Ledger muestre detalles en claro; si falla, se firma igual.
  let resolution = null;
  try {
    const { ledgerService } = require('@ledgerhq/hw-app-eth');
    resolution = await ledgerService.resolveTransaction(unsigned, {}, { erc20: true, externalPlugins: false, nft: false });
  } catch (_) {}
  const sig = await autoApp('evm', () => withDevice(async (t) => new EthApp(t).signTransaction(ethPath(index), unsigned, resolution)));
  const tx = ethers.Transaction.from(txReq);
  tx.signature = { r: '0x' + sig.r, s: '0x' + sig.s, v: parseInt(sig.v, 16) };
  const sent = await pr.broadcastTransaction(tx.serialized);
  return { hash: sent.hash, from };
}

async function sendNative({ index, rpc, to, amount }) {
  return _sendEvmTx({ index, rpc, to, valueWei: ethers.parseEther(String(amount)) });
}
async function sendToken({ index, rpc, token, to, amount }) {
  const pr = new ethers.JsonRpcProvider(rpc);
  const c = new ethers.Contract(token, ['function decimals() view returns (uint8)', 'function transfer(address,uint256) returns (bool)'], pr);
  const dec = await c.decimals();
  const data = c.interface.encodeFunctionData('transfer', [to, ethers.parseUnits(String(amount), dec)]);
  return _sendEvmTx({ index, rpc, to: token, valueWei: 0n, data });
}

// Llamada a contrato arbitraria (approve, transferRemote…) firmada en el aparato.
async function sendContract({ index, rpc, to, data, valueWei }) {
  return _sendEvmTx({ index, rpc, to, valueWei: valueWei || 0n, data });
}

module.exports = { getAccount, signKdaTransfer, sendNative, sendToken, sendContract };
