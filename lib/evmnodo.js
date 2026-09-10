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

// 3) EL NODO QUE NO SIRVE
// Un nodo puede estar vivo y aun asi no valer. Lo aprendido el 2026-09-09, en dos sustos y por
// el camino largo, es que preguntarle al nodo "quien eres" no demuestra NADA:
//   - cloudflare-eth.com contesta eth_chainId y luego rechaza eth_getBalance;
//   - rpc.flashbots.net contesta lo mismo y solo acepta envios, no lecturas;
//   - publicnode contesta y sirve saldos, pero dejo de dar bloques por numero.
// Un sondeo que solo mire el chainId habria dado por bueno cualquiera de los tres. Asi que aqui
// se prueba lo que la app USA de verdad: leer un saldo y llamar a un contrato, que es de donde
// salen los tokens y el puente, y ademas en el mismo envio, para que un nodo que corte los
// grupos se caiga aqui y no en mitad de una operacion.
//
// El chainId se comprueba SIEMPRE y no es opcional: saltar a otro nodo a ciegas podria dejarte
// firmando contra una cadena que no es la tuya. Una reserva que sirva otra cadena se descarta
// como si estuviera caida.
const ERC20_BAL = ['function balanceOf(address) view returns (uint256)'];
const SONDA = '0x0000000000000000000000000000000000000000';  // no es de nadie: solo para preguntar
const _vivos = new Map();

async function sirve(pr, chainId, token) {
  const red = await pr.getNetwork();
  if (chainId && Number(red.chainId) !== Number(chainId)) {
    const e = new Error('sirve la cadena ' + red.chainId + ', no la ' + chainId);
    e.otraCadena = true;
    throw e;
  }
  // Las dos juntas a proposito: asi van en un solo envio y un nodo que limite el grupo falla aqui.
  const pruebas = [pr.getBalance(SONDA)];
  if (token) pruebas.push(new ethers.Contract(token, ERC20_BAL, pr).balanceOf(SONDA));
  await Promise.all(pruebas);
}

// Devuelve el primer nodo que sirva de verdad, entre el configurado y las reservas del catalogo.
// El del usuario va SIEMPRE primero: si funciona, no se le toca.
async function elegirVivo({ clave, rpc, reservas, chainId, token }) {
  const lista = [rpc, ...(reservas || [])].filter(Boolean);
  const guardado = _vivos.get(clave);
  if (guardado && lista.includes(guardado)) return guardado;

  let primerFallo = null;
  for (const u of lista) {
    // El proveedor de la sonda se destruye SIEMPRE: ethers deja reintentando la deteccion
    // de red cada segundo, para siempre, al que no contesta. Sondear sin destruir dejaba un
    // zombi por cada nodo descartado y por cada consulta.
    const pr = proveedor(u, { staticNetwork: true });
    try {
      await sirve(pr, chainId, token);
      if (clave) _vivos.set(clave, u);
      return u;
    } catch (e) { if (!primerFallo) primerFallo = e; }
    finally { try { pr.destroy(); } catch (_) {} }
  }
  // Se devuelve el motivo del PRIMERO, que es el nodo que el usuario eligio y del que espera
  // noticias. "Fallaron 3 nodos" no le dice a nadie que arreglar.
  throw primerFallo || new Error('sin nodos disponibles');
}

// Olvida el nodo elegido para una red: se vuelve a sondear en la siguiente consulta.
const olvidarVivo = (clave) => _vivos.delete(clave);

module.exports = { proveedor, esperarRecibo, elegirVivo, olvidarVivo, TOPE_GRUPO };
