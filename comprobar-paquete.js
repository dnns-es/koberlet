#!/usr/bin/env node
// Koberlet - Copyright 2026 DNNS.es (Oberluss)
// SPDX-License-Identifier: Apache-2.0

/**
 * Comprobacion de humo del paquete recien construido, ANTES de subirlo.
 *
 * Existe por lo que paso el 28/08/2026: se publico la 2.7.17 con una poda de
 * node_modules que borraba carpetas "tests" enteras. Una de ellas
 * (@kadena/cryptography-utils/lib/tests/mockdata/Pact) hace falta EN TIEMPO DE
 * EJECUCION, asi que crear o importar una wallet por semilla dejo de funcionar. El
 * publicador dio todo por bueno: los sha256 cuadraban y las firmas validaban. Claro
 * que cuadraban — estaba firmando un paquete roto.
 *
 * Comprobar la huella dice que llego entero lo que mandaste. No dice que lo que
 * mandaste sirva. Esto ultimo es lo que mira este script.
 *
 *   node comprobar-paquete.js <carpeta-app-descomprimida>
 */
const path = require('path');
const fs = require('fs');

const LIBS = ['kda', 'dca', 'bridge', 'ethswap', 'evmswap', 'vault', 'wallets', 'nft', 'swap', 'eth', 'ledger', 'kdatime', 'backup', 'devnet-publico', 'evmnodo'];

async function main() {
  // La ruta se resuelve a ABSOLUTA aqui. Con una relativa sin './' -como la que manda
  // publicar.sh-, `require()` la toma por el nombre de un paquete y todas las libs
  // salian 'Cannot find module': el comprobador decia que el paquete estaba roto
  // cuando el roto era el comprobador.
  const raiz = process.argv[2] ? path.resolve(process.argv[2]) : null;
  if (!raiz || !fs.existsSync(path.join(raiz, 'main.js'))) {
    console.error('uso: node comprobar-paquete.js <carpeta con main.js>');
    return 2;
  }
  const fallos = [];
  const ok = (q) => console.log('  ok    ' + q);
  const mal = (q, e) => { fallos.push(q); console.log('  MAL   ' + q + '  -> ' + String(e && e.message || e).split('\n')[0].slice(0, 90)); };

  // 1. Las librerias propias cargan. Si alguna revienta al requerirse, la app no arranca.
  for (const l of LIBS) {
    const f = path.join(raiz, 'lib', l + '.js');
    if (!fs.existsSync(f)) { mal('lib/' + l + '.js', 'no esta en el paquete'); continue; }
    try { require(f); ok('lib/' + l + '.js'); } catch (e) { mal('lib/' + l + '.js', e); }
  }

  // 2. Las dependencias que solo se cargan en diferido. Son las peligrosas: no fallan
  //    al arrancar, fallan el dia que el usuario intenta crear una wallet.
  try {
    // En Windows, import() dinamico exige una URL file://, no una ruta con letra de unidad.
    const url = require('url').pathToFileURL(path.join(raiz, 'node_modules', '@kadena', 'hd-wallet', 'lib', 'cjs', 'index.js')).href;
    const hd = await import(url);
    const m = (hd.kadenaGenMnemonic || (hd.default && hd.default.kadenaGenMnemonic))();
    if (!m || m.split(' ').length < 12) throw new Error('la semilla generada no tiene pinta de serlo');
    ok('@kadena/hd-wallet: genera semilla de ' + m.split(' ').length + ' palabras');
  } catch (e) { mal('@kadena/hd-wallet (crear wallet por semilla)', e); }

  try { require(path.join(raiz, 'node_modules', '@kadena', 'cryptography-utils')); ok('@kadena/cryptography-utils'); }
  catch (e) { mal('@kadena/cryptography-utils', e); }

  try { require(path.join(raiz, 'node_modules', 'ethers')); ok('ethers'); }
  catch (e) { mal('ethers', e); }

  // 3. Los binarios nativos del Ledger, que un empaquetado descuidado se deja fuera.
  const hid = path.join(raiz, 'node_modules', 'node-hid', 'build', 'Release', 'HID.node');
  fs.existsSync(hid) ? ok('binario nativo del Ledger (HID.node)') : mal('binario nativo del Ledger', 'falta HID.node');

  // 4. La version del paquete es la que se cree que es.
  try {
    const v = JSON.parse(fs.readFileSync(path.join(raiz, 'package.json'), 'utf8')).version;
    const esperada = process.env.VER_ESPERADA;
    if (esperada && v !== esperada) throw new Error('el paquete dice ' + v + ' y se esperaba ' + esperada);
    ok('version del paquete: ' + v);
  } catch (e) { mal('version del paquete', e); }

  console.log(fallos.length ? '\nEL PAQUETE NO PASA: ' + fallos.length + ' fallo(s)' : '\nel paquete pasa la comprobacion');
  return fallos.length ? 1 : 0;
}

main().then((c) => process.exit(c)).catch((e) => { console.error('la comprobacion se rompio:', e); process.exit(1); });
