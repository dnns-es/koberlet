// 08/08/2026 — lib/nft.js — piezas NFT de una cuenta Kadena.
//
// Pensado GENÉRICO desde el principio: no sabe nada de ninguna tienda concreta.
// Cada red del catálogo declara su `nft` (modelo Alex #4: el catálogo vive en el
// DEFAULT del código, el renderer no puede inyectar contratos):
//
//   nft: {
//     ledger:      'marmalade-v2.ledger',     // módulo del ledger de esa red
//     descubridor: 'https://…/api/…?cuenta=', // opcional: quién sabe qué tiene una cuenta
//     pasarela:    'https://ipfs.io/ipfs/'    // por dónde se leen los ipfs://
//   }
//
// El ledger de Kadena sabe decir "cuántas unidades del token X tiene la cuenta Y",
// pero NO "qué tokens tiene Y": eso hay que preguntárselo a alguien que indexe la
// cadena (el descubridor) o guardarlo a mano en la wallet. Por eso las piezas
// salen de tres sitios y luego se confirma UNA a UNA contra la cadena:
//
//   1. el descubridor de la red (si lo hay),
//   2. las que el usuario ha añadido a mano por su id,
//   3. nada más: lo que la cadena no confirme, no se enseña.
//
// Toda la red se hace AQUÍ, en el proceso principal: el renderer nunca sale a
// internet (CSP estricta) y las imágenes le llegan ya como data URL.
'use strict';

const https = require('https');
const http = require('http');

const MAX_IMAGEN = 3 * 1024 * 1024;      // 3 MB por imagen: de sobra para una miniatura
const MAX_JSON = 256 * 1024;
const TIEMPO = 15000;

// Un id de token de Kadena: letras, números y algunos signos. Nunca comillas: el
// id acaba dentro de código Pact y una comilla permitiría colar código.
const ID_OK = /^[A-Za-z0-9_\-.:]{1,120}$/;
const CUENTA_OK = /^[kw]:[0-9a-fA-F:]{10,200}$/;
const MODULO_OK = /^[A-Za-z0-9_\-.]{3,120}$/;

function idValido(id) { return typeof id === 'string' && ID_OK.test(id); }
function cuentaValida(c) { return typeof c === 'string' && CUENTA_OK.test(c); }

function pedir(url, limite) {
    return new Promise((resolve, reject) => {
        let u;
        try { u = new URL(url); } catch (e) { return reject(new Error('url no válida')); }
        if (u.protocol !== 'https:' && u.protocol !== 'http:') return reject(new Error('protocolo no permitido'));
        const cliente = u.protocol === 'https:' ? https : http;
        const req = cliente.get(u, { timeout: TIEMPO }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                res.resume();
                return pedir(new URL(res.headers.location, u).toString(), limite).then(resolve, reject);
            }
            if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
            const trozos = [];
            let total = 0;
            res.on('data', (d) => {
                total += d.length;
                if (total > limite) { req.destroy(); return reject(new Error('respuesta demasiado grande')); }
                trozos.push(d);
            });
            res.on('end', () => resolve({ datos: Buffer.concat(trozos),
                                          tipo: (res.headers['content-type'] || '').split(';')[0] }));
        });
        req.on('timeout', () => { req.destroy(); reject(new Error('tiempo agotado')); });
        req.on('error', reject);
    });
}

