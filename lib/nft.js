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
// El descubridor admite dos formas, y da igual cuál sea porque de él solo salen
// CANDIDATOS (la cadena manda):
//   - acabado en `=`  → se le pega la cuenta: pregunta "qué tiene esta cuenta";
//   - sin `=` al final → se pide tal cual: es un CATÁLOGO público de piezas
//     conocidas, y Koberlet cruza cada id con el saldo real de la cuenta.
// La segunda forma es preferible: no hace falta que el servicio sepa (ni cuente)
// quién es el dueño de nada.
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
const MAX_JSON = 1024 * 1024;            // un catálogo de piezas es texto, pero puede tener cientos
const TIEMPO = 15000;
const MAX_CANDIDATOS = 500;              // techo por si el descubridor se va de madre
const A_LA_VEZ = 6;                      // consultas simultáneas a la cadena/IPFS
const MAX_SALTOS = 3;                    // redirecciones que se siguen como mucho
const TIPOS_IMAGEN = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']);

// Direcciones que NO se visitan aunque nos redirijan a ellas: la uri de una pieza la
// elige quien la acuña, y sin esto la wallet haría de sonda contra la red del usuario
// (su router, un panel interno…) a instancias de un tercero (auditoría M-1).
const PRIVADA = [
    /^127\./, /^10\./, /^192\.168\./, /^169\.254\./, /^0\./,
    /^172\.(1[6-9]|2\d|3[01])\./
];
function destinoPermitido(u) {
    const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (h === 'localhost' || h.endsWith('.localhost') || h === '::1') return false;
    if (/^(fc|fd)[0-9a-f]{2}:/i.test(h) || /^fe80:/i.test(h)) return false;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(h) && PRIVADA.some(re => re.test(h))) return false;
    return true;
}

// Un id de token de Kadena: letras, números y algunos signos. Nunca comillas: el
// id acaba dentro de código Pact y una comilla permitiría colar código.
const ID_OK = /^[A-Za-z0-9_\-.:]{1,120}$/;
const CUENTA_OK = /^[kw]:[0-9a-fA-F:]{10,200}$/;
const MODULO_OK = /^[A-Za-z0-9_\-.]{3,120}$/;

function idValido(id) { return typeof id === 'string' && ID_OK.test(id); }
function cuentaValida(c) { return typeof c === 'string' && CUENTA_OK.test(c); }

