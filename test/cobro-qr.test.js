// Koberlet - Copyright 2026 DNNS.es (Oberluss)
// SPDX-License-Identifier: Apache-2.0

// EL QR DE COBRO TIENE QUE HABLAR EL MISMO IDIOMA QUE EL MOVIL.
//
// Desde la 2.10.0 el QR de Recibir puede llevar la cantidad y la chain, para que
// quien pague con Koberlet en el telefono se las encuentre puestas y no las
// teclee. Eso solo funciona si los dos escriben EXACTAMENTE el mismo texto: el
// que genera el escritorio (renderer/app.js, `qrDeCobro`) y el que lee el movil
// (src/qr.js, `cobroDeQr`).
//
// Si uno de los dos cambiara -otro orden de parametros, otro prefijo, comas en
// vez de puntos-, el fallo NO se ve aqui: se ve en que el movil escanea el QR y
// se queda con la cuenta y sin la cantidad, que es justo lo que parece que
// funciona. Por eso se comprueba el texto letra a letra.
//
// Lo mas importante que vigila esta prueba es el caso vacio: sin cantidad ni
// chain el QR tiene que llevar la cuenta A SECAS, no `kadena:` con la cuenta
// dentro. Los monederos de fuera (Chainweaver, eckoWallet) no entienden el
// prefijo, y ese es el caso normal: cobrar sin pedir una cifra concreta.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

// `qrDeCobro` vive dentro del renderer, que es un fichero de navegador y no se
// puede `require`. Se saca su cuerpo del fuente y se evalua: asi la prueba mira
// el codigo DE VERDAD que se ejecuta, no una copia que se quedaria vieja.
const fuente = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app.js'), 'utf8');
const trozo = fuente.match(/function qrDeCobro\(cuenta, cantidad, chain\) \{[\s\S]*?\n\}/);
assert.ok(trozo, 'no se encuentra qrDeCobro en renderer/app.js');
const qrDeCobro = eval('(' + trozo[0] + ')');

const CUENTA = 'k:e5b947889c87fc5057ed35fa31302f57a248c33d0bbdb20a9c81500e2f3748df';

const casos = [];
function prueba(nombre, fn) {
  try { fn(); casos.push('ok     ' + nombre); }
  catch (e) { casos.push('FALLA  ' + nombre + ' -> ' + e.message); process.exitCode = 1; }
}

prueba('sin cantidad ni chain, la cuenta a secas', () => {
  assert.strictEqual(qrDeCobro(CUENTA, '', ''), CUENTA);
  assert.strictEqual(qrDeCobro(CUENTA, null, null), CUENTA);
  assert.strictEqual(qrDeCobro(CUENTA, undefined, undefined), CUENTA);
  // 0 no es una cantidad que cobrar: cobrar cero no es cobrar.
  assert.strictEqual(qrDeCobro(CUENTA, '0', ''), CUENTA);
});

prueba('con cantidad, el formato exacto que lee el movil', () => {
  assert.strictEqual(qrDeCobro(CUENTA, '1.5', ''), 'kadena:' + CUENTA + '?amount=1.5');
});

prueba('la chain 0 se escribe, no se pierde por ser cero', () => {
  // `if (chain)` en vez de comparar con '' se habria comido la chain 0, que es
  // una chain como cualquier otra y ademas la mas usada.
  assert.strictEqual(qrDeCobro(CUENTA, '', '0'), 'kadena:' + CUENTA + '?chain=0');
});

prueba('cantidad y chain, en este orden', () => {
  // El orden da igual para leerlo, pero se fija para que un cambio se note.
  assert.strictEqual(qrDeCobro(CUENTA, '2.25', '2'), 'kadena:' + CUENTA + '?amount=2.25&chain=2');
});

prueba('una cantidad no numerica no se cuela en el QR', () => {
  assert.strictEqual(qrDeCobro(CUENTA, 'mucho', ''), CUENTA);
  assert.strictEqual(qrDeCobro(CUENTA, '-3', ''), CUENTA);
});

prueba('el movil lo lee y saca lo mismo que se puso', () => {
  // Se reproduce aqui lo que hace `cobroDeQr` del movil (src/qr.js): quitar el
  // prefijo, cortar por '?' y leer los parametros. Si el escritorio escribiera
  // otra cosa, este ida y vuelta se rompe.
  const leer = (texto) => {
    let cuenta = String(texto).trim();
    if (cuenta.toLowerCase().startsWith('kadena:')) cuenta = cuenta.slice(7);
    const corte = cuenta.indexOf('?');
    const cola = corte > 0 ? cuenta.slice(corte + 1) : '';
    if (corte > 0) cuenta = cuenta.slice(0, corte);
    if (corte < 0) return { cuenta: cuenta.trim(), cantidad: null, chain: null };
    const p = new URLSearchParams(cola);
    const cantidad = Number(String(p.get('amount') || '').replace(',', '.'));
    // Igual que el movil: se mira el TEXTO antes de convertirlo. `Number(null)`
    // es 0, y eso hacia pasar por «chain 0» un QR que no traia chain.
    const txtChain = p.get('chain');
    let chain = null;
    if (txtChain !== null && txtChain.trim() !== '') {
      const n = Number(txtChain);
      if (Number.isInteger(n) && n >= 0 && n <= 19) chain = n;
    }
    return {
      cuenta: cuenta.trim(),
      cantidad: isFinite(cantidad) && cantidad > 0 ? cantidad : null,
      chain
    };
  };

  assert.deepStrictEqual(leer(qrDeCobro(CUENTA, '7.5', '2')), { cuenta: CUENTA, cantidad: 7.5, chain: 2 });
  assert.deepStrictEqual(leer(qrDeCobro(CUENTA, '', '0')), { cuenta: CUENTA, cantidad: null, chain: 0 });
  assert.deepStrictEqual(leer(qrDeCobro(CUENTA, '', '')), { cuenta: CUENTA, cantidad: null, chain: null });
  // El caso que descubrio el fallo del movil: importe SIN chain no puede
  // leerse como chain 0. Arreglado en src/qr.js del movil el 18/09/2026.
  assert.deepStrictEqual(leer(qrDeCobro(CUENTA, '1.5', '')), { cuenta: CUENTA, cantidad: 1.5, chain: null });
});

console.log(casos.join('\n'));
console.log(process.exitCode ? 'QR de cobro: HAY FALLOS.' : 'QR de cobro: todas las comprobaciones pasan.');
