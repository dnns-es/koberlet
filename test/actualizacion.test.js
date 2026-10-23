// Koberlet - Copyright 2026 DNNS.es (Oberluss)
// SPDX-License-Identifier: Apache-2.0

// El auto-update con firmas DE VERDAD (una llave de prueba, no la de publicar).
// Aviso de Alex GHSA-wj7g-5v28-pj92, hallazgo 4: nunca hacia atras y version firmada.
// Si esto fallara, la version que lo lleve se quedaria sin poder actualizarse sola.
//
//   node test/actualizacion.test.js
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const nacl = require('tweetnacl');
const { verificarPaquete, cmpVer } = require('../lib/actualizacion');

const par = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(7));
const PUB = Buffer.from(par.publicKey).toString('hex');
const firma = (t) => Buffer.from(nacl.sign.detached(Buffer.from(t, 'utf8'), par.secretKey)).toString('hex');
const paquete = Buffer.from('zip de prueba');
const sha = crypto.createHash('sha256').update(paquete).digest('hex');
// Lo mismo que escribe build-app-zip.sh y lleva publicar.sh a latest.json.
const latest = (ver, extra) => Object.assign({ version: ver, sha256: sha, sig: firma(sha), sigVer: firma('koberlet-app|' + ver + '|' + sha) }, extra);

let n = 0;
const ok = (c, t) => { assert.ok(c, t); n++; };
const falla = (fn, re, t) => { let m = ''; try { fn(); } catch (e) { m = e.message; } ok(re.test(m), t + ' (' + (m || 'no fallo') + ')'); };

ok(verificarPaquete(latest('2.16.4'), paquete, '2.16.3', PUB).version === '2.16.4', 'una version nueva y bien firmada se acepta');
ok(verificarPaquete(latest('2.17.0'), paquete, '2.16.3', PUB).version === '2.17.0', 'y un salto de menor');
falla(() => verificarPaquete(latest('2.16.3'), paquete, '2.16.3', PUB), /no es más nueva/, 'la misma version no');
falla(() => verificarPaquete(latest('2.7.4'), paquete, '2.16.3', PUB), /no es más nueva/, 'una vieja firmada de verdad NO (vuelta atras)');
falla(() => verificarPaquete(latest('2.16.4', { sigVer: undefined }), paquete, '2.16.3', PUB), /no va firmada/, 'sin sigVer no');
// El ataque: el sha y su firma son de un paquete viejo autentico; la version se cambia a mano.
falla(() => verificarPaquete(Object.assign(latest('2.7.4'), { version: '9.9.9' }), paquete, '2.16.3', PUB), /no va firmada/, 'subir la version a mano no cuela');
falla(() => verificarPaquete(latest('2.16.4'), Buffer.from('otro zip'), '2.16.3', PUB), /sha256/, 'otro paquete no');
falla(() => verificarPaquete(latest('2.16.4', { sig: firma('x') }), paquete, '2.16.3', PUB), /Firma del paquete/, 'firma del sha mala no');
falla(() => verificarPaquete(latest('2.16.4', { version: '2.16.4-beta' }), paquete, '2.16.3', PUB), /no es más nueva/, 'version con forma rara no');
const otra = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(9));
falla(() => verificarPaquete(latest('2.16.4'), paquete, '2.16.3', Buffer.from(otra.publicKey).toString('hex')), /Firma del paquete/, 'otra llave no');
ok(cmpVer('2.16.10', '2.16.9') === 1 && cmpVer('2.9.0', '2.16.0') === -1, 'cmpVer compara numeros, no texto');

// La forma que firma build-app-zip.sh es la que comprueba la app.
const build = fs.readFileSync(path.join(__dirname, '..', 'build-app-zip.sh'), 'utf8');
ok(build.includes('"koberlet-app|"+ver+"|"+sha'), 'build-app-zip.sh firma la misma cadena');
const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
ok(/verificarPaquete\(j, bytes, APP_VERSION, UPDATE_PUBKEY\)/.test(main), 'update:apply usa esta comprobacion');

console.log('actualizacion: ' + n + ' comprobaciones OK');
