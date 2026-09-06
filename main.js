// Proceso principal. Las privadas viven SOLO aquí (nunca en el renderer). Se firma y se exporta aquí.
const { app, BrowserWindow, ipcMain, shell, dialog, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const vault = require('./lib/vault');
const backup = require('./lib/backup');
const kda = require('./lib/kda');
const eth = require('./lib/eth');
const wallets = require('./lib/wallets');
const bridge = require('./lib/bridge');
const evmswap = require('./lib/evmswap');
const dca = require('./lib/dca');
const ordenes = require('./lib/ordenes');
const observadas = require('./lib/observadas');
const launch = require('./lib/launch');
const dex = require('./lib/dex');
const swap = require('./lib/swap');
const ethswap = require('./lib/ethswap');
const ktime = require('./lib/kdatime');
const devnetPub = require('./lib/devnet-publico');
const QRCode = require('qrcode');
// Ledger: carga PEREZOSA (node-hid es un módulo nativo; si fallara en algún equipo, la app debe arrancar igual).
let _ledger = null;
function ledger() { if (!_ledger) _ledger = require('./lib/ledger'); return _ledger; }

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
      // `nft`: dónde vive el ledger de NFT de esa red, quién sabe qué tiene una
      // cuenta (descubridor, opcional) y por dónde se leen los ipfs://. Igual que
      // `tokens`, va en el código y no en la config del usuario (modelo Alex #4).
      { key: 'mainnet', name: 'Kadena (Inc)', node: 'https://api.chainweb.com', networkId: 'mainnet01', color: '#a855f7', enabled: false, fork: false,
        nft: { ledger: 'marmalade-v2.ledger', chain: '0', descubridor: null, pasarela: 'https://ipfs.io/ipfs/' } },
      // `tokens`: fungibles KDA a mostrar además del kb-* del puente. Lista FIJA del código (no de la
      // config del usuario) — modelo Alex #4: el renderer no puede inyectar contratos de token.
      // Cada uno: {module (namespace.contrato fungible-v2), symbol, precision, chain, cg (id CoinGecko o null si sin precio)}.
      { key: 'fork', name: 'Kadena', node: 'https://api.chainweb-community.org', networkId: 'mainnet01', color: '#63e038', enabled: true, fork: true,
        nft: { ledger: 'marmalade-v2.ledger', chain: '0', descubridor: null, pasarela: 'https://ipfs.io/ipfs/' },
        tokens: [
          { module: 'n_57fcd6f7b72e8949af51a8d6f17fe12cc7719d10.pco', symbol: 'PCO', precision: 12, chain: 0, cg: null },
          // SPT (Smart Pacts, de Alex): fungible-v2 + fungible-xchain-v1, sin mint, 100.000 emitidos
          // de una vez. La venta directa (SPT-launch) vive en la chain 0, así que el saldo se mira ahí.
          { module: 'n_48867b242317a0216a67f8c7ca26696b5878e0e3.SPT', symbol: 'SPT', precision: 12, chain: 0, cg: null }
        ] },
      // El descubridor es el CATÁLOGO PÚBLICO de piezas de la tienda (sin `?cuenta=`):
      // de él salen los candidatos y el dueño lo confirma la cadena, wallet aparte.
      // El panel privado `/api/mis-piezas` ya no sirve: desde 08/2026 exige sesión
      // firmada en el navegador (se cerró un IDOR) y contestaba 401 a la wallet.
      { key: 'devnet', name: 'Devnet DNNS', node: 'https://devnet.dnns.es', networkId: 'development', color: '#f59e0b', enabled: false, fork: false,
        nft: { ledger: 'n_84b9f9aa6a2665fd8c8ca80cc9b252d818fdfbac.ledger', chain: '0',
               descubridor: 'https://nft.dnns.es/api/galeria',
               pasarela: 'https://nft.dnns.es/ipfs/' } }
    ],
    chains: Array.from({ length: 20 }, (_, i) => i)
  },
  // Redes EVM (la MISMA dirección 0x vale en todas). cg = id CoinGecko del nativo. enabled = mostrar por defecto.
  evm: [
    { key: 'eth', name: 'Ethereum', enabled: true, rpc: 'https://ethereum-rpc.publicnode.com', chainId: 1,
      reservas: ['https://eth.drpc.org', 'https://rpc.mevblocker.io', 'https://gateway.tenderly.co/public/mainnet'], symbol: 'ETH', cg: 'ethereum', color: '#627eea',
      tokens: [{ symbol: 'USDC', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', cg: 'usd-coin' }, { symbol: 'USDT', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', cg: 'tether' }] },
    { key: 'arb', name: 'Arbitrum', enabled: false, rpc: 'https://arbitrum-one-rpc.publicnode.com', chainId: 42161,
      reservas: ['https://arb1.arbitrum.io/rpc', 'https://arbitrum.drpc.org'], symbol: 'ETH', cg: 'ethereum', color: '#28a0f0',
      tokens: [{ symbol: 'USDC', address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', cg: 'usd-coin' }, { symbol: 'USDT', address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', cg: 'tether' }] },
    { key: 'base', name: 'Base', enabled: false, rpc: 'https://base-rpc.publicnode.com', chainId: 8453,
      reservas: ['https://mainnet.base.org', 'https://base.drpc.org'], symbol: 'ETH', cg: 'ethereum', color: '#0052ff',
      tokens: [{ symbol: 'USDC', address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', cg: 'usd-coin' }] },
    { key: 'bnb', name: 'BNB Chain', enabled: false, rpc: 'https://bsc-rpc.publicnode.com', chainId: 56,
      reservas: ['https://bsc-dataseed.bnbchain.org', 'https://bsc.drpc.org'], symbol: 'BNB', cg: 'binancecoin', color: '#f0b90b',
      tokens: [{ symbol: 'USDT', address: '0x55d398326f99059fF775485246999027B3197955', cg: 'tether' }, { symbol: 'USDC', address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', cg: 'usd-coin' }] },
    { key: 'pol', name: 'Polygon', enabled: false, rpc: 'https://polygon-bor-rpc.publicnode.com', chainId: 137,
      reservas: ['https://polygon.drpc.org'], symbol: 'POL', cg: 'polygon-ecosystem-token', color: '#8247e5',
      tokens: [{ symbol: 'USDC', address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', cg: 'usd-coin' }, { symbol: 'USDT', address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', cg: 'tether' }] }
  ],
  // DCA de KoberluSW: contrato en el fork que custodia el bote y compra periodicamente.
  // Koberlet solo crea, recarga, pausa y cierra planes: las compras las dispara el
  // vigilante de KoberluSW, que paga su propio gas. Modulo y tokens fijos del codigo.
  dca: {
    red: 'fork',
    modulo: 'free.ksw-dca2',
    moduloOrdenes: 'free.ksw2',   // ordenes limite, para el resumen del Panel
    gasolinera: 'free.ksw-gasolinera',   // paga el gas de las operaciones del DCA
    tokens: {
      KDA: { modulo: 'coin', precision: 12, minCuota: 100 },
      'kb-USDC': { modulo: 'n_e595727b657fbbb3b8e362a05a7bb8d12865c1ff.kb-USDC', precision: 6, minCuota: 1 }
    },
    comision: 0.005,        // 0,5% del contrato por compra, ademas del 0,3% del pool
    web: 'https://koberlusw.dnns.es'   // para consultarlo desde el movil
  },
  // VENTAS DIRECTAS (Launch). Un token a precio fijo contra su contrato: sin pool,
  // sin deslizamiento y sin comision. Anadir otra venta es una entrada mas aqui, no
  // codigo. El renderer elige por `clave` y nunca manda direcciones de contrato.
  launch: {
    red: 'fork',
    ventas: [
      {
        clave: 'spt',
        nombre: 'SPT · Smart Pacts',
        simbolo: 'SPT',
        modulo: 'n_48867b242317a0216a67f8c7ca26696b5878e0e3.SPT-launch',
        token: 'n_48867b242317a0216a67f8c7ca26696b5878e0e3.SPT',
        precision: 12,
        chain: '0',                    // OJO: la venta vive en la 0, Koberlet opera en la 2
        de: 'Alex, de la comunidad de Pact',
        web: 'https://koberlusw.dnns.es',
        // Riesgos que la ficha DEBE ensenar. No son adorno: el contrato no esta
        // congelado y su keyset de gobierno puede cambiarlo despues de que compres.
        avisos: ['no_congelado', 'precio_variable', 'otra_chain']
      }
    ]
  },
  // Cambios permitidos en Ethereum (Uniswap V3). Sirve sobre todo para pasar USDT a USDC
  // ANTES de cruzar el puente: en Kadena el unico token con mercado es kb-USDC, asi que un
  // USDT que llegue como kb-USDT no se puede cambiar a KDA (no existe ese pool en kaddex).
  // La lista es fija del codigo; el renderer solo elige par por simbolo, nunca da direcciones.
  evmSwap: {
    red: 'eth',
    pares: [
      { de: 'USDT', a: 'USDC', tokenDe: '0xdAC17F958D2ee523a2206206994597C13D831ec7', tokenA: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decDe: 6, decA: 6 },
      { de: 'USDC', a: 'USDT', tokenDe: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', tokenA: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decDe: 6, decA: 6 }
    ]
  },
  // Puente Kinesis (fork). Solo simulación por ahora. Dos orillas: Kadena (dominio 626) y Ethereum (1).
  bridge: {
    kda: { node: 'https://api.chainweb-community.org', networkId: 'mainnet01', chain: 2, domain: 626 },
    evm: { rpc: 'https://ethereum-rpc.publicnode.com', name: 'Ethereum', domain: 1, chainId: 1,
           reservas: ['https://eth.drpc.org', 'https://rpc.mevblocker.io', 'https://gateway.tenderly.co/public/mainnet'] },
    // OJO con las mayusculas de estas direcciones: en Ethereum el patron de mayusculas ES la
    // suma de verificacion (EIP-55) y ethers RECHAZA la direccion antes de llamar. Los routers
    // de USDT, DAI y WBTC lo tenian mal y el puente fallaba con "bad address checksum" en la
    // primera llamada: solo funcionaba USDC. Hay un test que lo comprueba (npm test).
    routes: [
      { symbol: 'USDC', cg: 'usd-coin', kadenaModule: 'kb-USDC', evmRouter: '0x81C2813aa88F66bca1e55838045Aaceb72FEbFc1', evmToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
      { symbol: 'USDT', cg: 'tether', kadenaModule: 'kb-USDT', evmRouter: '0x9CFDB123cE10CFBe276393D4B666AEBBE766ad8F', evmToken: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
      { symbol: 'DAI', cg: 'dai', kadenaModule: 'kb-DAI', evmRouter: '0x85CC60531119041B250003E25fe0c5920606c6dB', evmToken: '0x6B175474E89094C44Da98b954EedeAC495271d0F', decimals: 18 },
      { symbol: 'WBTC', cg: 'wrapped-bitcoin', kadenaModule: 'kb-WBTC', evmRouter: '0xDFdB8F3dEb5458BFA25cc97df41298A915a34BF3', evmToken: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', decimals: 8 }
    ]
  }
};

// unlocked = { key, salt, params, data:{ wallets:[...], active, shown } }  SOLO en memoria del main.
// L-2: se retiene la CLAVE derivada, no la passphrase en claro.
let unlocked = null;

// Re-autenticación: re-deriva la clave con la passphrase entrada y la compara en tiempo constante
// con la clave de sesión (Alex #6 + auditoría interna L-2: no se guarda la passphrase en claro).
function passOk(input) {
  if (!unlocked) return false;
  try {
    const k = crypto.scryptSync(String(input), unlocked.salt, 32, { N: unlocked.params.N, r: unlocked.params.r, p: unlocked.params.p, maxmem: 256 * 1024 * 1024 });
    return crypto.timingSafeEqual(k, unlocked.key);
  } catch (_) { return false; }
}

// M-2: auto-bloqueo por inactividad. Al saltar, borra la sesión y avisa al renderer para volver al desbloqueo.
let lockTimer = null;
function armAutoLock() {
  if (lockTimer) { clearTimeout(lockTimer); lockTimer = null; }
  if (!unlocked) return;
  const mins = loadConfig().lockMinutes;
  if (!mins || mins <= 0) return; // 0 = nunca
  lockTimer = setTimeout(() => {
    unlocked = null; lockTimer = null;
    for (const w of BrowserWindow.getAllWindows()) { try { w.webContents.send('locked'); } catch (_) {} }
  }, mins * 60 * 1000);
}
function touchActivity() { if (unlocked) armAutoLock(); }

const loadConfig = () => {
  let c;
  try { c = { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG(), 'utf8')) }; } catch (_) { c = { ...DEFAULT_CONFIG }; }
  // Normaliza las redes Kadena al formato lista (Oficial + Fork), preservando qué tenía activado el usuario.
  const savedNets = (c.kda && Array.isArray(c.kda.networks)) ? c.kda.networks : null;
  c.kda = {
    chains: (c.kda && c.kda.chains) || DEFAULT_CONFIG.kda.chains,
    networks: DEFAULT_CONFIG.kda.networks.map(n => { const s = savedNets ? savedNets.find(x => x.key === n.key) : null; return { ...n, enabled: s ? !!s.enabled : n.enabled }; })
  };
  // Simplificación de nombres (2026-07): la Community pasa a llamarse simplemente "Kadena" (es la red real
  // de la comunidad y donde vive todo el ecosistema) y la rama de Kadena Inc queda apagada por defecto,
  // disponible en Red por si hiciera falta. Se aplica UNA sola vez sobre configuraciones ya existentes.
  if (!c.kdaSimple) {
    const _inc = c.kda.networks.find(n => n.key === 'mainnet');
    if (_inc) _inc.enabled = false;
    c.kdaSimple = true;
    try { saveConfig(c); } catch (_) { /* si aún no se puede escribir, se persistirá al siguiente guardado */ }
  }
  c.launch = DEFAULT_CONFIG.launch;     // el catalogo de ventas es fijo del codigo
  c.dca = DEFAULT_CONFIG.dca;           // modulo y tokens del DCA: fijos del codigo
  c.evmSwap = DEFAULT_CONFIG.evmSwap;   // el catalogo de cambios es fijo del codigo, como el puente
  c.bridge = DEFAULT_CONFIG.bridge; // el puente (rutas/tokens/cg) es fijo del fork; una config guardada vieja podía quedarse sin `cg` → precios kb-* a 0
  // Auditoría Alex #4: las redes EVM se reconstruyen desde DEFAULT (routers, tokens, símbolos fijos del código);
  // del usuario solo se conserva `enabled` y un `rpc` que sea https válido. Así el renderer no puede repuntar
  // los endpoints de firma a un nodo hostil ni inyectar contratos de token arbitrarios.
  const savedEvm = Array.isArray(c.evm) ? c.evm : null;
  const httpsOk = (u) => { try { return new URL(u).protocol === 'https:'; } catch (_) { return false; } };
  c.evm = DEFAULT_CONFIG.evm.map(n => {
    const s = savedEvm ? savedEvm.find(x => x.key === n.key) : null;
    return { ...n, enabled: s ? !!s.enabled : n.enabled, rpc: (s && httpsOk(s.rpc)) ? s.rpc : n.rpc };
  });
  c.updateMode = (c.updateMode === 'auto') ? 'auto' : 'manual'; // manual por defecto: avisar y que el usuario decida
  c.lockMinutes = (c.lockMinutes === undefined || c.lockMinutes === null) ? 10 : Math.max(0, Number(c.lockMinutes) || 0); // M-2: auto-bloqueo, 10 min por defecto (0=nunca)
  // Libreta de direcciones (idea 1): lista {alias, address, kind:'kda'|'evm'} saneada. No es secreto.
  c.addressBook = (Array.isArray(c.addressBook) ? c.addressBook : [])
    .filter(e => e && typeof e.address === 'string' && typeof e.alias === 'string')
    .map(e => ({ alias: String(e.alias).slice(0, 60), address: String(e.address).slice(0, 128), kind: e.kind === 'evm' ? 'evm' : 'kda' }))
    .slice(0, 200);
  // Metadatos por wallet (idea 15): {tag:'fria'|'caliente'|'', note}. No es secreto.
  const wmIn = (c.walletMeta && typeof c.walletMeta === 'object' && !Array.isArray(c.walletMeta)) ? c.walletMeta : {};
  const wm = {}; for (const k in wmIn) { const e = wmIn[k] || {}; wm[k] = { tag: ['fria', 'caliente'].includes(e.tag) ? e.tag : '', note: String(e.note || '').slice(0, 200) }; }
  c.walletMeta = wm;
  delete c.importPath; // línea muerta de la versión que importaba TeamRed.json desde F: — la bóveda es autocontenida
  return c;
};
const saveConfig = (c) => fs.writeFileSync(CONFIG(), JSON.stringify(c, null, 2));
const saveVault = () => vault.guardar(VAULT(), unlocked.key, unlocked.salt, unlocked.params, unlocked.data);
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

// Precios (CoinGecko, caché 60s): usd + eur + variación 24h. `full` = { cgId:{usd,eur,chg} }.
let _priceCache = { at: 0, full: {} };
async function refreshPrices() {
  if (Date.now() - _priceCache.at < 60000 && Object.keys(_priceCache.full).length) return;
  const ids = 'kadena,ethereum,binancecoin,polygon-ecosystem-token,usd-coin,tether,dai,wrapped-bitcoin';
  try {
    const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=' + ids + '&vs_currencies=usd,eur&include_24hr_change=true');
    const j = await r.json();
    const m = {}; for (const k of Object.keys(j)) m[k] = { usd: j[k].usd, eur: j[k].eur, chg: j[k].usd_24h_change };
    if (Object.keys(m).length) _priceCache = { at: Date.now(), full: m };
  } catch (_) { /* sin red: mantiene la última */ }
}
// Compat: el cálculo de saldos usa un mapa { cgId: usd } (números).
async function getPrices() { await refreshPrices(); const m = {}; for (const k in _priceCache.full) m[k] = _priceCache.full[k].usd; return m; }
async function getPricesFull() { await refreshPrices(); return _priceCache.full; }

function view() {
  if (!unlocked) return null;
  const shown = new Set(shownIds());
  return {
    wallets: unlocked.data.wallets.map(x => ({ id: x.id, label: x.label, kind: x.kind, net: x.net || null, netName: x.kind === 'evm' ? evmNetName(x.net || 'eth') : 'Kadena', shown: shown.has(x.id), hasKda: !!x.kda, hasEth: !!x.eth, kdaAccount: x.kda ? x.kda.account : null, ethAddress: x.eth ? x.eth.address : null, ledger: !!x.ledger })),
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
  // M-1: en una wallet se DENIEGA toda navegación fuera de la app y la apertura de ventanas nuevas.
  // Los enlaces https legítimos se abren en el navegador del sistema; nunca dentro del Electron.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) { e.preventDefault(); if (/^https:\/\//.test(url)) shell.openExternal(url); }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}
// Instancia ÚNICA: si ya hay una abierta, la nueva enfoca la existente y se cierra (evita ventanas duplicadas).
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { const w = BrowserWindow.getAllWindows()[0]; if (w) { if (w.isMinimized()) w.restore(); w.focus(); } });
  app.whenReady().then(() => {
    createWindow(); ensureDesktopShortcut();
    // limpiar restos de actualizaciones anteriores (_update y _update-<ts>; el bat no siempre puede borrar su propia carpeta)
    try {
      const d0 = path.dirname(app.getPath('exe'));
      for (const d of fs.readdirSync(d0)) if (d === '_update' || d.startsWith('_update-')) { try { fs.rmSync(path.join(d0, d), { recursive: true, force: true }); } catch (_) {} }
    } catch (_) {}
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
    // Si ya hay un Koberlet.lnk apuntando a OTRA instalación, NO pisarlo (incidente 2026-07-22: extraer
    // una copia nueva en otra carpeta secuestraba el acceso directo y el usuario "perdía" sus wallets).
    if (fs.existsSync(lnk)) {
      try {
        const cur = shell.readShortcutLink(lnk);
        if (cur && cur.target && path.resolve(cur.target) !== path.resolve(app.getPath('exe'))) { fs.mkdirSync(path.dirname(marker), { recursive: true }); fs.writeFileSync(marker, MARK); return; }
      } catch (_) { /* ilegible → se actualiza abajo */ }
    }
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
// ---- MODO VISOR: mirar cuentas sin abrir la boveda -------------------------------
// Son los UNICOS handlers que no exigen `unlocked`, y pueden permitirselo porque no
// tocan la boveda, no reciben claves y no firman nada. Solo leen de la cadena
// direcciones publicas, que cualquiera puede consultar con un nodo.
//
// Existe por lo que pidio Alex en el grupo de Pact: quien tiene el saldo en frio o en
// un Ledger hoy tiene que enchufar el aparato solo para ver un numero. Eso es exponerlo
// a cambio de nada.
const DATOS = () => app.getPath('userData');

function validarDireccion(red, d) {
  if (red === 'kda') return kda.validKdaAccount(d);
  try { require('ethers').getAddress(d); return true; } catch (_) { return false; }
}

ipcMain.handle('visor:lista', () => observadas.leer(DATOS()));
ipcMain.handle('visor:anadir', (_e, { red, direccion, etiqueta } = {}) =>
  observadas.anadir(DATOS(), { red, direccion, etiqueta }, validarDireccion));
ipcMain.handle('visor:quitar', (_e, { id } = {}) => observadas.quitar(DATOS(), id));
ipcMain.handle('visor:renombrar', (_e, { id, etiqueta } = {}) => observadas.renombrar(DATOS(), id, etiqueta));

// Todo lo que se puede saber de una cuenta ajena leyendo la cadena. Cada trozo va con su
// propio catch: que falle el DCA no debe dejarte sin ver el saldo.
ipcMain.handle('visor:cuenta', async (_e, { red, direccion } = {}) => {
  if (!validarDireccion(red, String(direccion || ''))) throw new Error('Dirección no válida.');
  const c = loadConfig();
  const precios = await getPrices();
  const px = (id) => precios[id] || 0;

  if (red === 'evm') {
    const salidas = [];
    for (const net of c.evm.filter((n) => n.enabled)) {
      try {
        const b = await eth.getBalances(direccion, { rpc: await rpcDe(net), tokens: net.tokens });
        salidas.push({ red: net.name, color: net.color, nativo: b.native, simbolo: net.symbol,
                       usd: b.native * px(net.cg), tokens: (b.tokens || []).map((t) => ({ ...t, usd: t.amount * px(t.cg) })) });
      } catch (_) { /* esa red no responde: se sigue con las demas */ }
    }
    return { red: 'evm', direccion, bloques: salidas };
  }

  const net = c.kda.networks.find((n) => n.enabled && n.fork) || c.kda.networks.find((n) => n.enabled);
  if (!net) throw new Error('No hay ninguna red de Kadena activa.');
  const cfgDcaVisor = { node: net.node, networkId: net.networkId, chain: String(c.bridge.kda.chain),
                        modulo: c.dca.modulo, moduloOrdenes: c.dca.moduloOrdenes };
  const [saldo, tokens, planes, ordenes] = await Promise.all([
    kda.getBalance(direccion, { node: net.node, networkId: net.networkId, chains: c.kda.chains }).catch(() => ({ total: 0, perChain: {} })),
    kda.getTokenBalances(direccion, { node: net.node, networkId: net.networkId, tokens: net.tokens }).catch(() => []),
    dca.planesDe(cfgDcaVisor, direccion).catch(() => []),
    dca.ordenesDe(cfgDcaVisor, direccion).catch(() => [])
  ]);
  // Ultimos movimientos del indexador propio. Va aparte y con su catch: si kdaindex
  // esta caido o va detras del bloque, el resto de la ficha se ensena igual.
  let movs = [], crudos = [];
  try {
    const r = await fetch('https://kdaindex.dnns.es/txs/account/' + encodeURIComponent(direccion) + '?limit=300',
      { signal: AbortSignal.timeout(10000) });
    if (r.ok) {
      const j = await r.json();
      crudos = Array.isArray(j) ? j : [];
      movs = crudos.slice(0, 12).map((m) => ({
        cuando: m.blockTime, chain: m.chain, token: m.token,
        importe: Number(m.amount) || 0,
        entra: String(m.toAccount) === String(direccion),
        otra: String(m.toAccount) === String(direccion) ? m.fromAccount : m.toAccount,
        rk: m.requestKey
      }));
    }
  } catch (_) { /* sin movimientos: no es motivo para no ensenar el saldo */ }

  // Tokens que la cuenta ha MOVIDO, sacados del historial: cada transferencia dice su
  // modulo y su chain, asi que se consulta el saldo exacto en vez de barrer 20 chains.
  const vistos = new Map();
  for (const m of crudos) {
    const mod = String(m.token || '');
    if (!mod || mod === 'coin') continue;
    if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]{1,120}$/.test(mod)) continue;   // no interpolar basura en Pact
    vistos.set(mod + '|' + m.chain, { modulo: mod, chain: String(m.chain) });
  }
  const yaEstan = new Set((tokens || []).map((t) => t.module));
  const extra = [];
  await Promise.all([...vistos.values()].filter((v) => !yaEstan.has(v.modulo)).map(async (v) => {
    try {
      const rr = await kda.local(net.node, net.networkId, v.chain, '(' + v.modulo + '.get-balance "' + direccion + '")');
      if (rr && rr.status === 'success') {
        const val = typeof rr.data === 'object' ? Number(rr.data.decimal != null ? rr.data.decimal : rr.data) : Number(rr.data);
        if (isFinite(val) && val > 0) {
          extra.push({ symbol: v.modulo.split('.').pop(), module: v.modulo, amount: val, chain: v.chain, cg: null, descubierto: true });
        }
      }
    } catch (_) { /* la cuenta ya no tiene fila en ese token */ }
  }));

  // QUIEN CONTROLA LA CUENTA. Una cuenta k: se llama asi por su clave, pero el guard se
  // puede rotar: entonces el nombre ya no dice quien manda. Para vigilar una cuenta ajena
  // o propia en frio, eso es justo lo que interesa saber, y no lo ensena ningun monedero.
  let control = null;
  try {
    const chConGasto = Object.keys(saldo.perChain || {})[0] || String(c.bridge.kda.chain);
    const rg = await kda.local(net.node, net.networkId, chConGasto, '(at "guard" (coin.details "' + direccion + '"))');
    if (rg && rg.status === 'success') {
      const g = rg.data || {};
      const claves = g.keys || (g.keyset && g.keyset.keys) || null;
      const pred = g.pred || (g.keyset && g.keyset.pred) || null;
      if (g.cgName) control = { tipo: 'capability', detalle: g.cgName };
      else if (g.keysetref) control = { tipo: 'keyset', detalle: g.keysetref.name || String(g.keysetref) };
      else if (Array.isArray(claves)) {
        const propia = direccion.startsWith('k:') && claves.length === 1
          && String(claves[0]).toLowerCase() === direccion.slice(2).toLowerCase() && pred === 'keys-all';
        control = { tipo: 'claves', firmas: claves.length, pred, cuadra: direccion.startsWith('k:') ? propia : null };
      }
    }
  } catch (_) { /* la cuenta puede no existir en esa chain */ }

  // Resumen de actividad, sacado del mismo historial que ya se pidio.
  let actividad = null;
  if (crudos.length) {
    const kdaSolo = crudos.filter((m) => m.token === 'coin');
    const dentro = kdaSolo.filter((m) => String(m.toAccount) === String(direccion));
    const fuera = kdaSolo.filter((m) => String(m.fromAccount) === String(direccion));
    actividad = {
      total: crudos.length,
      entradas: dentro.length, salidas: fuera.length,
      entrado: dentro.reduce((n, m) => n + (Number(m.amount) || 0), 0),
      salido: fuera.reduce((n, m) => n + (Number(m.amount) || 0), 0),
      ultimo: crudos[0] && crudos[0].blockTime,
      primero: crudos[crudos.length - 1] && crudos[crudos.length - 1].blockTime
    };
  }

  const tokensUsd = (tokens || []).reduce((n, t) => n + (t.cg ? t.amount * px(t.cg) : 0), 0);
  return {
    red: 'kda', direccion, redNombre: net.name, movimientos: movs, control, actividad,
    nativo: saldo.total, porChain: saldo.perChain, usd: saldo.total * px('kadena'),
    usdTotal: saldo.total * px('kadena') + tokensUsd,
    tokens: (tokens || []).map((t) => ({ symbol: t.symbol, amount: t.amount, usd: t.cg ? t.amount * px(t.cg) : 0, descubierto: false }))
      .concat(extra.map((t) => ({ symbol: t.symbol, amount: t.amount, usd: 0, chain: t.chain, descubierto: true }))),
    planes: (planes || []).filter((x) => x.status !== 'closed').map((x) => ({
      id: x.id, estado: x.status, cuota: x.quota, periodo: x.period, balance: x.balance,
      proxima: x['next-buy'], gastado: x.spent, recibido: x.received,
      buys: x.buys, tokenIn: dca.refMod(x['token-in']), tokenOut: dca.refMod(x['token-out']) })),
    ordenes: (ordenes || []).map((o) => ({ id: o.id, entra: o['amount-in'], precio: o['trigger-price'],
      tokenIn: dca.refMod(o['token-in']), tokenOut: dca.refMod(o['token-out']) }))
  };
});

ipcMain.handle('vault:status', () => ({ exists: vault.existe(VAULT()), unlocked: !!unlocked, config: loadConfig() }));

ipcMain.handle('vault:setup', async (_e, { passphrase, kind, net }) => {
  if (vault.existe(VAULT())) backupVault(); // salvaguarda: nunca machacar una bóveda existente (p.ej. doble-submit) sin respaldo con fecha
  const { mnemonic, kda: k, eth: e } = await wallets.createNew(kind);
  const id = crypto.randomUUID();
  const w = { id, label: kind === 'kda' ? 'Mi wallet KDA' : 'Mi wallet ' + evmNetName(net || 'eth'), kind, kda: k, eth: e };
  if (kind === 'evm') w.net = net || 'eth';
  vault.crear(VAULT(), passphrase, { wallets: [w], active: id, shown: [id] });
  if (kind === 'evm') enableEvmNet(net || 'eth');
  return { ok: true, mnemonic };
});

ipcMain.handle('vault:unlock', (_e, { passphrase }) => {
  const opened = vault.abrir(VAULT(), passphrase); // lanza si passphrase mala
  const { data, changed } = migrate(opened.data);
  unlocked = { key: opened.key, salt: opened.salt, params: opened.params, data };
  if (changed) { try { backupVault(); } catch (_) {} saveVault(); } // persiste el formato normalizado (una wallet = una red)
  armAutoLock();
  return { ok: true, view: view() };
});
ipcMain.handle('vault:lock', () => { unlocked = null; if (lockTimer) { clearTimeout(lockTimer); lockTimer = null; } return { ok: true }; });

// ---- Copia de seguridad cifrada, portable (lib/backup.js) ----
// Exportar: cifra TODAS las wallets (semillas/claves) con una contraseña DEDICADA elegida por el
// usuario y las guarda en un archivo .kbk donde él elija. Requiere la bóveda desbloqueada.
ipcMain.handle('backup:export', async (_e, { password }) => {
  if (!unlocked) throw new Error('Desbloquea la bóveda antes de exportar la copia.');
  const text = backup.crearBackup(password, unlocked.data, { creado: new Date().toISOString(), app: 'Koberlet ' + app.getVersion() });
  const win = BrowserWindow.getFocusedWindow();
  const stamp = new Date().toISOString().slice(0, 10);
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Guardar copia de seguridad cifrada',
    defaultPath: `koberlet-backup-${stamp}.kbk`,
    filters: [{ name: 'Copia Koberlet', extensions: ['kbk'] }]
  });
  if (canceled || !filePath) return { ok: false, canceled: true };
  fs.writeFileSync(filePath, text, { mode: 0o600 });
  return { ok: true, path: filePath, count: unlocked.data.wallets.length };
});

// Importar/RESTAURAR: elige un .kbk, lo descifra con su contraseña. Si NO hay bóveda (PC nuevo,
// recuperación desde cero) crea la bóveda local con ESA MISMA contraseña -> el usuario solo
// recuerda una. Si ya hay bóveda abierta, FUSIONA las wallets que falten (no borra nada).
ipcMain.handle('backup:import', async (_e, { password }) => {
  const win = BrowserWindow.getFocusedWindow();
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Elegir copia de seguridad',
    properties: ['openFile'],
    filters: [{ name: 'Copia Koberlet', extensions: ['kbk', 'json'] }]
  });
  if (canceled || !filePaths || !filePaths[0]) return { ok: false, canceled: true };
  const text = fs.readFileSync(filePaths[0], 'utf8');
  const { data } = backup.abrirBackup(text, password); // lanza si la contraseña es mala o el archivo fue manipulado
  if (!data || !Array.isArray(data.wallets) || !data.wallets.length) throw new Error('La copia no contiene wallets.');
  const restored = migrate(data).data; // normaliza el formato (una wallet = una red)
  if (unlocked) {
    const dup = (w) => unlocked.data.wallets.some(x => (w.kda && x.kda && x.kda.account === w.kda.account) || (w.eth && x.eth && x.eth.address === w.eth.address));
    let added = 0;
    for (const w of restored.wallets) { if (!dup(w)) { if (!unlocked.data.wallets.some(x => x.id === w.id)) { unlocked.data.wallets.push(w); added++; } } }
    unlocked.data.shown = unlocked.data.wallets.map(w => w.id);
    saveVault();
    return { ok: true, mode: 'merge', added, total: unlocked.data.wallets.length, view: view() };
  }
  // recuperación desde cero: la contraseña del backup pasa a ser la de la bóveda local
  if (vault.existe(VAULT())) backupVault();
  vault.crear(VAULT(), password, restored);
  const opened = vault.abrir(VAULT(), password);
  unlocked = { key: opened.key, salt: opened.salt, params: opened.params, data: opened.data };
  armAutoLock();
  return { ok: true, mode: 'restore', total: restored.wallets.length, view: view() };
});
// M-2: el renderer avisa de actividad del usuario (throttled) para reiniciar el temporizador de auto-bloqueo.
ipcMain.on('activity:ping', () => touchActivity());

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
      try { const b = await eth.getBalances(e.address, { rpc: await rpcDe(nd), tokens: nd.tokens }); amount = b.native + b.tokens.reduce((sm, t) => sm + t.amount, 0); } catch (_) {}
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
// ---- Ledger: leer cuenta del aparato e importarla como wallet (sin clave en la bóveda; firma el aparato) ----
ipcMain.handle('ledger:peek', async (_e, { kind, index, verify }) => {
  if (!unlocked) throw new Error('bloqueado');
  const acc = await ledger().getAccount(kind === 'evm' ? 'evm' : 'kda', Math.max(0, index | 0), !!verify);
  return { account: acc.account || acc.address, index: acc.index };
});
ipcMain.handle('ledger:import', async (_e, { label, kind, net, index }) => {
  if (!unlocked) throw new Error('bloqueado');
  const k = kind === 'evm' ? 'evm' : 'kda';
  const acc = await ledger().getAccount(k, Math.max(0, index | 0), false);
  const w = { id: crypto.randomUUID(), label: label || ('Ledger #' + (index | 0)), kind: k, ledger: true, hwIndex: Math.max(0, index | 0), kda: null, eth: null };
  if (k === 'kda') w.kda = { account: acc.account, public: acc.public }; // SIN secret: la privada vive en el aparato
  else { w.eth = { address: acc.address, public: acc.public }; w.net = net || 'eth'; enableEvmNet(w.net); }
  const dup = unlocked.data.wallets.find(x => (w.kda && x.kda && x.kda.account === w.kda.account) || (w.eth && x.eth && x.eth.address === w.eth.address));
  if (dup) throw new Error('Esa cuenta ya está añadida como "' + dup.label + '".');
  unlocked.data.wallets.push(w); addShown(w.id); unlocked.data.active = w.id; saveVault();
  return { view: view(), account: w.kda ? w.kda.account : w.eth.address };
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
  if (!passOk(passphrase)) throw new Error('Contraseña incorrecta.');
  const w = unlocked.data.wallets.find(x => x.id === walletId) || active();
  if (w.ledger) throw new Error('Esta wallet es de Ledger: su clave privada vive dentro del aparato y no se puede exportar desde aquí.');
  const acc = w[chain];
  if (!acc) throw new Error('Esta wallet no tiene cuenta ' + chain.toUpperCase() + '.');
  return { chain, secret: acc.secret, public: acc.public, id: chain === 'kda' ? acc.account : acc.address };
});

// Por que falló una red, en corto y legible. Antes esto se tiraba a la basura y la tarjeta
// solo decia "sin conexion", que ademas mentia: cualquier excepcion pinta ese cartel, tambien
// las que no llegan a tocar la red. Sin el motivo no hay forma de distinguir un nodo caido de
// un fallo nuestro, ni para el usuario ni para quien da soporte.
// El RPC vivo de una red EVM: el que el usuario tiene puesto si responde y sirve la cadena
// correcta, y si no, la primera reserva del catalogo que cumpla las dos cosas. Ver elegirRpc
// en lib/eth.js, que es donde esta el porque y la comprobacion del chainId.
const rpcDe = (n, clave) => eth.elegirRpc({ clave: clave || n.key, rpc: n.rpc, reservas: n.reservas, chainId: n.chainId });

const motivo = (e) => String((e && (e.shortMessage || e.message)) || e || 'error').replace(/\s+/g, ' ').slice(0, 160);

// Dashboard: un BLOQUE (tarjeta) por cada red de cada wallet visible. Varias wallets a la vez.
ipcMain.handle('balances', async () => {
  if (!unlocked) throw new Error('bloqueado');
  const c = loadConfig();
  const prices = await getPrices();
  const px = (id) => prices[id] || 0;
  // Modo pruebas: con la Devnet activada solo se ven sus saldos ficticios (nada de redes reales ni EVM)
  const modoPruebas = c.kda.networks.some(n => n.key === 'devnet' && n.enabled);
  const blocks = []; let total = 0;
  for (const w of shownWallets()) {
    if (w.kind === 'kda' && w.kda) {
      for (const net of c.kda.networks.filter(n => n.enabled && (!modoPruebas || n.key === 'devnet'))) {
        try {
          const k = await kda.getBalance(w.kda.account, { node: net.node, networkId: net.networkId, chains: c.kda.chains });
          let tokens = [];
          if (net.fork) { // el fork tiene los tokens del puente (kb-*) en chain 2
            const kbs = await bridge.getKadenaBalances({ node: net.node, networkId: net.networkId, chain: c.bridge.kda.chain, routes: c.bridge.routes, account: w.kda.account });
            tokens = kbs.filter(t => t.balance > 0).map(t => { const rt = c.bridge.routes.find(r => r.symbol === t.symbol); return { symbol: 'kb-' + t.symbol, amount: t.balance, usd: t.balance * px(rt.cg) }; });
          }
          // Tokens fungibles KDA del catálogo del código (PCO y futuros). Se muestran SIEMPRE
          // (aunque 0) porque son una lista curada: así el usuario ve que están soportados.
          if (Array.isArray(net.tokens) && net.tokens.length) {
            const kt = await kda.getTokenBalances(w.kda.account, { node: net.node, networkId: net.networkId, tokens: net.tokens });
            for (const t of kt) tokens.push({ symbol: t.symbol, amount: t.amount, usd: t.cg ? t.amount * px(t.cg) : 0 });
          }
          const usd = net.key === 'devnet' ? 0 : k.total * px('kadena') + tokens.reduce((s, t) => s + t.usd, 0);
          blocks.push({ walletId: w.id, walletLabel: w.label, kind: 'kda', knet: net.key, name: net.name, color: net.color, address: w.kda.account, native: k.total, perChain: k.perChain, tokens, usd });
          total += usd;
        } catch (e) { blocks.push({ walletId: w.id, walletLabel: w.label, kind: 'kda', knet: net.key, name: net.name, color: net.color, address: w.kda.account, native: 0, perChain: {}, tokens: [], usd: 0, error: true, errorMsg: motivo(e) }); }
      }
    } else if (w.kind === 'evm' && w.eth) {
      for (const n of c.evm.filter(x => x.enabled && !modoPruebas)) {
        try {
          const b = await eth.getBalances(w.eth.address, { rpc: await rpcDe(n), tokens: n.tokens });
          const tokens = b.tokens.map(t => ({ ...t, usd: t.amount * px((n.tokens.find(x => x.symbol === t.symbol) || {}).cg) }));
          const nativeUsd = b.native * px(n.cg);
          const usd = nativeUsd + tokens.reduce((s, t) => s + t.usd, 0);
          blocks.push({ walletId: w.id, walletLabel: w.label, kind: 'evm', key: n.key, name: n.name, color: n.color, symbol: n.symbol, address: w.eth.address, native: b.native, nativeUsd, tokens, usd });
          total += usd;
        } catch (e) { blocks.push({ walletId: w.id, walletLabel: w.label, kind: 'evm', key: n.key, name: n.name, color: n.color, symbol: n.symbol, address: w.eth.address, native: 0, nativeUsd: 0, tokens: [], usd: 0, error: true, errorMsg: motivo(e) }); }
      }
    }
  }
  return { blocks, total, modoPruebas };
});

// Grifo de la Devnet: sender00 regala KDA de prueba. Sus claves son PÚBLICAS y de
// desarrollo (ver lib/devnet-publico.js); solo sirven en la devnet.
const GRIFO_DEVNET = devnetPub.GRIFO;
ipcMain.handle('devnet:faucet', async (_e, { walletId }) => {
  if (!unlocked) throw new Error('bloqueado');
  const c = loadConfig();
  const net = c.kda.networks.find(n => n.key === 'devnet');
  if (!net || !net.enabled) throw new Error('La Devnet no está activada.');
  const w = unlocked.data.wallets.find(x => x.id === walletId);
  if (!w || w.kind !== 'kda' || !w.kda) throw new Error('Wallet no válida.');
  const r = await kda.transferCreate({ node: net.node, networkId: net.networkId, chain: GRIFO_DEVNET.chain, from: GRIFO_DEVNET.from, to: w.kda.account, amount: GRIFO_DEVNET.cantidad, secretHex: GRIFO_DEVNET.sec, publicHex: GRIFO_DEVNET.pub });
  const res = await kda.pollResult({ node: net.node, networkId: net.networkId, chain: GRIFO_DEVNET.chain, requestKey: r.requestKey });
  if (!res || !res.result || res.result.status !== 'success') throw new Error('La recarga no se minó: ' + JSON.stringify((res && res.result && res.result.error && res.result.error.message) || 'sin respuesta'));
  logHistory({ desc: `Grifo devnet: +${GRIFO_DEVNET.cantidad} KDA (chain ${GRIFO_DEVNET.chain}) → ${w.label}`, walletId: w.id });
  return { amount: GRIFO_DEVNET.cantidad, chain: GRIFO_DEVNET.chain, requestKey: r.requestKey };
});

ipcMain.handle('send:kda', async (_e, { passphrase, walletId, kdaNet, chain, to, amount }) => {
  if (!unlocked) throw new Error('bloqueado');
  const c = loadConfig(); const w = unlocked.data.wallets.find(x => x.id === walletId) || active();
  // Wallet Ledger: la confirmación es FÍSICA en el aparato; la contraseña de la bóveda no aplica (la clave no está en ella).
  if (!w.ledger && !passOk(passphrase)) throw new Error('Contraseña incorrecta.');
  const net = c.kda.networks.find(n => n.key === kdaNet) || c.kda.networks.find(n => n.enabled) || c.kda.networks[0];
  if (!w.kda) throw new Error('Esta wallet no tiene cuenta KDA.');
  let r;
  if (w.ledger) {
    // Wallet Ledger: la app Kadena del aparato construye y firma la transferencia (solo destinos k:).
    if (!String(to).startsWith('k:')) throw new Error('Con Ledger el destino debe ser una cuenta k:… (la app del aparato firma contra su pubkey).');
    kda.assertKdaAccount(to, 'destino');
    const amt = kda.canonDecimal(amount).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '.0'); // recortado: es lo que muestra la pantallita
    const pact = await ledger().signKdaTransfer({
      index: w.hwIndex, isCreate: true, toPubkey: String(to).slice(2), amount: amt,
      chainId: Number(chain), networkId: net.networkId, gasPrice: '1.0e-8', gasLimit: '2500', ttl: '600',
      creationTime: await ktime.creationTime(net.node, net.networkId, chain), nonce: 'koberlet-ledger:' + Date.now()
    });
    r = await kda.sendSigned({ node: net.node, networkId: net.networkId, chain, cmdObj: pact });
  } else {
    // Para destinos k: usamos transfer-create (crea la cuenta si no existe; si existe, exige su mismo guard).
    const fn = to.startsWith('k:') ? kda.transferCreate : kda.transfer;
    r = await fn({ node: net.node, networkId: net.networkId, chain, from: w.kda.account, to, amount, secretHex: w.kda.secret, publicHex: w.kda.public });
  }
  // Esperamos al minado para poder avisar si la tx falla en cadena (antes el fallo era silencioso)
  const res = await kda.pollResult({ node: net.node, networkId: net.networkId, chain, requestKey: r.requestKey, tries: net.key === 'devnet' ? 8 : 20 });
  if (res && res.result && res.result.status === 'failure') {
    throw new Error('La transacción falló en cadena: ' + ((res.result.error && res.result.error.message) || 'error desconocido'));
  }
  logHistory({ type: 'send-kda', wallet: w.label, desc: `Envío ${amount} KDA · chain ${chain} · ${net.name}`, to, id: r.requestKey });
  return { ...r, status: res ? 'success' : 'pending' };
});

// Envío de un TOKEN fungible KDA (PCO y futuros). El símbolo llega del renderer, pero el
// MÓDULO/chain/precisión se leen del catálogo del DEFAULT (no del renderer) — modelo Alex #4.
ipcMain.handle('send:kdatoken', async (_e, { passphrase, walletId, symbol, to, amount }) => {
  if (!unlocked) throw new Error('bloqueado');
  const c = loadConfig(); const w = unlocked.data.wallets.find(x => x.id === walletId) || active();
  if (!w.kda) throw new Error('Esta wallet no tiene cuenta KDA.');
  // Ledger: el aparato no puede mostrar código Pact arbitrario (firma ciega) → bloqueado, como mercado/puente.
  if (w.ledger) throw new Error('El envío de tokens KDA con Ledger no está disponible todavía (la app del aparato no muestra código de contrato). Usa una wallet de semilla o clave privada.');
  if (!passOk(passphrase)) throw new Error('Contraseña incorrecta.');
  let tok = null, net = null;
  for (const n of c.kda.networks) { const f = (n.tokens || []).find(t => t.symbol === symbol); if (f) { tok = f; net = n; break; } }
  // Los kb-* (kb-USDC, kb-USDT…) no están en el catálogo por red: sus datos viven en las rutas
  // del puente, y por eso antes no se podían enviar. Son fungible-v2 corrientes (verificado en
  // cadena el 26/08/2026, con la precisión del módulo igual a `decimals` de la ruta), así que se
  // envían con el mismo transfer que PCO. El módulo sale de `c.bridge`, que loadConfig fuerza
  // desde el DEFAULT del código: el renderer no puede colar un contrato de token hostil (Alex #4).
  if (!tok && /^kb-/.test(String(symbol))) {
    const rt = (c.bridge.routes || []).find(r => 'kb-' + r.symbol === symbol);
    net = c.kda.networks.find(n => n.enabled && n.fork) || null;   // los kb-* solo viven en el fork
    if (rt && net) tok = { symbol, module: bridge.NS + '.' + rt.kadenaModule, precision: rt.decimals, chain: c.bridge.kda.chain, cg: rt.cg };
  }
  if (!tok || !net) throw new Error('Token KDA no reconocido: ' + symbol);
  // El token puede vivir en cualquier chain: enviar desde la que tenga más saldo del remitente.
  const bal = await kda.getTokenBalances(w.kda.account, { node: net.node, networkId: net.networkId, tokens: [tok] });
  const pc = (bal[0] && bal[0].perChain) || {};
  const sendChain = Object.keys(pc).sort((a, b) => pc[b] - pc[a])[0];
  if (sendChain === undefined) throw new Error('No tienes saldo de ' + symbol + ' en ninguna chain.');
  if (Number(amount) > (pc[sendChain] || 0) + 1e-12) throw new Error(`En la chain ${sendChain} solo tienes ${pc[sendChain]} ${symbol}. Envía como mucho eso (el saldo no se junta entre chains todavía).`);
  const r = await kda.transferToken({ node: net.node, networkId: net.networkId, chain: sendChain, module: tok.module,
    from: w.kda.account, to, amount, secretHex: w.kda.secret, publicHex: w.kda.public, precision: tok.precision });
  const res = await kda.pollResult({ node: net.node, networkId: net.networkId, chain: sendChain, requestKey: r.requestKey, tries: 20 });
  if (res && res.result && res.result.status === 'failure') throw new Error('La transacción falló en cadena: ' + ((res.result.error && res.result.error.message) || 'error desconocido'));
  logHistory({ type: 'send-kdatoken', wallet: w.label, desc: `Envío ${amount} ${symbol} · chain ${sendChain} · ${net.name}`, to, id: r.requestKey });
  return { ...r, status: res ? 'success' : 'pending' };
});

// ---- DCA de KoberluSW ----
// La red y el modulo salen del DEFAULT; el renderer solo elige wallet e importes.
function cfgDca() {
  const c = loadConfig();
  const net = c.kda.networks.find(n => n.key === c.dca.red) || c.kda.networks.find(n => n.fork);
  if (!net) throw new Error('La red del DCA no esta configurada.');
  return { cfg: { node: net.node, networkId: net.networkId, chain: String(c.bridge.kda.chain), modulo: c.dca.modulo, moduloOrdenes: c.dca.moduloOrdenes, gasolinera: c.dca.gasolinera }, c, net };
}
// Precisiones por modulo, para el decimal canonico del topup.
function precisionesDca(c) {
  const m = {};
  for (const t of Object.values(c.dca.tokens)) m[t.modulo] = t.precision;
  return m;
}
function walletDca(walletId) {
  if (!unlocked) throw new Error('bloqueado');
  const w = unlocked.data.wallets.find(x => x.id === walletId) || active();
  if (!w || !w.kda) throw new Error('Esta wallet no tiene cuenta KDA.');
  // Ledger fuera, como Mercado y Puente: el aparato no muestra codigo de contrato.
  if (w.ledger) throw new Error('El DCA con Ledger no esta disponible: el aparato no puede mostrar la llamada al contrato y seria firma ciega.');
  return w;
}
ipcMain.handle('dca:estado', async (_e, { walletId } = {}) => {
  const { cfg, c } = cfgDca();
  const w = (unlocked && (unlocked.data.wallets.find(x => x.id === walletId) || active())) || null;
  const cuenta = w && w.kda ? w.kda.account : null;
  const [planes, ordenes, pausado] = await Promise.all([
    cuenta ? dca.planesDe(cfg, cuenta).catch(() => []) : Promise.resolve([]),
    cuenta ? dca.ordenesDe(cfg, cuenta).catch(() => []) : Promise.resolve([]),
    dca.pausado(cfg).catch(() => null)
  ]);
  return { cuenta, pausado, ordenes: ordenes || [], comision: c.dca.comision, web: c.dca.web, limites: dca.LIMITES,
           tokens: c.dca.tokens, planes: (planes || []).map(p => ({ ...p, tokenIn: dca.refMod(p['token-in']), tokenOut: dca.refMod(p['token-out']) })) };
});
// Resumen para el Panel: planes DCA y ordenes limite abiertas de las wallets visibles.
// Una sola lectura de list-open para todas, que devuelve las de todo el mundo y se
// reparte aqui: asi no se pregunta a la cadena una vez por wallet.
ipcMain.handle('dca:panel', async () => {
  if (!unlocked) return { filas: [] };
  const { cfg } = cfgDca();
  const vistas = unlocked.data.wallets.filter(w => w.kda && (unlocked.data.shown || []).includes(w.id));
  const wallets = vistas.length ? vistas : unlocked.data.wallets.filter(w => w.kda);
  if (!wallets.length) return { filas: [] };
  // list-open devuelve las ordenes de TODO el mundo: se pide UNA vez y se reparte.
  let abiertas = [];
  try { abiertas = await dca.todasLasOrdenes(cfg); } catch (_) {}
  const filas = [];
  for (const w of wallets) {
    let planes = [];
    try { planes = await dca.planesDe(cfg, w.kda.account); } catch (_) {}
    const ords = abiertas.filter(o => String(o.owner) === String(w.kda.account));
    const vivos = (planes || []).filter(p => p.status !== 'closed');
    if (!vivos.length && !ords.length) continue;
    filas.push({
      wallet: w.label, cuenta: w.kda.account,
      planes: vivos.map(p => ({ id: p.id, estado: p.status, cuota: p.quota, periodo: p.period,
        balance: p.balance, buys: p.buys, tokenIn: dca.refMod(p['token-in']), tokenOut: dca.refMod(p['token-out']) })),
      ordenes: (ords || []).map(o => ({ id: o.id, entra: o['amount-in'], precio: o['trigger-price'],
        estado: o.status, tokenIn: dca.refMod(o['token-in']), tokenOut: dca.refMod(o['token-out']) }))
    });
  }
  return { filas };
});
ipcMain.handle('dca:crear', async (_e, { passphrase, walletId, de, a, deposito, cuota, periodo, slippage } = {}) => {
  const w = walletDca(walletId);
  if (!passOk(passphrase)) throw new Error('Contrasena incorrecta.');
  const { cfg, c } = cfgDca();
  const tIn = c.dca.tokens[de], tOut = c.dca.tokens[a];
  if (!tIn || !tOut) throw new Error('Ese par no esta soportado por el DCA.');
  const rc = await dca.crearPlan(cfg, { owner: w.kda.account, publicHex: w.kda.public, secretHex: w.kda.secret,
    tokenIn: tIn.modulo, tokenOut: tOut.modulo, precIn: tIn.precision,
    deposito, cuota, periodo, slippage });
  return { ...rc, chain: cfg.chain };   // el renderer necesita la chain para sondear
});
ipcMain.handle('dca:recargar', async (_e, { passphrase, walletId, id, cantidad } = {}) => {
  const w = walletDca(walletId);
  if (!passOk(passphrase)) throw new Error('Contrasena incorrecta.');
  const { cfg, c } = cfgDca();
  const rr = await dca.recargar(cfg, { id, cantidad, owner: w.kda.account, publicHex: w.kda.public,
    secretHex: w.kda.secret, precisiones: precisionesDca(c) });
  return { ...rr, chain: cfg.chain };
});
ipcMain.handle('dca:accion', async (_e, { passphrase, walletId, id, que } = {}) => {
  const w = walletDca(walletId);
  if (!passOk(passphrase)) throw new Error('Contrasena incorrecta.');
  const { cfg } = cfgDca();
  const ra = await dca.accion(cfg, { id, que, owner: w.kda.account, publicHex: w.kda.public, secretHex: w.kda.secret });
  return { ...ra, chain: cfg.chain };
});

// ---- ORDENES LIMITE de KoberluSW (contrato free.ksw2) ----
// Koberlet crea y cancela; la ejecucion la dispara el vigilante de KoberluSW pagando
// su propio gas. El contrato re-comprueba precio y minimo, asi que depender de un
// vigilante ajeno no le da ningun poder sobre el dinero.
//
// El par va fijo porque el contrato solo admite dos tokens (ALLOWED-TOKENS): coin y
// kb-USDC. Se arma desde la config del DCA para no repetir el modulo del token.
function parOrdenes(c) {
  const k = c.dca.tokens.KDA, u = c.dca.tokens['kb-USDC'];
  return {
    kda: { modulo: k.modulo, precision: k.precision, simbolo: 'KDA' },
    usdc: { modulo: u.modulo, precision: u.precision, simbolo: 'kb-USDC' }
  };
}
ipcMain.handle('ord:estado', async (_e, { walletId } = {}) => {
  const { cfg, c } = cfgDca();
  const par = parOrdenes(c);
  const w = (unlocked && (unlocked.data.wallets.find(x => x.id === walletId) || active())) || null;
  const cuenta = w && w.kda ? w.kda.account : null;
  // list-open trae las ordenes de todo el mundo: se pide UNA vez y de ahi salen tanto
  // las del usuario como el libro publico, en vez de leer la cadena dos veces.
  const [todas, pausa, lim, res] = await Promise.all([
    ordenes.todas(cfg, par).catch(() => []),
    ordenes.pausado(cfg).catch(() => null),
    ordenes.limites(cfg).catch(() => null),
    ordenes.reservas(cfg, par).catch(() => null)
  ]);
  return {
    cuenta, pausado: pausa, limites: lim,
    precio: res ? res.precio : null,
    mias: cuenta ? todas.filter(o => String(o.owner) === String(cuenta)) : [],
    // El libro es publico y ANONIMO: se ensena que hay, no de quien es.
    libro: todas.map(o => ({ lado: o.lado, cantidad: o.cantidad, precio: o.precio, minimo: o.minimo, simIn: o.simIn, simOut: o.simOut })),
    web: c.dca.web
  };
});
ipcMain.handle('ord:cotizar', async (_e, { direccion, cantidad, precio, slippage } = {}) => {
  const { cfg, c } = cfgDca();
  const q = await ordenes.cotizar(cfg, { par: parOrdenes(c), direccion, cantidad, precio, slippage });
  // El renderer no necesita los modulos del token, solo el simbolo para pintarlo.
  return { ...q, tokenIn: q.tokenIn.simbolo, tokenOut: q.tokenOut.simbolo };
});
ipcMain.handle('ord:crear', async (_e, { passphrase, walletId, direccion, cantidad, precio, slippage } = {}) => {
  const w = walletDca(walletId);
  if (!passOk(passphrase)) throw new Error('Contrasena incorrecta.');
  const { cfg, c } = cfgDca();
  const r = await ordenes.crearOrden(cfg, {
    par: parOrdenes(c), direccion, cantidad, precio, slippage,
    owner: w.kda.account, publicHex: w.kda.public, secretHex: w.kda.secret
  });
  return { requestKey: r.requestKey, id: r.id, chain: cfg.chain };
});
ipcMain.handle('ord:cancelar', async (_e, { passphrase, walletId, id } = {}) => {
  const w = walletDca(walletId);
  if (!passOk(passphrase)) throw new Error('Contrasena incorrecta.');
  const { cfg } = cfgDca();
  const r = await ordenes.cancelarOrden(cfg, { id, owner: w.kda.account, publicHex: w.kda.public, secretHex: w.kda.secret });
  return { ...r, chain: cfg.chain };
});

// ---- MERCADO KADENA: cualquier token del DEX contra cualquier otro ----
// El catalogo NO esta escrito en ningun sitio: se lee de la cadena cada vez, porque
// en este DEX los pares aparecen y se secan solos. Se cachea un minuto para no
// castigar al nodo mientras el usuario teclea la cantidad.
let MERCADO_CACHE = null;
function cfgDex() {
  const c = loadConfig();
  const net = c.kda.networks.find(n => n.enabled && n.fork);
  if (!net) throw new Error('La red del fork no esta activa.');
  return { node: net.node, networkId: net.networkId, chain: '2' };
}
async function mercadoDex(forzar) {
  const cfg = cfgDex();
  if (!forzar && MERCADO_CACHE && Date.now() - MERCADO_CACHE.ts < 60000) return MERCADO_CACHE;
  const m = await dex.mercado(cfg);
  MERCADO_CACHE = { ts: Date.now(), m, cfg };
  return MERCADO_CACHE;
}
ipcMain.handle('dex:tokens', async (_e, { forzar } = {}) => {
  const { m } = await mercadoDex(forzar);
  // Se manda la lista tal cual esta en la cadena, con el fondo, para que la pantalla
  // pueda avisar de los charcos. KDA va primero: es la moneda de la casa.
  return {
    kda: { modulo: 'coin', simbolo: 'KDA', fondoKda: null },
    tokens: m.tokens.map(t => ({ modulo: t.modulo, simbolo: t.simbolo, fondoKda: t.fondoKda, precioKda: t.precioKda })),
    fondoMin: dex.FONDO_MIN, impactoMax: dex.IMPACTO_MAX
  };
});
ipcMain.handle('dex:cotizar', async (_e, { de, a, cantidad, slippage } = {}) => {
  const { m, cfg } = await mercadoDex(false);
  const q = await dex.cotizar(cfg, m, de, a, cantidad, slippage);
  return {
    esperada: q.esperada, minimo: q.minimo, minimoStr: q.minimoStr, decOut: q.decOut,
    impacto: q.impacto, impactoMax: q.impactoMax, frenado: q.frenado, saltos: q.saltos,
    camino: q.camino.map(x => x === 'coin' ? 'KDA' : x.split('.').pop()),
    precioEfectivo: q.precioEfectivo, precioSpot: q.precioSpot, slippagePct: q.slippagePct,
    fondoEntrada: q.fondoEntrada
  };
});
ipcMain.handle('dex:saldo', async (_e, { walletId, modulo } = {}) => {
  if (!unlocked) throw new Error('bloqueado');
  const w = unlocked.data.wallets.find(x => x.id === walletId) || active();
  if (!w || !w.kda) throw new Error('Esta wallet no tiene cuenta KDA.');
  const cfg = cfgDex();
  const r = await kda.local(cfg.node, cfg.networkId, cfg.chain, '(' + modulo + '.get-balance "' + w.kda.account + '")');
  // Que no exista la fila del token no es un error: es que tienes cero.
  if (r.status !== 'success') return { saldo: 0 };
  const v = r.data;
  return { saldo: Number(typeof v === 'object' && v ? (v.decimal != null ? v.decimal : v.int) : v) || 0 };
});
ipcMain.handle('dex:cambiar', async (_e, { passphrase, walletId, de, a, cantidad, slippage } = {}) => {
  if (!unlocked) throw new Error('bloqueado');
  const w = unlocked.data.wallets.find(x => x.id === walletId) || active();
  if (!w || !w.kda) throw new Error('Esta wallet no tiene cuenta KDA.');
  if (w.ledger) throw new Error('Con Ledger no se puede cambiar aqui: el aparato no sabe ensenar la llamada al AMM y seria firma ciega.');
  if (!passOk(passphrase)) throw new Error('Contrasena incorrecta.');
  const cfg = cfgDex();
  const r = await dex.cambiar(cfg, { de, a, cantidad, slippage, cuenta: w.kda.account,
                                     publicHex: w.kda.public, secretHex: w.kda.secret });
  MERCADO_CACHE = null;               // el pool acaba de moverse: la cache ya no vale
  logHistory({ type: 'dex', wallet: w.label, chain: 2, id: r.requestKey, to: '',
               desc: `Cambio ${cantidad} ${r.camino.map(x => x === 'coin' ? 'KDA' : x.split('.').pop()).join(' \u2192 ')}` });
  return r;
});

// ---- LAUNCH: ventas directas a precio fijo ----
// La venta y el token salen del catalogo del DEFAULT; el renderer solo manda la
// clave y la cantidad. Con Ledger esta bloqueado, como todo lo que firma contrato.
function cfgLaunch(clave) {
  const c = loadConfig();
  const v = (c.launch.ventas || []).find(x => x.clave === clave);
  if (!v) throw new Error('Esa venta no existe.');
  const net = c.kda.networks.find(n => n.key === c.launch.red) || c.kda.networks.find(n => n.enabled && n.fork);
  if (!net) throw new Error('La red de la venta no esta configurada.');
  return { cfg: { node: net.node, networkId: net.networkId, chain: v.chain,
                  modulo: v.modulo, token: v.token, precision: v.precision }, v, net };
}
ipcMain.handle('launch:lista', () => {
  const c = loadConfig();
  return (c.launch.ventas || []).map(v => ({ clave: v.clave, nombre: v.nombre, simbolo: v.simbolo,
    chain: v.chain, de: v.de, web: v.web, avisos: v.avisos || [] }));
});
ipcMain.handle('launch:estado', async (_e, { clave } = {}) => {
  const { cfg, v } = cfgLaunch(clave);
  const est = await launch.estado(cfg);
  return Object.assign({}, est, { clave: v.clave, nombre: v.nombre, simbolo: v.simbolo,
                                  de: v.de, web: v.web, avisos: v.avisos || [] });
});
ipcMain.handle('launch:saldo', async (_e, { clave, walletId } = {}) => {
  if (!unlocked) throw new Error('bloqueado');
  const w = unlocked.data.wallets.find(x => x.id === walletId) || active();
  if (!w || !w.kda) throw new Error('Esta wallet no tiene cuenta KDA.');
  const { cfg } = cfgLaunch(clave);
  // Lo que importa aqui es el KDA EN LA CHAIN DE LA VENTA, no el total.
  const enChain = await kda.getBalance(w.kda.account, { node: cfg.node, networkId: cfg.networkId, chains: [Number(cfg.chain)] });
  const todas = await kda.getBalance(w.kda.account, { node: cfg.node, networkId: cfg.networkId });
  return { cuenta: w.kda.account, enChain: enChain.total, total: todas.total, porChain: todas.perChain };
});
ipcMain.handle('launch:comprar', async (_e, { passphrase, walletId, clave, cantidad } = {}) => {
  if (!unlocked) throw new Error('bloqueado');
  const w = unlocked.data.wallets.find(x => x.id === walletId) || active();
  if (!w || !w.kda) throw new Error('Esta wallet no tiene cuenta KDA.');
  if (w.ledger) throw new Error('La compra con Ledger no esta disponible: el aparato no puede mostrar la llamada al contrato y seria firma ciega.');
  if (!passOk(passphrase)) throw new Error('Contrasena incorrecta.');
  const { cfg, v } = cfgLaunch(clave);
  const r = await launch.comprar(cfg, { comprador: w.kda.account, publicHex: w.kda.public,
                                        secretHex: w.kda.secret, cantidad });
  logHistory({ type: 'launch', wallet: w.label, desc: `Compra ${r.cantidad} ${v.simbolo} por ${r.coste} KDA \u00b7 chain ${r.chain}`,
               to: '', id: r.requestKey, chain: Number(r.chain) });
  return r;
});

// ---- Cambio de token en Ethereum (Uniswap V3) ----
// El par SIEMPRE sale del catálogo del código: el renderer manda un símbolo, no direcciones.
function parEvmSwap(c, deSym, aSym) {
  const p = (c.evmSwap.pares || []).find(x => x.de === deSym && x.a === aSym);
  if (!p) throw new Error('Ese cambio no está soportado: ' + deSym + ' → ' + aSym);
  const net = c.evm.find(n => n.key === c.evmSwap.red);
  if (!net) throw new Error('La red del cambio no está configurada.');
  return { p, net };
}
ipcMain.handle('evmswap:cotizar', async (_e, { de, a, amount } = {}) => {
  const c = loadConfig(); const { p, net } = parEvmSwap(c, de, a);
  return evmswap.cotizar({ rpc: await rpcDe(net), tokenIn: p.tokenDe, tokenOut: p.tokenA, decIn: p.decDe, decOut: p.decA, amount });
});
ipcMain.handle('evmswap:enviar', async (_e, { passphrase, walletId, de, a, amount, slippage } = {}) => {
  if (!unlocked) throw new Error('bloqueado');
  const c = loadConfig(); const w = unlocked.data.wallets.find(x => x.id === walletId) || active();
  if (!w.eth) throw new Error('Esta wallet no tiene cuenta de Ethereum.');
  // Ledger fuera, igual que Mercado y Puente: el aparato no muestra código de contrato
  // y firmar un swap a ciegas es justo lo que no debe hacer un monedero.
  if (w.ledger) throw new Error('El cambio de tokens con Ledger no está disponible: el aparato no puede mostrar la llamada al contrato y seria firma ciega.');
  if (!passOk(passphrase)) throw new Error('Contraseña incorrecta.');
  const { p, net } = parEvmSwap(c, de, a);
  const r = await evmswap.swap({ rpc: await rpcDe(net), secretHex: w.eth.secret, tokenIn: p.tokenDe, tokenOut: p.tokenA,
    decIn: p.decDe, decOut: p.decA, amount, slippage: Math.min(5, Math.max(0.05, Number(slippage) || 0.5)) },
    (m) => { try { _e.sender.send('evmswap:progress', m); } catch (_) {} });
  logHistory({ type: 'evm-swap', wallet: w.label, desc: `Cambio ${amount} ${de} → ${r.esperado.toFixed(4)} ${a} · Uniswap`, to: '', id: r.hash });
  return r;
});

// Textos de la espera del puente. Viajan en los dos idiomas y el renderer elige el
// suyo: el proceso principal no tiene por que saber en que idioma esta la ventana.
const NOTA_RELAY = { es: 'Kadena ya lo ha enviado y está confirmado. Ahora depende del relé del puente, que suele tardar entre 2 y 5 minutos. Puedes cerrar esta ventana: el envío sigue su curso y no hay que repetir nada.',
                     en: 'Kadena has already sent it and it is confirmed. It now depends on the bridge relayer, which usually takes between 2 and 5 minutes. You can close this window: the transfer is on its way and nothing needs repeating.' };
const NOTA_TARDA = { es: 'Está tardando más de lo normal. Tus fondos NO se han perdido: salieron de Kadena y el relé los entregará. Compruébalo dentro de un rato mirando tu saldo en Ethereum.',
                     en: 'This is taking longer than usual. Your funds are NOT lost: they left Kadena and the relayer will deliver them. Check your Ethereum balance again in a while.' };
const NOTA_OK = { es: 'Recibido en Ethereum. Puente completado.', en: 'Received on Ethereum. Bridge complete.' };

// Cuentas de desarrollo con claves PÚBLICAS (ver lib/devnet-publico.js): en la devnet
// hacen de pagador de gas cuando la wallet aún no tiene saldo en la chain de destino.
const DEV_SENDERS = { sender00: devnetPub.SENDER00 };
ipcMain.handle('send:kda-xchain', async (_e, { passphrase, walletId, kdaNet, sourceChain, targetChain, to, amount }) => {
  if (!unlocked) throw new Error('bloqueado');
  const c = loadConfig(); const w = unlocked.data.wallets.find(x => x.id === walletId) || active();
  if (w.ledger) throw new Error('Los envíos entre chains con Ledger llegarán más adelante. De momento usa la misma chain de origen y destino.');
  if (!passOk(passphrase)) throw new Error('Contraseña incorrecta.');
  const net = c.kda.networks.find(n => n.key === kdaNet) || c.kda.networks.find(n => n.enabled) || c.kda.networks[0];
  if (!w.kda) throw new Error('Esta wallet no tiene cuenta KDA.');
  // Gas de la redención en destino: lo paga el propio remitente si tiene saldo allí; si no
  // y estamos en la devnet, lo paga sender00 (clave pública de desarrollo).
  let gasPayer = { account: w.kda.account, secretHex: w.kda.secret, publicHex: w.kda.public };
  try {
    const bal = await kda.getBalance(w.kda.account, { node: net.node, networkId: net.networkId, chains: [Number(targetChain)] });
    if (!(bal.perChain[targetChain] > 0.001) && net.key === 'devnet') gasPayer = DEV_SENDERS.sender00;
  } catch (_) {}
  const r = await kda.transferCrossChain({
    node: net.node, networkId: net.networkId, sourceChain, targetChain,
    from: w.kda.account, to, amount, secretHex: w.kda.secret, publicHex: w.kda.public, gasPayer,
    onProgress: (m) => { try { _e.sender.send('xchain:progress', m); } catch (_) {} }
  });
  logHistory({ type: 'send-kda-xchain', wallet: w.label, desc: `Cross-chain ${amount} KDA · chain ${sourceChain}→${targetChain} · ${net.name}`, to, id: r.pactId });
  return r;
});

// Envío inteligente: junta saldo de varias chains en la de destino si una sola no llega.
ipcMain.handle('send:kda-smart', async (_e, { passphrase, walletId, kdaNet, targetChain, to, amount }) => {
  if (!unlocked) throw new Error('bloqueado');
  const c = loadConfig(); const w = unlocked.data.wallets.find(x => x.id === walletId) || active();
  if (w.ledger) throw new Error('El barrido multi-chain con Ledger llegará más adelante. Envía desde una chain con saldo suficiente.');
  if (!passOk(passphrase)) throw new Error('Contraseña incorrecta.');
  const net = c.kda.networks.find(n => n.key === kdaNet) || c.kda.networks.find(n => n.enabled) || c.kda.networks[0];
  if (!w.kda) throw new Error('Esta wallet no tiene cuenta KDA.');
  // El gas de las redenciones cross-chain lo paga sender00 en la devnet; en otras redes, el propio remitente.
  const gasPayer = net.key === 'devnet' ? DEV_SENDERS.sender00 : { account: w.kda.account, secretHex: w.kda.secret, publicHex: w.kda.public };
  const r = await kda.sendSmart({
    node: net.node, networkId: net.networkId, targetChain, from: w.kda.account, to, amount,
    secretHex: w.kda.secret, publicHex: w.kda.public, gasPayer,
    onProgress: (m) => { try { _e.sender.send('xchain:progress', m); } catch (_) {} }
  });
  logHistory({ type: 'send-kda-smart', wallet: w.label, desc: `Envío ${amount} KDA (barrido multi-chain) → chain ${targetChain} · ${net.name}`, to, id: r.requestKey });
  return r;
});
ipcMain.handle('send:evm', async (_e, { passphrase, walletId, network, token, to, amount }) => {
  if (!unlocked) throw new Error('bloqueado');
  const c = loadConfig(); const w = unlocked.data.wallets.find(x => x.id === walletId) || active();
  if (!w.ledger && !passOk(passphrase)) throw new Error('Contraseña incorrecta.');
  if (!w.eth) throw new Error('Esta wallet no tiene cuenta EVM.');
  const n = c.evm.find(x => x.key === network); if (!n) throw new Error('Red no válida.');
  const nativo = !token || token === n.symbol;
  // El nodo se elige ANTES de firmar y con el chainId comprobado: si el configurado esta
  // caido se usa una reserva, pero nunca una que sirva otra cadena.
  const rpcEnvio = await rpcDe(n);
  const r = w.ledger
    ? (nativo ? await ledger().sendNative({ index: w.hwIndex, rpc: rpcEnvio, to, amount })
              : await ledger().sendToken({ index: w.hwIndex, rpc: rpcEnvio, token, to, amount }))
    : (nativo ? await eth.sendNative({ rpc: rpcEnvio, secretHex: w.eth.secret, to, amount })
              : await eth.sendToken({ rpc: rpcEnvio, secretHex: w.eth.secret, token, to, amount }));
  logHistory({ type: 'send-evm', wallet: w.label, desc: `Envío ${amount} ${nativo ? n.symbol : 'token'} · ${n.name}`, to, id: r.hash });
  return r;
});

ipcMain.handle('bridge:config', () => loadConfig().bridge);
const walletById = (id) => unlocked.data.wallets.find(w => w.id === id);
// Saldos de los tokens del puente según dirección: 'evm2kda' lee saldos EVM; 'kda2evm' lee saldos Kadena.
ipcMain.handle('bridge:tokens', async (_e, { walletId, dir }) => {
  if (!unlocked) throw new Error('bloqueado');
  const w = walletById(walletId); const b = loadConfig().bridge; if (!w) return [];
  if (dir === 'evm2kda') { if (!w.eth) return []; return bridge.getEvmBalances({ rpc: await rpcDe(b.evm, 'puente-evm'), address: w.eth.address, routes: b.routes }); }
  if (!w.kda) return []; return bridge.getKadenaBalances({ node: b.kda.node, networkId: b.kda.networkId, chain: b.kda.chain, routes: b.routes, account: w.kda.account });
});
ipcMain.handle('bridge:dryrun', async (_e, { dir, fromWalletId, symbol, recipient, amount }) => {
  if (!unlocked) throw new Error('bloqueado');
  const w = walletById(fromWalletId) || active(); const b = loadConfig().bridge;
  const route = b.routes.find(r => r.symbol === symbol); if (!route) throw new Error('Token no válido.');
  if (dir === 'evm2kda') {
    if (!w.eth) throw new Error('La wallet origen no tiene cuenta EVM.');
    return bridge.dryRunEvm2Kda({ rpc: await rpcDe(b.evm, 'puente-evm'), router: route.evmRouter, evmToken: route.evmToken, fromAddress: w.eth.address, kadenaAccount: recipient, amount, decimals: route.decimals, kadenaDomain: b.kda.domain, kadenaChain: b.kda.chain });
  }
  if (!w.kda) throw new Error('La wallet origen no tiene cuenta KDA.');
  return bridge.dryRunKda2Evm({ node: b.kda.node, networkId: b.kda.networkId, chain: b.kda.chain, senderAccount: w.kda.account, senderPubKey: w.kda.public, kadenaModule: route.kadenaModule, evmDomain: b.evm.domain, recipientEvmAddr: recipient, amount });
});
// ENVÍO REAL del puente (mueve fondos). Exige la contraseña de la bóveda.
ipcMain.handle('bridge:send', async (_e, { dir, passphrase, fromWalletId, symbol, recipient, amount }) => {
  if (!unlocked) throw new Error('bloqueado');
  const w = walletById(fromWalletId) || active(); const b = loadConfig().bridge;
  // Con Ledger: Ethereum→Kadena SÍ (approve+transferRemote son txs EVM que el aparato firma);
  // Kadena→EVM NO todavía (el dispatch es código Pact arbitrario → firma ciega, fase futura).
  if (w.ledger && dir !== 'evm2kda') throw new Error('El puente Kadena→EVM con Ledger llegará más adelante (necesita firmar código Pact en el aparato). El sentido Ethereum→Kadena sí funciona con Ledger.');
  if (!w.ledger && !passOk(passphrase)) throw new Error('Contraseña incorrecta.');
  const route = b.routes.find(r => r.symbol === symbol); if (!route) throw new Error('Token no válido.');
  if (dir === 'evm2kda') {
    if (!w.eth) throw new Error('La wallet origen no tiene cuenta EVM.');
    const onStep = (d) => { try { _e.sender.send('bridge:step', d); } catch (_) {} };
    const kb = async () => (await bridge.getKadenaBalances({ node: b.kda.node, networkId: b.kda.networkId, chain: b.kda.chain, routes: [route], account: recipient }))[0].balance;
    const before = await kb().catch(() => 0);
    const res = await bridge.sendEvm2Kda({ rpc: await rpcDe(b.evm, 'puente-evm'), secretHex: w.ledger ? undefined : w.eth.secret, ledgerIndex: w.ledger ? w.hwIndex : undefined, router: route.evmRouter, token: route.evmToken, kadenaAccount: recipient, amount, decimals: route.decimals, kadenaDomain: b.kda.domain, kadenaChain: b.kda.chain }, onStep);
    // Esperar la llegada a Kadena (relayer)
    onStep({ step: 'kadena', status: 'run', detail: 'Esperando al relayer del puente…' });
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    let arrived = false;
    for (let i = 0; i < 24 && !arrived; i++) { await sleep(15000); const now = await kb().catch(() => before); if (now > before + 1e-9) { onStep({ step: 'kadena', status: 'ok', detail: 'recibido · saldo ' + now }); arrived = true; } }
    if (!arrived) onStep({ step: 'kadena', status: 'pending', detail: 'aún no entregado; el relayer del puente puede tardar (fondos no perdidos)' });
    logHistory({ type: 'bridge', wallet: w.label || '', desc: `Puente ${amount} ${symbol} · Ethereum → Kadena${arrived ? ' (recibido)' : ' (pendiente relayer)'}`, to: recipient, id: res.txHash });
    return { ...res, arrived };
  }
  // KADENA -> EVM real: dispatch firmado en el fork + espera de llegada del token al lado EVM
  if (!w.kda) throw new Error('La wallet origen no tiene cuenta KDA.');
  const onStep = (d) => { try { _e.sender.send('bridge:step', d); } catch (_) {} };
  const evmBal = async () => { try { return (await bridge.getEvmBalances({ rpc: await rpcDe(b.evm, 'puente-evm'), address: recipient, routes: [route] }))[0].balance; } catch (_) { return 0; } };
  const before = await evmBal();
  const res = await bridge.sendKda2Evm({ node: b.kda.node, networkId: b.kda.networkId, chain: b.kda.chain, senderAccount: w.kda.account, senderPubKey: w.kda.public, secretHex: w.kda.secret, kadenaModule: route.kadenaModule, evmDomain: b.evm.domain, recipientEvmAddr: recipient, amount }, onStep);
  if (res.minedOk === false) throw new Error('La tx falló en Kadena: ' + JSON.stringify(res.error || {}).slice(0, 160));
  let arrived = false;
  if (res.minedOk) {
    // La entrega en Ethereum no la hace Koberlet: la hace el relé del puente. Aquí solo
    // se vigila el saldo del destinatario. Lo importante durante esta espera no es el
    // reloj, es que el usuario sepa que puede cerrar sin miedo: si duda, reenvía.
    const reloj = (seg) => Math.floor(seg / 60) + ':' + String(seg % 60).padStart(2, '0');
    onStep({ step: 'evm', status: 'run', detail: 'esperando al relé · 0:00', nota: NOTA_RELAY });
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const t0 = Date.now();
    for (let i = 0; i < 24 && !arrived; i++) {
      await sleep(15000);
      const now = await evmBal();
      if (now > before + 1e-9) {
        onStep({ step: 'evm', status: 'ok', detail: 'recibido · saldo ' + now, nota: NOTA_OK });
        arrived = true;
      } else {
        onStep({ step: 'evm', status: 'run', detail: 'esperando al relé · ' + reloj(Math.round((Date.now() - t0) / 1000)) });
      }
    }
    if (!arrived) onStep({ step: 'evm', status: 'pending', detail: 'aún no entregado', nota: NOTA_TARDA });
  }
  logHistory({ type: 'bridge', wallet: w.label || '', desc: `Puente ${amount} ${symbol} · Kadena → Ethereum${arrived ? ' (recibido)' : ' (pendiente relayer)'}`, to: recipient, id: res.requestKey });
  return { ...res, txHash: res.requestKey, arrived };
});

// Mercado: swap KDA <-> kb-USDC en el pool del fork (kaddex.exchange, chain 2). No custodial: firma el main con la clave de la wallet.
ipcMain.handle('swap:quote', async (_e, { dir, amount }) => swap.quote(dir, amount));
// Swap USDC <-> ETH en Uniswap (Ethereum mainnet), para reponer ETH de gas con USDC
ipcMain.handle('ethswap:quote', async (_e, { dir, amount }) => ethswap.quote({ rpc: loadConfig().evm.find(n => n.key === 'eth').rpc, dir, amount }));
ipcMain.handle('ethswap:exec', async (_e, { passphrase, walletId, dir, amount, minOut }) => {
  if (!unlocked) throw new Error('bloqueado');
  if (!passOk(passphrase)) throw new Error('Contraseña incorrecta.');
  const w = walletById(walletId); if (!w || !w.eth) throw new Error('Wallet EVM no válida.');
  if (w.ledger) throw new Error('El swap de Uniswap con wallets Ledger llegará más adelante. Usa una wallet normal.');
  const onStep = (d) => { try { _e.sender.send('bridge:step', d); } catch (_) {} };
  const r = await ethswap.swap({ rpc: loadConfig().evm.find(n => n.key === 'eth').rpc, secretHex: w.eth.secret, dir, amount, minOut }, onStep);
  logHistory({ type: 'send-evm', wallet: w.label || '', desc: `Swap ${amount} ${dir === 'usdc2eth' ? 'USDC → ETH' : 'ETH → USDC'} (Uniswap)`, to: w.eth.address, id: r.txHash });
  return r;
});
ipcMain.handle('swap:exec', async (_e, { passphrase, walletId, dir, amount, slippage }) => {
  if (!unlocked) throw new Error('bloqueado');
  if (!passOk(passphrase)) throw new Error('Contraseña incorrecta.');
  const w = unlocked.data.wallets.find(x => x.id === walletId) || active();
  if (!w || !w.kda) throw new Error('Necesitas una wallet Kadena para operar en el mercado.');
  if (w.ledger) throw new Error('El Mercado con wallets Ledger llegará más adelante (necesita firma de código Pact arbitrario). Usa una wallet normal.');
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
// Lo que el nodo guarda de una transaccion ya minada: estado, gas, resultado y
// eventos. Es una consulta SUELTA a /poll, sin reintentos ni esperas: la tx ya
// paso, o esta o no esta. (kda.pollResult es para esperar a una recien enviada:
// duerme 3 s antes del primer intento y reintenta 12 veces.)
ipcMain.handle('tx:info', async (_e, { requestKey, chain, redKey } = {}) => {
    const rk = String(requestKey || '').trim();
    if (!/^[A-Za-z0-9_-]{40,50}$/.test(rk)) throw new Error('requestKey no valido.');
    const ch = String(chain === undefined || chain === null ? '' : chain).trim();
    if (!/^([0-9]|1[0-9])$/.test(ch)) throw new Error('chain no valida (0-19).');
    const c = loadConfig();
    // Se busca en TODAS las redes definidas, no solo en la activa: se trabaja a
    // ratos en devnet y a ratos en el fork, y el usuario no tiene por que saber
    // de cual era una transaccion para poder mirarla. Orden: la pedida, luego
    // las habilitadas, luego el resto. Se para en la primera que la tenga.
    const todas = c.kda.networks || [];
    const pedida = redKdaPorClave(redKey);
    const orden = [];
    for (const r of [pedida, ...todas.filter(r => r.enabled), ...todas]) {
        if (r && !orden.some(x => x.key === r.key)) orden.push(r);
    }
    if (!orden.length) throw new Error('No hay redes de Kadena configuradas.');
    const fallos = [];
    for (const red of orden) {
        const url = `${red.node}/chainweb/0.0/${red.networkId}/chain/${ch}/pact/api/v1/poll`;
        try {
            const res = await fetch(url, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ requestKeys: [rk] }),
                signal: AbortSignal.timeout(12000)
            });
            const j = await res.json();
            const ent = j && j[rk];
            if (ent) {
                return { encontrada: true, requestKey: rk, chain: ch, red: red.name,
                         nodo: red.node, networkId: red.networkId, datos: ent,
                         buscadaEn: orden.map(r => r.name) };
            }
        } catch (e) {
            fallos.push(`${red.name}: ${String(e.message || e).slice(0, 60)}`);
        }
    }
    return { encontrada: false, requestKey: rk, chain: ch,
             red: orden[0].name, nodo: orden[0].node, networkId: orden[0].networkId,
             datos: null, buscadaEn: orden.map(r => r.name),
             fallos: fallos.length ? fallos : null };
});

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
ipcMain.handle('prices', () => getPricesFull()); // idea 5/6: variación 24h + eur para el dashboard y el conversor
// Idea 12: copia de seguridad cifrada de la bóveda. vault.json YA está cifrado (AES-256-GCM), así que la copia es segura.
ipcMain.handle('vault:backup', async () => {
  if (!vault.existe(VAULT())) throw new Error('No hay bóveda que copiar.');
  const win = BrowserWindow.getAllWindows()[0];
  const d = new Date().toISOString().slice(0, 10);
  const { canceled, filePath } = await dialog.showSaveDialog(win, { title: 'Guardar copia cifrada de la bóveda', defaultPath: `koberlet-boveda-${d}.json`, filters: [{ name: 'Bóveda cifrada Koberlet', extensions: ['json'] }] });
  if (canceled || !filePath) return { ok: false };
  fs.copyFileSync(VAULT(), filePath);
  return { ok: true, path: filePath };
});
// Restaurar una copia: elige fichero, verifica que abre con la contraseña dada, respalda la actual y la instala. Deja la app bloqueada.
ipcMain.handle('vault:restore', async (_e, { passphrase }) => {
  const win = BrowserWindow.getAllWindows()[0];
  const { canceled, filePaths } = await dialog.showOpenDialog(win, { title: 'Restaurar copia de la bóveda', filters: [{ name: 'Bóveda cifrada Koberlet', extensions: ['json'] }], properties: ['openFile'] });
  if (canceled || !filePaths || !filePaths[0]) return { ok: false };
  const raw = fs.readFileSync(filePaths[0], 'utf8');
  let obj; try { obj = JSON.parse(raw); } catch (_) { throw new Error('El fichero no es una bóveda válida.'); }
  if (!obj.kdf || !obj.iv || !obj.tag || !obj.ct) throw new Error('El fichero no parece una bóveda de Koberlet.');
  const tmp = path.join(app.getPath('userData'), 'vault-restore-tmp.json');
  fs.writeFileSync(tmp, raw, { mode: 0o600 });
  try { vault.abrir(tmp, passphrase); } catch (e) { fs.rmSync(tmp, { force: true }); throw new Error('La contraseña no abre esa copia (¿es la de ese backup?).'); }
  fs.rmSync(tmp, { force: true });
  if (vault.existe(VAULT())) backupVault(); // respaldo del actual con fecha antes de sustituir
  fs.copyFileSync(filePaths[0], VAULT());
  unlocked = null; if (lockTimer) { clearTimeout(lockTimer); lockTimer = null; }
  return { ok: true };
});
// Exportar historial a CSV (idea 4): el renderer pasa las filas ya formateadas; guardamos con diálogo nativo.
ipcMain.handle('history:export', async (_e, { rows, filename }) => {
  const win = BrowserWindow.getAllWindows()[0];
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Exportar historial', defaultPath: filename || 'koberlet-historial.csv',
    filters: [{ name: 'CSV', extensions: ['csv'] }]
  });
  if (canceled || !filePath) return { ok: false };
  const esc = (v) => { const s = String(v == null ? '' : v); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const head = ['Fecha', 'Tipo', 'Descripción', 'Contraparte', 'Chain', 'Id/Tx'];
  const csv = '﻿' + [head.join(';')].concat((rows || []).map(r => [r.fecha, r.tipo, r.desc, r.other, r.chain, r.id].map(esc).join(';'))).join('\r\n');
  fs.writeFileSync(filePath, csv, 'utf8');
  return { ok: true, path: filePath };
});

// ===== NFT: piezas de las wallets (lectura) =====
// El ledger de Kadena no sabe listar los tokens de una cuenta, así que las piezas
// salen del descubridor de la red (si lo hay) y de las que el usuario añade a
// mano, y SIEMPRE se confirman contra la cadena antes de enseñarlas.
const nftLib = require('./lib/nft');

function nftManualPath() { return path.join(app.getPath('userData'), 'nft-manual.json'); }

function leerManuales() {
    try { return JSON.parse(fs.readFileSync(nftManualPath(), 'utf8')); } catch (e) { return {}; }
}
function guardarManuales(m) {
    fs.writeFileSync(nftManualPath(), JSON.stringify(m, null, 2), 'utf8');
}
function redKdaPorClave(clave) {
    const c = loadConfig();
    return (c.kda.networks || []).find(r => r.key === clave) || null;
}
// Miniatura con lo que ya trae Electron: nada de dependencias nuevas. Si el
// formato no lo entiende (algún WebP raro), devuelve null y se usa el original.
async function miniatura(datos, tipo) {
    const img = nativeImage.createFromBuffer(datos);
    if (img.isEmpty()) return null;
    const { width } = img.getSize();
    const chica = width > 420 ? img.resize({ width: 420, quality: 'good' }) : img;
    return chica.toDataURL();
}

function localDeRed(red) {
    // lib/kda.local(node, networkId, chain, code) -> aquí se fija la red
    return (code, chain) => kda.local(red.node, red.networkId, chain || '0', code);
}

ipcMain.handle('nft:list', async (_e, { walletId, redKey } = {}) => {
    const w = unlocked.data.wallets.find(x => x.id === walletId);
    if (!w || w.kind !== 'kda') throw new Error('Elige una wallet de Kadena');
    const red = redKdaPorClave(redKey);
    if (!red) throw new Error('Red no encontrada');
    if (!red.nft || !red.nft.ledger) return { piezas: [], sinSoporte: true, red: red.name };
    const cuenta = w.kda.account;
    const manuales = (leerManuales()[`${redKey}|${cuenta}`]) || [];
    const { piezas, avisoDescubridor } = await nftLib.piezasDe(localDeRed(red), red, cuenta, manuales, { reducir: miniatura });
    return { piezas, cuenta, red: red.name, redKey, conDescubridor: !!red.nft.descubridor, avisoDescubridor };
});

ipcMain.handle('nft:add', async (_e, { walletId, redKey, id } = {}) => {
    const w = unlocked.data.wallets.find(x => x.id === walletId);
    if (!w || w.kind !== 'kda') throw new Error('Elige una wallet de Kadena');
    const red = redKdaPorClave(redKey);
    if (!red || !red.nft || !red.nft.ledger) throw new Error('Esta red no tiene NFT configurados');
    const cuenta = w.kda.account;
    const pieza = await nftLib.comprobarPieza(localDeRed(red), red, cuenta, String(id || '').trim(), { reducir: miniatura });
    const m = leerManuales();
    const clave = `${redKey}|${cuenta}`;
    m[clave] = [...new Set([...(m[clave] || []), pieza.id])].slice(0, 200);
    guardarManuales(m);
    return { ok: true, pieza };
});

// ¿dejaría el contrato mover esta pieza? Se pregunta antes de pedir la contraseña
ipcMain.handle('nft:comprobar', async (_e, { walletId, redKey, id, destino } = {}) => {
    const w = unlocked.data.wallets.find(x => x.id === walletId);
    if (!w || w.kind !== 'kda') throw new Error('Elige una wallet de Kadena');
    const red = redKdaPorClave(redKey);
    if (!red || !red.nft) throw new Error('Esta red no tiene NFT configurados');
    const simular = (code, data, clist, chain) => kda.simularFirmada({
        node: red.node, networkId: red.networkId, chain, code, data, clist,
        from: w.kda.account, publicHex: w.kda.public });
    return nftLib.comprobarEnvio(simular, red, w.kda.account, id, String(destino || '').trim());
});

ipcMain.handle('nft:enviar', async (_e, { walletId, redKey, id, destino, passphrase } = {}) => {
    const w = unlocked.data.wallets.find(x => x.id === walletId);
    if (!w || w.kind !== 'kda') throw new Error('Elige una wallet de Kadena');
    if (w.ledger) throw new Error('Con Ledger todavía no: enviar un NFT firma código Pact y el '
                                  + 'aparato lo mostraría como firma ciega.');
    if (!passOk(passphrase)) throw new Error('Contraseña incorrecta.');
    const red = redKdaPorClave(redKey);
    if (!red || !red.nft) throw new Error('Esta red no tiene NFT configurados');
    const partes = nftLib._tx(red.nft.ledger, id, w.kda.account, String(destino || '').trim());
    const r = await kda.enviarNft({
        node: red.node, networkId: red.networkId, chain: red.nft.chain || '0',
        ...partes, from: w.kda.account, secretHex: w.kda.secret, publicHex: w.kda.public });
    const res = await kda.pollResult({ node: red.node, networkId: red.networkId,
        chain: red.nft.chain || '0', requestKey: r.requestKey });
    return { ...r, resultado: res };
});

// Valida una cuenta Kadena con el MISMO criterio que usa el envio (lib/kda.js), para que
// la agenda no rechace cuentas que la cadena si acepta (gasolineras c:, keysets r:, vanity...).
ipcMain.handle('kda:validar', (_e, cuenta) => kda.validKdaAccount(String(cuenta || '')));

ipcMain.handle('nft:remove', (_e, { walletId, redKey, id } = {}) => {
    const w = unlocked.data.wallets.find(x => x.id === walletId);
    if (!w) throw new Error('wallet no encontrada');
    const m = leerManuales();
    const clave = `${redKey}|${w.kda.account}`;
    m[clave] = (m[clave] || []).filter(x => x !== id);
    guardarManuales(m);
    return { ok: true };
});

ipcMain.handle('config:get', () => loadConfig());
ipcMain.handle('config:set', (_e, c) => {
  if (!c || typeof c !== 'object' || Array.isArray(c)) throw new Error('config inválida');
  // Se guarda tal cual, pero loadConfig() reconstruye kda/evm/bridge desde DEFAULT y solo respeta
  // enabled/rpc(https)/updateMode — los campos sensibles de firma nunca los fija el renderer (Alex #4).
  saveConfig(c); return { ok: true };
});

// ---- Versión + auto-update vía descargas.dnns.es (latest.json {version,url,appUrl,sha256,sig,notes}) ----
const APP_VERSION = require('./package.json').version;
const UPDATE_URL = 'https://descargas.dnns.es/kob7t2m9x4/koberlet';
// Clave PÚBLICA de firma de updates (Ed25519). La privada vive SOLO en la máquina de publicación (fuera del repo).
// El updater exige que el paquete descargado case con este sha256 Y que la firma sobre ese sha256 valide con esta clave.
// Así, ni un servidor de descargas comprometido ni un MITM pueden colar código (no tienen la privada).
const UPDATE_PUBKEY = '57e9f4fae9fcfa361e58b702cf83ff9b8b806d606a2e741b40b77ed2866bb4e4';
const nacl = require('tweetnacl');
const cmpVer = (a, b) => { const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) { if ((pa[i] || 0) > (pb[i] || 0)) return 1; if ((pa[i] || 0) < (pb[i] || 0)) return -1; } return 0; };
ipcMain.handle('app:info', () => ({ version: APP_VERSION }));
ipcMain.handle('update:check', async () => {
  try {
    const r = await fetch(UPDATE_URL + '/latest.json', { signal: AbortSignal.timeout(6000), cache: 'no-store' });
    const j = await r.json();
    // SEGURIDAD (revisión 2026-07-21 #1): latest.json NO va firmado (solo el paquete sí). Por eso `version` y `url`
    // se validan en origen antes de que el renderer los use: version debe ser semver estricto, y url debe colgar del
    // origen oficial. Así, aunque el server de descargas o un MITM mienta, no cuela markup ni redirige el botón.
    const ver = (j && typeof j.version === 'string' && /^\d+\.\d+\.\d+$/.test(j.version)) ? j.version : null;
    const newer = ver && cmpVer(ver, APP_VERSION) > 0;
    const url = (j && typeof j.url === 'string' && j.url.startsWith(UPDATE_URL + '/')) ? j.url : (UPDATE_URL + '/');
    // Novedades. `notes` es SIEMPRE un texto (las versiones antiguas lo pintan
    // tal cual: si aquí llegara un objeto, enseñarían "[object Object]"), y el
    // idioma va aparte en `notes_i18n = {es, en}`. Se prefiere el idioma si está.
    let notes = typeof j.notes === 'string' ? j.notes.slice(0, 4000) : '';
    const porIdioma = j.notes_i18n;
    if (porIdioma && typeof porIdioma === 'object' && !Array.isArray(porIdioma)) {
      const limpio = {};
      for (const k of ['es', 'en']) {
        if (typeof porIdioma[k] === 'string') limpio[k] = porIdioma[k].slice(0, 4000);
      }
      if (Object.keys(limpio).length) notes = limpio;
    }
    // Huella del INSTALADOR completo (el zip que se pasa a otra persona). El instalador no
    // se actualiza solo, así que no puede verificarse a sí mismo: la huella se enseña para
    // que quien lo reparta la dicte aparte y el que lo baje pueda comprobarla con
    // `Get-FileHash` antes de abrirlo (auditoría A-1). Formato validado en origen.
    const urlSha256 = (typeof j.urlSha256 === 'string' && /^[0-9a-f]{64}$/.test(j.urlSha256.toLowerCase()))
      ? j.urlSha256.toLowerCase() : null;
    return { current: APP_VERSION, latest: ver, newer: !!newer, url, urlSha256, canAuto: !!j.appUrl, notes };
  } catch (_) { return { current: APP_VERSION, latest: null, newer: false }; }
});
// SEGURIDAD (revisión 2026-07-21 #1b): el único uso de open:external es el botón de descarga del update, que apunta
// al origen oficial. Se restringe a ese origen para que un latest.json manipulado no pueda abrir un host arbitrario.
ipcMain.handle('open:external', (_e, url) => { if (typeof url === 'string' && url.startsWith(UPDATE_URL + '/')) shell.openExternal(url); });

