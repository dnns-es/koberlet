// Koberlet - Copyright 2026 DNNS.es (Oberluss)
// SPDX-License-Identifier: Apache-2.0

// WalletConnect: lo que se firma tiene que caber en lo que se aprobo al conectar.
// Aviso privado de Alex (GHSA-wj7g-5v28-pj92), hallazgos 3a, 3c, 3d, 3e y 3f, el 5
// (NFT, navegacion) y el 4 (auto-update), mas el issue #7 (enlace koberlet://).
//
//   node test/wc-sesion.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ns = require('../lib/wc-namespaces');
const { wcDeEnlace } = require('../lib/wc-enlace');
const nft = require('../lib/nft');
const { METODOS, CADENA } = require('../lib/walletconnect');

const raiz = path.join(__dirname, '..');
const lee = (...p) => fs.readFileSync(path.join(raiz, ...p), 'utf8');
const MIA = 'ab'.repeat(32), OTRA_MIA = 'cd'.repeat(32), AJENA = 'ef'.repeat(32);
let n = 0;
const ok = (c, t) => { assert.ok(c, t); n++; };

// --- 3d: solo las redes que pide la web ---
const soloTest = { obliga: ns.loQuePide({ kadena: { chains: ['kadena:testnet04'], methods: ['kadena_quicksign_v1'] } }), suelta: ns.loQuePide({}) };
ok(JSON.stringify(ns.namespacesParaAprobar(soloTest, [MIA], { cadena: CADENA, metodos: METODOS }).kadena.chains) === '["kadena:testnet04"]', '3d: una web que pide testnet04 no se lleva mainnet01');
const nada = { obliga: ns.loQuePide({}), suelta: ns.loQuePide({}) };
ok(JSON.stringify(ns.namespacesParaAprobar(nada, [MIA], { cadena: CADENA, metodos: METODOS }).kadena.chains) === '["kadena:mainnet01"]', '3d: sin redes pedidas, la nuestra');
const mezcla = { obliga: ns.loQuePide({ kadena: { chains: ['kadena:testnet04', 'kadena:mainnet01'] } }), suelta: ns.loQuePide({}) };
ok(ns.namespacesParaAprobar(mezcla, [MIA], { cadena: CADENA, metodos: METODOS }).kadena.chains[0] === 'kadena:mainnet01', '3d: mainnet, si se pide, la primera');

// --- 3a y 3d: lo que se pide firmar, contra la sesion ---
const sesion = { namespaces: { kadena: { chains: ['kadena:mainnet01'], accounts: ['kadena:mainnet01:' + MIA] } } };
const cmd = (net, firmantes) => JSON.stringify({ networkId: net, signers: firmantes.map((k) => ({ pubKey: k, clist: [{ name: 'coin.GAS', args: [] }] })) });
const mias = [MIA, OTRA_MIA];
ok(ns.motivoFueraDeSesion(cmd('mainnet01', [MIA]), sesion, mias) === '', 'la cuenta compartida firma');
ok(ns.motivoFueraDeSesion(cmd('mainnet01', [MIA, AJENA]), sesion, mias) === '', 'una clave ajena a la boveda no es cosa nuestra');
ok(/no se compartió/.test(ns.motivoFueraDeSesion(cmd('mainnet01', [OTRA_MIA]), sesion, mias)), '3a: otra cuenta de la boveda que no se compartio NO firma');
ok(/no se compartió/.test(ns.motivoFueraDeSesion(cmd('mainnet01', [MIA, OTRA_MIA]), sesion, mias)), '3a: ni colada junto a la buena');
ok(/testnet04/.test(ns.motivoFueraDeSesion(cmd('testnet04', [MIA]), sesion, mias)), '3d: otra red que la aprobada NO firma');
ok(ns.motivoFueraDeSesion('no es json', sesion, mias) !== '', 'lo ilegible no firma');
ok(ns.motivoFueraDeSesion(cmd('mainnet01', [MIA]), null, mias) !== '', 'sin sesion no se firma');
ok(JSON.stringify(ns.clavesDeSesion(sesion)) === JSON.stringify([MIA]), 'claves de la sesion');

// --- 3c: al conectar se comparte SOLO la elegida ---
const main = lee('main.js');
ok(/aprobarSesion\(id, \[elegida\.kda\.public\]\)/.test(main), '3c: una sola cuenta al conectar');
ok(/if \(!compartidas\.includes\(pub\)\)[\s\S]{0,80}no se compartió/.test(main), '3a: wc:firmar mira la sesion clave a clave');
ok(/WC_SESION_CERRADA/.test(main), 'issue #7: no se firma para una sesion que ya no existe');

