// Koberlet - Copyright 2026 DNNS.es (Oberluss)
// SPDX-License-Identifier: Apache-2.0

// LOS ERRORES DE MAIN Y DE LIB TIENEN QUE SALIR EN INGLES CON LA VENTANA EN INGLES.
//
// main.js y lib/*.js lanzan sus errores en espanol; renderer/errores-en.js los traduce
// con una tabla de patrones. El fallo que vigila esta prueba no se ve usando la app en
// espanol: alguien anade un throw nuevo y quien la tiene en ingles lee espanol (paso con
// el DCA: «Te faltan KDA en la chain 2 para pagar el gas…»).
//
// Por eso los mensajes NO se copian a mano aqui: se sacan del fuente. Cada new Error(...)
// se evalua con valores de relleno para los trozos variables y el resultado tiene que
// encajar en alguna fila de la tabla y salir sin palabras en espanol.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');
const { ERRORES_EN, traducirError } = require(path.join(raiz, 'renderer', 'errores-en.js'));
const fuenteRen = fs.readFileSync(path.join(raiz, 'renderer', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(raiz, 'renderer', 'index.html'), 'utf8');

const casos = [];
function prueba(nombre, fn) {
    try { fn(); casos.push('ok     ' + nombre); }
    catch (e) { casos.push('FALLA  ' + nombre + ' -> ' + e.message); process.exitCode = 1; }
}

// --- Sacar los argumentos de new Error(...) del fuente ---

const ficheros = ['main.js', ...fs.readdirSync(path.join(raiz, 'lib')).filter(f => f.endsWith('.js')).map(f => 'lib/' + f)];

// Texto del argumento: se cuentan parentesis saltando lo que va dentro de comillas.
function argumento(src, i) {
    let nivel = 1, j = i, comilla = null;
    for (; j < src.length; j++) {
        const c = src[j];
        if (comilla) { if (c === '\\') { j++; continue; } if (c === comilla) comilla = null; continue; }
        if (c === "'" || c === '"' || c === '`') { comilla = c; continue; }
        if (c === '(') nivel++;
        else if (c === ')' && --nivel === 0) break;
    }
    return src.slice(i, j);
}

// Relleno para cualquier variable: vale «7» al pasarlo a texto, cualquier propiedad o
// llamada devuelve otro relleno (cfg.chain, x.toFixed(2), modulo.split('.').pop()…).
const RELLENO = new Proxy(function () {}, {
    get(_, k) {
        if (k === Symbol.toPrimitive || k === 'toString' || k === 'valueOf' || k === 'toJSON') return () => '7';
        return RELLENO;
    },
    apply() { return RELLENO; }
});
// Ambito: lo que no sea global (JSON, String, Math…) es relleno.
const AMBITO = new Proxy({}, {
    has(_, k) { return typeof k === 'string' && !(k in globalThis); },
    get(_, k) { return k === Symbol.unscopables ? undefined : RELLENO; }
});
function evalua(expr) {
    // eslint-disable-next-line no-new-func
    return String(new Function('ambito', 'with (ambito) { return (' + expr + '); }')(AMBITO));
}
// Segunda pasada para ver las otras ramas: «x === 'coin' ? A : B» sale por A y
// «algo || 'texto de relleno'» sale por el texto de relleno.
function otraRama(expr) {
    return expr
        .replace(/===\s*('[^']*'|"[^"]*")/g, '=== $1 || true')
        .replace(/\|\|\s*(?=['"`(])/g, '&& false || ');
}

const muestras = [];   // { donde, texto }
for (const f of ficheros) {
    const src = fs.readFileSync(path.join(raiz, f), 'utf8');
    const re = /new Error\(/g;
    let m;
    while ((m = re.exec(src))) {
        const expr = argumento(src, m.index + m[0].length);
        const donde = f + ':' + src.slice(0, m.index).split('\n').length;
        for (const e of new Set([expr, otraRama(expr)])) {
            try { muestras.push({ donde, texto: evalua(e) }); }
            catch (err) { muestras.push({ donde, texto: null, fallo: err.message, expr: e }); }
        }
    }
}

// Mensajes que no salen de un new Error pero se ensenan igual.
const ordenes = fs.readFileSync(path.join(raiz, 'lib', 'ordenes.js'), 'utf8');
const aviso = /avisoPool = ('[\s\S]*?);\r?\n/.exec(ordenes);
prueba('se encuentra el aviso de pool de lib/ordenes.js', () => assert.ok(aviso, 'ha cambiado la forma de avisoPool'));
if (aviso) muestras.push({ donde: 'lib/ordenes.js avisoPool', texto: evalua(aviso[1]) });
for (const f of ficheros) {
    const src = fs.readFileSync(path.join(raiz, f), 'utf8');
    for (const m of src.matchAll(/\berror:\s*'([^']+)'/g)) muestras.push({ donde: f + ' error:', texto: m[1] });
}
// Trozos que dependen de valores concretos que el relleno no da. Se comprueba que el
// fuente sigue teniendo ese trozo para que esto no se quede viejo sin avisar.
const aMano = [
    ['lib/kdanodo.js', "'no contesto en '", 'no contesto en 8 s'],
    ['lib/evmnodo.js', "' minutos'", 'No se pudo confirmar la transaccion en 2 minutos. OJO: puede estar YA en la cadena. Comprueba el hash 0xabc en un explorador ANTES de volver a enviar.'],
    ['lib/evmnodo.js', "' segundos'", 'No se pudo confirmar la transaccion en 45 segundos. OJO: puede estar YA en la cadena. Comprueba el hash 0xabc en un explorador ANTES de volver a enviar.'],
    ['lib/evmswap.js', "'de origen'", 'Direccion de origen invalida: 0x12'],
    ['lib/evmswap.js', "'de destino'", 'Direccion de destino invalida: 0x12'],
    ['lib/kda.js', "'destino'", 'Cuenta Kadena destino inválida o con caracteres no permitidos.'],
    ['lib/kda.js', "'origen'", 'Cuenta Kadena origen inválida o con caracteres no permitidos.'],
    ['lib/dca.js', "'de consulta'", 'Cuenta Kadena de consulta inválida o con caracteres no permitidos.'],
    ['lib/kda.js', "'El nodo'", 'El nodo rechazó la transacción: Validation failed'],
    ['main.js', "'error desconocido'", 'La transacción falló en cadena: error desconocido'],
    ['lib/dca.js', "'Modulo '", 'Modulo  no valido: coin'],
    ['lib/dca.js', "'Modulo '", 'Modulo token no valido: x.y']
];
for (const [f, trozo, texto] of aMano) {
    prueba('sigue existiendo ' + trozo + ' en ' + f, () => {
        assert.ok(fs.readFileSync(path.join(raiz, f), 'utf8').includes(trozo), 'ya no esta: quita o cambia esta muestra');
    });
    muestras.push({ donde: f + ' (a mano)', texto });
}

// Lo que no es espanol y no hace falta traducir: codigos que el renderer ya arma con su
// LANG (XC_*, WC_*), y mensajes que son solo el dato de fuera («HTTP 503», «Ledger: …»).
const NO_ES_ESPANOL = (t) => /^(XC|WC)_[A-Z_]+/.test(t) || t === '7' || /^HTTP 7$/.test(t) || /^Ledger: 7$/.test(t);

// Palabras que delatan espanol en la salida inglesa.
const DELATORAS = [' la ', ' el ', ' de ', ' del ', ' que ', ' en ', ' con ', ' para ', ' una ', ' esta ', ' ese ', ' esa ',
    ' los ', ' las ', ' por ', ' no se ', 'falta', 'puede', 'cuenta ', 'saldo', 'cantidad', 'contrase', 'bóveda', 'cadena',
    'inválid', 'desconocid', 'respondio','rechaz', 'minutos', 'segundos', 'destino', 'origen', 'ción', 'á', 'é', 'í', 'ó', 'ú', 'ñ', '¿'];

// --- Comprobaciones ---

prueba('se sacan muchos mensajes del fuente (si salen pocos, el extractor se ha roto)', () => {
    assert.ok(muestras.length >= 250, 'solo ' + muestras.length);
});

const vistas = new Set();
let traducidas = 0;
for (const mu of muestras) {
    if (mu.texto == null) {
        prueba(mu.donde + ': se puede evaluar', () => assert.fail('no se pudo evaluar «' + mu.expr + '»: ' + mu.fallo));
        continue;
    }
    if (NO_ES_ESPANOL(mu.texto) || vistas.has(mu.texto)) continue;
    vistas.add(mu.texto);
    traducidas++;
    prueba(mu.donde + ': «' + mu.texto.slice(0, 60) + '» tiene traduccion', () => {
        const en = traducirError(mu.texto);
        assert.notStrictEqual(en, mu.texto, 'ninguna fila de renderer/errores-en.js encaja con este mensaje');
        const bajo = ' ' + en.toLowerCase() + ' ';
        const mala = DELATORAS.find(p => bajo.includes(p));
        assert.ok(!mala, mala ? 'la traduccion «' + en + '» aun lleva «' + mala.trim() + '»' : '');
    });
}

prueba('el caso real del DCA sin gas sale en ingles, con sus numeros', () => {
    const es = 'Te faltan KDA en la chain 2 para pagar el gas. Tienes 10000 y hacen falta al menos 10000.01 (el deposito mas un poco para el gas). Manda algo de KDA a esa chain y vuelve a intentarlo.';
    assert.strictEqual(traducirError(es),
        "You don't have enough KDA on chain 2 to pay for gas. You have 10000 and need at least 10000.01 (the deposit plus a little for gas). Send some KDA to that chain and try again.");
    // Tal y como llega por IPC, con el prefijo de Electron delante.
    const ipc = "Error invoking remote method 'dca:crear': Error: " + es;
    assert.ok(traducirError(ipc).startsWith("Error invoking remote method 'dca:crear': Error: You don't have enough KDA on chain 2"));
});

prueba('los huecos que son trozos conocidos tambien se traducen', () => {
    assert.strictEqual(traducirError('Cuenta Kadena de origen inválida o con caracteres no permitidos.'),
        'Invalid source Kadena account, or it contains characters that are not allowed.');
    assert.strictEqual(traducirError('La transacción falló en cadena: error desconocido'), 'The transaction failed on chain: unknown error');
});

prueba('lo que no conoce lo deja tal cual (errores del nodo, ya en ingles)', () => {
    assert.strictEqual(traducirError('Validation failed: gas limit exceeded'), 'Validation failed: gas limit exceeded');
});

prueba('cada fila es [RegExp anclado, texto]', () => {
    for (const [re, en] of ERRORES_EN) {
        assert.ok(re instanceof RegExp && re.source.startsWith('^') && re.source.endsWith('$'), 'fila mal anclada: ' + re);
        assert.strictEqual(typeof en, 'string');
    }
});

// El renderer: la tabla se carga antes que app.js y solo se aplica en ingles.
prueba('index.html carga errores-en.js antes que app.js', () => {
    const a = html.indexOf('<script src="errores-en.js"></script>'), b = html.indexOf('<script src="app.js"></script>');
    assert.ok(a > 0 && b > a);
});
prueba('cleanErr pasa por errIdioma, y errIdioma solo traduce con LNG en ingles', () => {
    assert.ok(/const cleanErr = [^\n]*errIdioma\(textoXchain\(/.test(fuenteRen), 'cleanErr ya no traduce');
    assert.ok(/const errIdioma = \(m\) => \(LNG === 'en'[^\n]*traducirError\(m\) : String\(m\)/.test(fuenteRen), 'errIdioma ha cambiado');
});
prueba('isLedgerWait reconoce los avisos del Ledger tambien en ingles', () => {
    const def = /const isLedgerWait = \(m\) => (\/.*\/i)\.test\(m\);/.exec(fuenteRen);
    assert.ok(def, 'no se encuentra isLedgerWait');
    // eslint-disable-next-line no-eval
    const re = eval(def[1]);
    for (const es of ['El Ledger está bloqueado: introduce el PIN en el aparato.',
        'No veo ningún Ledger. Conéctalo por USB, desbloquéalo y cierra Ledger Live si está abierto.',
        'Abre la app correcta en el Ledger (Kadena para KDA, Ethereum para EVM) y reintenta.']) {
        assert.ok(re.test(es) && re.test(traducirError(es)), 'no se reconoce en ingles: ' + traducirError(es));
    }
});

for (const c of casos) if (c.startsWith('FALLA')) console.log(c);
console.log(process.exitCode
    ? 'Errores en ingles: HAY FALLOS.'
    : 'Errores en ingles: ' + traducidas + ' mensajes distintos con traduccion; todas las comprobaciones pasan (' + casos.length + ').');
