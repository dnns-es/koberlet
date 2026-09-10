// El unico sitio donde se crea un proveedor EVM y donde se espera un recibo.
// Existe por dos sustos del 2026-09-09, los dos con la misma forma: la app daba por
// hecho algo del nodo que el nodo no tiene por que cumplir.
const { ethers } = require('ethers');

// 1) LOS GRUPOS DE LLAMADAS
// ethers junta hasta 100 llamadas en un solo envio. Suena a optimizacion y es una trampa:
// hay nodos publicos que limitan el tamano del grupo y, al pasarse, tumban el grupo ENTERO,
// no la llamada sobrante. eth.drpc.org corta en 3 en su plan gratis y dejo los CUATRO saldos
// del puente a cero de golpe, teniendo saldo. Como el nodo lo elige el usuario en Ajustes,
// esto puede volver a pasar con cualquier otro: mejor no depender de que sea generoso.
// 3 es el limite mas bajo que hemos visto de verdad; un nodo mas estricto no da para esta app.
const TOPE_GRUPO = 3;

function proveedor(rpc, extra) {
  return new ethers.JsonRpcProvider(rpc, undefined, { batchMaxCount: TOPE_GRUPO, ...(extra || {}) });
}

// 2) LA ESPERA DEL RECIBO
// tx.wait() de ethers no se limita a preguntar por el recibo: mientras no lo ve, escanea bloques
// buscando si alguien te ha reemplazado la transaccion, y para eso pide el bloque ENTERO con sus
// transacciones (getBlock(n, true)). Justo esa llamada es la que publicnode dejo de servir, asi
// que la espera reventaba DESPUES de firmar y enviar, con la transaccion ya en la cadena, y el
// usuario veia un error enorme por una transferencia que habia salido bien.
// Aqui se pregunta solo por el recibo. Se pierde la deteccion de reemplazo, que en esta app no
// aporta nada (no reemplazamos transacciones), y se gana no depender de los bloques.
const dormir = (ms) => new Promise(r => setTimeout(r, ms));

async function esperarRecibo(pr, hash, opciones = {}) {
  const { confirmaciones = 1, timeoutMs = 20 * 60 * 1000, intervaloMs = 4000 } = opciones;
  const t0 = Date.now();
  for (;;) {
    let r = null;
    try { r = await pr.getTransactionReceipt(hash); }
    catch (_) { /* hipo del nodo: no es un no, es un "todavia no se sabe". Se reintenta. */ }
    if (r) {
      if (confirmaciones <= 1) return r;
      try { const bn = await pr.getBlockNumber(); if (bn - r.blockNumber + 1 >= confirmaciones) return r; }
      catch (_) { return r; }   // hay recibo; no poder contar confirmaciones no lo invalida
    }
    if (Date.now() - t0 >= timeoutMs) {
      // El mensaje importa: aqui la transaccion YA se firmo y se envio. Decir solo "fallo" empuja
      // a reenviar, que es la forma de pagar dos veces. Hay que decir que puede estar en la cadena.
      const cuanto = timeoutMs >= 60000
        ? Math.round(timeoutMs / 60000) + ' minutos'
        : Math.round(timeoutMs / 1000) + ' segundos';
      const e = new Error('No se pudo confirmar la transaccion en ' + cuanto +
        '. OJO: puede estar YA en la cadena. Comprueba el hash ' + hash +
        ' en un explorador ANTES de volver a enviar.');
      e.hash = hash; e.sinConfirmar = true;
      throw e;
    }
    await dormir(intervaloMs);
  }
}

module.exports = { proveedor, esperarRecibo, TOPE_GRUPO };
