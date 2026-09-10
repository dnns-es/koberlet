// Test de como loadConfig() decide QUE NODO usa cada cosa. Sin red: se arranca main.js
// con un electron de mentira y se le pregunta por IPC, que es como se lo pregunta la app.
// Recoge lo aprendido el 2026-09-09, cuando el nodo de fabrica se cayo:
//
//   1. EL NODO SE GUARDA EN config.json Y LO GUARDADO MANDA. Por eso cambiar el nodo de
//      fabrica no arreglo a nadie que ya hubiera abierto Koberlet: seguian con el suyo,
//      que era el roto. Hace falta soltarlo a mano, y solo el que este inservible.
//   2. EL PUENTE TIENE QUE USAR EL MISMO NODO QUE LA RED ETHEREUM. Antes lo tenia clavado
//      en el codigo: cambiarlo en Ajustes arreglaba saldos y cambios, pero el puente
//      seguia yendo al nodo roto y no habia forma de arreglarlo sin recompilar.
//   3. Y NADA DE ESTO PUEDE ROMPER LA AUDITORIA (Alex #4): del usuario solo se acepta un
//      rpc https; las rutas, tokens y routers del puente salen siempre del codigo.
//
//   node test/config-nodo.test.js
const Module = require('module');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DATOS = fs.mkdtempSync(path.join(os.tmpdir(), 'koberlet-test-'));
const CFG = path.join(DATOS, 'config.json');

// --- electron de mentira: ni ventanas ni disco de verdad -------------------------
const manejadores = {};
const cualquiera = () => new Proxy({}, { get: (t, k) => (typeof k === 'string' ? (t[k] || (t[k] = () => {})) : undefined) });
const app = Object.assign(cualquiera(), {
  getPath: (k) => (k === 'exe' ? path.join(DATOS, 'Koberlet') : DATOS),
  whenReady: () => new Promise(() => {}),   // nunca resuelve: no se abre nada
  on: () => {}, requestSingleInstanceLock: () => true, setAppUserModelId: () => {},
  isPackaged: false, getVersion: () => '0.0.0', getName: () => 'Koberlet', setName: () => {},
});
const falso = {
  app, BrowserWindow: class { static getAllWindows() { return []; } },
  ipcMain: { handle: (c, f) => { manejadores[c] = f; }, on: () => {}, removeHandler: () => {} },
  shell: cualquiera(), dialog: cualquiera(), session: cualquiera(), Tray: class {},
  Menu: { setApplicationMenu: () => {}, buildFromTemplate: () => ({}) },
  nativeImage: { createFromPath: () => ({ isEmpty: () => true, resize: () => ({}) }), createEmpty: () => ({}) },
};
const cargar = Module._load;
Module._load = function (pedido) { return pedido === 'electron' ? falso : cargar.apply(this, arguments); };
require('../main.js');

let fallos = 0, casos = 0;
function comprueba(nombre, dio, esperado) {
  casos++;
  if (dio !== esperado) { fallos++; console.log('FALLA  ' + nombre + ': esperaba ' + esperado + ' y dio ' + dio); }
}
const guarda = (cfg) => fs.writeFileSync(CFG, JSON.stringify(cfg));
const borra = () => { try { fs.unlinkSync(CFG); } catch (_) {} };
const red = (c, k) => c.evm.find(n => n.key === k).rpc;
// El nodo que dejo de servir bloques por numero. Se escribe aqui a proposito: si algun dia
// vuelve a ser el de fabrica, este test lo canta.
const ROTO = 'https://ethereum-rpc.publicnode.com';

