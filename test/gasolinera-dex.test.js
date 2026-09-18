// Koberlet - Copyright 2026 DNNS.es (Oberluss)
// SPDX-License-Identifier: Apache-2.0

// LA GASOLINERA EN EL MERCADO: QUIEN PAGA EL GAS.
//
// Desde la 2.10.0 el Mercado de Kadena puede ir con el gas pagado por
// `free.ksw-gasolinera`, igual que ya iban el DCA y las ordenes limite de este
// mismo proyecto y que el Mercado del movil desde su 0.57.0.
//
// De todo lo que hay que acertar para que funcione, esto vigila lo que NO avisa
// cuando se rompe. El contrato, si algo no le cuadra, no dice «te has pasado de
// gas» ni «esa llamada no me vale»: la transaccion muere comprando el gas y al
// usuario le llega «Failed to buy gas». Por eso se comprueba aqui y no en el
// ordenador de alguien:
//
//   1. LA FORMA DEL CODIGO. El contrato mira que cada llamada de primer nivel
//      EMPIECE por un modulo permitido. El `(let ((r ...)) ... r)` de siempre
//      -que se sigue usando cuando paga el usuario- las esconde dentro.
//   2. EL TOPE DE GAS. El contrato rechaza por encima de 8000, y cuenta el gas
//      que se FIRMA, no el que se gasta. El que se firma sale de multiplicar el
//      medido por el margen; si el margen creciera sin que nadie mire, las
//      operaciones empezarian a fallar.
//   3. EL UMBRAL. 5 kb-USDC, medido sobre la pata que de verdad esta en kb-USDC:
//      al vender KDA, el minimo garantizado, nunca lo esperado.
//   4. QUE DIGA LO MISMO QUE EL MOVIL. Si uno de los dos se desviara, la misma
//      operacion se cobraria distinto segun el aparato, que es justo lo que se
//      estaba arreglando.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const dex = require('../lib/dex');

const USDC = 'n_e595727b657fbbb3b8e362a05a7bb8d12865c1ff.kb-USDC';
const KDA = 'coin';

// Lo que hace `cambiar` con el gas medido, escrito una vez para poder probarlo.
const gasAFirmar = (medido) => Math.ceil(medido * dex.GASO_MARGEN);

const casos = [];
function prueba(nombre, fn) {
  try { fn(); casos.push('ok     ' + nombre); }
  catch (e) { casos.push('FALLA  ' + nombre + ' -> ' + e.message); process.exitCode = 1; }
}

prueba('el gas que se firma cabe en el tope del contrato', () => {
  // Medido en cadena sobre los 100 ultimos pagos de la gasolinera (agosto y
  // septiembre de 2026): de 668 a 2312.
  for (const medido of [668, 836, 1961, 2312]) {
    assert.ok(gasAFirmar(medido) <= dex.GASO_TOPE,
      'con ' + medido + ' de gas real se firmarian ' + gasAFirmar(medido) + ', y el tope es ' + dex.GASO_TOPE);
  }
});

prueba('por encima del tope no se pide gasolinera: se paga y ya', () => {
  // 6154 * 1,3 = 8001. Un punto por encima y el contrato lo tira entero.
  const medido = 6155;
  assert.ok(gasAFirmar(medido) > dex.GASO_TOPE);
  // Hay que decidir por el gas YA multiplicado, no por el medido: 6155 cabria en
  // 8000 y llevaria a firmar algo que el contrato rechaza.
  assert.ok(medido < dex.GASO_TOPE, 'el medido solo engaña si se mira sin el margen');
});

prueba('con gasolinera las llamadas van sueltas, nunca dentro de un (let', () => {
  const cambio = '(kaddex.exchange.swap-exact-in 1 2 [coin] "k:aa" "k:aa" (read-keyset "ks"))';
  const cobro = '(coin.transfer-create "k:aa" "k:bb" (read-keyset "ks-koberlet") 0.5)';

  const gratis = dex.codigoCambio(cambio, cobro, true);
  assert.strictEqual(gratis, cambio + ' ' + cobro);
  assert.ok(!gratis.includes('(let'), 'el `let` esconde las llamadas del contrato');
  assert.ok(gratis.startsWith('(kaddex.'), 'la primera llamada tiene que EMPEZAR por el modulo');

  // Pagando el usuario se conserva el `let`: ahi si conviene devolver el
  // resultado del cambio, y al contrato de la gasolinera no se le pregunta nada.
  const pagando = dex.codigoCambio(cambio, cobro, false);
  assert.ok(pagando.startsWith('(let ((r '), 'falta la forma con let');
  assert.ok(pagando.endsWith(' r)'));

  // Sin comision no hay nada que atar: la llamada va sola de las dos maneras.
  assert.strictEqual(dex.codigoCambio(cambio, null, true), cambio);
  assert.strictEqual(dex.codigoCambio(cambio, null, false), cambio);
});

