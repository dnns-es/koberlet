// Koberlet - Copyright 2026 DNNS.es (Oberluss)
// SPDX-License-Identifier: Apache-2.0

// AVISO PRIVADO DE ALEX (GHSA-wj7g-5v28-pj92, 23/10/2026), hallazgo 2: un nodo
// malicioso podia meter codigo Pact en el cambio del Mercado a traves del NOMBRE de
// un token, porque `mercado()` lo pegaba tal cual en lo que se firma. Esto reproduce
// su prueba con un nodo de mentira y comprueba que ya no entra.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const dex = require('../lib/dex');

// El «token» exacto de su prueba de concepto.
const MALO = 'free.realtok] (at \'sender (chain-data)) "attacker-acct" (keyset-ref-guard "free.attacker-ks")) (list [1';
const BUENO = 'free.realtok';
const cfg = { node: 'https://nodo.prueba', networkId: 'mainnet01', chain: '2' };

let enviados = 0;
global.fetch = async (url, o) => {
  if (String(url).endsWith('/send')) { enviados++; return { text: async () => '{"requestKeys":["x"]}' }; }
  const code = JSON.parse(JSON.parse(o.body).cmd).payload.exec.code;
  let data;
  if (code.includes('get-pairs')) {
    data = [
      { k: 'coin:' + MALO, cuenta: 'c:par-malo', r0: 50000, r1: 50000 },
      { k: 'coin:' + BUENO, cuenta: 'c:par-bueno', r0: 50000, r1: 50000 },
      { k: 'coin:free.a:free.b', cuenta: 'c:tres', r0: 50000, r1: 50000 },
    ];
  } else if (code.endsWith('.precision)')) data = 12;
  else return { json: async () => ({ result: { status: 'failure', error: { message: 'no' } } }) };
  return { json: async () => ({ result: { status: 'success', data } }) };
};

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; console.log('ok     ' + m); };

(async () => {
  const m = await dex.mercado(cfg);
  ok(!m.pares.some((p) => p.t1 === MALO || p.t0 === MALO), 'un par con codigo en el nombre no se lista');
  ok(!m.pares.some((p) => p.clave === 'coin:free.a:free.b'), 'un par con tres nombres tampoco');
  ok(m.tokens.length === 1 && m.tokens[0].modulo === BUENO, 'el token limpio si se lista');

  const o = { cuenta: 'k:' + 'ab'.repeat(32), publicHex: 'ab'.repeat(32), secretHex: '11'.repeat(32), cantidad: '10', slippage: 0.01 };
  await assert.rejects(dex.cambiar(cfg, { ...o, de: 'coin', a: MALO }), /forma válida/);
  ok(true, 'cambiar() rechaza un destino con codigo aunque la pantalla lo mande');
  await assert.rejects(dex.cambiar(cfg, { ...o, de: MALO, a: 'coin' }), /forma válida/);
  ok(true, 'y un origen con codigo');
  ok(enviados === 0, 'no se llego a mandar nada al nodo');

  for (const bien of ['coin', 'free.realtok', 'n_e595727b657fbbb3b8e362a05a7bb8d12865c1ff.kb-USDC', 'runonflux.flux']) {
    ok(dex.moduloValido(bien), 'vale: ' + bien);
  }
  for (const mal of [MALO, 'free.x"', 'free.x)', 'free x', 'free.', '.x', 'a']) {
    ok(!dex.moduloValido(mal), 'no vale: ' + JSON.stringify(mal));
  }

  const app = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app.js'), 'utf8');
  ok(/const mxSim = \(mod\) => mod === 'coin' \? 'KDA' : esc\(/.test(app), 'el nombre del token se escapa antes de ir a innerHTML');
  console.log('\nInyeccion por el nombre del token: todas las comprobaciones pasan (' + n + ').');
})().catch((e) => { console.error(e); process.exit(1); });