/** ipfs://CID/loquesea -> https://pasarela/CID/loquesea (y deja pasar http/https). */
function aHttp(uri, pasarela) {
    if (!uri) return null;
    if (uri.startsWith('ipfs://')) return pasarela.replace(/\/$/, '/') + uri.slice(7).replace(/^ipfs\//, '');
    if (uri.startsWith('http://') || uri.startsWith('https://')) return uri;
    return null;
}

const cacheMeta = new Map();             // uri -> metadata (los CID son inmutables)
const cacheImg = new Map();

async function metadatosDe(uri, pasarela) {
    if (cacheMeta.has(uri)) return cacheMeta.get(uri);
    const url = aHttp(uri, pasarela);
    if (!url) return {};
    try {
        const { datos } = await pedir(url, MAX_JSON);
        const meta = JSON.parse(datos.toString('utf8'));
        cacheMeta.set(uri, meta);
        return meta;
    } catch (e) {
        return {};
    }
}

async function imagenDataUrl(uri, pasarela, reducir) {
    if (!uri) return null;
    if (cacheImg.has(uri)) return cacheImg.get(uri);
    const url = aHttp(uri, pasarela);
    if (!url) return null;
    try {
        const { datos, tipo } = await pedir(url, MAX_IMAGEN);
        if (!/^image\//.test(tipo)) return null;          // solo imágenes, nada de html ni scripts
        // Las piezas suelen ser de 2048 px y ~700 KB: para una rejilla de
        // miniaturas eso son decenas de MB en el renderer. Si quien llama sabe
        // reducir (el main, con nativeImage), se guarda la versión pequeña.
        let data = null;
        if (typeof reducir === 'function') {
            try { data = await reducir(datos, tipo); } catch (e) { data = null; }
        }
        if (!data) data = `data:${tipo};base64,${datos.toString('base64')}`;
        cacheImg.set(uri, data);
        return data;
    } catch (e) {
        return null;
    }
}

/** Ids candidatos que ofrece el descubridor de la red (si la red tiene uno). */
async function candidatosDelDescubridor(descubridor, cuenta) {
    if (!descubridor) return [];
    try {
        const { datos } = await pedir(descubridor + encodeURIComponent(cuenta), MAX_JSON);
        const d = JSON.parse(datos.toString('utf8'));
        const lista = Array.isArray(d) ? d : (d.piezas || d.tokens || d.items || []);
        return lista.map(x => (typeof x === 'string' ? x : (x.token_id || x.tokenId || x.id)))
                    .filter(idValido);
    } catch (e) {
        return [];
    }
}

/**
 * Piezas que la CADENA confirma que posee la cuenta.
 *   local: función que ejecuta código Pact en esa red (la de lib/kda.js)
 *   red:   entrada del catálogo, con su `nft`
 */
async function piezasDe(local, red, cuenta, idsManuales = [], opciones = {}) {
    if (!cuentaValida(cuenta)) throw new Error('cuenta no válida');
    const conf = (red && red.nft) || {};
    if (!conf.ledger || !MODULO_OK.test(conf.ledger)) return [];
    const pasarela = conf.pasarela || 'https://ipfs.io/ipfs/';

    const candidatos = [...new Set([
        ...(await candidatosDelDescubridor(conf.descubridor, cuenta)),
        ...idsManuales.filter(idValido)
    ])].slice(0, 200);                    // techo por si el descubridor se va de madre

    const piezas = [];
    for (const id of candidatos) {
        let saldo = 0;
        try {
            const r = await local(`(${conf.ledger}.get-balance "${id}" "${cuenta}")`, conf.chain || '0');
            const dato = r && r.status === 'success' ? r.data : null;
            saldo = typeof dato === 'object' && dato !== null
                ? Number(dato.decimal ?? dato.int ?? 0) : Number(dato || 0);
        } catch (e) { saldo = 0; }
        if (!(saldo > 0)) continue;       // no la tiene: fuera, aunque el descubridor la listara

        let uri = null;
        try {
            const info = await local(`(${conf.ledger}.get-token-info "${id}")`, conf.chain || '0');
            if (info && info.status === 'success' && info.data) uri = info.data.uri || null;
        } catch (e) { /* sin uri: se enseña igual, sin imagen */ }

        const meta = uri ? await metadatosDe(uri, pasarela) : {};
        piezas.push({
            id, cuenta, saldo,
            nombre: meta.name || id.slice(0, 18) + '…',
            descripcion: meta.description || '',
            coleccion: meta.collection || (meta.name || '').replace(/\s*#\d+\s*$/, ''),
            atributos: Array.isArray(meta.attributes) ? meta.attributes.slice(0, 20) : [],
            imagen: await imagenDataUrl(meta.image, pasarela, opciones.reducir),
            uri, manual: idsManuales.includes(id)
        });
    }
    return piezas;
}

/** Comprueba que un id existe en esa red y que la cuenta lo tiene (para añadir a mano). */
async function comprobarPieza(local, red, cuenta, id, opciones = {}) {
    if (!idValido(id)) throw new Error('El identificador de la pieza no es válido');
    const piezas = await piezasDe(local, red, cuenta, [id], opciones);
    const p = piezas.find(x => x.id === id);
    if (!p) throw new Error('Esa cuenta no tiene esa pieza en esta red');
    return p;
}

/**
 * ¿Deja el contrato mover esta pieza? Se pregunta ANTES de firmar, simulándolo
 * en el nodo (el /local no escribe nada). Muchas piezas con royalty se acuñan
 * como «sale-only»: solo cambian de dueño vendiéndose, y ni el creador puede
 * regalarlas. Vale la pena avisar antes que soltar el error crudo del contrato.
 *
 *   simular(code, data, clist) -> resultado de /local con las firmas declaradas
 */
async function comprobarEnvio(simular, red, cuenta, id, destino) {
    const conf = (red && red.nft) || {};
    const { code, data, clist } = _tx(conf.ledger, id, cuenta, destino);
    const r = await simular(code, data, clist, conf.chain || '0');
    if (r && r.status === 'success') return { puede: true };
    const mensaje = ((r || {}).error || {}).message || 'el contrato lo rechaza';
    return {
        puede: false,
        motivo: /sale-only/i.test(mensaje)
            ? 'sale-only'          // solo se puede vender, no transferir
            : 'rechazo',
        mensaje
    };
}

/** Partes de la transacción de envío de una pieza (las usa la simulación y el envío real). */
function _tx(ledger, id, de, a) {
    if (!ledger || !MODULO_OK.test(ledger)) throw new Error('Esta red no tiene ledger de NFT');
    if (!idValido(id)) throw new Error('El identificador de la pieza no es válido');
    if (!cuentaValida(de) || !cuentaValida(a)) throw new Error('Cuenta no válida');
    if (!a.startsWith('k:')) throw new Error('El destino tiene que ser una cuenta k:');
    return {
        code: `(${ledger}.transfer-create "${id}" "${de}" "${a}" (read-keyset "ks-destino") 1.0)`,
        data: { 'ks-destino': { keys: [a.slice(2)], pred: 'keys-all' } },
        clist: [{ name: `${ledger}.TRANSFER`, args: [id, de, a, 1.0] },
                { name: 'coin.GAS', args: [] }]
    };
}

module.exports = { piezasDe, comprobarPieza, comprobarEnvio, metadatosDe, imagenDataUrl,
                   idValido, cuentaValida, aHttp, _tx };
