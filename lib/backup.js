// Copia de seguridad PORTABLE y cifrada de la bóveda. El usuario elige una contraseña
// DEDICADA (no tiene por qué ser la de la app), guarda el archivo donde quiera, y solo con
// esa contraseña puede abrirse. Sin ella, el contenido es indistinguible de ruido.
//
// Cifrado: AES-256-GCM (autenticado: detecta cualquier manipulación del archivo).
// Derivación: scrypt con coste ALTO (N=2^17) — más caro que el de la bóveda porque un
// backup se abre de tarde en tarde, así que encarecer cada intento de fuerza bruta compensa.
// Formato autocontenido: { magic, v, creado, kdf:{salt,N,r,p}, iv, tag, ct }  (todo base64).
const crypto = require('crypto');

const N = 1 << 17, r = 8, p = 1;   // ~0,5-1 s por intento en un PC normal
const KEYLEN = 32;
const MAXMEM = 512 * 1024 * 1024;
const MAGIC = 'koberlet-backup';
const MIN_PW = 10;                  // suelo de longitud (la app además exige fortaleza)

function derive(password, salt, params) {
  return crypto.scryptSync(Buffer.from(String(password), 'utf8'), salt, KEYLEN,
    { N: params.N, r: params.r, p: params.p, maxmem: MAXMEM });
}

// Devuelve el TEXTO del archivo de backup (JSON) cifrando dataObj con `password`.
function crearBackup(password, dataObj, meta) {
  if (!password || String(password).length < MIN_PW) throw new Error(`La contraseña del backup debe tener al menos ${MIN_PW} caracteres.`);
  const salt = crypto.randomBytes(16);
  const params = { N, r, p };
  const key = derive(password, salt, params);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const pt = Buffer.from(JSON.stringify(dataObj), 'utf8');
  const ct = Buffer.concat([cipher.update(pt), cipher.final()]);
  const tag = cipher.getAuthTag();
  pt.fill(0); key.fill(0);
  return JSON.stringify({
    magic: MAGIC, v: 1, creado: (meta && meta.creado) || null, app: (meta && meta.app) || 'Koberlet',
    kdf: { salt: salt.toString('base64'), N, r, p },
    iv: iv.toString('base64'), tag: tag.toString('base64'), ct: ct.toString('base64')
  }, null, 2);
}

// Descifra el texto de un archivo de backup con `password`. Lanza si la contraseña es mala o
// el archivo fue manipulado (el tag GCM no cuadra). Devuelve { data, creado }.
function abrirBackup(fileText, password) {
  let raw;
  try { raw = JSON.parse(fileText); } catch (_) { throw new Error('El archivo no es una copia de seguridad de Koberlet válida.'); }
  if (!raw || raw.magic !== MAGIC) throw new Error('El archivo no es una copia de seguridad de Koberlet.');
  const kN = Number(raw.kdf.N), kr = Number(raw.kdf.r), kp = Number(raw.kdf.p);
  // Suelo anti-downgrade: un backup con KDF débil (por manipulación) se rechaza.
  // Suelo contra degradación y TECHO contra un archivo manipulado que pida un scrypt
  // desmesurado y deje la app pensando hasta agotar la memoria (auditoría B-1).
  if (!(kN >= (1 << 14)) || !(kr >= 8) || !(kp >= 1)) throw new Error('Parámetros de cifrado del backup por debajo del mínimo de seguridad.');
  if (!(kN <= (1 << 20)) || !(kr <= 32) || !(kp <= 16)) throw new Error('Parámetros de cifrado del backup fuera de rango.');
  const salt = Buffer.from(raw.kdf.salt, 'base64');
  const key = derive(password, salt, { N: kN, r: kr, p: kp });
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(raw.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(raw.tag, 'base64'));
  let pt;
  try { pt = Buffer.concat([decipher.update(Buffer.from(raw.ct, 'base64')), decipher.final()]); }
  catch (_) { key.fill(0); throw new Error('Contraseña incorrecta o archivo dañado/manipulado.'); }
  key.fill(0);
  let obj; try { obj = JSON.parse(pt.toString('utf8')); } catch (_) { pt.fill(0); throw new Error('El contenido del backup no es válido.'); }
  pt.fill(0);
  return { data: obj, creado: raw.creado };
}

module.exports = { crearBackup, abrirBackup, MIN_PW };
