// Koberlet - Copyright 2026 DNNS.es (Oberluss)
// SPDX-License-Identifier: Apache-2.0

// Derivación e importación de cuentas KDA (ed25519) y ETH (secp256k1).
// Dos métodos KDA por semilla: 'chainweaver' (@kadena/hd-wallet) y 'ecko' (BIP44 ed25519 SLIP-0010, m/44'/626'/0'/0'/i').
const { ethers } = require('ethers');
const nacl = require('tweetnacl');
const crypto = require('crypto');

let _hd = null;
async function hd() { if (!_hd) _hd = await import('@kadena/hd-wallet'); return _hd; }

const clean = (s) => String(s || '').trim();
const noHex0x = (s) => clean(s).replace(/^0x/i, '');

// --- Derivaciones SLIP-0010 ed25519 (estilo eckoWallet). Varias rutas candidatas para dar con la que usa cada wallet. ---
function hmac512(key, data) { return crypto.createHmac('sha512', key).update(data).digest(); }
function ser32(i) { const b = Buffer.alloc(4); b.writeUInt32BE(i >>> 0, 0); return b; }
function slip10Priv(seedBuf, indices) { // indices = niveles (se aplican hardened, único modo válido en ed25519)
  let I = hmac512(Buffer.from('ed25519 seed'), seedBuf);
  let k = I.subarray(0, 32), c = I.subarray(32);
  for (const p of indices) { const idx = (p + 0x80000000) >>> 0; I = hmac512(c, Buffer.concat([Buffer.from([0]), k, ser32(idx)])); k = I.subarray(0, 32); c = I.subarray(32); }
  return Buffer.from(k);
}
function acctFromSeed32(k) { const kp = nacl.sign.keyPair.fromSeed(k); const pub = Buffer.from(kp.publicKey).toString('hex'); return { account: 'k:' + pub, public: pub, secret: Buffer.from(k).toString('hex') }; }
// Rutas candidatas (m/…), el índice va donde marca cada plantilla; 'direct' = primeros 32 bytes de la semilla BIP39.
const SLIP_PATHS = {
  'ecko': (i) => [44, 626, 0, 0, i],       // m/44'/626'/0'/0'/i'
  'ecko-acct': (i) => [44, 626, i, 0, 0],  // m/44'/626'/i'/0'/0'
  'ecko-4': (i) => [44, 626, 0, i],        // m/44'/626'/0'/i'
  'ecko-3': (i) => [44, 626, i],           // m/44'/626'/i'
  'ecko-chg': (i) => [44, 626, 0, i, 0],   // m/44'/626'/0'/i'/0'
  'ecko-direct': 'direct'
};
function kdaSlip(mnemonic, index, method) {
  const seedBuf = Buffer.from(ethers.Mnemonic.fromPhrase(clean(mnemonic)).computeSeed().slice(2), 'hex');
  const tpl = SLIP_PATHS[method];
  if (tpl === 'direct') return acctFromSeed32(seedBuf.subarray(0, 32));
  return acctFromSeed32(slip10Priv(seedBuf, tpl(index | 0)));
}
const SLIP_METHODS = Object.keys(SLIP_PATHS);

// KDA desde privada (seed ed25519 de 32 bytes en hex)
function kdaFromPriv(secretHex) {
  const seed = noHex0x(secretHex);
  if (!/^[0-9a-fA-F]{64}$/.test(seed)) throw new Error('La privada KDA debe ser 64 caracteres hex (32 bytes).');
  const kp = nacl.sign.keyPair.fromSeed(Buffer.from(seed, 'hex'));
  const pub = Buffer.from(kp.publicKey).toString('hex');
  return { account: 'k:' + pub, public: pub, secret: seed };
}

// ETH desde privada (secp256k1 hex)
function ethFromPriv(privHex) {
  const w = new ethers.Wallet('0x' + noHex0x(privHex));
  return { address: w.address, public: w.signingKey.publicKey, secret: noHex0x(w.privateKey) };
}

// Cuenta KDA en el índice dado por el método elegido: 'chainweaver' (@kadena/hd-wallet) o 'ecko' (SLIP-0010).
async function deriveKda(mnemonic, index, method) {
  const mn = clean(mnemonic);
  const i = Math.max(0, index | 0);
  if (method && SLIP_PATHS[method]) return kdaSlip(mn, i, method);
  const h = await hd();
  const PW = 'ephemeral-' + Math.floor(performance.now());
  const seed = await h.kadenaMnemonicToSeed(PW, mn);
  const [pub, encSec] = await h.kadenaGenKeypairFromSeed(PW, seed, i);
  const sec = await h.kadenaDecrypt(PW, encSec);
  const secHex = (Buffer.isBuffer(sec) ? sec.toString('hex') : (typeof sec === 'string' ? sec : Buffer.from(sec).toString('hex'))).slice(0, 64);
  return { account: 'k:' + pub, public: pub, secret: secHex };
}
function deriveEth(mnemonic, index) {
  const node = ethers.HDNodeWallet.fromPhrase(clean(mnemonic), '', `m/44'/60'/0'/0/${index | 0}`);
  return { address: node.address, public: node.publicKey, secret: noHex0x(node.privateKey) };
}
// De una MISMA semilla BIP-39: deriva la cuenta KDA (por método) y la ETH en el ÍNDICE dado.
async function deriveAt(mnemonic, index, method) {
  const mn = clean(mnemonic);
  const words = mn.split(/\s+/).length;
  if (![12, 24].includes(words)) throw new Error('La semilla debe tener 12 o 24 palabras.');
  const i = Math.max(0, index | 0);
  return { kda: await deriveKda(mn, i, method), eth: deriveEth(mn, i) };
}
async function fromMnemonic(mnemonic) { return deriveAt(mnemonic, 0, 'chainweaver'); }

// Crea una wallet NUEVA de UNA sola red: genera semilla BIP-39 y deriva SOLO la cuenta de esa red.
// kind = 'kda' | 'evm'. Devuelve la semilla para que el usuario la anote (recupera cualquiera de las dos).
async function createNew(kind) {
  const h = await hd();
  const mnemonic = h.kadenaGenMnemonic();
  const w = await fromMnemonic(mnemonic);
  return { mnemonic, kda: kind === 'kda' ? w.kda : null, eth: kind === 'evm' ? w.eth : null };
}

module.exports = { fromMnemonic, deriveAt, deriveKda, deriveEth, kdaFromPriv, ethFromPriv, createNew, SLIP_METHODS };
