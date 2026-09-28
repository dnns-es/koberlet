// Koberlet - Copyright 2026 DNNS.es (Oberluss)
// SPDX-License-Identifier: Apache-2.0

// DECISION DE ANTONIO (28/09/2026): la gasolinera solo paga a partir de 5 kb-USDC,
// tambien en el DCA y en las ordenes, no solo en el Mercado. Esto lo vigila.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const kda = require('../lib/kda');
const dca = require('../lib/dca');

const USDC = 'n_e595727b657fbbb3b8e362a05a7bb8d12865c1ff.kb-USDC';
const cfg = { node: 'https://nodo.prueba', networkId: 'mainnet01', chain: '2', gasolinera: 'free.ksw-gasolinera' };
const vistos = [];
// Nodo de mentira: gasolinera con saldo y pool a 0,5 kb-USDC por KDA.
kda.local = async (_n, _id, _ch, code) => {
  vistos.push(code);
  if (code.includes('.cuenta')) return { status: 'success', data: 'c:gaso' };
  if (code.includes('.saldo')) return { status: 'success', data: 5.9 };
  if (code.includes('get-pair-by-key')) return { status: 'success', data: [{ decimal: '1000.0' }, 500] };
  return { status: 'failure', error: { message: 'no' } };
};

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; console.log('ok     ' + m); };

(async () => {
  ok(dca.MIN_GRATIS_USDC === 5, 'el umbral es de 5 kb-USDC');
  ok((await dca.gasolineraPara(cfg, 4.99)) === null, 'por debajo de 5 paga el usuario');
  ok((await dca.gasolineraPara(cfg, undefined)) === null, 'sin valor declarado paga el usuario');
  vistos.length = 0;
  await dca.gasolineraPara(cfg, 1);
  ok(vistos.length === 0, 'por debajo ni se pregunta a la gasolinera');
  ok((await dca.gasolineraPara(cfg, 5)) !== null, 'justo en 5 paga la gasolinera');

  ok((await dca.valorEnUsdc(cfg, USDC, '7.5')) === 7.5, 'kb-USDC vale lo que dice');
  ok((await dca.valorEnUsdc(cfg, 'coin', '100')) === 50, 'KDA al precio del pool');
  ok((await dca.valorEnUsdc(cfg, 'runonflux.flux', '100')) === 0, 'otro token no se valora');

  // Todas las firmas que pueden ir por la gasolinera dicen cuanto valen.
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'dca.js'), 'utf8');
  const ord = fs.readFileSync(path.join(__dirname, '..', 'lib', 'ordenes.js'), 'utf8');
  ok(/gasLimit: 12000, valorUsdc\n/.test(src) && /gasLimit: 10000, valorUsdc\n/.test(src), 'crear y recargar un plan pasan su valor');
  ok(/nonce: 'koberlet-orden', valorUsdc\n/.test(ord), 'crear una orden pasa su valor');
  ok(/q\.direccion === 'compra' \? Number\(q\.cantidad\) : Number\(q\.minOut\)/.test(ord), 'la orden se valora como el Mercado: lo que entra al comprar, el minimo al vender');
  ok(!/hayGasolinera: !!\(await (dca\.)?gasolinera\(cfg\)\)/.test(src + ord), 'el aviso de gas mira el mismo umbral');
  console.log('\nUmbral de la gasolinera: todas las comprobaciones pasan (' + n + ').');
})().catch((e) => { console.error(e); process.exit(1); });
