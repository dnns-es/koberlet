// Koberlet - Copyright 2026 DNNS.es (Oberluss)
// SPDX-License-Identifier: Apache-2.0

// Precio limite de un plan DCA ([P8] del contrato). Sin red: se sustituyen la cadena y
// el envio, y se mira la transaccion que se iba a firmar.
//
//   1. El codigo es (modulo.set-limit "id" precio) con el precio a 12 decimales.
//   2. Fuera de [0, 1000] no se firma: es lo que exige MAX-LIMIT-PRICE.
//   3. Se firma SIN ACOTAR (enforce-guard del dueño fuera de capability) y paga el dueño.
//   4. limit-of se lee como numero, venga como decimal Pact o como numero suelto.
//   5. Un plan cerrado o de otro dueño no se toca.
//
//   node test/dca-limite.test.js
const assert = require('assert');
const kda = require('../lib/kda');
const ktime = require('../lib/kdatime');

const OWNER = 'k:' + 'ab'.repeat(32);
const SECRET = '11'.repeat(32);
let PLAN = { owner: OWNER, status: 'active' };
kda.local = async (_n, _net, _ch, code) => {
  if (/\.get-plan /.test(code)) return { status: 'success', data: PLAN };
  if (/\.limit-of "plan-1"/.test(code)) return { status: 'success', data: { decimal: '0.5' } };
  if (/\.limit-of "plan-2"/.test(code)) return { status: 'success', data: 0.25 };
  return { status: 'failure', error: { message: 'no esperado: ' + code } };
};
ktime.creationTime = async () => 1790000000;
let enviado = null;
global.fetch = async (_url, o) => {
  enviado = JSON.parse(o.body).cmds[0];
  return { text: async () => JSON.stringify({ requestKeys: ['rk1'] }) };
};

const dca = require('../lib/dca');
const cfg = { node: 'http://x', networkId: 'mainnet01', chain: '2', modulo: 'free.ksw-dca2', gasolinera: 'free.gaso' };
const id = OWNER.slice(0, 10) + '-1';
let ok = 0;
const prueba = (n, f) => Promise.resolve().then(f).then(() => { ok++; console.log('ok  ' + n); });

(async () => {
  await prueba('codigo set-limit', () => {
    assert.strictEqual(dca.codigoLimite('free.ksw-dca2', id, 0.5), '(free.ksw-dca2.set-limit "' + id + '" 0.500000000000)');
    assert.strictEqual(dca.codigoLimite('free.ksw-dca3', id, 0), '(free.ksw-dca3.set-limit "' + id + '" 0.000000000000)');
    assert.strictEqual(dca.codigoLimite('free.ksw-dca3', id, 0.000002), '(free.ksw-dca3.set-limit "' + id + '" 0.000002000000)');
  });
  await prueba('fuera de rango no se firma', () => {
    assert.throws(() => dca.codigoLimite('free.ksw-dca2', id, -1), /0 \(sin limite\) a 1000/);
    assert.throws(() => dca.codigoLimite('free.ksw-dca2', id, 1001), /1000/);
    assert.throws(() => dca.codigoLimite('free.ksw-dca2', id, 'x'), /1000/);
  });
  await prueba('limit-of se lee como numero', async () => {
    assert.strictEqual(await dca.limiteDe(cfg, 'plan-1'), 0.5);
    assert.strictEqual(await dca.limiteDe(cfg, 'plan-2'), 0.25);
  });
  await prueba('firma sin acotar y paga el dueño', async () => {
    const r = await dca.fijarLimite(cfg, { id, precio: 0.5, owner: OWNER, publicHex: OWNER.slice(2), secretHex: SECRET });
    assert.strictEqual(r.requestKey, 'rk1');
    const cmd = JSON.parse(enviado.cmd);
    assert.strictEqual(cmd.payload.exec.code, '(free.ksw-dca2.set-limit "' + id + '" 0.500000000000)');
    assert.strictEqual(cmd.signers.length, 1);
    assert.strictEqual(cmd.signers[0].clist, undefined, 'sin clist: enforce-guard suelto');
    assert.strictEqual(cmd.meta.sender, OWNER, 'el gas lo paga el dueño, no la gasolinera');
    assert.strictEqual(cmd.meta.gasLimit, 2500);
  });
  await prueba('plan cerrado o ajeno no se toca', async () => {
    PLAN = { owner: OWNER, status: 'closed' };
    await assert.rejects(dca.fijarLimite(cfg, { id, precio: 0.5, owner: OWNER, publicHex: OWNER.slice(2), secretHex: SECRET }), /cerrado/);
    PLAN = { owner: 'k:' + 'cd'.repeat(32), status: 'active' };
    await assert.rejects(dca.fijarLimite(cfg, { id, precio: 0.5, owner: OWNER, publicHex: OWNER.slice(2), secretHex: SECRET }), /no es de esta wallet/);
  });
  console.log(ok + ' pruebas del precio limite OK');
})().catch((e) => { console.error('FALLA', e); process.exit(1); });
