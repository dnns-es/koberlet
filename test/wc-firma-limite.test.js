// Koberlet - Copyright 2026 DNNS.es (Oberluss)
// SPDX-License-Identifier: Apache-2.0

// AVISO PRIVADO DE ALEX (GHSA-wj7g-5v28-pj92, 23/10/2026), hallazgo 1: por
// WalletConnect se podia firmar SIN LIMITES (un firmante sin clist) sin que la
// pantalla lo dijera, y en `kadena_sign_v1` sin caps la montaba el propio monedero.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { comandoDeFirma } = require('../lib/wc-comando');

const CLAVE = 'ab'.repeat(32);
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; console.log('ok     ' + m); };

// 1. sign_v1 sin caps: la firma queda acotada a coin.GAS.
const sin = JSON.parse(comandoDeFirma({ code: '(free.hello.greet "hi")', chainId: '2' }, 'mainnet01', CLAVE));
ok(Array.isArray(sin.signers[0].clist) && sin.signers[0].clist.length === 1, 'sin caps el firmante lleva clist');
ok(sin.signers[0].clist[0].name === 'coin.GAS', 'y es solo coin.GAS');

// 2. Con caps van tal cual, sin añadir nada.
const con = JSON.parse(comandoDeFirma({ code: '(x)', chainId: '2', caps: [{ cap: { name: 'free.t.TRANSFER', args: ['a', 'b', 1] } }] }, 'mainnet01', CLAVE));
ok(con.signers[0].clist.length === 1 && con.signers[0].clist[0].name === 'free.t.TRANSFER', 'con caps se firman los pedidos, ni uno mas');

// 3. main se niega a firmar sin limites salvo con la casilla marcada.
const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const i = main.indexOf("ipcMain.handle('wc:firmar'");
const cuerpo = main.slice(i, main.indexOf('kda.firmarCmd', i));
ok(/aceptaSinLimite !== true && .*firmaSinLimite/.test(cuerpo), 'wc:firmar comprueba la firma sin limites ANTES de firmar');
ok(/throw new Error\('WC_SIN_LIMITE'\)/.test(cuerpo), 'y la rechaza con su codigo');
const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
ok(/aceptaSinLimite: aceptaSinLimite === true/.test(preload), 'el puente solo pasa un true de verdad');

// 4. La pantalla avisa en rojo, enseña quien firma y solo coin.TRANSFER es KDA.
const app = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app.js'), 'utf8');
ok(/c\.sinLimite \?/.test(app) && /wc-f-acepto/.test(app), 'aviso rojo con casilla');
ok(/mueveDinero: p\.nombre === 'coin\.TRANSFER' \|\| p\.nombre === 'coin\.TRANSFER_XCHAIN'/.test(app), 'solo el TRANSFER de coin se pinta como KDA');
ok(/wc_f_firmantes/.test(app) && /c\.nonce/.test(app) && /c\.ttl/.test(app), 'se ven firmantes, ttl y nonce');
ok(/SIN_LIMITE\)\$/.test(app), 'el codigo WC_SIN_LIMITE tiene su frase');
for (const k of ['wc_f_sin_limite_t', 'wc_f_sin_limite_s', 'wc_f_sin_limite_ok', 'wc_sin_limite', 'wc_f_firmantes']) {
  ok(app.split(k + ':').length === 3, k + ' en español y en inglés');
}
console.log('\nFirma sin limites por WalletConnect: todas las comprobaciones pasan (' + n + ').');
