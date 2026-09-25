// Koberlet - Copyright 2026 DNNS.es (Oberluss)
// SPDX-License-Identifier: Apache-2.0

// Copia del movil (koberlet-android/src/lib/wc-comando.js), pasada a CommonJS.
// Si se cambia aqui, se cambia alli: PARIDAD.md.

// EL OTRO MODO DE FIRMAR DE KADENA: `kadena_sign_v1`.
//
// Hay dos, y las webs eligen. Con `kadena_quicksign_v1` la web manda el comando
// YA MONTADO y el monedero solo lo firma. Con `kadena_sign_v1` manda las PIEZAS
// -el codigo, los datos, los permisos, quien paga el gas- y **el comando lo monta
// el monedero**. Eso es lo que hace este fichero.
//
// Lo pidio la realidad: mercatusdex.fun exige `kadena_sign_v1` y sin el no deja
// ni conectar (25/09/2026, visto en el iPhone de Antonio).
//
// MONTARLO AQUI NO ES PEOR QUE RECIBIRLO HECHO; es mejor. Lo que llega son campos
// sueltos, asi que la pantalla puede enseñar los permisos uno a uno -cuanto se
// autoriza mover y a quien- en vez de un JSON. Y lo que se firma es exactamente
// la cadena que se devuelve: el hash sale de ella, asi que no hay hueco entre lo
// que se enseño y lo que se firmo.
//
// LO QUE NO SE INVENTA: la clave con la que se firma no la decide la web. Sale de
// la cuenta con la que se conecto la sesion, y si la web pide otra cosa se dice.
// Y la red tampoco: manda la de la sesion, no un campo del mensaje.

/** Lo que se pone si la web no lo dice. Son los valores de siempre de Kadena. */
const GAS_LIMITE = 2000;
const GAS_PRECIO = 1e-8;
const VIDA = 600;               // 10 minutos de validez

const esClave = (k) => /^[0-9a-f]{64}$/i.test(String(k || ''));

/**
 * De la peticion de la web al comando de Kadena, listo para firmar y enseñar.
 *
 * @param peticion  lo que manda la web: { code, data, caps, nonce, chainId,
 *                  gasLimit, gasPrice, ttl, sender, extraSigners }
 * @param red       la red de la sesion (`mainnet01`), que manda sobre lo que diga
 *                  la peticion: la sesion se aprobo para unas redes concretas
 * @param clave     la publica de la cuenta con la que se conecto, en hex
 */
function comandoDeFirma(peticion, red, clave) {
    // Algunas librerias lo mandan envuelto en `body`. Se admiten las dos formas:
    // rechazar por el envoltorio seria dejar sin firmar a media Internet.
    const p = (peticion && peticion.body) ? peticion.body : (peticion || {});

    const codigo = String(p.code || '');
    if (!codigo.trim()) throw new Error('WC_SIN_CODIGO');
    if (!esClave(clave)) throw new Error('WC_SIN_CUENTA');

    // Los permisos van TAL CUAL los pide la web: son lo que se enseña y lo que
    // acota la firma. Quitar uno aqui seria firmar algo distinto de lo que se
    // vio; añadirlo, firmar mas de lo que se pidio.
    const clist = [];
    for (const c of (p.caps || [])) {
        const cap = (c && c.cap) ? c.cap : c;
        if (!cap || !cap.name) continue;
        clist.push({ name: String(cap.name), args: Array.isArray(cap.args) ? cap.args : [] });
    }

    // El firmante es el dueño; los `extraSigners` son otras claves que la web
    // espera que firmen en otra parte, y van SIN permisos porque no somos
    // nosotros quien decide que autorizan.
    const signers = [clist.length ? { pubKey: clave, clist } : { pubKey: clave }];
    for (const otro of (p.extraSigners || [])) {
        if (esClave(otro) && otro.toLowerCase() !== clave.toLowerCase()) signers.push({ pubKey: String(otro) });
    }

    const meta = {
        chainId: String(p.chainId !== undefined && p.chainId !== null ? p.chainId : ''),
        sender: String(p.sender || ('k:' + clave)),
        gasLimit: Number(p.gasLimit) > 0 ? Number(p.gasLimit) : GAS_LIMITE,
        gasPrice: Number(p.gasPrice) > 0 ? Number(p.gasPrice) : GAS_PRECIO,
        ttl: Number(p.ttl) > 0 ? Number(p.ttl) : VIDA,
        // Quince segundos atras: el reloj del movil puede ir un poco adelantado y
        // un comando del futuro lo rechaza el nodo.
        creationTime: Math.floor(Date.now() / 1000) - 15,
    };
    if (!/^\d{1,2}$/.test(meta.chainId)) throw new Error('WC_SIN_CHAIN');

    return JSON.stringify({
        networkId: String(red || ''),
        payload: { exec: { data: (p.data && typeof p.data === 'object') ? p.data : {}, code: codigo } },
        signers,
        meta,
        nonce: String(p.nonce || ('koberlet-' + Date.now())),
    });
}

/**
 * Lo que se le devuelve a la web cuando ya esta firmado.
 *
 * `kadena_sign_v1` contesta UN comando dentro de `body`; `kadena_quicksign_v1`
 * contesta una lista en `responses`, cada una con su resultado. Devolver la forma
 * del otro metodo deja a la web esperando algo que no llega.
 */
function respuestaFirmada(metodo, firmados) {
    if (metodo === 'kadena_sign_v1') {
        const f = firmados[0];
        return { body: { cmd: f.cmd, hash: f.hash, sigs: [{ sig: f.sig }] } };
    }
    return {
        responses: firmados.map((f) => ({
            commandSigData: { cmd: f.cmd, sigs: [{ pubKey: f.pubKey, sig: f.sig }] },
            outcome: { result: 'success', hash: f.hash },
        })),
    };
}

module.exports = { comandoDeFirma, respuestaFirmada };
