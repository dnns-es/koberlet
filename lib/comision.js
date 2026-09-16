// Koberlet - Copyright 2026 DNNS.es (Oberluss)
// SPDX-License-Identifier: Apache-2.0

// LO QUE COBRA KOBERLET, ESCRITO UNA SOLA VEZ.
//
// El 0,5% de servicio sale en cinco sitios distintos -el Mercado de Kadena por sus dos
// caminos, el cambio USDC<->ETH, el de estables y, dentro de sus contratos, el DCA y las
// ordenes limite-. Si cada uno llevara su copia de la cuenta que cobra, tarde o temprano
// una se quedaria vieja y el dinero se iria a una cuenta equivocada sin que nadie lo
// notara: son numeros que nadie lee dos veces.
//
// Asi que viven aqui, en un fichero que no hace nada mas, y las pruebas comprueban que
// nadie se escriba la suya.
//
// Dos redes, dos formas de cobrar, y la diferencia hay que decirla tal cual:
//
//   - En KADENA se aparta de lo que ENTRA, antes del cambio, con una transferencia que
//     viaja dentro de la misma transaccion.
//   - En ETHEREUM sale de lo que SE RECIBE, porque lo hace el propio router de Uniswap
//     (`sweepTokenWithFee` / `unwrapWETH9WithFee`), que es codigo suyo y auditado. El
//     router no admite pasar del 1%, asi que ni por error se puede cobrar de mas.

// El 0,5%, escrito de las dos maneras que hacen falta.
const FEE = 0.005;
const FEE_BIPS = 50n;        // 50 centesimas de punto porcentual
const FEE_MAX_BIPS = 100n;   // el tope que impone el router de Uniswap

// Kadena: cuenta `k:` y su clave, que es la misma sin el prefijo. Es la cuenta que ya
// cobran el DCA y las ordenes limite desde sus contratos.
const KDA_CLAVE = 'e5b947889c87fc5057ed35fa31302f57a248c33d0bbdb20a9c81500e2f3748df';
const KDA_CUENTA = 'k:' + KDA_CLAVE;

// Ethereum: la cuenta que recibe la parte del router.
const ETH_CUENTA = '0x4A31148aD2BF0355C93bf7C9218Bb723F15c901c';

// Redondeo HACIA ABAJO a los decimales del token. Cobrar de mas, aunque sea un decimal,
// es cobrar lo que no es tuyo; y mandar mas decimales de los que el token admite hace
// que el contrato tire la transaccion entera.
function piso(x, decimales) {
  const f = Math.pow(10, decimales);
  return Math.floor(x * f) / f;
}

/**
 * Kadena: lo que se parte de la cantidad que entra.
 *
 * Se devuelven tambien en texto porque es ese texto, y no el numero, lo que acaba dentro
 * del comando firmado: asi lo que se enseña y lo que se firma son lo mismo.
 */
function reparto(cantidad, decimales) {
  const comision = piso(Number(cantidad) * FEE, decimales);
  const alPool = piso(Number(cantidad) - comision, decimales);
  return { comision, alPool, comisionStr: comision.toFixed(decimales), alPoolStr: alPool.toFixed(decimales) };
}

/**
 * Ethereum: lo que se lleva Koberlet de lo que sale del pool y lo que queda para el
 * usuario. El router hace esta misma cuenta con el saldo real al ejecutarse; aqui se
 * repite sobre la cotizacion para poder ENSEÑARLA antes de firmar.
 */
function conComision(bruto) {
  const comision = bruto * FEE_BIPS / 10000n;
  return { comision, neto: bruto - comision };
}

module.exports = { FEE, FEE_BIPS, FEE_MAX_BIPS, KDA_CUENTA, KDA_CLAVE, ETH_CUENTA, piso, reparto, conComision };
