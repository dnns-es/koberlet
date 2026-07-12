// Proceso principal. Las privadas viven SOLO aquí (nunca en el renderer). Se firma y se exporta aquí.
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const vault = require('./lib/vault');
const kda = require('./lib/kda');
const eth = require('./lib/eth');
const wallets = require('./lib/wallets');
const bridge = require('./lib/bridge');
const swap = require('./lib/swap');
const QRCode = require('qrcode');

// Modo PORTABLE: la bóveda va JUNTO al ejecutable (M.2/USB), no en AppData.
const _exeDir = path.dirname(app.getPath('exe'));
const _portDir = process.env.PORTABLE_EXECUTABLE_DIR
  || (fs.existsSync(path.join(_exeDir, 'portable.flag')) ? _exeDir : null);
if (_portDir) app.setPath('userData', path.join(_portDir, 'MonederoDNNS-datos'));

const VAULT = () => path.join(app.getPath('userData'), 'vault.json');
const CONFIG = () => path.join(app.getPath('userData'), 'config.json');
const HISTORY = () => path.join(app.getPath('userData'), 'history.json');

// Historial local de operaciones (el indexador del fork está caído; lo llevamos nosotros). No es secreto → fichero plano.
const loadHistory = () => { try { return JSON.parse(fs.readFileSync(HISTORY(), 'utf8')); } catch (_) { return []; } };
function logHistory(e) { try { const h = loadHistory(); h.unshift({ ts: Date.now(), ...e }); fs.writeFileSync(HISTORY(), JSON.stringify(h.slice(0, 300), null, 2)); } catch (_) {} }

