// Koberlet - Copyright 2026 DNNS.es (Oberluss)
// SPDX-License-Identifier: Apache-2.0

// LOS AVISOS DEL CROSS-CHAIN TIENEN QUE SALIR EN EL IDIOMA DE LA VENTANA.
//
// `lib/kda.js` no sabe en que idioma esta abierta la app, asi que desde la 2.11.2 no
// escribe frases: manda `CODIGO|dato|dato` y el renderer lo arma con su LANG. Antes
// mandaba espanol a pelo y quien tenia Koberlet en ingles recibia espanol justo en los
// mensajes que mas importan: los de un envio de dinero a medio camino.
//
// El fallo que vigila esta prueba no se ve al usarla en espanol: se ve cuando alguien
// con la app en ingles se topa con un codigo crudo («XC_ESPERA_SALIDA|abc123») porque
// se anadio un aviso nuevo en la lib y nadie le puso texto. Por eso se comprueban las
// tres patas a la vez: el codigo que emite la lib, su entrada en la tabla del renderer
// y que la clave existe en los DOS idiomas.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');
const fuenteLib = fs.readFileSync(path.join(raiz, 'lib', 'kda.js'), 'utf8');
const fuenteRen = fs.readFileSync(path.join(raiz, 'renderer', 'app.js'), 'utf8');

const casos = [];
function prueba(nombre, fn) {
    try { fn(); casos.push('ok     ' + nombre); }
    catch (e) { casos.push('FALLA  ' + nombre + ' -> ' + e.message); process.exitCode = 1; }
}

// Codigos que la lib emite de verdad, sacados del fuente (no de una lista a mano, que
// se quedaria vieja en cuanto se anada uno).
const emitidos = [...new Set([...fuenteLib.matchAll(/'(XC_[A-Z_]+)(?:\|'|')/g)].map(m => m[1]))];

// La tabla del renderer: CODIGO: ['clave_i18n', [...datos]]
const tabla = {};
for (const m of fuenteRen.matchAll(/^\s*(XC_[A-Z_]+):\s*\['([a-z_]+)',\s*\[([^\]]*)\]\]/gm)) {
    tabla[m[1]] = { clave: m[2], datos: m[3].split(',').map(x => x.trim().replace(/'/g, '')).filter(Boolean) };
}

// Los diccionarios. Se leen del propio fuente por el mismo motivo que el QR de cobro:
// asi la prueba mira el texto DE VERDAD que se ejecuta.
function clavesDe(idioma) {
    const desde = fuenteRen.indexOf('\n  ' + idioma + ': {');
    assert.ok(desde > 0, 'no se encuentra el diccionario ' + idioma);
    const hasta = fuenteRen.indexOf('\n  },', desde);
    const trozo = fuenteRen.slice(desde, hasta);
    return new Set([...trozo.matchAll(/(?:^\s{4}|,\s)([a-z0-9_]+):\s*'/gm)].map(m => m[1]));
}
const ES = clavesDe('es'), EN = clavesDe('en');

prueba('la lib emite codigos, no frases sueltas', () => {
    assert.ok(emitidos.length >= 10, 'solo se han encontrado ' + emitidos.length + ' codigos');
});

for (const cod of emitidos) {
    prueba(cod + ': el renderer sabe armarlo', () => {
        assert.ok(tabla[cod], 'falta ' + cod + ' en XC_TEXTOS de renderer/app.js');
    });
    prueba(cod + ': tiene texto en espanol y en ingles', () => {
        const clave = (tabla[cod] || {}).clave;
        assert.ok(clave, 'sin clave i18n');
        assert.ok(ES.has(clave), 'falta ' + clave + ' en LANG.es');
        assert.ok(EN.has(clave), 'falta ' + clave + ' en LANG.en');
    });
}

// Los avisos de «va en camino» se pintan en naranja porque empiezan por ⏳ (esEnCamino).
// Si alguien le quita el reloj al texto ingles, ese aviso saldria en rojo de error y
// volveriamos justo al problema que se arreglo: la gente reenviando el dinero.
for (const clave of ['xc_espera_salida', 'xc_espera_spv', 'xc_espera_acunar']) {
    prueba(clave + ': lleva el reloj en los dos idiomas', () => {
        for (const idioma of ['es', 'en']) {
            const re = new RegExp("\\n\\s{4}" + clave + ":\\s*'([^']*)'");
            const desde = fuenteRen.indexOf('\n  ' + idioma + ': {');
            const hasta = fuenteRen.indexOf('\n  },', desde);
            const m = re.exec(fuenteRen.slice(desde, hasta));
            assert.ok(m, 'no se encuentra ' + clave + ' en ' + idioma);
            assert.ok(m[1].startsWith('⏳'), clave + ' en ' + idioma + ' no empieza por ⏳');
        }
    });
}

// El boton de firmar NO puede volver cuando el envio va en camino: es el que manda el
// dinero por segunda vez. Se comprueba que el catch lo esconde.
prueba('con el envio en camino el dialogo se cierra en vez de ofrecer firmar otra vez', () => {
    const catchXc = /if \(esEnCamino\(m\)\) \{[\s\S]*?\n    \}/.exec(fuenteRen);
    assert.ok(catchXc, 'el catch del envio ya no distingue el envio en camino');
    const trozo = catchXc[0];
    assert.ok(/modal-send'\)\.hidden = true/.test(trozo), 'el dialogo no se cierra solo');
    assert.ok(/wallet-msg/.test(trozo), 'el aviso no se deja detras y el pactId se perderia al cerrar');
    assert.ok(/return;/.test(trozo), 'sigue devolviendo los botones despues del aviso');
});

for (const c of casos) console.log(c);
console.log(process.exitCode ? 'Avisos del cross-chain: HAY FALLOS.' : 'Avisos del cross-chain: todas las comprobaciones pasan (' + casos.length + ').');
