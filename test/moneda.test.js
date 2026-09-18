// Koberlet - Copyright 2026 DNNS.es (Oberluss)
// SPDX-License-Identifier: Apache-2.0

// LA MONEDA DE REFERENCIA: QUE EL TOTAL NO MIENTA.
//
// Desde la 2.10.0 el total del panel y las tarjetas se enseñan en la moneda que
// elija cada uno (EUR, USD, GBP o CHF), igual que en el movil. Los saldos se
// siguen calculando en dolares en el proceso principal -ese calculo esta probado
// y no se toca-, y el renderer solo cambia la vara de medir con `fxDesdeUsd`.
//
// Eso convierte a esa funcion en el sitio donde un fallo NO se ve: la app no se
// rompe, no da error, simplemente enseña una cifra que no es. Y como lo que hay
// al lado es el saldo de alguien, una cifra que no es da miedo o da confianza de
// mas. Por eso se prueba aparte:
//
//   1. QUE NO INVENTE. Sin precios -sin red y con la cache vacia- tiene que
//      decir «no se», no devolver 1 y enseñar euros que en realidad son dolares.
//   2. QUE EL DOLAR SEA GRATIS. Pedir dolares no puede depender de que CoinGecko
//      haya contestado: el numero ya viene en dolares.
//   3. QUE USE UN PAR COMPLETO. Una moneda a la que le falte una de las dos
//      cifras no vale para sacar el factor; hay que seguir buscando.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Se saca la funcion del fuente del renderer, que es codigo de navegador y no se
// puede `require`. Asi la prueba mira el codigo de verdad, no una copia.
const fuente = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app.js'), 'utf8');
const trozo = fuente.match(/function fxDesdeUsd\(fiat = FIAT\) \{[\s\S]*?\n\}/);
assert.ok(trozo, 'no se encuentra fxDesdeUsd en renderer/app.js');

// `PRICES` y `FIAT` son variables del renderer. Se le dan a la funcion desde
// fuera con un pequeño envoltorio, en vez de copiarla aqui.
function conPrecios(PRICES, FIAT) {
  // eslint-disable-next-line no-eval
  return eval('(function(){ const PRICES = ' + JSON.stringify(PRICES) + '; const FIAT = ' + JSON.stringify(FIAT) + '; return ' + trozo[0] + '; })()');
}

const casos = [];
function prueba(nombre, fn) {
  try { fn(); casos.push('ok     ' + nombre); }
  catch (e) { casos.push('FALLA  ' + nombre + ' -> ' + e.message); process.exitCode = 1; }
}

const PRECIOS = {
  ethereum: { usd: 4000, eur: 3600, gbp: 3100, chf: 3400 },
  'usd-coin': { usd: 1, eur: 0.9, gbp: 0.775, chf: 0.85 },
  kadena: { usd: 0.5, eur: 0.45, gbp: 0.3875, chf: 0.425 }
};

prueba('el dolar no necesita factor ni precios', () => {
  // Sin red, sin cache, sin nada: los saldos ya vienen en dolares.
  assert.strictEqual(conPrecios({}, 'usd')('usd'), 1);
});

prueba('el factor sale de la razon entre las dos cifras', () => {
  const fx = conPrecios(PRECIOS, 'eur');
  assert.strictEqual(fx('eur'), 0.9);       // 3600 / 4000
  assert.strictEqual(fx('gbp'), 0.775);     // 3100 / 4000
  assert.strictEqual(fx('chf'), 0.85);      // 3400 / 4000
});

prueba('sin precios dice que no sabe, no devuelve 1', () => {
  // Devolver 1 seria lo comodo y lo peligroso: el panel pondria «1.234,56 €»
  // encima de una cifra que son dolares. Mejor que quien llame lo sepa.
  assert.strictEqual(conPrecios({}, 'eur')('eur'), null);
});

prueba('una moneda a medias no sirve para sacar el factor', () => {
  // Si ethereum viniera sin `eur` -CoinGecko a veces devuelve una moneda y otra
  // no-, hay que seguir buscando en las demas, no rendirse en la primera.
  const cojo = {
    ethereum: { usd: 4000 },                // le falta eur
    'usd-coin': { usd: 1, eur: 0.9 }
  };
  assert.strictEqual(conPrecios(cojo, 'eur')('eur'), 0.9);
});

prueba('un precio a cero no se usa como divisor', () => {
  // Dividir por cero daria Infinity y el panel enseñaria «∞ €».
  const malo = { ethereum: { usd: 0, eur: 0 }, kadena: { usd: 0.5, eur: 0.45 } };
  assert.strictEqual(conPrecios(malo, 'eur')('eur'), 0.9);
});

prueba('el mismo factor salga de la moneda que salga', () => {
  // CoinGecko deriva todas las monedas del mismo tipo de cambio, asi que la
  // razon tiene que ser identica en las tres. Si un dia dejara de serlo, este
  // metodo de sacar el factor habria dejado de valer y conviene enterarse.
  const fx = conPrecios(PRECIOS, 'eur');
  const desde = (cg) => PRECIOS[cg].eur / PRECIOS[cg].usd;
  assert.strictEqual(desde('ethereum'), desde('usd-coin'));
  assert.strictEqual(desde('ethereum'), desde('kadena'));
  assert.strictEqual(fx('eur'), desde('ethereum'));
});

console.log(casos.join('\n'));
console.log(process.exitCode ? 'Moneda de referencia: HAY FALLOS.' : 'Moneda de referencia: todas las comprobaciones pasan.');
