// Koberlet - Copyright 2026 DNNS.es (Oberluss)
// SPDX-License-Identifier: Apache-2.0

// LA CUENTA AL REVES: «QUIERO RECIBIR TANTO, CUANTO ENTREGO».
//
// Desde la 2.10.0 el Mercado tiene dos casillas: se escribe en una y la otra se
// rellena sola. La de la derecha hace la cuenta al reves con `cantidadPara`.
//
// Esto se prueba porque es el tipo de fallo que NO se nota: una formula invertida
// mal no da error ni deja la casilla vacia, da un numero creible y equivocado. Y
// el numero va derecho a la casilla de lo que se entrega, que es dinero.
//
// La comprobacion de verdad es la IDA Y VUELTA: se pide recibir X, se calcula lo
// que hay que entregar, y se mete esa cantidad por el camino normal a ver si sale
// X. Si las dos formulas dejan de ser la misma leida del otro lado, aqui se ve.
//
// Nota sobre el redondeo: `cantidadPara` redondea hacia ARRIBA en el ultimo
// decimal del token. Es deliberado -hacia abajo dejaria la salida siempre un pelo
// por debajo de lo pedido- y hace que la vuelta de un pelin de mas, nunca de
// menos. Eso es lo que se exige aqui.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

// `salidaHop`, `entradaHop` y `FEE` no se exportan (son de dentro del modulo). Se
// sacan del fuente y se evaluan juntos, para probar el codigo de verdad y no una
// copia que se quedaria vieja.
const fuente = fs.readFileSync(path.join(__dirname, '..', 'lib', 'dex.js'), 'utf8');
const trozos = ['const FEE = 0.003;']
  .concat(['function salidaHop', 'function entradaHop'].map((f) => {
    const m = fuente.match(new RegExp(f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\([\\s\\S]*?\\n\\}'));
    assert.ok(m, 'no se encuentra ' + f + ' en lib/dex.js');
    return m[0];
  }));
const { salidaHop, entradaHop } = eval('(function(){' + trozos.join('\n') + '\nreturn { salidaHop, entradaHop };})()');

const casos = [];
function prueba(nombre, fn) {
  try { fn(); casos.push('ok     ' + nombre); }
  catch (e) { casos.push('FALLA  ' + nombre + ' -> ' + e.message); process.exitCode = 1; }
}

// Un pool de tamaño realista: el de kb-USDC/KDA rondaba las 840.000 KDA el
// 18/09/2026, con unos 3.300 kb-USDC al otro lado.
const RIN = 3329.41, ROUT = 838250.99;

prueba('la ida y la vuelta se cierran en un salto', () => {
  for (const quiero of [100, 1501.25, 20000]) {
    const entrada = entradaHop(quiero, RIN, ROUT);
    const vuelta = salidaHop(entrada, RIN, ROUT);
    // Hasta una millonesima relativa: son numeros en coma flotante, no enteros.
    assert.ok(Math.abs(vuelta - quiero) / quiero < 1e-9,
      'pidiendo ' + quiero + ' se entregaria ' + entrada + ', que devuelve ' + vuelta);
  }
});

prueba('la vuelta nunca se queda corta', () => {
  // Es la unica direccion del error que importa: quien escribe 6 en la casilla
  // espera 6 o un pelo mas, nunca 5,99.
  for (const quiero of [1, 6, 250.5, 9999]) {
    const entrada = entradaHop(quiero, RIN, ROUT);
    assert.ok(salidaHop(entrada, RIN, ROUT) >= quiero * (1 - 1e-9));
  }
});

prueba('pedir mas de lo que hay en el pool no da un numero, da null', () => {
  // La formula `salida*rin/(rout-salida)` se vuelve negativa o infinita al pasarse.
  // Sin este freno saldria una cantidad a entregar sin ningun sentido -negativa o
  // astronomica- y el usuario la veria en la casilla como si fuese buena.
  assert.strictEqual(entradaHop(ROUT, RIN, ROUT), null);
  assert.strictEqual(entradaHop(ROUT * 2, RIN, ROUT), null);
  // Justo por debajo del fondo si hay respuesta, aunque sea enorme.
  assert.ok(entradaHop(ROUT * 0.999, RIN, ROUT) > 0);
});

prueba('cero y negativos no se calculan', () => {
  assert.strictEqual(entradaHop(0, RIN, ROUT), 0);
  assert.strictEqual(entradaHop(-5, RIN, ROUT), 0);
});

prueba('la ida y la vuelta se cierran tambien en dos saltos', () => {
  // Segundo pool, mas pequeño, como los que hay de verdad en este DEX.
  const RIN2 = 41000, ROUT2 = 86.4;
  const quiero = 12;
  // Hacia atras: lo que hay que meter en el ultimo salto es lo que sale del primero.
  const medio = entradaHop(quiero, RIN2, ROUT2);
  const entrada = entradaHop(medio, RIN, ROUT);
  // Hacia delante otra vez.
  const vuelta = salidaHop(salidaHop(entrada, RIN, ROUT), RIN2, ROUT2);
  assert.ok(Math.abs(vuelta - quiero) / quiero < 1e-9, 'dos saltos no cierran: ' + vuelta + ' en vez de ' + quiero);
});

prueba('la comision del pool esta en las dos formulas, y es la misma', () => {
  // Si una llevara el 0,3 % y la otra no, la ida y la vuelta seguirian cerrando
  // casi -el error es pequeño- pero el numero estaria mal. Se mira el fuente.
  const ida = fuente.match(/function salidaHop[\s\S]*?\n\}/)[0];
  const vuelta = fuente.match(/function entradaHop[\s\S]*?\n\}/)[0];
  assert.ok(ida.includes('(1 - FEE)'), 'la ida no descuenta la comision del pool');
  assert.ok(vuelta.includes('(1 - FEE)'), 'la vuelta no deshace la comision del pool');
});

prueba('lo que se pide al usuario incluye la comision de Koberlet', () => {
  // `cantidadPara` divide entre (1 - FEE_DNNS) al final: lo que entra al pool es
  // lo que queda despues de apartar el 0,5 %. Sin eso, la salida real se quedaria
  // sistematicamente por debajo de lo pedido, justo un 0,5 %.
  const cuerpo = fuente.match(/async function cantidadPara[\s\S]*?\n\}/)[0];
  assert.ok(cuerpo.includes('/ (1 - FEE_DNNS)'), 'no se deshace la comision de Koberlet');
  assert.ok(cuerpo.includes('Math.ceil'), 'el redondeo no es hacia arriba');
});

console.log(casos.join('\n'));
console.log(process.exitCode ? 'Cuenta inversa: HAY FALLOS.' : 'Cuenta inversa: todas las comprobaciones pasan.');
