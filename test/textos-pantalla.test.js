// Koberlet - Copyright 2026 DNNS.es (Oberluss)
// SPDX-License-Identifier: Apache-2.0

// NINGUNA ETIQUETA DE LA PANTALLA PUEDE QUEDARSE SIN TEXTO.
//
// El HTML marca lo que hay que traducir con `data-i18n`, `data-i18n-ph` (marcador de un
// campo) y `data-i18n-title`. Si la clave no esta en el diccionario, `applyLang()` mete
// la CLAVE tal cual: el usuario ve "wc_s_titulo" donde deberia leer "Una web quiere
// conectarse". Paso el 24/09/2026 con toda la pantalla de WalletConnect, y ya venia de
// antes con los marcadores de la copia de seguridad.
//
// No se ve en desarrollo porque uno mira su propio idioma y las claves nuevas se
// escriben primero en español: el que se queda sin texto es el de la otra lengua.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(raiz, 'renderer', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(raiz, 'renderer', 'app.js'), 'utf8');

const casos = [];
function prueba(nombre, fn) {
    try { fn(); casos.push('ok     ' + nombre); }
    catch (e) { casos.push('FALLA  ' + nombre + ' -> ' + e.message); process.exitCode = 1; }
}

// Claves que pide la pantalla.
const pedidas = [...new Set([...html.matchAll(/data-i18n(?:-ph|-title)?="([a-z0-9_]+)"/g)].map((m) => m[1]))];

// Claves que ofrece cada diccionario. Se lee el trozo de cada idioma tal cual esta en el
// fuente; las claves van varias por linea y con comillas simples o dobles, asi que el
// patron admite las dos. Leerlo del fuente y no de un require es a proposito: `app.js`
// es codigo de navegador y no se puede cargar aqui.
// Se acota primero el bloque LANG entero: el diccionario `en` es el ultimo y, sin ese
// corte, se seguia leyendo el resto del fichero y cualquier `algo:` del codigo entraba
// como si fuera una clave de idioma.
const LANG_INI = app.indexOf('const LANG = {');
const LANG_FIN = app.indexOf('\n};', LANG_INI);
assert.ok(LANG_INI > 0 && LANG_FIN > LANG_INI, 'no se encuentra el bloque LANG en renderer/app.js');
const LANG = app.slice(LANG_INI, LANG_FIN);

function clavesDe(idioma) {
    const desde = LANG.indexOf('\n  ' + idioma + ': {');
    assert.ok(desde > 0, 'no se encuentra el diccionario ' + idioma);
    const hasta = LANG.indexOf('\n  },', desde);
    const trozo = LANG.slice(desde, hasta > 0 ? hasta : undefined);
    return new Set([...trozo.matchAll(/(?:^\s{4}|[,{]\s*)([a-z0-9_]+):\s*['"`]/gm)].map((m) => m[1]));
}
const ES = clavesDe('es');
const EN = clavesDe('en');

prueba('la pantalla pide un monton de textos (el detector funciona)', () => {
    assert.ok(pedidas.length > 50, 'solo se han encontrado ' + pedidas.length + ' etiquetas');
});

for (const idioma of ['es', 'en']) {
    const dicc = idioma === 'es' ? ES : EN;
    const faltan = pedidas.filter((k) => !dicc.has(k));
    prueba('ninguna etiqueta se queda sin texto en ' + idioma, () => {
        assert.deepStrictEqual(faltan, [], 'sin texto en ' + idioma + ': ' + faltan.join(', '));
    });
}

// Y al reves: los dos idiomas tienen que ofrecer lo mismo. Una clave que solo existe en
// español es una frase que el ingles no vera nunca.
prueba('los dos diccionarios ofrecen las mismas claves', () => {
    const soloEs = [...ES].filter((k) => !EN.has(k));
    const soloEn = [...EN].filter((k) => !ES.has(k));
    assert.deepStrictEqual({ soloEs, soloEn }, { soloEs: [], soloEn: [] },
        'solo en es: ' + soloEs.join(', ') + ' | solo en en: ' + soloEn.join(', '));
});

for (const c of casos) console.log(c);
console.log(process.exitCode ? 'Textos de pantalla: HAY FALLOS.' : 'Textos de pantalla: todas las comprobaciones pasan (' + casos.length + ').');