(async () => {
  // --- 1. De fabrica ------------------------------------------------------------
  borra();
  let cfg = await manejadores['config:get']();
  let puente = await manejadores['bridge:config']();
  comprueba('el nodo de fabrica NO es el que se cayo', red(cfg, 'eth') === ROTO, false);
  comprueba('el puente arranca con el mismo nodo que la red Ethereum', puente.evm.rpc, red(cfg, 'eth'));

  // --- 2. Lo que ponga el usuario en Ajustes manda, y llega al puente ------------
  guarda({ evm: [{ key: 'eth', enabled: true, rpc: 'https://nodo-del-usuario.example' }] });
  cfg = await manejadores['config:get']();
  puente = await manejadores['bridge:config']();
  comprueba('la red Ethereum usa el nodo del usuario', red(cfg, 'eth'), 'https://nodo-del-usuario.example');
  comprueba('y el PUENTE tambien (antes iba por su cuenta)', puente.evm.rpc, 'https://nodo-del-usuario.example');

  // --- 3. El nodo inservible guardado se suelta ----------------------------------
  guarda({ evm: [{ key: 'eth', enabled: true, rpc: ROTO }, { key: 'pol', enabled: false, rpc: 'https://polygon-bor-rpc.publicnode.com' }] });
  cfg = await manejadores['config:get']();
  puente = await manejadores['bridge:config']();
  comprueba('el nodo roto guardado se descarta', red(cfg, 'eth') === ROTO, false);
  comprueba('  ...y el puente tampoco se queda con el', puente.evm.rpc === ROTO, false);
  // Solo se suelta el de Ethereum: los demas de publicnode siguen sirviendo bloques.
  comprueba('  ...pero a Polygon no se le toca', red(cfg, 'pol'), 'https://polygon-bor-rpc.publicnode.com');

  // --- 4. Un nodo elegido a proposito NO se pisa ---------------------------------
  // La lista es de nodos INSERVIBLES. Quitarle a alguien un nodo que funciona es intrusivo,
  // y es justo lo que se corrigio al sacar drpc de la lista cuando el tope de grupo lo arreglo.
  guarda({ evm: [{ key: 'eth', enabled: true, rpc: 'https://eth.drpc.org' }] });
  cfg = await manejadores['config:get']();
  comprueba('un nodo que funciona se respeta aunque diera guerra antes', red(cfg, 'eth'), 'https://eth.drpc.org');

  // --- 5. La auditoria Alex #4 sigue en pie -------------------------------------
  guarda({ evm: [{ key: 'eth', enabled: true, rpc: 'http://nodo-hostil.example' }] });
  cfg = await manejadores['config:get']();
  puente = await manejadores['bridge:config']();
  comprueba('un nodo http:// se rechaza', red(cfg, 'eth').startsWith('https://'), true);
  comprueba('  ...y no se cuela por el puente', puente.evm.rpc.startsWith('https://'), true);

  // El renderer no puede inyectar rutas ni contratos: el puente es fijo del codigo.
  guarda({ bridge: { routes: [{ symbol: 'FALSO', evmToken: '0x' + '9'.repeat(40), evmRouter: '0x' + '9'.repeat(40), decimals: 18 }], evm: { rpc: 'https://malo.example' } } });
  puente = await manejadores['bridge:config']();
  comprueba('las rutas del puente salen del codigo, no de la config', puente.routes.map(r => r.symbol).join(','), 'USDC,USDT,DAI,WBTC');
  comprueba('  ...y el nodo del puente tampoco viene de ahi', puente.evm.rpc === 'https://malo.example', false);

  // --- 6. Y la config del usuario no envenena los valores de fabrica -------------
  guarda({ evm: [{ key: 'eth', enabled: true, rpc: 'https://otro.example' }] });
  await manejadores['config:get']();
  borra();
  cfg = await manejadores['config:get']();
  comprueba('sin config se vuelve al nodo de fabrica, no al ultimo visto', red(cfg, 'eth') === 'https://otro.example', false);

  fs.rmSync(DATOS, { recursive: true, force: true });
  console.log(fallos === 0 ? 'OK: ' + casos + ' casos, 0 fallos' : 'HAY ' + fallos + ' FALLOS');
  process.exit(fallos === 0 ? 0 : 1);
})();