// --- 3e: Verify ---
ok(ns.verificacion({ verified: { validation: 'VALID' } }) === 'ok', 'Verify valido');
ok(ns.verificacion({ verified: { validation: 'INVALID' } }) === 'mal', 'Verify no coincide');
ok(ns.verificacion({ verified: { validation: 'VALID', isScam: true } }) === 'estafa', 'Verify estafa gana');
ok(ns.verificacion(undefined) === 'sin', 'sin Verify');

// --- 3f e issue #7: caducadas y sesiones cerradas ---
const wc = lee('lib', 'walletconnect.js');
ok(/session_request_expire/.test(wc), '3f: se escucha session_request_expire');
ok(/for \(const \[k, f\] of wcPendientes\) if \(f\.topic === topic\) wcPendientes\.delete\(k\)/.test(main), 'issue #7: session_delete tira sus peticiones');

// --- issue #7: enlace koberlet:// ---
const WC = 'wc:' + 'a1'.repeat(32) + '@2?relay-protocol=irn&symKey=' + 'b2'.repeat(32) + '&expiryTimestamp=1790000000';
ok(wcDeEnlace('koberlet://wc?uri=' + encodeURIComponent(WC)) === WC, 'enlace codificado');
ok(wcDeEnlace('koberlet://wc?uri=' + WC) === WC, 'enlace sin codificar');
ok(wcDeEnlace('koberlet://wc/?uri=' + encodeURIComponent(WC) + '&otra=1') === WC, 'con barra y otro parametro');
ok(wcDeEnlace('koberlet://otra?uri=' + encodeURIComponent(WC)) === null, 'otro host no');
ok(wcDeEnlace('https://wc?uri=' + encodeURIComponent(WC)) === null, 'otro esquema no');
ok(wcDeEnlace('koberlet://wc?uri=' + encodeURIComponent('wc:zz@2?x=1')) === null, 'wc: mal formado no');
ok(wcDeEnlace('koberlet://wc?uri=' + encodeURIComponent(WC + '"><img src=x>')) === null, 'nada de comillas ni etiquetas');
ok(wcDeEnlace('--algo') === null && wcDeEnlace(undefined) === null, 'argumentos normales se ignoran');
ok(!/emparejar\(wcEnlace|emparejar\(uri\)[^\n]*wcRecibir/.test(main), 'el enlace no conecta solo');

// --- 5: NFT a la red de casa ---
for (const u of ['http://[::ffff:127.0.0.1]/', 'http://100.64.0.1/', 'http://2130706433/', 'http://[::1]/', 'http://[fe80::1]/', 'http://192.168.1.1/', 'http://localhost/']) {
  ok(!nft.destinoPermitido(new URL(u)), 'M-1: ' + u + ' no se visita');
}
ok(nft.destinoPermitido(new URL('https://ipfs.io/ipfs/x')), 'una pasarela publica si');
ok(nft.ipPrivada('10.1.2.3') && nft.ipPrivada('::ffff:192.168.0.1') && !nft.ipPrivada('8.8.8.8'), 'ipPrivada');
ok(/lookup: lookupSeguro/.test(lee('lib', 'nft.js')), 'M-1: tambien lo que da el DNS');

// --- 5: escapes y navegacion ---
const app = lee('renderer', 'app.js');
ok(!/<img src="\$\{portada\.imagen\}"/.test(app), 'A-2: portada escapada');
ok(!/chain \$\{m\.chain\}/.test(app), 'chain del visor escapada');
ok(!/url\.startsWith\('file:\/\/'\)/.test(main) && /PROPIA/.test(main), 'will-navigate: solo la propia app');

// --- 4: el auto-update no va hacia atras ---
ok(/cmpVer\(verNueva, APP_VERSION\) <= 0/.test(main), '4: version mayor que la instalada');
ok(/'koberlet-app\|' \+ verNueva \+ '\|' \+ gotHash/.test(main), '4: la version va firmada');
ok(/verDentro !== verNueva/.test(main), '4: el paquete es la version anunciada');
ok(/sigVer/.test(lee('build-app-zip.sh')) && /sigVer/.test(lee('publicar.sh')), '4: build y publicar firman la version');
for (const f of ['build-app-zip.sh', 'build-portable.sh', 'build-mac.sh']) {
  const s = lee(f);
  ok(/npm ci --omit=dev/.test(s) && /package-lock\.json/.test(s) && !/npm install --omit/.test(s), '4: ' + f + ' usa el lockfile');
}

console.log('wc-sesion: ' + n + ' comprobaciones OK');
