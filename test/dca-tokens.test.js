// Koberlet - Copyright 2026 DNNS.es (Oberluss)
// SPDX-License-Identifier: Apache-2.0

// Test del DCA con los tokens nuevos (kb-ETH, FLUX, bro sobre free.ksw-dca3). Sin red:
// se sustituyen la cadena y el envio, y se mira la transaccion que se iba a firmar.
//
//   1. Un plan de dca3 NO pasa por la gasolinera: ella solo admite dca2 y, si se le
//      pidiera, el nodo tiraria la tx por "gas buy failed" sin decir por que.
//   2. La firma cubre coin.GAS y el TRANSFER del token que entregas, y nada mas.
//   3. El minimo por compra es el del token, no el de KDA o kb-USDC.
//   4. Los minimos de main.js son los MIN-IN del contrato (si el .pact esta a mano).
//
//   node test/dca-tokens.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const kda = require('../lib/kda');
const ktime = require('../lib/kdatime');
kda.local = async (_n, _net, _ch, code) => {
  if (/open-plans/.test(code)) return { status: 'success', data: { int: 0 } };
  if (/\.paused\)/.test(code)) return { status: 'success', data: false };
  if (/custody-account/.test(code)) return { status: 'success', data: 'u:custodia' };
  if (/coin\.get-balance/.test(code)) return { status: 'success', data: 5000 };
  if (/\.get-plan /.test(code)) return { status: 'success', data: { owner: OWNER, status: 'active', 'token-in': 'coin' } };
  if (/gasolinera\.cuenta\)/.test(code)) return { status: 'success', data: 'k:gasolinera' };
  if (/gasolinera\.saldo\)/.test(code)) return { status: 'success', data: 10 };
  return { status: 'failure', error: { message: 'no esperado: ' + code } };
};
ktime.creationTime = async () => 1790000000;
let enviado = null;
global.fetch = async (_url, o) => { enviado = JSON.parse(JSON.parse(o.body).cmds[0].cmd); return { text: async () => '{"requestKeys":["rk"]}' }; };

const dca = require('../lib/dca');
const SEC = '11'.repeat(32);
const PUB = require('tweetnacl').sign.keyPair.fromSeed(Buffer.from(SEC, 'hex')).publicKey;
const PUBHEX = Buffer.from(PUB).toString('hex');
const OWNER = 'k:' + PUBHEX;
const ETH = 'n_e595727b657fbbb3b8e362a05a7bb8d12865c1ff.kb-ETH';
const cfg = { node: 'http://x', networkId: 'mainnet01', chain: '2', modulo: 'free.ksw-dca3', gasolinera: null };

(async () => {
  // 1 y 2: KDA -> kb-ETH
  await dca.crearPlan(cfg, { owner: OWNER, publicHex: PUBHEX, secretHex: SEC, tokenIn: 'coin', tokenOut: ETH,
    precIn: 12, minCuota: 100, simIn: 'KDA', deposito: 1000, cuota: 100, periodo: 3600, slippage: 0.05 });
  assert.ok(enviado.payload.exec.code.startsWith('(free.ksw-dca3.create-plan '), 'va al dca3');
  assert.ok(enviado.payload.exec.code.includes(' coin ' + ETH + ' '), 'par KDA -> kb-ETH');
  assert.strictEqual(enviado.meta.sender, OWNER, 'el gas lo paga el dueño, no la gasolinera');
  const caps = enviado.signers[0].clist.map(c => c.name);
  assert.deepStrictEqual(caps, ['coin.GAS', 'coin.TRANSFER'], 'solo GAS y TRANSFER');
  assert.ok(!('exec-code' in enviado.payload.exec.data), 'sin datos de gasolinera');

  // kb-ETH -> KDA: la capability es la del token que entregas
  await dca.crearPlan(cfg, { owner: OWNER, publicHex: PUBHEX, secretHex: SEC, tokenIn: ETH, tokenOut: 'coin',
    precIn: 18, minCuota: 0.0004, simIn: 'kb-ETH', deposito: 0.004, cuota: 0.0004, periodo: 3600, slippage: 0.05 });
  assert.deepStrictEqual(enviado.signers[0].clist[1], { name: ETH + '.TRANSFER', args: [OWNER, 'u:custodia', { decimal: '0.004000000000' }] });

  // 3: minimo del token
  await assert.rejects(dca.crearPlan(cfg, { owner: OWNER, publicHex: PUBHEX, secretHex: SEC, tokenIn: ETH, tokenOut: 'coin',
    precIn: 18, minCuota: 0.0004, simIn: 'kb-ETH', deposito: 0.004, cuota: 0.0003, periodo: 3600, slippage: 0.05 }),
    /minima por compra es 0.0004 kb-ETH/);

  // 5: cerrar/pausar van SIN ACOTAR. Acotada a coin.GAS, el enforce-guard del dueño
  //    falla ("Keyset failure") y el plan no se puede cerrar: paso el 25/09/2026.
  //    Con gasolinera disponible (dca2), a proposito: ni aun asi se puede acotar.
  const cfgGaso = { ...cfg, modulo: 'free.ksw-dca2', gasolinera: 'free.ksw-gasolinera' };
  for (const que of ['cerrar', 'pausar', 'reanudar']) {
    await dca.accion(cfgGaso, { id: 'k:d0439ab3-1', que, owner: OWNER, publicHex: PUBHEX, secretHex: SEC });
    assert.deepStrictEqual(enviado.signers, [{ pubKey: PUBHEX }], que + ': firma sin acotar');
    assert.strictEqual(enviado.meta.sender, OWNER, que + ': gas del dueño');
  }

  // 4: config de main.js contra MIN-IN del contrato
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const pact = path.join(__dirname, '..', '..', 'KoberluSW', 'contracts', 'ksw-dca3.pact');
  if (fs.existsSync(pact)) {
    const src = fs.readFileSync(pact, 'utf8');
    const bloque = src.slice(src.indexOf('(defconst MIN-IN'), src.indexOf('})', src.indexOf('(defconst MIN-IN')));
    const re = /"([^"]+)"\s*:\s*([0-9.]+)/g; let m, n = 0;
    while ((m = re.exec(bloque))) {
      const linea = main.split('\n').find(l => l.includes("modulo: '" + m[1] + "'"));
      assert.ok(linea, 'main.js no tiene el token ' + m[1]);
      assert.strictEqual(Number((linea.match(/minCuota: ([0-9.]+)/) || [])[1]), Number(m[2]), 'minimo de ' + m[1]);
      n++;
    }
    assert.strictEqual(n, 5, 'cinco tokens en MIN-IN');
  } else console.log('(sin ksw-dca3.pact al lado: se salta la comparacion de minimos)');

  console.log('dca-tokens: OK');
})().catch(e => { console.error('FALLA', e.message); process.exit(1); });
