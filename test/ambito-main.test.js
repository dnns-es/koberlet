// Guardia contra variables sueltas en main.js. Sin red, sin Electron: lee el fichero como texto.
//
// Viene de la regresion de la 2.8.3 (09-09-2026, descubierta el 13-09): cuatro manejadores
// del puente llamaban `rpcEvmPuente(c)` con una `c` que no existia en su ambito. node -c no
// lo ve (es un error de ejecucion), los tests de las libs tampoco (main.js no se carga fuera
// de Electron), y el renderer se lo tragaba: la lista de tokens se quedo en "cargando
// saldos…" y todo el sentido Ethereum→Kadena estuvo muerto cuatro dias sin que nadie lo viera.
//
// Aqui se comprueba, para cada manejador `ipcMain.handle(...)`, que las variables de una
// letra que usa (c, w, b, n) esten declaradas dentro de ese mismo manejador o arriba del
// todo. No es un analizador completo: es el cinturon para la forma concreta en que se cayo.
//
//   node test/ambito-main.test.js
const fs = require('fs');
const path = require('path');

// Se le puede pasar otro fichero para comprobar que SI pilla una version rota:
//   node test/ambito-main.test.js /ruta/main-viejo.js
const src = fs.readFileSync(process.argv[2] || path.join(__dirname, '..', 'main.js'), 'utf8');
let fallos = 0, casos = 0;
function comprueba(nombre, ok, detalle) {
  casos++;
  if (!ok) { fallos++; console.log('FALLA  ' + nombre + (detalle ? ': ' + detalle : '')); }
}

// Declaradas a nivel de modulo (columna 0): valen en cualquier manejador.
const globales = new Set();
for (const m of src.matchAll(/^(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)/gm)) globales.add(m[1]);

// Cada manejador: sus parametros (lo que hay entre el nombre y la flecha) y su cuerpo. Si tras
// la flecha viene una llave, el cuerpo va hasta la llave que la cierra (contando llaves); si no,
// es un manejador de una expresion y el cuerpo es el resto de la linea. OJO: la primera llave
// tras `handle(` puede ser un parametro desestructurado `{ walletId }`, no el cuerpo; por eso
// se busca la flecha primero. (La primera version de este test tropezo justo ahi.)
function cuerpos() {
  const out = [];
  const re = /ipcMain\.handle\('([^']+)'/g;
  let m;
  while ((m = re.exec(src))) {
    const flecha = src.indexOf('=>', m.index); if (flecha < 0) break;
    const params = src.slice(m.index + m[0].length, flecha);
    let k = flecha + 2; while (/\s/.test(src[k])) k++;
    let cuerpo;
    if (src[k] === '{') {
      let prof = 0, j = k;
      for (; j < src.length; j++) {
        const ch = src[j];
        if (ch === '{') prof++;
        else if (ch === '}') { prof--; if (prof === 0) break; }
      }
      cuerpo = src.slice(k, j + 1);
    } else {
      cuerpo = src.slice(k, src.indexOf('\n', k));
    }
    out.push({ nombre: m[1], params, cuerpo });
  }
  return out;
}

const VARS = ['c', 'w', 'b', 'n'];
const handlers = cuerpos();
comprueba('hay manejadores que revisar', handlers.length > 50, String(handlers.length));

for (const h of handlers) {
  // quitar strings y comentarios de forma tosca para no confundir una `c` de un texto
  const limpio = h.cuerpo.replace(/'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"/g, '""').replace(/\/\/.*$/gm, '');
  for (const v of VARS) {
    // se usa como argumento o propiedad: `(v)`, `(v,`, `, v)`, `v.`
    const usa = new RegExp('(?:\\(|,\\s*)' + v + '(?:\\)|,|\\.)|\\b' + v + '\\.').test(limpio);
    if (!usa) continue;
    // declarada dentro: const/let v, parametro { v } o (v) de una arrow, for (const v of
    const declarada = new RegExp('(?:const|let|var)\\s+(?:\\{[^}]*\\b' + v + '\\b[^}]*\\}|' + v + '\\b)|\\(\\s*' + v + '\\s*\\)\\s*=>|\\b' + v + '\\s*=>|\\(\\s*[^)]*\\b' + v + '\\b[^)]*\\)\\s*=>|function\\s*\\([^)]*\\b' + v + '\\b').test(limpio);
    const enParams = new RegExp('\\b' + v + '\\b').test(h.params);
    comprueba(`'${v}' declarada en ${h.nombre}`, declarada || enParams || globales.has(v), 'se usa sin declarar en ese manejador');
  }
}

// Y la forma concreta del tropiezo, por si el analisis de arriba se relaja algun dia:
comprueba('rpcEvmPuente nunca se llama con una c suelta', !/rpcEvmPuente\(c\)/.test(src));

console.log((fallos ? 'FALLOS: ' + fallos : 'OK') + ' (' + casos + ' comprobaciones)');
process.exit(fallos ? 1 : 0);
