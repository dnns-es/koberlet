// Cuentas OBSERVADAS: direcciones que se miran sin abrir la bóveda.
//
// Para qué sirve: quien tiene el dinero en frío o en un Ledger hoy tiene que enchufar
// el aparato solo para ver un saldo. Eso es exponerlo para nada. Aquí pega la dirección
// y mira; para operar, ya entrará con su contraseña.
//
// Van en su propio fichero, NO en la bóveda, y a propósito: la bóveda está cifrada y
// cerrada justo cuando hace falta leer esto. Son direcciones públicas —cualquiera con
// un nodo las consulta— así que no se cifran. Lo único que revela el fichero es QUÉ
// cuentas te interesan, y eso a quien ya tiene acceso a tu equipo.
//
// Aquí NO hay ninguna clave. Ni la habrá: es la parte del monedero que, por
// construcción, no puede firmar nada.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX = 50;                       // tope sano: cada una son varias lecturas a la cadena
const ETIQUETA_MAX = 40;

function fichero(dirDatos) { return path.join(dirDatos, 'observadas.json'); }

function leer(dirDatos) {
  try {
    const t = fs.readFileSync(fichero(dirDatos), 'utf8');
    const j = JSON.parse(t);
    return Array.isArray(j) ? j.filter(esValida) : [];
  } catch (_) { return []; }
}

function esValida(o) {
  return o && typeof o.id === 'string' && typeof o.direccion === 'string'
    && (o.red === 'kda' || o.red === 'evm');
}

function guardar(dirDatos, lista) {
  const tmp = fichero(dirDatos) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(lista, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, fichero(dirDatos));   // atómico: nadie lee un fichero a medias
  return lista;
}

/**
 * Añade una cuenta. `validar` lo pone quien llama (main.js) para no duplicar aquí las
 * reglas de cada cadena: el validador de Kadena vive en lib/kda.js y ya está contrastado
 * contra el contrato coin.
 */
function anadir(dirDatos, { red, direccion, etiqueta }, validar) {
  const d = String(direccion || '').trim();
  if (!d) throw new Error('Falta la dirección.');
  if (red !== 'kda' && red !== 'evm') throw new Error('Red no válida.');
  if (typeof validar === 'function' && !validar(red, d)) {
    throw new Error(red === 'kda'
      ? 'Esa cuenta de Kadena no es válida.'
      : 'Esa dirección de Ethereum no es válida.');
  }
  const lista = leer(dirDatos);
  if (lista.length >= MAX) throw new Error('No caben más de ' + MAX + ' cuentas observadas.');
  if (lista.some((x) => x.red === red && x.direccion.toLowerCase() === d.toLowerCase())) {
    throw new Error('Esa cuenta ya está en la lista.');
  }
  lista.push({
    id: crypto.randomUUID(),
    red,
    direccion: d,
    etiqueta: String(etiqueta || '').trim().slice(0, ETIQUETA_MAX) || null,
    anadida: new Date().toISOString()
  });
  return guardar(dirDatos, lista);
}

function quitar(dirDatos, id) {
  return guardar(dirDatos, leer(dirDatos).filter((x) => x.id !== id));
}

function renombrar(dirDatos, id, etiqueta) {
  const lista = leer(dirDatos);
  const o = lista.find((x) => x.id === id);
  if (!o) throw new Error('Esa cuenta no está en la lista.');
  o.etiqueta = String(etiqueta || '').trim().slice(0, ETIQUETA_MAX) || null;
  return guardar(dirDatos, lista);
}

module.exports = { leer, anadir, quitar, renombrar, MAX };