function pedir(url, limite, saltos = 0) {
    return new Promise((resolve, reject) => {
        let u;
        try { u = new URL(url); } catch (e) { return reject(new Error('url no válida')); }
        if (u.protocol !== 'https:' && u.protocol !== 'http:') return reject(new Error('protocolo no permitido'));
        if (!destinoPermitido(u)) return reject(new Error('destino no permitido'));
        const cliente = u.protocol === 'https:' ? https : http;
        const req = cliente.get(u, { timeout: TIEMPO }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                res.resume();
                // Con tope de saltos (sin él, un servidor que se redirige a sí mismo deja
                // la carga dando vueltas para siempre) y sin bajar de https a http.
                if (saltos >= MAX_SALTOS) return reject(new Error('demasiadas redirecciones'));
                let destino;
                try { destino = new URL(res.headers.location, u); } catch (e) { return reject(new Error('redirección no válida')); }
                if (u.protocol === 'https:' && destino.protocol !== 'https:') return reject(new Error('redirección insegura'));
                return pedir(destino.toString(), limite, saltos + 1).then(resolve, reject);
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
        // Lista blanca de tipos, no un `startsWith('image/')`: el Content-Type lo elige
        // el servidor de quien acuñó la pieza y acaba dentro del atributo src de la
        // rejilla. Con comillas dentro se podría cerrar el atributo e inyectar markup
        // (auditoría A-2). Lo que no esté aquí, no se pinta.
        if (!TIPOS_IMAGEN.has(tipo)) return null;
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

/**
 * Rebusca ids de token por todo un JSON, esté como esté anidado (una lista suelta,
 * {piezas:[…]}, {colecciones:[{piezas:[…]}]}…). Así el descubridor puede cambiar de
 * forma sin que haya que tocar la wallet. Solo pasan los ids con forma válida.
 */
function recolectarIds(valor, salida = [], hondo = 0) {
    if (salida.length >= MAX_CANDIDATOS || hondo > 6 || !valor) return salida;
    if (typeof valor === 'string') { if (idValido(valor)) salida.push(valor); return salida; }
    if (Array.isArray(valor)) { for (const v of valor) recolectarIds(v, salida, hondo + 1); return salida; }
    if (typeof valor !== 'object') return salida;
    for (const clave of ['token_id', 'tokenId', 'id']) {
        const v = valor[clave];
        if (typeof v === 'string' && idValido(v)) { salida.push(v); return salida; }   // ya identificada: no hurgamos dentro
    }
    for (const v of Object.values(valor)) recolectarIds(v, salida, hondo + 1);
    return salida;
}

/**
 * Ids candidatos que ofrece el descubridor de la red (si la red tiene uno).
 * Devuelve {ids, error}: si el descubridor falla (caído, pide sesión…) hay que
 * DECIRLO, porque si no la wallet enseña "ninguna pieza" y parece que no tienes.
 */
async function candidatosDelDescubridor(descubridor, cuenta) {
    if (!descubridor) return { ids: [], error: null };
    // acabado en `=` → pregunta por una cuenta; si no, es un catálogo público
    const url = descubridor.endsWith('=') ? descubridor + encodeURIComponent(cuenta) : descubridor;
    try {
        const { datos } = await pedir(url, MAX_JSON);
        return { ids: recolectarIds(JSON.parse(datos.toString('utf8'))), error: null };
    } catch (e) {
        return { ids: [], error: e.message || String(e) };
    }
}

/** Ejecuta `tarea` sobre cada elemento, de A_LA_VEZ en A_LA_VEZ (la lista puede tener cientos). */
async function porLotes(lista, tarea) {
    const salida = [];
    for (let i = 0; i < lista.length; i += A_LA_VEZ) {
        salida.push(...await Promise.all(lista.slice(i, i + A_LA_VEZ).map(tarea)));
    }
    return salida;
}

/**
 * Piezas que la CADENA confirma que posee la cuenta.
 *   local: función que ejecuta código Pact en esa red (la de lib/kda.js)
 *   red:   entrada del catálogo, con su `nft`
 */
async function piezasDe(local, red, cuenta, idsManuales = [], opciones = {}) {
    if (!cuentaValida(cuenta)) throw new Error('cuenta no válida');
    const conf = (red && red.nft) || {};
    if (!conf.ledger || !MODULO_OK.test(conf.ledger)) return { piezas: [], avisoDescubridor: null };
    const pasarela = conf.pasarela || 'https://ipfs.io/ipfs/';
    const chain = conf.chain || '0';

    const desc = opciones.sinDescubridor
        ? { ids: [], error: null }                       // al añadir a mano solo interesa ese id
        : await candidatosDelDescubridor(conf.descubridor, cuenta);
    const candidatos = [...new Set([...desc.ids, ...idsManuales.filter(idValido)])].slice(0, MAX_CANDIDATOS);

    // 1) la cadena dice cuáles son suyas de verdad (lo demás, fuera)
    const mias = (await porLotes(candidatos, async (id) => {
        try {
            const r = await local(`(${conf.ledger}.get-balance "${id}" "${cuenta}")`, chain);
            const dato = r && r.status === 'success' ? r.data : null;
            const saldo = typeof dato === 'object' && dato !== null
                ? Number(dato.decimal ?? dato.int ?? 0) : Number(dato || 0);
            return saldo > 0 ? { id, saldo } : null;
        } catch (e) { return null; }
    })).filter(Boolean);

    // 2) solo de esas se piden ficha, metadatos e imagen
    const piezas = await porLotes(mias, async ({ id, saldo }) => {
        let uri = null;
        try {
            const info = await local(`(${conf.ledger}.get-token-info "${id}")`, chain);
            if (info && info.status === 'success' && info.data) uri = info.data.uri || null;
        } catch (e) { /* sin uri: se enseña igual, sin imagen */ }

        const meta = uri ? await metadatosDe(uri, pasarela) : {};
        return {
            id, cuenta, saldo,
            nombre: meta.name || id.slice(0, 18) + '…',
            descripcion: meta.description || '',
            coleccion: meta.collection || (meta.name || '').replace(/\s*#\d+\s*$/, ''),
            atributos: Array.isArray(meta.attributes) ? meta.attributes.slice(0, 20) : [],
            imagen: await imagenDataUrl(meta.image, pasarela, opciones.reducir),
            uri, manual: idsManuales.includes(id)
        };
    });
    return { piezas, avisoDescubridor: desc.error };
}

/** Comprueba que un id existe en esa red y que la cuenta lo tiene (para añadir a mano). */
async function comprobarPieza(local, red, cuenta, id, opciones = {}) {
    if (!idValido(id)) throw new Error('El identificador de la pieza no es válido');
    const { piezas } = await piezasDe(local, red, cuenta, [id], { ...opciones, sinDescubridor: true });
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
