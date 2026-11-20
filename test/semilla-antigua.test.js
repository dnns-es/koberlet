// Koberlet - Copyright 2026 DNNS.es (Oberluss)
// SPDX-License-Identifier: Apache-2.0

// Dos cosas que fallaron el 20-11-2026 al importar una wallet de eckoWALLET por semilla:
//   1. Una semilla correcta daba "Invalid mnemonic." si llegaba con mayusculas, dobles
//      espacios, tabuladores o saltos de linea.
//   2. La cuenta no aparecia con ningun metodo: eckoWALLET usa la derivacion ANTIGUA de
//      Chainweaver (kadena-crypto), que Koberlet no tenia ni sabia firmar.
// Sin red. La semilla es el vector publico de pruebas de BIP-39, no la de nadie.
//
//   node test/semilla-antigua.test.js
const path = require('path');
const crypto = require('crypto');
const nacl = require('tweetnacl');
const wallets = require('../lib/wallets');
const firma = require('../lib/firma');

const SEMILLA = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
let mal = 0;
const ok = (c, t) => { console.log((c ? 'ok     ' : 'MAL    ') + t); if (!c) mal++; };
const valida = (msg, sigHex, pubHex) => nacl.sign.detached.verify(new Uint8Array(msg), new Uint8Array(Buffer.from(sigHex, 'hex')), new Uint8Array(Buffer.from(pubHex, 'hex')));

(async () => {
  // --- 1. La semilla se limpia antes de derivar ---
  const p = SEMILLA.split(' ');
  const sucias = {
    'mayusculas': SEMILLA.toUpperCase(),
    'dobles espacios': p.join('  '),
    'tabuladores': p.join('\t'),
    'salto de linea': p.slice(0, 6).join(' ') + '\r\n' + p.slice(6).join(' '),
    'espacios en los bordes': '  ' + SEMILLA + ' \n'
  };
  for (const metodo of ['chainweaver', 'ecko', wallets.METODO_ANTIGUO]) {
    const buena = (await wallets.deriveKda(SEMILLA, 0, metodo)).account;
    for (const [nombre, s] of Object.entries(sucias)) {
      let cuenta = null;
      try { cuenta = (await wallets.deriveKda(s, 0, metodo)).account; } catch (e) { cuenta = 'ERROR ' + e.message; }
      ok(cuenta === buena, metodo + ': semilla con ' + nombre + ' da la misma cuenta');
    }
  }
  let rechazada = false;
  try { await wallets.deriveKda(['zzzz'].concat(p.slice(1)).join(' '), 0, 'chainweaver'); } catch (_) { rechazada = true; }
  ok(rechazada, 'una palabra que no existe se sigue rechazando');

  // --- 2. Derivacion antigua: coincide con kadena-crypto en crudo (el oraculo) ---
  const crudo = require(path.join(__dirname, '..', 'node_modules', '@kadena', 'hd-wallet', 'lib', 'cjs', 'chainweaver', 'kadena-crypto.js'));
  const raiz = await crudo.kadenaMnemonicToRootKeypair('', SEMILLA);
  for (const i of [0, 1, 5]) {
    const par = await crudo.kadenaGenKeypair('', raiz, 0x80000000 + i);   // indice endurecido A MANO
    const esperada = 'k:' + Buffer.from(par[1]).toString('hex');
    const k = await wallets.deriveKda(SEMILLA, i, wallets.METODO_ANTIGUO);
    ok(k.account === esperada, 'antigua #' + i + ': misma cuenta que kadena-crypto en crudo');
    ok(firma.esAntigua(k.secret), 'antigua #' + i + ': el secreto lleva la marca de clave antigua');
    const msg = crypto.randomBytes(32);
    ok(valida(msg, await firma.firmar(msg, k.secret), k.public), 'antigua #' + i + ': la firma valida contra su clave publica');
  }
  const a0 = (await wallets.deriveKda(SEMILLA, 0, wallets.METODO_ANTIGUO)).account;
  ok(a0 !== (await wallets.deriveKda(SEMILLA, 0, 'chainweaver')).account && a0 !== (await wallets.deriveKda(SEMILLA, 0, 'ecko')).account,
    'la cuenta antigua es distinta de las de los otros dos metodos');

  // --- 3. El firmante unico no cambia nada para las claves de siempre ---
  const s = await wallets.deriveKda(SEMILLA, 0, 'chainweaver');
  const msg = crypto.randomBytes(32);
  const sig = await firma.firmar(msg, s.secret);
  const directa = Buffer.from(nacl.sign.detached(new Uint8Array(msg), nacl.sign.keyPair.fromSeed(Buffer.from(s.secret, 'hex')).secretKey)).toString('hex');
  ok(sig === directa, 'semilla de 32 bytes: firma identica a la de tweetnacl de siempre');
  ok(valida(msg, await firma.firmar(msg, '0x' + s.secret), s.public), 'acepta el secreto con 0x delante');
  let rechaza = false;
  try { await firma.firmar(msg, 'esto-no-es-una-clave'); } catch (_) { rechaza = true; }
  ok(rechaza, 'un secreto irreconocible no firma');

  console.log(mal ? '\nHAY ' + mal + ' COMPROBACIONES MAL' : '\nsemilla y derivacion antigua: todo bien');
  process.exit(mal ? 1 : 0);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
