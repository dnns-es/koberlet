// Koberlet - Copyright 2026 DNNS.es (Oberluss)
// SPDX-License-Identifier: Apache-2.0

// QUE PAQUETE DE AUTO-UPDATE SE ACEPTA. Aparte de main.js para poder probarlo con
// firmas de verdad (test/actualizacion.test.js): si esto fallara, la version que lo
// lleve se quedaria sin poder actualizarse sola.
//
//   - el sha256 de lo bajado es el anunciado y `sig` lo firma (auditoria Alex #1);
//   - `sigVer` firma "koberlet-app|<version>|<sha256>" y la version es MAYOR que la
//     instalada (aviso de Alex GHSA-wj7g-5v28-pj92, hallazgo 4): sin esto un
//     latest.json manipulado devolvia a todos a un paquete viejo, firmado de verdad.
//
// Devuelve la version nueva o lanza con el motivo.

const crypto = require('crypto');
const nacl = require('tweetnacl');

const cmpVer = (a, b) => {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
};

function firmaVale(texto, sigHex, pubHex) {
  try { return nacl.sign.detached.verify(Buffer.from(texto, 'utf8'), Buffer.from(String(sigHex || ''), 'hex'), Buffer.from(pubHex, 'hex')); }
  catch (_) { return false; }
}

function verificarPaquete(j, bytes, instalada, pubHex) {
  if (!j || !j.sha256 || !j.sig) throw new Error('El paquete no está firmado; actualización rechazada por seguridad.');
  const sha = crypto.createHash('sha256').update(bytes).digest('hex');
  if (sha !== String(j.sha256).toLowerCase()) throw new Error('El paquete descargado no coincide con el sha256 esperado; se descarta.');
  if (!firmaVale(sha, j.sig, pubHex)) throw new Error('Firma del paquete inválida; actualización rechazada (posible manipulación).');
  const ver = (typeof j.version === 'string' && /^\d+\.\d+\.\d+$/.test(j.version)) ? j.version : '';
  if (!ver || cmpVer(ver, instalada) <= 0) throw new Error('La versión del servidor no es más nueva que la instalada; no se actualiza.');
  if (!firmaVale('koberlet-app|' + ver + '|' + sha, j.sigVer, pubHex)) throw new Error('La versión del paquete no va firmada; actualización rechazada por seguridad.');
  return { version: ver, sha256: sha };
}

module.exports = { verificarPaquete, cmpVer };