// Auto-update IN-PLACE: descarga SOLO el código nuevo (resources/app) y lo cambia con un .bat al cerrar,
// preservando la bóveda (MonederoDNNS-datos vive junto al .exe, fuera de resources/app). No pierde nada.
const { spawn } = require('child_process');
ipcMain.handle('update:apply', async () => {
  const r = await fetch(UPDATE_URL + '/latest.json', { signal: AbortSignal.timeout(8000), cache: 'no-store' });
  const j = await r.json();
  const appUrl = j.appUrl; // zip que contiene SOLO la carpeta app (el código)
  if (!appUrl) throw new Error('Esta versión no admite auto-update in-place (falta appUrl).');
  // SEGURIDAD (auditoría Alex #1): el paquete debe venir del origen oficial y traer sha256 + firma.
  if (!appUrl.startsWith(UPDATE_URL + '/')) throw new Error('Origen del paquete no autorizado (debe ser descargas.dnns.es).');
  if (!j.sha256 || !j.sig) throw new Error('El paquete no está firmado; actualización rechazada por seguridad.');
  const exe = app.getPath('exe'); const exeDir = path.dirname(exe); const exeName = path.basename(exe);
  const resDir = path.join(exeDir, 'resources');
  // Carpeta ÚNICA por intento: si un intento anterior dejó su bat vivo (bloquea la carpeta), borrar el
  // _update compartido lanzaba ENOTEMPTY y encima vaciaba a medias el paquete del otro intento (visto 2026-07-22).
  const upd = path.join(exeDir, '_update-' + Date.now());
  for (const d of fs.readdirSync(exeDir)) if (d === '_update' || d.startsWith('_update-')) { try { fs.rmSync(path.join(exeDir, d), { recursive: true, force: true }); } catch (_) {} }
  fs.mkdirSync(upd, { recursive: true });
  // 1) descargar
  const res = await fetch(appUrl, { signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error('descarga falló: ' + res.status);
  const bytes = Buffer.from(await res.arrayBuffer());
  // 1b) VERIFICAR integridad + autenticidad antes de tocar nada
  const gotHash = crypto.createHash('sha256').update(bytes).digest('hex');
  if (gotHash !== String(j.sha256).toLowerCase()) throw new Error('El paquete descargado no coincide con el sha256 esperado; se descarta.');
  let sigOk = false;
  try { sigOk = nacl.sign.detached.verify(Buffer.from(gotHash, 'utf8'), Buffer.from(j.sig, 'hex'), Buffer.from(UPDATE_PUBKEY, 'hex')); } catch (_) {}
  if (!sigOk) throw new Error('Firma del paquete inválida; actualización rechazada (posible manipulación).');
  const zipPath = path.join(upd, 'app.zip');
  fs.writeFileSync(zipPath, bytes);
  // 2) extraer con PowerShell (queda upd/app)
  // Las comillas simples de la ruta se duplican: el nombre de usuario de Windows puede
  // llevar apóstrofo (O'Brien) y sin esto el comando se rompe por la mitad (auditoría M-3).
  const ps = (p) => String(p).replace(/'/g, "''");
  await new Promise((resolve, reject) => spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath '${ps(zipPath)}' -DestinationPath '${ps(upd)}' -Force`], { windowsHide: true })
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
    // si el paquete nuevo está incompleto (p.ej. otra instancia limpió esta carpeta), NO tocar la app actual
    `if not exist ${q(path.join(upd, 'app', 'main.js'))} goto done`,
    `if exist ${q(path.join(resDir, 'app_old'))} rmdir /s /q ${q(path.join(resDir, 'app_old'))}`,
    `move ${q(path.join(resDir, 'app'))} ${q(path.join(resDir, 'app_old'))}`,
    `move ${q(path.join(upd, 'app'))} ${q(path.join(resDir, 'app'))}`,
    // verificar por FICHERO, no por carpeta (una app parcial también "existe"): si falta main.js, restaurar el respaldo
    `if exist ${q(path.join(resDir, 'app', 'main.js'))} ( rmdir /s /q ${q(path.join(resDir, 'app_old'))} ) else ( rmdir /s /q ${q(path.join(resDir, 'app'))} & move ${q(path.join(resDir, 'app_old'))} ${q(path.join(resDir, 'app'))} )`,
    ':done',
    `start "" ${q(exe)}`,
    `rmdir /s /q ${q(upd)}`
  ].join('\r\n'), 'latin1');
  // 4) lanzar el bat OCULTO (cmd detached ignora windowsHide y deja una consola negra a la vista;
  //    wscript con ventana 0 sí lo esconde de verdad) y cerrar la app
  const vbs = path.join(upd, 'apply.vbs');
  fs.writeFileSync(vbs, 'CreateObject("WScript.Shell").Run "cmd.exe /c ""' + bat + '""", 0, False\r\n', 'latin1');
  spawn('wscript.exe', [vbs], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  // Cierre en dos tiempos: quit educado y, si algo lo retiene (visto 2026-07-23: la app no se cerraba
  // y el bat esperaba eternamente), exit forzado — el bat necesita que el proceso MUERA para aplicar.
  setTimeout(() => { unlocked = null; app.quit(); setTimeout(() => { try { app.exit(0); } catch (_) {} }, 1500); }, 400);
  return { ok: true };
});