const DEFAULT_CONFIG = {
  // Redes Kadena: la OFICIAL (donde están los fondos reales de la mayoría) y el FORK comunitario. Se activan como las EVM.
  kda: {
    networks: [
      { key: 'mainnet', name: 'Kadena', node: 'https://api.chainweb.com', networkId: 'mainnet01', color: '#a855f7', enabled: true, fork: false },
      { key: 'fork', name: 'Kadena Fork', node: 'https://api.chainweb-community.org', networkId: 'mainnet01', color: '#63e038', enabled: true, fork: true }
    ],
    chains: Array.from({ length: 20 }, (_, i) => i)
  },
  // Redes EVM (la MISMA dirección 0x vale en todas). cg = id CoinGecko del nativo. enabled = mostrar por defecto.
  evm: [
    { key: 'eth', name: 'Ethereum', enabled: true, rpc: 'https://ethereum-rpc.publicnode.com', symbol: 'ETH', cg: 'ethereum', color: '#627eea',
      tokens: [{ symbol: 'USDC', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', cg: 'usd-coin' }, { symbol: 'USDT', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', cg: 'tether' }] },
    { key: 'arb', name: 'Arbitrum', enabled: false, rpc: 'https://arbitrum-one-rpc.publicnode.com', symbol: 'ETH', cg: 'ethereum', color: '#28a0f0',
      tokens: [{ symbol: 'USDC', address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', cg: 'usd-coin' }, { symbol: 'USDT', address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', cg: 'tether' }] },
    { key: 'base', name: 'Base', enabled: false, rpc: 'https://base-rpc.publicnode.com', symbol: 'ETH', cg: 'ethereum', color: '#0052ff',
      tokens: [{ symbol: 'USDC', address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', cg: 'usd-coin' }] },
    { key: 'bnb', name: 'BNB Chain', enabled: false, rpc: 'https://bsc-rpc.publicnode.com', symbol: 'BNB', cg: 'binancecoin', color: '#f0b90b',
      tokens: [{ symbol: 'USDT', address: '0x55d398326f99059fF775485246999027B3197955', cg: 'tether' }, { symbol: 'USDC', address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', cg: 'usd-coin' }] },
    { key: 'pol', name: 'Polygon', enabled: false, rpc: 'https://polygon-bor-rpc.publicnode.com', symbol: 'POL', cg: 'polygon-ecosystem-token', color: '#8247e5',
      tokens: [{ symbol: 'USDC', address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', cg: 'usd-coin' }, { symbol: 'USDT', address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', cg: 'tether' }] }
  ],
  // Puente Kinesis (fork). Solo simulación por ahora. Dos orillas: Kadena (dominio 626) y Ethereum (1).
  bridge: {
    kda: { node: 'https://api.chainweb-community.org', networkId: 'mainnet01', chain: 2, domain: 626 },
    evm: { rpc: 'https://ethereum-rpc.publicnode.com', name: 'Ethereum', domain: 1 },
    routes: [
      { symbol: 'USDC', cg: 'usd-coin', kadenaModule: 'kb-USDC', evmRouter: '0x81C2813aa88F66bca1e55838045Aaceb72FEbFc1', evmToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
      { symbol: 'USDT', cg: 'tether', kadenaModule: 'kb-USDT', evmRouter: '0x9cFdB123ce10CFBe276393D4B666aEBBe766AD8F', evmToken: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
      { symbol: 'DAI', cg: 'dai', kadenaModule: 'kb-DAI', evmRouter: '0x85cC60531119041b250003e25fE0c5920606C6db', evmToken: '0x6B175474E89094C44Da98b954EedeAC495271d0F', decimals: 18 },
      { symbol: 'WBTC', cg: 'wrapped-bitcoin', kadenaModule: 'kb-WBTC', evmRouter: '0xdFdB8f3DEB5458bfA25CC97dF41298a915a34bF3', evmToken: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', decimals: 8 }
    ]
  }
};

// unlocked = { pass, data:{ wallets:[{id,label,kind,net,kda,eth}], active } }  SOLO en memoria del main
let unlocked = null;

const loadConfig = () => {
  let c;
  try { c = { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG(), 'utf8')) }; } catch (_) { c = { ...DEFAULT_CONFIG }; }
  // Normaliza las redes Kadena al formato lista (Oficial + Fork), preservando qué tenía activado el usuario.
  const savedNets = (c.kda && Array.isArray(c.kda.networks)) ? c.kda.networks : null;
  c.kda = {
    chains: (c.kda && c.kda.chains) || DEFAULT_CONFIG.kda.chains,
    networks: DEFAULT_CONFIG.kda.networks.map(n => { const s = savedNets ? savedNets.find(x => x.key === n.key) : null; return { ...n, enabled: s ? !!s.enabled : n.enabled }; })
  };
  c.bridge = DEFAULT_CONFIG.bridge; // el puente (rutas/tokens/cg) es fijo del fork; una config guardada vieja podía quedarse sin `cg` → precios kb-* a 0
  c.updateMode = (c.updateMode === 'auto') ? 'auto' : 'manual'; // manual por defecto: avisar y que el usuario decida
  delete c.importPath; // línea muerta de la versión que importaba TeamRed.json desde F: — la bóveda es autocontenida
  return c;
};
const saveConfig = (c) => fs.writeFileSync(CONFIG(), JSON.stringify(c, null, 2));
const saveVault = () => vault.crear(VAULT(), unlocked.pass, unlocked.data);
function backupVault() {
  const p = VAULT(); if (!fs.existsSync(p)) return;
  const d = new Date(); const ts = d.toISOString().replace(/[:T]/g, '-').slice(0, 19);
  fs.copyFileSync(p, path.join(app.getPath('userData'), 'vault-' + ts + '.bak.json'));
}

// Normaliza el formato antiguo a "una wallet = una red". Un perfil con KDA+EVM se DIVIDE en dos wallets.
function migrate(data) {
  let changed = false, wallets = [], active = null;
  const push = (w) => wallets.push(w);
  if (data && data.wallets) {
    for (const w of data.wallets) {
      if (w.kind) { push(w); continue; }             // ya normalizado
      changed = true;
      const hasK = !!w.kda, hasE = !!w.eth;
      if (hasK && hasE) {
        const idK = crypto.randomUUID(), idE = crypto.randomUUID();
        push({ id: idK, label: w.label + ' KDA', kind: 'kda', kda: w.kda, eth: null });
        push({ id: idE, label: w.label + ' EVM', kind: 'evm', net: 'eth', kda: null, eth: w.eth });
        if (data.active === w.id) active = idK;
      } else if (hasK) {
        push({ id: w.id, label: w.label, kind: 'kda', kda: w.kda, eth: null });
        if (data.active === w.id) active = w.id;
      } else {
        push({ id: w.id, label: w.label, kind: 'evm', net: 'eth', kda: null, eth: w.eth });
        if (data.active === w.id) active = w.id;
      }
    }
  } else if (data && (data.kda || data.eth)) {         // formato antiquísimo {kda,eth}
    changed = true;
    if (data.kda) push({ id: crypto.randomUUID(), label: 'Wallet KDA', kind: 'kda', kda: data.kda, eth: null });
    if (data.eth) push({ id: crypto.randomUUID(), label: 'Wallet EVM', kind: 'evm', net: 'eth', kda: null, eth: data.eth });
  }
  if (!wallets.length) throw new Error('Bóveda vacía o corrupta.');
  if (!active || !wallets.some(w => w.id === active)) active = (data && data.active && wallets.some(w => w.id === data.active)) ? data.active : wallets[0].id;
  // shown = conjunto de wallets visibles en el dashboard (varias a la vez). Por defecto: todas.
  const prevShown = Array.isArray(data && data.shown) ? data.shown.filter(id => wallets.some(w => w.id === id)) : null;
  const shown = (prevShown && prevShown.length) ? prevShown : wallets.map(w => w.id);
  return { data: { wallets, active, shown }, changed };
}
const active = () => unlocked.data.wallets.find(w => w.id === unlocked.data.active) || unlocked.data.wallets[0];
const shownIds = () => (unlocked.data.shown && unlocked.data.shown.length) ? unlocked.data.shown : unlocked.data.wallets.map(w => w.id);
const shownWallets = () => shownIds().map(id => unlocked.data.wallets.find(w => w.id === id)).filter(Boolean);
const evmNetName = (key) => { const n = loadConfig().evm.find(x => x.key === key); return n ? n.name : 'EVM'; };
function enableEvmNet(key) { if (!key) return; const c = loadConfig(); const n = c.evm.find(x => x.key === key); if (n && !n.enabled) { n.enabled = true; saveConfig(c); } }

// Precios USD (CoinGecko, caché 60s). Devuelve mapa { <coingeckoId>: usd }.
let _priceCache = { at: 0, data: {} };
async function getPrices() {
  if (Date.now() - _priceCache.at < 60000 && Object.keys(_priceCache.data).length) return _priceCache.data;
  const ids = 'kadena,ethereum,binancecoin,polygon-ecosystem-token,usd-coin,tether,dai,wrapped-bitcoin';
  try {
    const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=' + ids + '&vs_currencies=usd');
    const j = await r.json();
    const m = {}; for (const k of Object.keys(j)) m[k] = j[k].usd;
    _priceCache = { at: Date.now(), data: m };
  } catch (_) { /* sin red: mantiene la última */ }
  return _priceCache.data;
}

function view() {
  if (!unlocked) return null;
  const shown = new Set(shownIds());
  return {
    wallets: unlocked.data.wallets.map(x => ({ id: x.id, label: x.label, kind: x.kind, net: x.net || null, netName: x.kind === 'evm' ? evmNetName(x.net || 'eth') : 'Kadena', shown: shown.has(x.id), hasKda: !!x.kda, hasEth: !!x.eth, kdaAccount: x.kda ? x.kda.account : null, ethAddress: x.eth ? x.eth.address : null })),
    shown: shownIds().slice()
  };
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1000, height: 760, minWidth: 860,
    icon: path.join(__dirname, 'renderer', 'icon.ico'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}
// Instancia ÚNICA: si ya hay una abierta, la nueva enfoca la existente y se cierra (evita ventanas duplicadas).
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { const w = BrowserWindow.getAllWindows()[0]; if (w) { if (w.isMinimized()) w.restore(); w.focus(); } });
  app.whenReady().then(() => {
    createWindow(); ensureDesktopShortcut();
    // limpiar restos de una actualización anterior (el bat no siempre puede borrar su propia carpeta)
    try { fs.rmSync(path.join(path.dirname(app.getPath('exe')), '_update'), { recursive: true, force: true }); } catch (_) {}
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
}
app.on('window-all-closed', () => { unlocked = null; if (process.platform !== 'darwin') app.quit(); });

// Acceso directo en el escritorio (Windows). Se crea UNA vez (marcador en userData);
// si el usuario lo borra a propósito, no se le vuelve a crear.
function ensureDesktopShortcut() {
  try {
    if (process.platform !== 'win32') return;
    // MARK versiona el acceso directo: al subirla, el siguiente arranque lo crea/actualiza una vez
    // (p.ej. v2-icon aplicó el icono propio a accesos ya creados). Si el usuario lo borra después, no se recrea.
    const MARK = 'v2-icon';
    const marker = path.join(app.getPath('userData'), 'shortcut.flag');
    if (fs.existsSync(marker) && fs.readFileSync(marker, 'utf8').trim() === MARK) return;
    const lnk = path.join(app.getPath('desktop'), 'Koberlet.lnk');
    shell.writeShortcutLink(lnk, fs.existsSync(lnk) ? 'update' : 'create', {
      target: app.getPath('exe'), cwd: _exeDir,
      icon: path.join(__dirname, 'renderer', 'icon.ico'), iconIndex: 0,
      description: 'Koberlet — monedero multi-cadena (Kadena + EVM)'
    });
    fs.mkdirSync(path.dirname(marker), { recursive: true });
    fs.writeFileSync(marker, MARK);
  } catch (_) { /* sin escritorio o sin permisos: no es crítico */ }
}

// ---- IPC ----
ipcMain.handle('vault:status', () => ({ exists: vault.existe(VAULT()), unlocked: !!unlocked, config: loadConfig() }));

ipcMain.handle('vault:setup', async (_e, { passphrase, kind, net }) => {
  const { mnemonic, kda: k, eth: e } = await wallets.createNew(kind);
  const id = crypto.randomUUID();
  const w = { id, label: kind === 'kda' ? 'Mi wallet KDA' : 'Mi wallet ' + evmNetName(net || 'eth'), kind, kda: k, eth: e };
  if (kind === 'evm') w.net = net || 'eth';
  vault.crear(VAULT(), passphrase, { wallets: [w], active: id, shown: [id] });
  if (kind === 'evm') enableEvmNet(net || 'eth');
  return { ok: true, mnemonic };
});

ipcMain.handle('vault:unlock', (_e, { passphrase }) => {
  const { data, changed } = migrate(vault.abrir(VAULT(), passphrase)); // lanza si passphrase mala
  unlocked = { pass: passphrase, data };
  if (changed) { try { backupVault(); } catch (_) {} saveVault(); } // persiste el formato normalizado (una wallet = una red)
  return { ok: true, view: view() };
});
ipcMain.handle('vault:lock', () => { unlocked = null; return { ok: true }; });

// Multi-wallet
ipcMain.handle('wallet:list', () => view());
// Marca/desmarca una wallet como visible en el dashboard (pueden ser varias a la vez).
ipcMain.handle('wallet:shown', (_e, { id, shown }) => {
  const set = new Set(shownIds());
  if (shown) set.add(id); else set.delete(id);
  if (!set.size) set.add(id); // no dejar el dashboard vacío del todo
  unlocked.data.shown = unlocked.data.wallets.filter(w => set.has(w.id)).map(w => w.id);
  saveVault(); return view();
});
ipcMain.handle('wallet:rename', (_e, { id, label }) => {
  const w = unlocked.data.wallets.find(x => x.id === id);
  if (!w) throw new Error('Wallet no encontrada.');
  const l = String(label || '').trim();
  if (l) { w.label = l; saveVault(); }
  return view();
});
ipcMain.handle('wallet:remove', (_e, { id }) => {
  if (unlocked.data.wallets.length <= 1) throw new Error('No puedes borrar la última wallet.');
  unlocked.data.wallets = unlocked.data.wallets.filter(w => w.id !== id);
  unlocked.data.shown = (unlocked.data.shown || []).filter(x => x !== id);
  if (!unlocked.data.shown.length) unlocked.data.shown = [unlocked.data.wallets[0].id];
  if (unlocked.data.active === id) unlocked.data.active = unlocked.data.wallets[0].id;
  saveVault(); return view();
});
const addShown = (id) => { const s = new Set(shownIds()); s.add(id); unlocked.data.shown = unlocked.data.wallets.filter(w => s.has(w.id)).map(w => w.id); };
ipcMain.handle('wallet:create', async (_e, { label, kind, net }) => {
  const { mnemonic, kda: k, eth: e } = await wallets.createNew(kind);
  const id = crypto.randomUUID();
  const w = { id, label: label || (kind === 'kda' ? 'Nueva KDA' : 'Nueva ' + evmNetName(net || 'eth')), kind, kda: k, eth: e };
  if (kind === 'evm') { w.net = net || 'eth'; enableEvmNet(w.net); }
  unlocked.data.wallets.push(w); addShown(id);
  unlocked.data.active = id; saveVault();
  return { view: view(), mnemonic }; // la semilla se muestra UNA vez para que la anote
});
ipcMain.handle('wallet:import-mnemonic', async (_e, { label, mnemonic, kind, net, index, method }) => {
  const { kda: k, eth: e } = await wallets.deriveAt(mnemonic, index || 0, method || 'chainweaver');
  const id = crypto.randomUUID();
  const w = { id, label: label || 'Importada', kind: kind || 'kda', kda: kind === 'evm' ? null : k, eth: kind === 'evm' ? e : null };
  if (kind === 'evm') { w.net = net || 'eth'; enableEvmNet(w.net); }
  unlocked.data.wallets.push(w); addShown(id); unlocked.data.active = id; saveVault(); return view();
});
// Busca una cuenta CONCRETA dentro de la semilla: prueba índices 0..max en ambos métodos y devuelve el que la genera (sin consultar saldo, rápido).
ipcMain.handle('seed:find', async (_e, { mnemonic, kind, net, target, maxIndex }) => {
  if (!unlocked) throw new Error('bloqueado');
  const tgt = String(target || '').trim().toLowerCase();
  if (!tgt) throw new Error('Indica la cuenta a buscar.');
  const max = Math.min(Math.max(maxIndex || 30, 1), 100);
  const methods = kind === 'evm' ? ['evm'] : ['chainweaver', ...wallets.SLIP_METHODS];
  for (let i = 0; i < max; i++) {
    for (const m of methods) {
      const id = kind === 'evm' ? wallets.deriveEth(mnemonic, i).address : (await wallets.deriveKda(mnemonic, i, m)).account;
      if (id.toLowerCase() === tgt) return { found: true, index: i, method: m, id };
    }
  }
  return { found: false, scanned: max };
});
// Escáner de cuentas de una semilla. Para KDA prueba AMBOS métodos (Chainweaver y eckoWallet); devuelve cada cuenta con su saldo.
ipcMain.handle('seed:accounts', async (_e, { mnemonic, kind, net, start, count }) => {
  if (!unlocked) throw new Error('bloqueado');
  const c = loadConfig(); const s = Math.max(0, start | 0); const n = Math.min(Math.max(count || 5, 1), 10);
  const idxs = Array.from({ length: n }, (_, k) => s + k);
  if (kind === 'evm') {
    const nd = c.evm.find(x => x.key === (net || 'eth')) || c.evm[0];
    return Promise.all(idxs.map(async (i) => {
      const e = wallets.deriveEth(mnemonic, i);
      let amount = 0;
      try { const b = await eth.getBalances(e.address, { rpc: nd.rpc, tokens: nd.tokens }); amount = b.native + b.tokens.reduce((sm, t) => sm + t.amount, 0); } catch (_) {}
      return { index: i, method: 'evm', id: e.address, amount, unit: nd.symbol };
    }));
  }
  const nets = c.kda.networks.filter(x => x.enabled);
  const jobs = [];
  for (const i of idxs) for (const m of ['chainweaver', 'ecko']) jobs.push({ i, m });
  return Promise.all(jobs.map(async ({ i, m }) => {
    const k = await wallets.deriveKda(mnemonic, i, m);
    let amount = 0;
    await Promise.all(nets.map(async (nd) => { try { const r = await kda.getBalance(k.account, { node: nd.node, networkId: nd.networkId, chains: c.kda.chains }); amount += r.total; } catch (_) {} }));
    return { index: i, method: m, id: k.account, amount, unit: 'KDA' };
  }));
});
ipcMain.handle('wallet:import-privkey', (_e, { label, kind, net, priv }) => {
  const w = { id: crypto.randomUUID(), label: label || 'Importada', kda: null, eth: null };
  if (kind === 'kda') { w.kind = 'kda'; w.kda = wallets.kdaFromPriv(priv); }
  else if (kind === 'evm') { w.kind = 'evm'; w.eth = wallets.ethFromPriv(priv); w.net = net || 'eth'; enableEvmNet(w.net); }
  else throw new Error('Cadena no válida.');
  unlocked.data.wallets.push(w); addShown(w.id); unlocked.data.active = w.id; saveVault(); return view();
});

// Exportar privada: EXIGE reintroducir la contraseña de la bóveda
ipcMain.handle('wallet:export', (_e, { passphrase, walletId, chain }) => {
  if (!unlocked) throw new Error('bloqueado');
  if (passphrase !== unlocked.pass) throw new Error('Contraseña incorrecta.');
  const w = unlocked.data.wallets.find(x => x.id === walletId) || active();
  const acc = w[chain];
  if (!acc) throw new Error('Esta wallet no tiene cuenta ' + chain.toUpperCase() + '.');
  return { chain, secret: acc.secret, public: acc.public, id: chain === 'kda' ? acc.account : acc.address };
});

// Dashboard: un BLOQUE (tarjeta) por cada red de cada wallet visible. Varias wallets a la vez.
ipcMain.handle('balances', async () => {
  if (!unlocked) throw new Error('bloqueado');
  const c = loadConfig();
  const prices = await getPrices();
  const px = (id) => prices[id] || 0;
  const blocks = []; let total = 0;
  for (const w of shownWallets()) {
    if (w.kind === 'kda' && w.kda) {
      for (const net of c.kda.networks.filter(n => n.enabled)) {
        try {
          const k = await kda.getBalance(w.kda.account, { node: net.node, networkId: net.networkId, chains: c.kda.chains });
          let tokens = [];
          if (net.fork) { // el fork tiene los tokens del puente (kb-*) en chain 2
            const kbs = await bridge.getKadenaBalances({ node: net.node, networkId: net.networkId, chain: c.bridge.kda.chain, routes: c.bridge.routes, account: w.kda.account });
            tokens = kbs.filter(t => t.balance > 0).map(t => { const rt = c.bridge.routes.find(r => r.symbol === t.symbol); return { symbol: 'kb-' + t.symbol, amount: t.balance, usd: t.balance * px(rt.cg) }; });
          }
          const usd = k.total * px('kadena') + tokens.reduce((s, t) => s + t.usd, 0);
          blocks.push({ walletId: w.id, walletLabel: w.label, kind: 'kda', knet: net.key, name: net.name, color: net.color, address: w.kda.account, native: k.total, perChain: k.perChain, tokens, usd });
          total += usd;
        } catch (_) { blocks.push({ walletId: w.id, walletLabel: w.label, kind: 'kda', knet: net.key, name: net.name, color: net.color, address: w.kda.account, native: 0, perChain: {}, tokens: [], usd: 0, error: true }); }
      }
    } else if (w.kind === 'evm' && w.eth) {
      for (const n of c.evm.filter(x => x.enabled)) {
        try {
          const b = await eth.getBalances(w.eth.address, { rpc: n.rpc, tokens: n.tokens });
          const tokens = b.tokens.map(t => ({ ...t, usd: t.amount * px((n.tokens.find(x => x.symbol === t.symbol) || {}).cg) }));
          const nativeUsd = b.native * px(n.cg);
          const usd = nativeUsd + tokens.reduce((s, t) => s + t.usd, 0);
          blocks.push({ walletId: w.id, walletLabel: w.label, kind: 'evm', key: n.key, name: n.name, color: n.color, symbol: n.symbol, address: w.eth.address, native: b.native, nativeUsd, tokens, usd });
          total += usd;
        } catch (_) { blocks.push({ walletId: w.id, walletLabel: w.label, kind: 'evm', key: n.key, name: n.name, color: n.color, symbol: n.symbol, address: w.eth.address, native: 0, nativeUsd: 0, tokens: [], usd: 0, error: true }); }
      }
    }
  }
  return { blocks, total };
});

ipcMain.handle('send:kda', async (_e, { passphrase, walletId, kdaNet, chain, to, amount }) => {
  if (!unlocked) throw new Error('bloqueado');
  if (passphrase !== unlocked.pass) throw new Error('Contraseña incorrecta.');
  const c = loadConfig(); const w = unlocked.data.wallets.find(x => x.id === walletId) || active();
  const net = c.kda.networks.find(n => n.key === kdaNet) || c.kda.networks.find(n => n.enabled) || c.kda.networks[0];
  if (!w.kda) throw new Error('Esta wallet no tiene cuenta KDA.');
  const r = await kda.transfer({ node: net.node, networkId: net.networkId, chain, from: w.kda.account, to, amount, secretHex: w.kda.secret, publicHex: w.kda.public });
  logHistory({ type: 'send-kda', wallet: w.label, desc: `Envío ${amount} KDA · chain ${chain} · ${net.name}`, to, id: r.requestKey });
  return r;
});
ipcMain.handle('send:evm', async (_e, { passphrase, walletId, network, token, to, amount }) => {
  if (!unlocked) throw new Error('bloqueado');
  if (passphrase !== unlocked.pass) throw new Error('Contraseña incorrecta.');
  const c = loadConfig(); const w = unlocked.data.wallets.find(x => x.id === walletId) || active();
  if (!w.eth) throw new Error('Esta wallet no tiene cuenta EVM.');
  const n = c.evm.find(x => x.key === network); if (!n) throw new Error('Red no válida.');
  const nativo = !token || token === n.symbol;
  const r = nativo ? await eth.sendNative({ rpc: n.rpc, secretHex: w.eth.secret, to, amount })
                   : await eth.sendToken({ rpc: n.rpc, secretHex: w.eth.secret, token, to, amount });
  logHistory({ type: 'send-evm', wallet: w.label, desc: `Envío ${amount} ${nativo ? n.symbol : 'token'} · ${n.name}`, to, id: r.hash });
  return r;
});

ipcMain.handle('bridge:config', () => loadConfig().bridge);
const walletById = (id) => unlocked.data.wallets.find(w => w.id === id);
// Saldos de los tokens del puente según dirección: 'evm2kda' lee saldos EVM; 'kda2evm' lee saldos Kadena.
ipcMain.handle('bridge:tokens', async (_e, { walletId, dir }) => {
  if (!unlocked) throw new Error('bloqueado');
  const w = walletById(walletId); const b = loadConfig().bridge; if (!w) return [];
  if (dir === 'evm2kda') { if (!w.eth) return []; return bridge.getEvmBalances({ rpc: b.evm.rpc, address: w.eth.address, routes: b.routes }); }
  if (!w.kda) return []; return bridge.getKadenaBalances({ node: b.kda.node, networkId: b.kda.networkId, chain: b.kda.chain, routes: b.routes, account: w.kda.account });
});
ipcMain.handle('bridge:dryrun', async (_e, { dir, fromWalletId, symbol, recipient, amount }) => {
  if (!unlocked) throw new Error('bloqueado');
  const w = walletById(fromWalletId) || active(); const b = loadConfig().bridge;
  const route = b.routes.find(r => r.symbol === symbol); if (!route) throw new Error('Token no válido.');
  if (dir === 'evm2kda') {
    if (!w.eth) throw new Error('La wallet origen no tiene cuenta EVM.');
    return bridge.dryRunEvm2Kda({ rpc: b.evm.rpc, router: route.evmRouter, evmToken: route.evmToken, fromAddress: w.eth.address, kadenaAccount: recipient, amount, decimals: route.decimals, kadenaDomain: b.kda.domain, kadenaChain: b.kda.chain });
  }
  if (!w.kda) throw new Error('La wallet origen no tiene cuenta KDA.');
  return bridge.dryRunKda2Evm({ node: b.kda.node, networkId: b.kda.networkId, chain: b.kda.chain, senderAccount: w.kda.account, senderPubKey: w.kda.public, kadenaModule: route.kadenaModule, evmDomain: b.evm.domain, recipientEvmAddr: recipient, amount });
});
// ENVÍO REAL del puente (mueve fondos). Exige la contraseña de la bóveda.
ipcMain.handle('bridge:send', async (_e, { dir, passphrase, fromWalletId, symbol, recipient, amount }) => {
  if (!unlocked) throw new Error('bloqueado');
  if (passphrase !== unlocked.pass) throw new Error('Contraseña incorrecta.');
  const w = walletById(fromWalletId) || active(); const b = loadConfig().bridge;
  const route = b.routes.find(r => r.symbol === symbol); if (!route) throw new Error('Token no válido.');
  if (dir === 'evm2kda') {
    if (!w.eth) throw new Error('La wallet origen no tiene cuenta EVM.');
    const onStep = (d) => { try { _e.sender.send('bridge:step', d); } catch (_) {} };
    const kb = async () => (await bridge.getKadenaBalances({ node: b.kda.node, networkId: b.kda.networkId, chain: b.kda.chain, routes: [route], account: recipient }))[0].balance;
    const before = await kb().catch(() => 0);
    const res = await bridge.sendEvm2Kda({ rpc: b.evm.rpc, secretHex: w.eth.secret, router: route.evmRouter, token: route.evmToken, kadenaAccount: recipient, amount, decimals: route.decimals, kadenaDomain: b.kda.domain, kadenaChain: b.kda.chain }, onStep);
    // Esperar la llegada a Kadena (relayer)
    onStep({ step: 'kadena', status: 'run', detail: 'Esperando al relayer del fork…' });
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    let arrived = false;
    for (let i = 0; i < 24 && !arrived; i++) { await sleep(15000); const now = await kb().catch(() => before); if (now > before + 1e-9) { onStep({ step: 'kadena', status: 'ok', detail: 'recibido · saldo ' + now }); arrived = true; } }
    if (!arrived) onStep({ step: 'kadena', status: 'pending', detail: 'aún no entregado; el relayer del fork puede tardar (fondos no perdidos)' });
    logHistory({ type: 'bridge', wallet: w.label || '', desc: `Puente ${amount} ${symbol} · Ethereum → Kadena${arrived ? ' (recibido)' : ' (pendiente relayer)'}`, to: recipient, id: res.txHash });
    return { ...res, arrived };
  }
  // KADENA -> EVM real: dispatch firmado en el fork + espera de llegada del token al lado EVM
  if (!w.kda) throw new Error('La wallet origen no tiene cuenta KDA.');
  const onStep = (d) => { try { _e.sender.send('bridge:step', d); } catch (_) {} };
  const evmBal = async () => { try { return (await bridge.getEvmBalances({ rpc: b.evm.rpc, address: recipient, routes: [route] }))[0].balance; } catch (_) { return 0; } };
  const before = await evmBal();
  const res = await bridge.sendKda2Evm({ node: b.kda.node, networkId: b.kda.networkId, chain: b.kda.chain, senderAccount: w.kda.account, senderPubKey: w.kda.public, secretHex: w.kda.secret, kadenaModule: route.kadenaModule, evmDomain: b.evm.domain, recipientEvmAddr: recipient, amount }, onStep);
  if (res.minedOk === false) throw new Error('La tx falló en Kadena: ' + JSON.stringify(res.error || {}).slice(0, 160));
  let arrived = false;
  if (res.minedOk) {
    onStep({ step: 'evm', status: 'run', detail: 'Esperando al relayer hacia Ethereum…' });
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    for (let i = 0; i < 24 && !arrived; i++) { await sleep(15000); const now = await evmBal(); if (now > before + 1e-9) { onStep({ step: 'evm', status: 'ok', detail: 'recibido · saldo ' + now }); arrived = true; } }
    if (!arrived) onStep({ step: 'evm', status: 'pending', detail: 'aún no entregado; el relayer puede tardar (fondos no perdidos)' });
  }
  logHistory({ type: 'bridge', wallet: w.label || '', desc: `Puente ${amount} ${symbol} · Kadena → Ethereum${arrived ? ' (recibido)' : ' (pendiente relayer)'}`, to: recipient, id: res.requestKey });
  return { ...res, txHash: res.requestKey, arrived };
});

// Mercado: swap KDA <-> kb-USDC en el pool del fork (kaddex.exchange, chain 2). No custodial: firma el main con la clave de la wallet.
ipcMain.handle('swap:quote', async (_e, { dir, amount }) => swap.quote(dir, amount));
ipcMain.handle('swap:exec', async (_e, { passphrase, walletId, dir, amount, slippage }) => {
  if (!unlocked) throw new Error('bloqueado');
  if (passphrase !== unlocked.pass) throw new Error('Contraseña incorrecta.');
  const w = unlocked.data.wallets.find(x => x.id === walletId) || active();
  if (!w || !w.kda) throw new Error('Necesitas una wallet Kadena para operar en el mercado.');
  const r = await swap.swap({ dir, amountIn: amount, account: w.kda.account, publicHex: w.kda.public, secretHex: w.kda.secret, slippage });
  logHistory({ type: 'swap', wallet: w.label, desc: `Swap ${amount} ${dir === 'compra' ? 'kb-USDC → KDA' : 'KDA → kb-USDC'} · mín ${r.minOut}`, id: r.requestKey });
  return r;
});
const shortA = (a) => (a && a.length > 14) ? a.slice(0, 8) + '…' + a.slice(-4) : (a || '');
const tokLabel = (t) => t === 'coin' ? 'KDA' : (String(t).endsWith('kb-USDC') ? 'kb-USDC' : String(t).split('.').pop());
// Caché incremental del historial on-chain por cuenta: guarda local y solo pide al indexador lo NUEVO (?desde=).
const HISTCACHE = () => path.join(app.getPath('userData'), 'history-cache.json');
const loadHistCache = () => { try { return JSON.parse(fs.readFileSync(HISTCACHE(), 'utf8')); } catch (_) { return {}; } };
const saveHistCache = (o) => { try { fs.writeFileSync(HISTCACHE(), JSON.stringify(o)); } catch (_) {} };
async function fetchAccountTxs(account) {
  const cache = loadHistCache();
  const prev = cache[account] || [];
  let url = 'https://kdaindex.dnns.es/txs/account/' + encodeURIComponent(account) + '?limit=50';
  if (prev.length) { const last = prev.reduce((m, t) => (t.blockTime > m ? t.blockTime : m), prev[0].blockTime); url += '&desde=' + String(last).slice(0, 10); } // solo lo nuevo desde el último día conocido
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    const arr = await r.json();
    if (Array.isArray(arr)) {
      const byKey = {};
      for (const t of prev) byKey[t.requestKey + '|' + t.idx] = t;
      for (const t of arr) byKey[t.requestKey + '|' + t.idx] = t;
      const merged = Object.values(byKey).sort((a, b) => (b.blockTime > a.blockTime ? 1 : -1)).slice(0, 300);
      cache[account] = merged; saveHistCache(cache);
      return merged;
    }
  } catch (_) {}
  return prev; // sin indexador: devuelve lo cacheado (resiliente a caídas)
}
// Historial de UNA wallet (la seleccionada): on-chain de su cuenta KDA vía kdaindex + local (EVM/puente de esa wallet).
ipcMain.handle('history:list', async (_e, { walletId } = {}) => {
  const out = [];
  if (!unlocked) return out;
  const wallets = walletId ? unlocked.data.wallets.filter(w => w.id === walletId) : unlocked.data.wallets;
  await Promise.all(wallets.filter(w => w.kda).map(async (w) => {
    const arr = await fetchAccountTxs(w.kda.account); // caché + solo el delta nuevo
    for (const t of arr) {
      const inbound = t.toAccount === w.kda.account;
      const other = inbound ? (t.fromAccount || '(acuñado)') : t.toAccount;
      // dir/amt/tok/wlabel/other/chain van estructurados para que el renderer los traduzca (ES/EN); title/sub quedan de respaldo
      out.push({ ts: Date.parse(t.blockTime), kind: inbound ? 'in' : 'out', dir: inbound ? 'in' : 'out', amt: t.amount, tok: tokLabel(t.token), wlabel: w.label, other: shortA(other), chain: t.chain, title: `${inbound ? 'Recibido' : 'Enviado'} ${t.amount} ${tokLabel(t.token)}`, sub: `${w.label} · ${inbound ? 'de' : 'a'} ${shortA(other)} · chain ${t.chain}`, id: t.requestKey });
    }
  }));
  const labels = new Set(wallets.map(w => w.label));
  for (const h of loadHistory()) {
    if ((h.type === 'send-evm' || h.type === 'bridge') && (!walletId || labels.has(h.wallet))) out.push({ ts: h.ts, kind: h.type, title: h.desc, sub: (h.wallet || '') + (h.to ? ' → ' + shortA(h.to) : ''), id: h.id });
  }
  out.sort((a, b) => b.ts - a.ts);
  return out.slice(0, 80);
});

ipcMain.handle('qr', (_e, text) => QRCode.toDataURL(text, { margin: 1, width: 240 }));
ipcMain.handle('config:get', () => loadConfig());
ipcMain.handle('config:set', (_e, c) => { saveConfig(c); return { ok: true }; });

// ---- Versión + auto-update vía descargas.dnns.es (patrón latest.json {version,url,sha256,notes}) ----
const APP_VERSION = require('./package.json').version;
const UPDATE_URL = 'https://descargas.dnns.es/kob7t2m9x4/koberlet';
const cmpVer = (a, b) => { const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) { if ((pa[i] || 0) > (pb[i] || 0)) return 1; if ((pa[i] || 0) < (pb[i] || 0)) return -1; } return 0; };
ipcMain.handle('app:info', () => ({ version: APP_VERSION }));
ipcMain.handle('update:check', async () => {
  try {
    const r = await fetch(UPDATE_URL + '/latest.json', { signal: AbortSignal.timeout(6000), cache: 'no-store' });
    const j = await r.json();
    const newer = j && j.version && cmpVer(j.version, APP_VERSION) > 0;
    return { current: APP_VERSION, latest: j.version || null, newer: !!newer, url: j.url || (UPDATE_URL + '/'), canAuto: !!j.appUrl, notes: j.notes || '' };
  } catch (_) { return { current: APP_VERSION, latest: null, newer: false }; }
});
ipcMain.handle('open:external', (_e, url) => { if (/^https:\/\//.test(url)) shell.openExternal(url); });

// Auto-update IN-PLACE: descarga SOLO el código nuevo (resources/app) y lo cambia con un .bat al cerrar,
// preservando la bóveda (MonederoDNNS-datos vive junto al .exe, fuera de resources/app). No pierde nada.
const { spawn } = require('child_process');
ipcMain.handle('update:apply', async () => {
  const r = await fetch(UPDATE_URL + '/latest.json', { signal: AbortSignal.timeout(8000), cache: 'no-store' });
  const j = await r.json();
  const appUrl = j.appUrl; // zip que contiene SOLO la carpeta app (el código)
  if (!appUrl) throw new Error('Esta versión no admite auto-update in-place (falta appUrl).');
  const exe = app.getPath('exe'); const exeDir = path.dirname(exe); const exeName = path.basename(exe);
  const resDir = path.join(exeDir, 'resources');
  const upd = path.join(exeDir, '_update');
  fs.rmSync(upd, { recursive: true, force: true }); fs.mkdirSync(upd, { recursive: true });
  // 1) descargar
  const res = await fetch(appUrl, { signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error('descarga falló: ' + res.status);
  const zipPath = path.join(upd, 'app.zip');
  fs.writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));
  // 2) extraer con PowerShell (queda upd/app)
  await new Promise((resolve, reject) => spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${upd}' -Force`], { windowsHide: true })
    .on('exit', c => c === 0 ? resolve() : reject(new Error('unzip código ' + c))));
  if (!fs.existsSync(path.join(upd, 'app'))) throw new Error('el paquete no contiene la carpeta app.');
  // 3) .bat que espera al cierre, cambia resources/app (con respaldo) y reinicia
  const bat = path.join(upd, 'apply.bat');
  const q = (p) => '"' + p + '"';
  fs.writeFileSync(bat, [
    '@echo off',
    'timeout /t 2 /nobreak >nul',
    ':wait',
    `tasklist /fi "imagename eq ${exeName}" | find /i "${exeName}" >nul && (timeout /t 1 /nobreak >nul & goto wait)`,
    `if exist ${q(path.join(resDir, 'app_old'))} rmdir /s /q ${q(path.join(resDir, 'app_old'))}`,
    `move ${q(path.join(resDir, 'app'))} ${q(path.join(resDir, 'app_old'))}`,
    `move ${q(path.join(upd, 'app'))} ${q(path.join(resDir, 'app'))}`,
    `if exist ${q(path.join(resDir, 'app'))} ( rmdir /s /q ${q(path.join(resDir, 'app_old'))} ) else ( move ${q(path.join(resDir, 'app_old'))} ${q(path.join(resDir, 'app'))} )`,
    `start "" ${q(exe)}`,
    `rmdir /s /q ${q(upd)}`
  ].join('\r\n'), 'latin1');
  // 4) lanzar el bat OCULTO (cmd detached ignora windowsHide y deja una consola negra a la vista;
  //    wscript con ventana 0 sí lo esconde de verdad) y cerrar la app
  const vbs = path.join(upd, 'apply.vbs');
  fs.writeFileSync(vbs, 'CreateObject("WScript.Shell").Run "cmd.exe /c ""' + bat + '""", 0, False\r\n', 'latin1');
  spawn('wscript.exe', [vbs], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  setTimeout(() => { unlocked = null; app.quit(); }, 400);
  return { ok: true };
});
