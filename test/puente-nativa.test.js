// Koberlet - Copyright 2026 DNNS.es (Oberluss)
// SPDX-License-Identifier: Apache-2.0

// Ruta de COLATERAL del puente: KDA nativo (Kadena) → kb-KDA (Ethereum). 13-11-2026.
//
// Con los kb-* el modulo quema el token; con KDA lo GUARDA en su cuenta de colateral, y eso exige
// firmar un coin.TRANSFER mas (el del importe). Lo que se comprueba aqui, sin red:
//   1. la ruta KDA añade ese permiso, por el importe EXACTO y hacia la cuenta fija;
//   2. las rutas kb-* de siempre NO cambian (siguen con sus tres permisos);
//   3. una cuenta de colateral con forma rara se rechaza antes de firmar nada;
//   4. KDA vive en `nativas`, NO en `routes` (si entrara en `routes` el programa pintaria un
//      "kb-KDA" que en Kadena no existe y contaria el saldo dos veces);
//   5. la vuelta (Ethereum → Kadena) se pide como kb-KDA, que es como se llama alli, y NO da
//      approve: el token se quema a si mismo (verificado con eth_call el 13-11-2026).
//
//   node test/puente-nativa.test.js
const fs = require('fs');
const path = require('path');
const bridge = require('../lib/bridge');

let fallos = 0;
const ok = (cond, texto) => { if (!cond) { fallos++; console.log('FALLA  ' + texto); } };

const COL = 'c:TLKMz0rO15FnZARzjvdoT6FHMGWqc8NGI0V_p2KvjY4';
const base = { senderAccount: 'k:' + 'ab'.repeat(32), evmDomain: 1, rec: 'AAAAAAAAAAAAAAAAd4bx6y7BmKBNj14_w2-rFNo3AHY', igpAccount: 'r:relayers', maxPay: '39.198747877556' };

// 1. KDA: cuatro permisos; el cuarto es el colateral, exacto
const kda = bridge.dispatchParts({ ...base, kadenaModule: 'KDA', amount: '5000', colateral: COL });
ok(kda.clist.length === 4, 'la ruta KDA debe firmar 4 permisos');
const cap = kda.clist[3];
ok(cap.name === 'coin.TRANSFER' && cap.args[0] === base.senderAccount && cap.args[1] === COL, 'el 4º permiso es coin.TRANSFER a la cuenta de colateral');
ok(cap.args[2] && cap.args[2].decimal === '5000.000000000000', 'el permiso de colateral lleva el importe exacto con 12 decimales');
ok(kda.code.includes('.mailbox.dispatch ') && kda.code.includes('.KDA 1 ') && kda.code.endsWith(' 5000.000000000000)'), 'el codigo despacha el modulo KDA con el mismo importe');
ok(kda.clist.filter(c => c.name === 'coin.TRANSFER').length === 2, 'solo dos coin.TRANSFER: peaje y colateral');

// 2. kb-USDC no cambia
const usdc = bridge.dispatchParts({ ...base, kadenaModule: 'kb-USDC', amount: '25' });
ok(usdc.clist.length === 3 && !usdc.clist.some(c => c.args[1] === COL), 'las rutas kb-* siguen con 3 permisos y sin colateral');

// 3. colateral con forma rara
for (const malo of ['k:' + 'cd'.repeat(32), 'c:corto', 12345, 'c:TLKMz0rO15FnZARzjvdoT6FHMGWqc8NGI0V_p2KvjY4" "x']) {
  let lanzo = false;
  try { bridge.dispatchParts({ ...base, kadenaModule: 'KDA', amount: '1', colateral: malo }); } catch (_) { lanzo = true; }
  ok(lanzo, 'debe rechazar la cuenta de colateral ' + String(malo).slice(0, 20));
}

// 4 y 5. la config: KDA en `nativas`, fuera de `routes`, y los manejadores la limitan a kda2evm
const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const iR = main.indexOf('    routes: ['), iN = main.indexOf('    nativas: [');
ok(iR > 0 && iN > iR, 'main.js tiene routes y, despues, nativas');
ok(!/symbol: 'KDA'/.test(main.slice(iR, iN)), 'KDA no esta dentro de routes');
ok(new RegExp("symbol: 'KDA'[^\\n]*kadenaModule: 'KDA'[^\\n]*colateral: '" + COL + "'").test(main.slice(iN, iN + 700)), 'nativas lleva KDA con la cuenta de colateral fija');
ok(/evmSymbol: 'kb-KDA'/.test(main.slice(iN, iN + 900)), 'nativas dice como se llama el token en Ethereum (kb-KDA)');
ok(/\(dir === 'evm2kda' \? x\.evmSymbol : x\.symbol\) === symbol/.test(main), 'rutaPuente busca la ruta de colateral por el nombre de la orilla de salida');
ok(/map\(n => \(\{ \.\.\.n, symbol: n\.evmSymbol \}\)\)/.test(main), 'en Ethereum → Kadena la lista enseña kb-KDA, no KDA');
ok((main.match(/sinPermiso: !!route\.colateral/g) || []).length === 2, 'simulacion y envio pasan sinPermiso en la ruta de colateral');
const br = fs.readFileSync(path.join(__dirname, '..', 'lib', 'bridge.js'), 'utf8');
ok(/const allowance = sinPermiso \? amt : await t\.allowance\(from, router\);/.test(br), 'con sinPermiso no se consulta ni se da approve');
ok(/missingApprove: sinPermiso \? false : allowance < amt/.test(br), 'la simulacion no pide autorizar el token en la ruta de colateral');

console.log(fallos === 0 ? 'OK: ruta de colateral KDA → kb-KDA' : `HAY ${fallos} FALLOS EN LA RUTA DE COLATERAL`);
process.exit(fallos === 0 ? 0 : 1);