prueba('el umbral se mide sobre la pata que esta en kb-USDC', () => {
  // Comprando: lo que se entrega ya son kb-USDC.
  assert.strictEqual(dex.valorEnUsdc({ de: USDC, a: KDA, cantidad: '7.5', minimo: '900' }), 7.5);
  // Vendiendo KDA: vale el MINIMO garantizado, no lo esperado. Es la unica cifra
  // que la cadena promete; entre la cotizacion y el bloque, lo esperado se cae.
  assert.strictEqual(dex.valorEnUsdc({ de: KDA, a: USDC, cantidad: '1000', minimo: '5.2' }), 5.2);
  // Sin ninguna pata en kb-USDC no se puede valorar sin meter un precio de
  // mercado aqui, asi que no se subvenciona.
  assert.strictEqual(dex.valorEnUsdc({ de: KDA, a: 'kaddex.kdx', cantidad: '1000', minimo: '30' }), 0);
});

prueba('justo en 5 entra, justo por debajo no', () => {
  const vale = (v) => v >= dex.MIN_GRATIS_USDC;
  assert.strictEqual(vale(dex.valorEnUsdc({ de: USDC, a: KDA, cantidad: '5', minimo: '0' })), true);
  assert.strictEqual(vale(dex.valorEnUsdc({ de: USDC, a: KDA, cantidad: '4.999999', minimo: '0' })), false);
  // Vendiendo manda el minimo: aunque se esperen 6, si solo se garantizan 4,9 no.
  assert.strictEqual(vale(dex.valorEnUsdc({ de: KDA, a: USDC, cantidad: '1000', minimo: '4.9' })), false);
});

prueba('el sender y la capability del gas cambian JUNTOS', () => {
  // Son las dos mitades de la misma decision. Cambiar una sin la otra da
  // «Failed to buy gas», que no dice nada de lo que pasa de verdad. Se comprueba
  // sobre el fuente porque el camino que las une necesita red para recorrerse.
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'dex.js'), 'utf8');
  assert.ok(src.includes("sender: gratis ? gaso.cuenta : o.cuenta"),
    'el sender no depende de quien paga');
  assert.ok(/gratis[\s\S]{0,200}GAS_PAYER/.test(src), 'la GAS_PAYER no depende de quien paga');
  assert.ok(src.includes("[{ name: 'coin.GAS', args: [] }].concat(transfers)"),
    'pagando el usuario tiene que seguir yendo coin.GAS');
  // Pagando la gasolinera NO va coin.GAS: el gas no sale de la cuenta del
  // usuario, asi que ahi no hay nada que acotar. Se mira SOLO la rama de la
  // gasolinera -la del interrogante-, porque la otra si lleva coin.GAS y
  // cortando de mas se colaban las dos.
  const ternario = src.slice(src.indexOf('const clist = gratis'), src.indexOf('const data = gratis'));
  const ramaGratis = ternario.slice(ternario.indexOf('? [{'), ternario.indexOf(': [{'));
  assert.ok(ramaGratis.includes('GAS_PAYER'), 'la rama de la gasolinera no firma GAS_PAYER');
  assert.ok(!ramaGratis.includes("'coin.GAS'"), 'con gasolinera no debe firmarse coin.GAS');
  const ramaPago = ternario.slice(ternario.indexOf(': [{'));
  assert.ok(ramaPago.includes("'coin.GAS'") && !ramaPago.includes('GAS_PAYER'), 'la rama de pago propio no es la de siempre');
});

prueba('el escritorio y el movil hablan de la misma gasolinera', () => {
  // Si uno de los dos se desviara, la misma operacion se cobraria distinto segun
  // el aparato. El movil vive en otro repositorio; si no esta a mano, se avisa y
  // no se falla: la prueba no puede exigir que el otro proyecto este clonado.
  const movil = path.join(__dirname, '..', '..', 'koberlet-android', 'src', 'lib', 'dex.js');
  if (!fs.existsSync(movil)) { casos.push('       (el movil no esta en F:\\APP, no se ha podido cotejar)'); return; }
  const src = fs.readFileSync(movil, 'utf8');

  const tope = /GAS_TOPE_GRATIS\s*=\s*(\d+)/.exec(src);
  assert.ok(tope, 'no se encuentra el tope de gas en el movil');
  assert.strictEqual(Number(tope[1]), dex.GASO_TOPE, 'el tope de gas no coincide con el del movil');

  const min = /MIN_GRATIS_USDC\s*=\s*([\d.]+)/.exec(src);
  assert.ok(min, 'no se encuentra el umbral en el movil');
  assert.strictEqual(Number(min[1]), dex.MIN_GRATIS_USDC, 'el umbral no coincide con el del movil');

  assert.ok(src.includes('* 1.3'), 'el margen sobre el gas medido no coincide con el del movil');
  assert.strictEqual(dex.GASO_MARGEN, 1.3);
});

console.log(casos.join('\n'));
console.log(process.exitCode ? 'Gasolinera del Mercado: HAY FALLOS.' : 'Gasolinera del Mercado: todas las comprobaciones pasan.');
