// Koberlet - Copyright 2026 DNNS.es (Oberluss)
// SPDX-License-Identifier: Apache-2.0

// ENLACE koberlet://wc?uri=<wc:...> (issue #7 de Alex, 22/10/2026).
//
// Una web pone un boton «Abrir en Koberlet» y la app se abre con la conexion YA PEGADA
// en Ajustes. Solo eso: no conecta ni aprueba nada. La propuesta se sigue enseñando y
// aprobando a mano, y cada firma pide la contraseña.
//
// Se admite el `uri` codificado (lo normal, `wc%3A...`) y sin codificar. Lo que no sea un
// enlace wc: de WalletConnect v2 bien formado se ignora sin decir nada.

function wcDeEnlace(arg) {
  const s = String(arg || '');
  if (!/^koberlet:\/\/wc\/?\?/i.test(s) || s.length > 4096) return null;
  const i = s.indexOf('uri=');
  if (i < 0) return null;
  let uri = s.slice(i + 4);
  try { if (/^wc%3a/i.test(uri)) uri = decodeURIComponent(uri.split('&')[0]); } catch (_) { return null; }
  return /^wc:[0-9a-f]{64}@2\?[^\s"'<>\\`]+$/i.test(uri) ? uri : null;
}

module.exports = { wcDeEnlace };
