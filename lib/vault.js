// Bóveda cifrada de claves. AES-256-GCM + scrypt(passphrase). Las privadas NUNCA se guardan en claro.
// Formato del fichero vault.json: { v, kdf:{salt,N,r,p}, iv, tag, ct }  (todo base64)
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const N = 1 << 15, r = 8, p = 1; // scrypt: coste alto pero usable
const KEYLEN = 32;

function deriveKey(passphrase, salt) {
  return crypto.scryptSync(passphrase, salt, KEYLEN, { N, r, p, maxmem: 256 * 1024 * 1024 });
}

// Cifra un objeto JS -> escribe el fichero vault
function crear(vaultPath, passphrase, dataObj) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveKey(passphrase, salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const pt = Buffer.from(JSON.stringify(dataObj), 'utf8');
  const ct = Buffer.concat([cipher.update(pt), cipher.final()]);
  const tag = cipher.getAuthTag();
  key.fill(0);
  const out = {
    v: 1,
    kdf: { salt: salt.toString('base64'), N, r, p },
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ct: ct.toString('base64')
  };
  fs.writeFileSync(vaultPath, JSON.stringify(out, null, 2), { mode: 0o600 });
  return true;
}

// Descifra el fichero vault -> objeto JS (lanza si la passphrase es mala)
function abrir(vaultPath, passphrase) {
  const raw = JSON.parse(fs.readFileSync(vaultPath, 'utf8'));
  const salt = Buffer.from(raw.kdf.salt, 'base64');
  const key = crypto.scryptSync(passphrase, salt, KEYLEN, { N: raw.kdf.N, r: raw.kdf.r, p: raw.kdf.p, maxmem: 256 * 1024 * 1024 });
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(raw.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(raw.tag, 'base64'));
  const pt = Buffer.concat([decipher.update(Buffer.from(raw.ct, 'base64')), decipher.final()]);
  key.fill(0);
  const obj = JSON.parse(pt.toString('utf8'));
  pt.fill(0);
  return obj;
}

function existe(vaultPath) { return fs.existsSync(vaultPath); }

module.exports = { crear, abrir, existe };
