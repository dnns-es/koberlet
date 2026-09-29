// Koberlet - Copyright 2026 DNNS.es (Oberluss)
// SPDX-License-Identifier: Apache-2.0

// RESPALDO DEL PRECIO DEL KDA: el pool KDA/kb-USDC del Mercado.
//
// CoinGecko es un solo sitio, y ademas su precio del KDA se alimenta de solo dos
// mercados (CoinEx y Gate a 29/09/2026; CoinEx cerro ese mismo mes). Cuando no
// contesta -corta por cuota, o bloquea la IP con un 403 de CloudFront, que es lo
// que le paso a Antonio- el dashboard se quedaba en 0,00 con los saldos bien.
//
// El respaldo es el pool KDA/kb-USDC de la chain 2, que la app ya lee para las
// ordenes y que no depende de ningun exchange: 1 kb-USDC se toma por 1 dolar.
// Para pasar de dolar a euros, libras o francos no se pide el cambio a un tercero
// mas: se recuerda la razon eur/usd, gbp/usd y chf/usd de la ultima vez que
// CoinGecko contesto (cambia poco de un dia a otro). Si nunca contesto, en esas
// monedas no hay precio: se deja en null y no se inventa.
//
// Es un calco de `src/lib/mercado.js` del movil (valorDesdePool). Sin red y sin
// Electron para poderlo probar suelto.

const FIATS = ['usd', 'eur', 'gbp', 'chf'];
const VIGENCIA_RAZONES_MS = 7 * 86400000;

/** Las razones fiat/usd de una entrada de CoinGecko ({usd, eur, gbp, chf}). */
function razonesDe(k) {
  const usd = Number(k && k.usd);
  if (!(usd > 0)) return null;
  const r = { cuando: Date.now() };
  for (const f of FIATS) {
    const v = Number(k[f]);
    if (v > 0) r[f] = v / usd;
  }
  return r;
}

/** Unas razones guardadas siguen valiendo una semana; despues, mejor nada. */
function razonesVigentes(r) {
  if (!r || !(Date.now() - Number(r.cuando) < VIGENCIA_RAZONES_MS)) return null;
  return r;
}

/**
 * Una entrada de precios a partir de un precio en dolares: el dolar siempre; las
 * demas monedas solo con razon recordada (null si no). Sin variacion 24h, que el
 * pool no sabe de ayer. `fuente` dice de donde sale, para quien quiera decirlo.
 */
function desdeDolar(precioUsd, razones, fuente) {
  const p = Number(precioUsd);
  if (!(p > 0)) return null;
  const e = { chg: null, fuente: fuente || 'pool' };
  for (const f of FIATS) {
    const razon = f === 'usd' ? 1 : (razones && Number(razones[f]));
    e[f] = razon > 0 ? p * razon : null;
  }
  return e;
}

/**
 * Lo que se mete en el mapa de precios cuando CoinGecko falla: el KDA al precio
 * del pool y las monedas estables a un dolar. Lo demas (ETH, BNB...) no tiene
 * respaldo y se queda como estuviera.
 */
function respaldo(precioPoolUsd, razones) {
  const kda = desdeDolar(precioPoolUsd, razones, 'pool');
  if (!kda) return {};
  const m = { kadena: kda };
  for (const id of ['usd-coin', 'tether', 'dai']) m[id] = desdeDolar(1, razones, 'fijo');
  return m;
}

module.exports = { FIATS, razonesDe, razonesVigentes, desdeDolar, respaldo };
