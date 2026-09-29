// Koberlet - Copyright 2026 DNNS.es (Oberluss)
// SPDX-License-Identifier: Apache-2.0

// EL RESPALDO DEL PRECIO (29/09/2026): con CoinGecko caido, el KDA sale del pool
// KDA/kb-USDC en dolares y, con razon recordada, en las demas monedas. Nunca un
// cero: null cuando no se sabe.
const assert = require('assert');
const precios = require('../lib/precios');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; console.log('ok     ' + m); };

const r = precios.razonesDe({ usd: 0.5, eur: 0.4, gbp: 0.35, chf: 0.45 });
ok(r.eur === 0.8 && r.gbp === 0.7 && r.chf === 0.9, 'las razones salen de dividir por el dolar');
ok(precios.razonesDe({ usd: 0 }) === null, 'sin precio en dolares no hay razones');
ok(precios.razonesVigentes(r) === r, 'unas razones de ahora valen');
ok(precios.razonesVigentes({ ...r, cuando: Date.now() - 8 * 86400000 }) === null, 'unas de hace 8 dias no');
ok(precios.razonesVigentes(null) === null, 'sin razones, null');

const solo = precios.desdeDolar(0.5, null);
ok(solo.usd === 0.5 && solo.eur === null && solo.chg === null && solo.fuente === 'pool', 'sin razon: solo dolares, sin 24h');
const con = precios.desdeDolar(0.5, r);
ok(con.eur === 0.4 && con.gbp === 0.35 && con.chf === 0.45, 'con razon: todas las monedas');
ok(precios.desdeDolar(0, r) === null && precios.desdeDolar('x', r) === null, 'un precio que no es precio da null, no cero');

const m = precios.respaldo(0.5, r);
ok(m.kadena.usd === 0.5 && m.kadena.eur === 0.4, 'el KDA va al precio del pool');
ok(m['usd-coin'].usd === 1 && m.tether.eur === 0.8 && m.dai.chg === null, 'las estables valen un dolar');
ok(Object.keys(precios.respaldo(0, r)).length === 0, 'sin pool no hay respaldo');

console.log('\n' + n + ' comprobaciones, todas bien');
