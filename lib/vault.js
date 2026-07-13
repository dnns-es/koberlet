// Bóveda cifrada de claves. AES-256-GCM + scrypt(passphrase). Las privadas NUNCA se guardan en claro.
// Formato del fichero vault.json: { v, kdf:{salt,N,r,p}, iv, tag, ct }  (todo base64)
// La SESIÓN retiene la clave derivada (no la passphrase): re-guardar y re-autenticar no necesitan el texto.
const crypto = require('crypto');
const fs = require('fs');

const N = 1 << 15, r = 8, p = 1; // scrypt: coste alto pero usable
const KEYLEN = 32;
const MAXMEM = 256 * 1024 * 1024;

function derive(passphrase, salt, params) {
  return crypto.scryptSync(passphrase, salt, KEYLEN, { N: params.N, r: params.r, p: params.p, maxmem: MAXMEM });
}

// Cifra con una clave/sal ya derivadas. IV NUEVO por escritura (obligatorio en GCM).
function encryptWith(vaultPath, key, salt, params, dataObj) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const pt = Buffer.from(JSON.stringify(dataObj), 'utf8');
  const ct = Buffer.concat([cipher.update(pt), cipher.final()]);
  const tag = cipher.getAuthTag();
  pt.fill(0);
  const out = {
    v: 1,
    kdf: { salt: salt.toString('base64'), N: params.N, r: params.r, p: params.p },
    iv: iv.toString('base64'), tag: tag.toString('base64'), ct: ct.toString('base64')
  };
  fs.writeFileSync(vaultPath, JSON.stringify(out, null, 2), { mode: 0o600 });
}

// Primer uso: genera sal, deriva clave, escribe. Devuelve la sesión {key,salt,params} para no retener la passphrase.
function crear(vaultPath, passphrase, dataObj) {
  const salt = crypto.randomBytes(16);
  const params = { N, r, p };
  const key = derive(passphrase, salt, params);
  encryptWith(vaultPath, key, salt, params, dataObj);
  return { key, salt, params };
}

// Re-guardar con la clave/sal de la sesión (sin necesitar la passphrase).
function guardar(vaultPath, key, salt, params, dataObj) {
  encryptWith(vaultPath, key, salt, params, dataObj);
}

// Descifra el fichero vault -> { data, key, salt, params } (lanza si la passphrase es mala)
function abrir(vaultPath, passphrase) {
  const raw = JSON.parse(fs.readFileSync(vaultPath, 'utf8'));
  const salt = Buffer.from(raw.kdf.salt, 'base64');
  // Suelo mínimo de KDF (anti-downgrade sobre un vault robado): rechazar parámetros débiles.
  const kN = Number(raw.kdf.N), kr = Number(raw.kdf.r), kp = Number(raw.kdf.p);
  if (!(kN >= (1 << 14)) || !(kr >= 8) || !(kp >= 1)) throw new Error('Parámetros KDF de la bóveda por debajo del mínimo de seguridad.');
  const params = { N: kN, r: kr, p: kp };
  const key = derive(passphrase, salt, params);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(raw.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(raw.tag, 'base64'));
  const pt = Buffer.concat([decipher.update(Buffer.from(raw.ct, 'base64')), decipher.final()]);
  const obj = JSON.parse(pt.toString('utf8'));
  pt.fill(0);
  return { data: obj, key, salt, params };
}

function existe(vaultPath) { return fs.existsSync(vaultPath); }

module.exports = { crear, guardar, abrir, existe };
