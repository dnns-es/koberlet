// Koberlet - Copyright 2026 DNNS.es (Oberluss)
// SPDX-License-Identifier: Apache-2.0

// Firmante UNICO de Kadena. Hasta la 2.16.15 cada modulo (kda, dex, dca, swap, launch,
// bridge) firmaba por su cuenta con tweetnacl, dando por hecho que la privada era una
// semilla ed25519 de 32 bytes. Las cuentas de la derivacion ANTIGUA de Chainweaver (la que
// usa eckoWALLET) no tienen esa semilla: su privada es una clave extendida que solo sabe
// usar kadena-crypto. Aqui se decide con que se firma segun el tipo de clave, y el resto
// del monedero no se entera.
//
// Dos formatos de secreto en la boveda:
//   - 64 caracteres hex            -> semilla ed25519 (lo de siempre): tweetnacl.
//   - "cwl:" + clave de kadena-crypto -> derivacion antigua: kadenaSign.
// La firma que sale es en los dos casos una ed25519 corriente de 64 bytes: el nodo no
// distingue una de otra.
const nacl = require('tweetnacl');

const PREFIJO_ANTIGUA = 'cwl:';
const ES_SEMILLA = /^[0-9a-fA-F]{64}$/;

let _leg = null;
async function antigua() { if (!_leg) _leg = await import('@kadena/hd-wallet/chainweaver'); return _leg; }

const esAntigua = (secreto) => String(secreto || '').startsWith(PREFIJO_ANTIGUA);

// bytes = el hash blake2b de 32 bytes del comando. Devuelve la firma en hex.
async function firmar(bytes, secreto) {
  const s = String(secreto || '');
  if (esAntigua(s)) {
    const L = await antigua();
    const sig = Buffer.from(await L.kadenaSign('', Buffer.from(bytes), s.slice(PREFIJO_ANTIGUA.length)));
    if (sig.length !== 64) throw new Error('La firma con la clave antigua no ha salido bien.');
    return sig.toString('hex');
  }
  const semilla = s.replace(/^0x/i, '');
  if (!ES_SEMILLA.test(semilla)) throw new Error('Clave de Kadena no reconocida: no se puede firmar.');
  const par = nacl.sign.keyPair.fromSeed(Buffer.from(semilla, 'hex'));
  return Buffer.from(nacl.sign.detached(new Uint8Array(bytes), par.secretKey)).toString('hex');
}

module.exports = { firmar, esAntigua, PREFIJO_ANTIGUA };
