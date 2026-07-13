const $ = (id) => document.getElementById(id);
function msg(el, text, kind) { el.className = 'msg ' + (kind || ''); el.textContent = text; }
let CFG = null, WALLETS = [], SHOWN = [];

// ===== i18n ES/EN =====
const LANG = {
  es: {
    nav_dashboard: 'Panel', nav_wallets: 'Wallets', nav_red: 'Red', nav_mercado: 'Mercado', nav_puente: 'Puente', nav_seguridad: 'Seguridad', nav_ajustes: 'Ajustes', nav_info: 'Info',
    auth_tag_setup: 'Crea tu bóveda cifrada', auth_tag_unlock: 'Tu monedero multi-cadena',
    auth_lead: 'Protege tus claves con una contraseña. Se cifran con AES-256-GCM + scrypt y no se guardan en ningún sitio.',
    lbl_pass: 'Contraseña', lbl_pass2: 'Repite la contraseña', lbl_net_first: 'Red de tu primera wallet',
    ph_pass_min: 'mínimo 8 caracteres', ph_pass_rep: 'repite la contraseña', ph_pass: 'tu contraseña',
    btn_setup: 'Crear bóveda y wallet', btn_unlock: 'Desbloquear',
    foot_setup: 'No custodial · cifrado local', foot_unlock: 'Cifrado local AES-256',
    seed_warn: '⚠️ Apunta esta frase de recuperación en papel y guárdala a salvo. Es la ÚNICA forma de recuperar tu wallet. No se volverá a mostrar.',
    seed_done: 'Ya la anoté, continuar', copy: 'copiar',
    btn_hist: 'Historial', btn_refresh: 'Refrescar', lock: 'Bloquear',
    total: 'Total', bal_by_net: 'Saldos por red',
    h_wallets: 'Wallets', create_new: '＋ Crear nueva', import: 'Importar',
    h_red: 'Redes', h_mercado: 'Mercado', h_puente: 'Puente Kinesis — Kadena → EVM',
    mercado_sub: 'Cambios no custodial: firmas tú con tu contraseña y el precio se lee fresco del pool justo antes de firmar.',
    mkt_kda_sub: 'kb-USDC ⇄ KDA · pool kaddex, chain 2', mkt_eth_sub: 'USDC ⇄ ETH · Uniswap, para reponer gas',
    h_seguridad: 'Seguridad', h_ajustes: 'Ajustes', h_info: 'Info y manuales',
    kda_nets: 'Redes Kadena — elige cuáles ver', evm_nets: 'Redes EVM — para wallets EVM', eth_rpc: 'RPC de Ethereum', save: 'Guardar',
    mk_wallet: 'Wallet (Kadena)', mk_amount: 'Cantidad a entregar', mk_swap: 'Cambiar',
    h_ethswap: 'Ethereum — cambiar USDC ⇄ ETH (Uniswap)', es_wallet: 'Wallet (Ethereum)',
    set_kda_mode: 'Redes Kadena en el dashboard', check_upd: 'Buscar actualizaciones', download: 'Descargar',
    set_upd_mode: 'Actualizaciones', upd_manual: 'Manual — avisarme y actualizo yo', upd_auto: 'Automática — instalar al detectarla',
    upd_mode_hint: 'En manual, la app solo muestra un aviso cuando hay versión nueva y tú decides cuándo aplicarla. En automática, se instala y reinicia sola al arrancar. Tus wallets y datos nunca se tocan.',
    upd_available: 'Koberlet v{v} disponible.', update: 'Actualizar',
    upd_applying: 'Actualizando… la app se reiniciará sola. Tus wallets y datos se conservan.',
    upd_auto_applying: 'Actualizando a Koberlet v{v}… la app se reiniciará sola.',
    upd_err: 'Error al actualizar: ', upd_checking: 'Comprobando…',
    upd_new: 'Nueva versión <b>v{v}</b> disponible.', upd_now: 'Actualizar ahora',
    upd_latest: 'Estás en la última versión (v{v}).', upd_nocheck: 'No pude comprobar (¿sin conexión o servidor?).',
    hist_title: 'Historial de operaciones', close: 'cerrar',
    hist_loading: 'Cargando historial on-chain…', hist_empty: 'Sin operaciones para esta wallet.',
    hist_in: 'Recibido', hist_out: 'Enviado', hist_from: 'de', hist_to: 'a'
  },
  en: {
    nav_dashboard: 'Dashboard', nav_wallets: 'Wallets', nav_red: 'Network', nav_mercado: 'Market', nav_puente: 'Bridge', nav_seguridad: 'Security', nav_ajustes: 'Settings', nav_info: 'Info',
    auth_tag_setup: 'Create your encrypted vault', auth_tag_unlock: 'Your multi-chain wallet',
    auth_lead: 'Protect your keys with a password. They are encrypted with AES-256-GCM + scrypt and never stored anywhere.',
    lbl_pass: 'Password', lbl_pass2: 'Repeat password', lbl_net_first: 'Network for your first wallet',
    ph_pass_min: 'at least 8 characters', ph_pass_rep: 'repeat the password', ph_pass: 'your password',
    btn_setup: 'Create vault and wallet', btn_unlock: 'Unlock',
    foot_setup: 'Non-custodial · local encryption', foot_unlock: 'Local AES-256 encryption',
    seed_warn: '⚠️ Write this recovery phrase on paper and keep it safe. It is the ONLY way to recover your wallet. It will not be shown again.',
    seed_done: 'I wrote it down, continue', copy: 'copy',
    btn_hist: 'History', btn_refresh: 'Refresh', lock: 'Lock',
    total: 'Total', bal_by_net: 'Balances by network',
    h_wallets: 'Wallets', create_new: '＋ Create new', import: 'Import',
    h_red: 'Networks', h_mercado: 'Market', h_puente: 'Kinesis Bridge — Kadena → EVM',
    mercado_sub: 'Non-custodial swaps: you sign with your password and the price is read fresh from the pool right before signing.',
    mkt_kda_sub: 'kb-USDC ⇄ KDA · kaddex pool, chain 2', mkt_eth_sub: 'USDC ⇄ ETH · Uniswap, to top up gas',
    h_seguridad: 'Security', h_ajustes: 'Settings', h_info: 'Info & manuals',
    kda_nets: 'Kadena networks — choose which to show', evm_nets: 'EVM networks — for EVM wallets', eth_rpc: 'Ethereum RPC', save: 'Save',
    mk_wallet: 'Wallet (Kadena)', mk_amount: 'Amount to send', mk_swap: 'Swap',
    h_ethswap: 'Ethereum — swap USDC ⇄ ETH (Uniswap)', es_wallet: 'Wallet (Ethereum)',
    set_kda_mode: 'Kadena networks on the dashboard', check_upd: 'Check for updates', download: 'Download',
    set_upd_mode: 'Updates', upd_manual: 'Manual — notify me and I update', upd_auto: 'Automatic — install when detected',
    upd_mode_hint: 'In manual mode the app only shows a notice when a new version is available and you decide when to apply it. In automatic mode it installs and restarts by itself on startup. Your wallets and data are never touched.',
    upd_available: 'Koberlet v{v} available.', update: 'Update',
    upd_applying: 'Updating… the app will restart by itself. Your wallets and data are preserved.',
    upd_auto_applying: 'Updating to Koberlet v{v}… the app will restart by itself.',
    upd_err: 'Update error: ', upd_checking: 'Checking…',
    upd_new: 'New version <b>v{v}</b> available.', upd_now: 'Update now',
    upd_latest: 'You are on the latest version (v{v}).', upd_nocheck: 'Could not check (offline or server down?).',
    hist_title: 'Operation history', close: 'close',
    hist_loading: 'Loading on-chain history…', hist_empty: 'No operations for this wallet.',
    hist_in: 'Received', hist_out: 'Sent', hist_from: 'from', hist_to: 'to'
  }
};
let LNG = localStorage.getItem('koberlet-lang'); if (LNG !== 'en' && LNG !== 'es') LNG = (navigator.language || 'es').slice(0, 2) === 'en' ? 'en' : 'es';
function t(k) { return (LANG[LNG] && LANG[LNG][k]) || LANG.es[k] || k; }
function applyLang() {
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-ph]').forEach(el => { el.placeholder = t(el.dataset.i18nPh); });
  const on = document.querySelector('.nav.on'); if (on && $('crumb')) $('crumb').textContent = t('nav_' + on.dataset.nav);
  document.querySelectorAll('.lang-es').forEach(e => { e.hidden = (LNG !== 'es'); });
  document.querySelectorAll('.lang-en').forEach(e => { e.hidden = (LNG !== 'en'); });
  document.querySelectorAll('.langbtn').forEach(b => b.textContent = LNG === 'es' ? 'EN' : 'ES');
  document.documentElement.lang = LNG;
}
function setLang(l) { LNG = l; localStorage.setItem('koberlet-lang', l); applyLang(); if ($('history-panel') && !$('history-panel').hidden) refreshHistory(); }
document.querySelectorAll('.langbtn').forEach(b => b.onclick = () => setLang(LNG === 'es' ? 'en' : 'es'));

function screen(name) { ['scr-setup', 'scr-unlock'].forEach(s => $(s).hidden = true); $('app').hidden = true; if (name === 'app') $('app').hidden = false; else $(name).hidden = false; }
function nav(v) { ['dashboard', 'wallets', 'red', 'mercado', 'puente', 'seguridad', 'ajustes', 'info'].forEach(n => $('view-' + n).hidden = (n !== v)); document.querySelectorAll('.nav').forEach(a => a.classList.toggle('on', a.dataset.nav === v)); $('crumb').textContent = t('nav_' + v); }

// Opciones de red para crear/importar: KDA + cada red EVM. value = 'kda' o 'evm:<key>'.
function netOptions() { return '<option value="kda">Kadena (KDA)</option>' + CFG.evm.map(n => `<option value="evm:${n.key}">${n.name}</option>`).join(''); }
function parseNet(sel) { return sel === 'kda' ? { kind: 'kda', net: null } : { kind: 'evm', net: sel.slice(4) }; }

async function boot() {
  const st = await window.api.status(); CFG = st.config;
  $('setup-net').innerHTML = netOptions();
  $('cr-net').innerHTML = netOptions();
  $('imp-net').innerHTML = netOptions();
  screen(st.exists ? 'scr-unlock' : 'scr-setup');
  applyLang();
  initUpdates();
}
// Versión + auto-update vía descargas.dnns.es
async function initUpdates() {
  try { const info = await window.api.appInfo(); const v = 'v' + info.version; document.title = 'Koberlet ' + v; ['app-ver', 'auth-ver', 'auth-ver-s'].forEach(id => { if ($(id)) $(id).textContent = v; }); } catch (_) {}
  try {
    const u = await window.api.updateCheck();
    if (u.newer) {
      window._upd = u;
      if (CFG && CFG.updateMode === 'auto' && u.canAuto) {
        $('update-text').textContent = t('upd_auto_applying').replace('{v}', u.latest);
        $('btn-update-dl').hidden = true; $('update-banner').hidden = false;
        try { await window.api.updateApply(); return; }
        catch (_) { $('btn-update-dl').hidden = false; } // si falla, cae al aviso manual
      }
      $('update-text').textContent = t('upd_available').replace('{v}', u.latest) + (u.notes ? ' ' + u.notes : '');
      $('btn-update-dl').textContent = u.canAuto ? t('update') : t('download');
      $('update-banner').hidden = false;
    }
  } catch (_) {}
}
async function doUpdate(u, statusEl) {
  if (u && u.canAuto) {
    if (statusEl) statusEl.textContent = t('upd_applying');
    try { await window.api.updateApply(); } catch (e) { if (statusEl) statusEl.textContent = t('upd_err') + e.message; }
  } else if (u && u.url) { window.api.openExternal(u.url); }
}
$('btn-update-dl').onclick = () => { $('btn-update-dl').disabled = true; doUpdate(window._upd, $('update-text')); };
$('btn-update-x').onclick = () => { $('update-banner').hidden = true; };
$('btn-check-upd').onclick = async () => {
  msg($('upd-status'), t('upd_checking'));
  try {
    const u = await window.api.updateCheck();
    if (u.newer) { $('upd-status').innerHTML = t('upd_new').replace('{v}', u.latest) + ` <a href="#" id="upd-dl-link" class="grn">${u.canAuto ? t('upd_now') : t('download')}</a>`; $('upd-dl-link').onclick = (e) => { e.preventDefault(); doUpdate(u, $('upd-status')); }; }
    else if (u.latest) msg($('upd-status'), t('upd_latest').replace('{v}', u.current), 'ok');
    else msg($('upd-status'), t('upd_nocheck'), 'err');
  } catch (e) { msg($('upd-status'), e.message, 'err'); }
};
$('btn-setup').onclick = async () => {
  const p = $('setup-pass').value, p2 = $('setup-pass2').value;
  if (p.length < 8) return msg($('setup-msg'), 'Mínimo 8 caracteres.', 'err');
  if (p !== p2) return msg($('setup-msg'), 'No coinciden.', 'err');
  const { kind, net } = parseNet($('setup-net').value);
  try { msg($('setup-msg'), 'Creando bóveda…'); const r = await window.api.setup(p, kind, net); $('setup-seed').textContent = r.mnemonic; $('setup-step1').hidden = true; $('setup-step2').hidden = false; }
  catch (e) { msg($('setup-msg'), 'Error: ' + e.message, 'err'); }
};
$('btn-setup-done').onclick = () => screen('scr-unlock');
$('btn-unlock').onclick = async () => { try { const r = await window.api.unlock($('unlock-pass').value); enter(r.view); } catch (_) { msg($('unlock-msg'), 'Contraseña incorrecta.', 'err'); } };
$('unlock-pass').addEventListener('keydown', e => { if (e.key === 'Enter') $('btn-unlock').click(); });
$('btn-lock').onclick = async () => { await window.api.lock(); location.reload(); };
document.querySelectorAll('.nav').forEach(a => a.onclick = () => nav(a.dataset.nav));

async function enter(v) {
  screen('app'); nav('dashboard');
  // interruptores de redes Kadena (Oficial / Fork), como las EVM
  $('kda-nets').innerHTML = CFG.kda.networks.map(n => `<label class="toggle"><input type="checkbox" data-knet="${n.key}" ${n.enabled ? 'checked' : ''}/><span class="tdot" style="background:${n.color}"></span>${n.name}</label>`).join('');
  $('kda-nets').querySelectorAll('input').forEach(cb => cb.onchange = async () => { CFG.kda.networks.find(x => x.key === cb.dataset.knet).enabled = cb.checked; await window.api.setConfig(CFG); syncKdaControls(); updateNetContext(); loadBalances(); });
  // Ajustes: modo de redes Kadena en el dashboard (Ambas / Solo oficial / Solo fork), sincronizado con los interruptores de Red
  $('set-kda-mode').onchange = async () => {
    const v = $('set-kda-mode').value;
    CFG.kda.networks.find(n => n.key === 'mainnet').enabled = v !== 'fork';
    CFG.kda.networks.find(n => n.key === 'fork').enabled = v !== 'oficial';
    await window.api.setConfig(CFG); syncKdaControls(); updateNetContext(); loadBalances();
  };
  syncKdaControls();
  // Ajustes: modo de actualización (manual por defecto / automática)
  $('set-upd-mode').value = CFG.updateMode || 'manual';
  $('set-upd-mode').onchange = async () => { CFG.updateMode = $('set-upd-mode').value; await window.api.setConfig(CFG); };
  $('eth-rpc').value = CFG.evm.find(n => n.key === 'eth').rpc;
  $('btn-save-rpc').onclick = async () => { CFG.evm.find(n => n.key === 'eth').rpc = $('eth-rpc').value.trim(); await window.api.setConfig(CFG); msg($('wallet-msg'), 'RPC guardado.', 'ok'); loadBalances(); };
  // interruptores de redes EVM
  $('evm-nets').innerHTML = CFG.evm.map(n => `<label class="toggle"><input type="checkbox" data-net="${n.key}" ${n.enabled ? 'checked' : ''}/><span class="tdot" style="background:${n.color}"></span>${n.name}</label>`).join('');
  $('evm-nets').querySelectorAll('input').forEach(cb => cb.onchange = async () => { CFG.evm.find(x => x.key === cb.dataset.net).enabled = cb.checked; await window.api.setConfig(CFG); loadBalances(); });
  applyView(v);
}
const shortAddr = (a) => a ? a.slice(0, 8) + '…' + a.slice(-4) : '';
let DIR = 'evm2kda'; // por defecto Ethereum -> Kadena
function renderBridge() {
  const evm2 = DIR === 'evm2kda';
  $('dir-from').textContent = evm2 ? 'Ethereum' : 'Kadena';
  $('dir-to').textContent = evm2 ? 'Kadena' : 'Ethereum';
  $('lbl-from').textContent = evm2 ? 'Wallet origen (Ethereum)' : 'Wallet origen (Kadena)';
  $('lbl-dest').textContent = evm2 ? 'Wallet destino (Kadena)' : 'Wallet destino (Ethereum)';
  $('lbl-to').textContent = evm2 ? 'Cuenta Kadena destino (k:…)' : 'Dirección EVM destino (0x…)';
  $('br-to').placeholder = evm2 ? 'k:...' : '0x...';
  const fromW = WALLETS.filter(w => evm2 ? w.ethAddress : w.kdaAccount);
  const destW = WALLETS.filter(w => evm2 ? w.kdaAccount : w.ethAddress);
  $('br-from').innerHTML = fromW.map(w => `<option value="${w.id}">${w.label} · ${shortAddr(evm2 ? w.ethAddress : w.kdaAccount)}</option>`).join('') || '<option value="">— sin wallet —</option>';
  $('br-dest').innerHTML = destW.map(w => `<option value="${evm2 ? w.kdaAccount : w.ethAddress}">${w.label} · ${shortAddr(evm2 ? w.kdaAccount : w.ethAddress)}</option>`).join('') + '<option value="otra">Otra dirección…</option>';
  $('br-dest').onchange = () => { $('br-to-wrap').hidden = $('br-dest').value !== 'otra'; };
  $('br-dest').onchange();
  $('br-from').onchange = () => loadBridgeTokens($('br-from').value);
  if (fromW.length) loadBridgeTokens(fromW[0].id); else $('br-token').innerHTML = '';
}
$('btn-invert').onclick = () => { DIR = DIR === 'evm2kda' ? 'kda2evm' : 'evm2kda'; renderBridge(); msg($('br-msg'), ''); $('br-out').hidden = true; };
async function loadBridgeTokens(walletId) {
  if (!walletId) { $('br-token').innerHTML = ''; return; }
  $('br-token').innerHTML = '<option>cargando saldos…</option>'; $('br-tokhint').textContent = '';
  const toks = await window.api.bridgeTokens(walletId, DIR);
  $('br-token').innerHTML = toks.map(t => `<option value="${t.symbol}" data-bal="${t.balance}">${t.symbol} — ${t.balance}</option>`).join('');
  $('br-token').onchange = () => { const o = $('br-token').selectedOptions[0]; $('br-tokhint').textContent = o ? '(saldo ' + o.dataset.bal + ')' : ''; };
  $('br-token').onchange();
}
$('btn-bridge-sim').onclick = async () => {
  const from = $('br-from').value, symbol = $('br-token').value, amt = $('br-amt').value;
  const to = $('br-dest').value === 'otra' ? $('br-to').value.trim() : $('br-dest').value;
  if (!from) return msg($('br-msg'), 'No hay wallet origen para esa dirección.', 'err');
  if (!to || !amt) return msg($('br-msg'), 'Elige destino y cantidad.', 'err');
  try {
    msg($('br-msg'), 'Simulando…'); $('br-out').hidden = true;
    const r = await window.api.bridgeDryRun(DIR, from, symbol, to, amt);
    $('br-code').textContent = r.code;
    $('br-result').textContent = JSON.stringify(r.result, null, 2);
    $('br-out').hidden = false;
    const st = r.result && r.result.status; const err = (r.result && r.result.error && r.result.error.message) || '';
    let m, kind;
    if (st === 'success') { m = '✅ La transacción se arma bien (simulación correcta).' + (r.gas ? ' Gas: ' + r.gas + '.' : '') + (r.toll ? ` <b>Peaje del puente: ${Number(r.toll).toFixed(2)} KDA</b> (se cobra en Kadena al despachar, aparte del token puenteado).` : ''); kind = 'ok'; }
    else if (DIR === 'evm2kda' && r.enoughBalance && r.missingApprove) { m = `✅ La tx se construye bien y tienes saldo (${r.balance} del token). Revierte solo porque falta el <b>approve</b> (autorizar al router a mover tu token) — es un paso previo que se hará automáticamente en el envío real.`; kind = 'ok'; }
    else if (DIR === 'evm2kda' && !r.enoughBalance) { m = `⚠️ Saldo insuficiente en Ethereum: tienes ${r.balance}, necesitas ${r.need}.`; kind = 'err'; }
    else if (/buy gas/i.test(err)) { m = '⚠️ La tx se construye bien, pero esta cuenta KDA no tiene KDA en la chain 2 del fork para el gas. Necesitas algo de KDA ahí.'; kind = 'err'; }
    else if (/row not found|No value found|Insufficient|balance/i.test(err)) { m = '⚠️ La tx se construye bien, pero no tienes saldo de ese token. Revisa abajo.'; kind = 'err'; }
    else { m = '⚠️ Simulación con error: ' + err.slice(0, 140); kind = 'err'; }
    $('br-msg').innerHTML = m; $('br-msg').className = 'msg ' + kind;
  } catch (e) { msg($('br-msg'), 'Error: ' + e.message, 'err'); }
};
const STEP_SETS = {
  evm2kda: { approve: 'Autorizar token (approve)', transfer: 'Enviar al puente (Ethereum)', ethconfirm: 'Confirmar en Ethereum', kadena: 'Recibir en Kadena (chain 2)' },
  kda2evm: { dispatch: 'Enviar al puente (Kadena, chain 2)', kdaconfirm: 'Confirmar en Kadena', evm: 'Recibir en Ethereum' }
};
const STEP_ICON = { pending: '⚪', run: '⏳', ok: '✅', skip: '⏭️', fail: '❌' };
function initSteps(dir) { const L = STEP_SETS[dir] || STEP_SETS.evm2kda; $('send-steps').innerHTML = Object.keys(L).map(k => `<div class="stp" data-step="${k}"><span class="si">⚪</span> <span class="sl">${L[k]}</span> <span class="sd"></span></div>`).join(''); }
function updateStep(d) {
  const row = $('send-steps').querySelector(`[data-step="${d.step}"]`); if (!row) return;
  row.querySelector('.si').textContent = STEP_ICON[d.status] || (d.status === 'pending' ? '🕒' : '⚪');
  if (d.status === 'pending') row.querySelector('.si').textContent = '🕒';
  if (d.detail) row.querySelector('.sd').textContent = '· ' + (d.detail.length > 30 ? d.detail.slice(0, 10) + '…' + d.detail.slice(-6) : d.detail);
  row.classList.toggle('done', d.status === 'ok');
}
$('btn-bridge-send').onclick = () => {
  const from = $('br-from').value, symbol = $('br-token').value, amt = $('br-amt').value;
  const to = $('br-dest').value === 'otra' ? $('br-to').value.trim() : $('br-dest').value;
  if (!from) return msg($('br-msg'), 'No hay wallet origen para esa dirección.', 'err');
  if (!to || !amt) return msg($('br-msg'), 'Elige destino y cantidad.', 'err');
  const rutaTxt = DIR === 'evm2kda' ? 'Ethereum → Kadena' : 'Kadena → Ethereum';
  const avisoTxt = DIR === 'evm2kda'
    ? '⚠️ Mueve fondos reales por el puente. Hará approve + transferRemote y gastará ETH en gas. Usa importes pequeños.'
    : '⚠️ Mueve fondos reales por el puente. Quemará el kb-token en Kadena (dispatch) y cobrará además el PEAJE del puente en KDA de la chain 2 (~37 KDA hacia Ethereum; míralo exacto con Simular). Usa importes que compensen el peaje.';
  askSend(`<b>ENVÍO REAL por el puente</b> (${rutaTxt})<br>Puentear <b>${amt} ${symbol}</b> a <span class="mono">${to}</span><br><span class="warn" style="display:block;margin-top:8px">${avisoTxt}</span>`,
    async (pass) => {
      initSteps(DIR);
      const off = window.api.onBridgeStep(updateStep);
      try {
        const r = await window.api.bridgeSend(DIR, pass, from, symbol, to, amt);
        const okTxt = DIR === 'evm2kda'
          ? (r.arrived ? '✅ Puente completado — recibido en Kadena.' : '⏳ Enviado y confirmado en Ethereum. Esperando al relayer para que llegue a Kadena.')
          : (r.arrived ? '✅ Puente completado — recibido en Ethereum.' : '⏳ Enviado y confirmado en Kadena. Esperando al relayer hacia Ethereum.');
        return okTxt + ' tx: ' + (r.txHash || '').slice(0, 14) + '…';
      }
      finally { off(); }
    });
};

// Refleja el estado de las redes Kadena (enabled) en el selector de Ajustes y en los interruptores de Red.
function syncKdaControls() {
  if (!CFG || !CFG.kda) return;
  const on = (k) => { const n = CFG.kda.networks.find(x => x.key === k); return n && n.enabled; };
  const mode = on('mainnet') && on('fork') ? 'ambas' : (on('mainnet') ? 'oficial' : 'fork');
  if ($('set-kda-mode')) $('set-kda-mode').value = mode;
  if ($('kda-nets')) $('kda-nets').querySelectorAll('input').forEach(cb => { cb.checked = on(cb.dataset.knet); });
}

// Las redes EVM se muestran cuando hay alguna wallet EVM visible en el dashboard.
function updateNetContext() {
  const anyEvmShown = WALLETS.some(w => w.kind === 'evm' && SHOWN.includes(w.id));
  if ($('kda-ctx')) $('kda-ctx').textContent = '';
  if ($('evm-ctx')) $('evm-ctx').textContent = anyEvmShown
    ? 'Marca las redes EVM que quieras ver (la misma dirección 0x vale en todas).'
    : 'Estas redes se muestran cuando tienes alguna wallet EVM visible en el dashboard.';
  const nets = $('evm-nets');
  if (nets) nets.style.opacity = anyEvmShown ? 1 : .55;
}

// MERCADO (swap KDA <-> kb-USDC en el pool del fork)
let MKDIR = 'compra'; // 'compra' = entregas kb-USDC, recibes KDA · 'venta' = al revés
function renderMercado() {
  const kdaW = WALLETS.filter(w => w.kind === 'kda');
  $('mk-wallet').innerHTML = kdaW.map(w => `<option value="${w.id}">${w.label} · ${shortAddr(w.kdaAccount)}</option>`).join('') || '<option value="">— sin wallet Kadena —</option>';
  const compra = MKDIR === 'compra';
  $('mk-from').textContent = compra ? 'kb-USDC' : 'KDA';
  $('mk-to').textContent = compra ? 'KDA' : 'kb-USDC';
  $('mk-lbl-amt').textContent = 'Cantidad a entregar (' + (compra ? 'kb-USDC' : 'KDA') + ')';
  mkQuote();
}
$('mk-invert').onclick = () => { MKDIR = MKDIR === 'compra' ? 'venta' : 'compra'; renderMercado(); };
let _mkT = null;
$('mk-amt').oninput = () => { clearTimeout(_mkT); _mkT = setTimeout(mkQuote, 400); };
async function mkQuote() {
  const amt = $('mk-amt').value;
  if (!amt || Number(amt) <= 0) { $('mk-quote').textContent = ''; return; }
  try {
    msg($('mk-quote'), 'Calculando precio del pool…');
    const q = await window.api.swapQuote(MKDIR, amt);
    $('mk-quote').innerHTML = `Recibes ≈ <b>${q.esperada.toFixed(6)} ${q.tokenOut}</b> · mínimo ${q.minimo.toFixed(6)} (slippage ${q.slippagePct}%)<br>Precio ${q.precio.toFixed(6)} kb-USDC/KDA · impacto ${q.impacto.toFixed(2)}%`;
    $('mk-quote').className = 'msg';
  } catch (e) { msg($('mk-quote'), e.message, 'err'); }
}
$('mk-swap').onclick = () => {
  const wid = $('mk-wallet').value, amt = $('mk-amt').value;
  if (!wid) return msg($('mk-msg'), 'No hay wallet Kadena.', 'err');
  if (!amt || Number(amt) <= 0) return msg($('mk-msg'), 'Indica la cantidad.', 'err');
  const compra = MKDIR === 'compra';
  askSend(`Cambiar <b>${amt} ${compra ? 'kb-USDC' : 'KDA'}</b> → <b>${compra ? 'KDA' : 'kb-USDC'}</b><br><span class="muted">Pool del fork (kaddex.exchange, chain 2), no custodial. Precio fresco al firmar.</span>`,
    async (pass) => { const r = await window.api.swapExec(pass, wid, MKDIR, amt); return 'Swap enviado. requestKey: ' + r.requestKey; });
};

// SWAP ETH (USDC <-> ETH en Uniswap, Ethereum mainnet) — para reponer ETH de gas con USDC
let ESDIR = 'usdc2eth';
function renderEthSwap() {
  const evmW = WALLETS.filter(w => w.ethAddress);
  $('es-wallet').innerHTML = evmW.map(w => `<option value="${w.id}">${w.label} · ${shortAddr(w.ethAddress)}</option>`).join('') || '<option value="">— sin wallet Ethereum —</option>';
  const u2e = ESDIR === 'usdc2eth';
  $('es-from').textContent = u2e ? 'USDC' : 'ETH';
  $('es-to').textContent = u2e ? 'ETH' : 'USDC';
  $('es-lbl-amt').textContent = 'Cantidad a entregar (' + (u2e ? 'USDC' : 'ETH') + ')';
  esQuote();
}
$('es-invert').onclick = () => { ESDIR = ESDIR === 'usdc2eth' ? 'eth2usdc' : 'usdc2eth'; renderEthSwap(); };
let _esT = null;
$('es-amt').oninput = () => { clearTimeout(_esT); _esT = setTimeout(esQuote, 500); };
async function esQuote() {
  const amt = $('es-amt').value;
  if (!amt || Number(amt) <= 0) { $('es-quote').textContent = ''; return; }
  try {
    msg($('es-quote'), 'Consultando Uniswap…');
    const q = await window.api.ethswapQuote(ESDIR, amt);
    const outSym = ESDIR === 'usdc2eth' ? 'ETH' : 'USDC';
    $('es-quote').innerHTML = `Recibes ≈ <b>${q.out.toFixed(6)} ${outSym}</b> · mínimo ${q.min.toFixed(6)} (slippage ${q.slipPct}%)` +
      (q.gasEth != null ? `<br>⛽ Gas estimado del swap: ~${q.gasEth.toFixed(5)} ETH — se paga en ETH: no esperes a quedarte a cero.` : '');
    $('es-quote').className = 'msg';
  } catch (e) { msg($('es-quote'), e.message, 'err'); }
}
$('es-swap').onclick = () => {
  const wid = $('es-wallet').value, amt = $('es-amt').value;
  if (!wid) return msg($('es-msg'), 'No hay wallet Ethereum.', 'err');
  if (!amt || Number(amt) <= 0) return msg($('es-msg'), 'Indica la cantidad.', 'err');
  const u2e = ESDIR === 'usdc2eth';
  askSend(`Cambiar <b>${amt} ${u2e ? 'USDC' : 'ETH'}</b> → <b>${u2e ? 'ETH' : 'USDC'}</b> en Uniswap (Ethereum)<br><span class="muted">No custodial; precio fresco al firmar. El gas del swap se paga en ETH de tu cuenta.</span>`,
    async (pass) => { const r = await window.api.ethswapExec(pass, wid, ESDIR, amt); return (r.ok ? '✅ Swap confirmado.' : '⚠️ Swap enviado, revisa la tx.') + ' tx: ' + (r.txHash || '').slice(0, 14) + '…'; });
};

async function applyView(v) {
  WALLETS = v.wallets; SHOWN = v.shown;
  renderBridge();
  renderMercado();
  renderEthSwap();
  updateNetContext();
  $('sec-wallet').innerHTML = v.wallets.map(w => `<option value="${w.id}">${w.label} · ${w.kind === 'kda' ? 'Kadena' : w.netName}</option>`).join('');
  $('wallet-list').innerHTML = v.wallets.map(w => `<div class="wrow ${w.shown ? 'active' : ''}">
    <label class="wshow" title="Ver en el dashboard"><input type="checkbox" data-show="${w.id}" ${w.shown ? 'checked' : ''}/> <span class="tdot" style="background:${w.kind === 'kda' ? '#63e038' : '#627eea'}"></span></label>
    <div class="wmeta"><div class="wl">${w.label}</div><div class="wa">${w.kind === 'kda' ? 'Kadena' : w.netName}${w.shown ? ' · <span class="grn">en dashboard</span>' : ''}</div></div>
    <div class="wact"><button class="copy" data-ren="${w.id}" title="Renombrar">✏️</button><button class="copy" data-del="${w.id}" title="Borrar">🗑</button></div></div>`).join('');
  $('wallet-list').querySelectorAll('[data-show]').forEach(cb => cb.onchange = async () => applyView(await window.api.walletShown(cb.dataset.show, cb.checked)));
  $('wallet-list').querySelectorAll('[data-ren]').forEach(b => b.onclick = () => { const w = WALLETS.find(x => x.id === b.dataset.ren); openRename(b.dataset.ren, w ? w.label : ''); });
  // Borrar con DOBLE confirmación + consejo de copiar la semilla antes (modal-del)
  $('wallet-list').querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
    const w = WALLETS.find(x => x.id === b.dataset.del);
    window._delId = b.dataset.del;
    $('del-name').textContent = w ? w.label : 'esta wallet'; $('del-name2').textContent = w ? w.label : 'esta wallet';
    $('del-step1').hidden = false; $('del-step2').hidden = true; msg($('del-msg'), '');
    $('modal-del').hidden = false;
  });
  loadBalances();
}

function assetRow(sym, amt, usd) { return `<div class="asset"><span class="a-sym">${sym}</span><span class="a-amt">${amt}</span><span class="a-usd">$${(usd || 0).toFixed(2)}</span></div>`; }
// Una tarjeta = una red de una wallet visible. Colapsada por defecto: solo red + total. Clic en el título despliega tokens/chains.
function cardBlock(bl, qr) {
  let rows, extra = '', sendForm;
  if (bl.kind === 'kda') {
    const toks = bl.tokens || [];
    const kdaUsd = (bl.usd || 0) - toks.reduce((s, t) => s + t.usd, 0);
    rows = assetRow('KDA', bl.native.toFixed(4), kdaUsd) + toks.map(t => assetRow(t.symbol, t.amount.toFixed(4), t.usd)).join('');
    const per = Object.keys(bl.perChain || {}).length ? 'Repartido: ' + Object.entries(bl.perChain).sort((a, b) => a[0] - b[0]).map(([c, x]) => `Chain ${c} → ${Number(x).toFixed(4)}`).join('  ·  ') : 'Sin saldo aún.';
    extra = `<div class="muted xs">${per}</div>`;
    sendForm = `<label>Chain</label><input class="k-chain" type="number" value="2" min="0" max="19"/>
      <label>Destino (k:…)</label><input class="k-to" placeholder="k:..."/>
      <label>Cantidad</label><input class="k-amt" type="number" step="0.0001"/>
      <button class="primary k-send" data-wid="${bl.walletId}" data-knet="${bl.knet}">Enviar</button>`;
  } else {
    rows = assetRow(bl.symbol, bl.native.toFixed(4), bl.nativeUsd) + bl.tokens.map(t => assetRow(t.symbol, t.amount.toFixed(4), t.usd)).join('');
    const opts = `<option value="${bl.symbol}">${bl.symbol}</option>` + bl.tokens.map(t => `<option value="${t.address}">${t.symbol}</option>`).join('');
    sendForm = `<label>Activo</label><select class="e-asset">${opts}</select>
      <label>Destino (0x…)</label><input class="e-to" placeholder="0x..."/>
      <label>Cantidad</label><input class="e-amt" type="number" step="0.0001"/>
      <button class="primary e-send" data-wid="${bl.walletId}" data-net="${bl.key}" data-netname="${bl.name}">Enviar</button>`;
  }
  return `<div class="card netcard" style="border-top:3px solid ${bl.color}">
    <div class="nc-head" data-toggle="body"><span class="netdot" style="background:${bl.color}"></span><span class="chev">▸</span> ${bl.name} <small class="muted">${bl.walletLabel}</small>${bl.error ? ' <small class="err">sin conexión</small>' : ''}<span class="nc-sub">$${(bl.usd || 0).toFixed(2)}</span></div>
    <div class="nc-body" hidden>
      <div class="assets">${rows}</div>
      ${extra}
    </div>
    <div class="nc-actions">
      <button class="act-btn" data-panel="recv">📥 Recibir</button>
      <button class="act-btn" data-panel="send">📤 Enviar</button>
    </div>
    <div class="nc-panel" data-pan="recv" hidden>
      <div class="addr"><span class="mono">${bl.address}</span><button class="copy" data-ct="${bl.address}">copiar</button></div>
      <img class="qr" src="${qr}"/>
    </div>
    <div class="nc-panel" data-pan="send" hidden>${sendForm}</div>
  </div>`;
}
function donut(segs, total) {
  const el = $('donut');
  if (!total) { el.style.background = '#e7eae6'; $('total-legend').innerHTML = ''; return; }
  let acc = 0; const parts = segs.filter(s => s.usd > 0).map(s => { const a = acc, b = acc + s.usd / total * 100; acc = b; return `${s.color} ${a}% ${b}%`; });
  el.style.background = `conic-gradient(${parts.join(',')})`;
  $('total-legend').innerHTML = segs.filter(s => s.usd > 0).map(s => `<span class="lg"><i style="background:${s.color}"></i>${s.name} $${s.usd.toFixed(0)}</span>`).join('');
}

async function loadBalances() {
  msg($('wallet-msg'), 'Cargando saldos…');
  try {
    const b = await window.api.balances();
    const blocks = b.blocks || [];
    const qrs = {};
    for (const bl of blocks) { if (!(bl.address in qrs)) qrs[bl.address] = await window.api.qr(bl.address); }
    $('net-cards').innerHTML = blocks.map(bl => cardBlock(bl, qrs[bl.address])).join('') || '<p class="muted">No hay wallets visibles. Marca alguna en la sección Wallets.</p>';
    $('total-usd').textContent = '$' + (b.total || 0).toFixed(2);
    const segMap = {};
    blocks.forEach(bl => { (segMap[bl.name] = segMap[bl.name] || { name: bl.name, color: bl.color, usd: 0 }).usd += bl.usd; });
    donut(Object.values(segMap), b.total || 0);
    wireCards();
    msg($('wallet-msg'), '');
  } catch (e) { msg($('wallet-msg'), 'Error: ' + e.message, 'err'); }
}
function wireCards() {
  // Título → despliega tokens/chains
  document.querySelectorAll('.netcard .nc-head[data-toggle]').forEach(h => h.onclick = () => {
    const b = h.parentElement.querySelector('.nc-body'); if (!b) return;
    b.hidden = !b.hidden; const c = h.querySelector('.chev'); if (c) c.textContent = b.hidden ? '▸' : '▾';
  });
  // Botones Recibir/Enviar → despliegan su panel (uno u otro)
  document.querySelectorAll('.netcard .act-btn').forEach(btn => btn.onclick = () => {
    const card = btn.closest('.netcard'); const which = btn.dataset.panel;
    const panel = card.querySelector(`.nc-panel[data-pan="${which}"]`);
    const other = card.querySelector(`.nc-panel[data-pan="${which === 'recv' ? 'send' : 'recv'}"]`);
    if (other) other.hidden = true;
    panel.hidden = !panel.hidden;
    card.querySelectorAll('.act-btn').forEach(b => b.classList.toggle('on', b === btn && !panel.hidden));
  });
  document.querySelectorAll('.k-send').forEach(btn => btn.onclick = () => {
    const c = btn.closest('.netcard'); const chain = Number(c.querySelector('.k-chain').value), to = c.querySelector('.k-to').value.trim(), amt = c.querySelector('.k-amt').value;
    if (!to || !amt) return msg($('wallet-msg'), 'Rellena destino y cantidad.', 'err');
    const wid = btn.dataset.wid, knet = btn.dataset.knet;
    askSend(`Enviar <b>${amt} KDA</b> (chain ${chain})<br>a <span class="mono">${to}</span>`, async (pass) => { const r = await window.api.sendKda(pass, wid, knet, chain, to, amt); return 'Enviado. requestKey: ' + r.requestKey; });
  });
  document.querySelectorAll('.e-send').forEach(btn => btn.onclick = () => {
    const c = btn.closest('.netcard'); const sel = c.querySelector('.e-asset'); const asset = sel.value, label = sel.options[sel.selectedIndex].textContent, to = c.querySelector('.e-to').value.trim(), amt = c.querySelector('.e-amt').value;
    if (!to || !amt) return msg($('wallet-msg'), 'Rellena destino y cantidad.', 'err');
    const wid = btn.dataset.wid;
    askSend(`Enviar <b>${amt} ${label}</b> en ${btn.dataset.netname}<br>a <span class="mono">${to}</span>`, async (pass) => { const r = await window.api.sendEvm(pass, wid, btn.dataset.net, asset, to, amt); return 'Enviado. tx: ' + r.hash; });
  });
}
// confirmación de envío con contraseña
function askSend(summary, fn) { window._sendFn = fn; $('send-summary').innerHTML = summary; $('send-pass').value = ''; msg($('send-msg'), ''); $('send-steps').innerHTML = ''; $('modal-send').hidden = false; }
$('btn-confirm-send').onclick = async () => { try { msg($('send-msg'), 'Firmando y enviando… (puede tardar)'); const okmsg = await window._sendFn($('send-pass').value); msg($('send-msg'), '✅ ' + okmsg, 'ok'); loadBalances(); setTimeout(() => { $('modal-send').hidden = true; }, 2500); } catch (e) { msg($('send-msg'), e.message, 'err'); } };
$('send-pass').addEventListener('keydown', e => { if (e.key === 'Enter') $('btn-confirm-send').click(); });
$('btn-refresh').onclick = loadBalances;

// HISTORIAL (plegado por defecto) — de la wallet seleccionada: on-chain de kdaindex + local (EVM/puente)
const HIST_ICON = { in: '📥', out: '📤', 'send-evm': '📤', bridge: '🌉' };
let HIST_WID = null;
async function refreshHistory() {
  const wid = $('hist-wallet').value || null;
  $('hist-list').innerHTML = `<div class="muted xs" style="padding:10px 2px">${t('hist_loading')}</div>`;
  let list = [];
  try { list = await window.api.history(wid); } catch (e) { $('hist-list').innerHTML = '<div class="msg err">Error: ' + e.message + '</div>'; return; }
  // Alex #3: todo lo que venga del indexador (amt/tok/other/chain/id/title/sub) se ESCAPA antes de ir a innerHTML.
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  $('hist-list').innerHTML = list.length ? list.map(h => {
    const fecha = new Date(h.ts).toLocaleString(LNG === 'en' ? 'en-GB' : 'es-ES');
    const idShort = h.id ? esc(String(h.id).slice(0, 12)) + '…' : '';
    // on-chain: campos estructurados (amt/chain se fuerzan a número); locales EVM/puente usan title/sub
    const title = h.dir ? `${t(h.dir === 'in' ? 'hist_in' : 'hist_out')} ${esc(Number(h.amt))} ${esc(h.tok)}` : esc(h.title);
    const sub = h.dir ? `${esc(h.wlabel)} · ${t(h.dir === 'in' ? 'hist_from' : 'hist_to')} ${esc(h.other)} · chain ${esc(Number(h.chain))}` : esc(h.sub);
    return `<div class="hrow"><div class="hi">${HIST_ICON[h.kind] || '•'}</div><div class="hmeta"><div class="hd">${title}</div><div class="hx muted">${esc(fecha)}${sub ? ' · ' + sub : ''}${idShort ? ' · ' + idShort : ''}</div></div>${h.id ? `<button class="copy" data-ct="${esc(h.id)}" title="copiar id">⧉</button>` : ''}</div>`;
  }).join('') : `<div class="muted xs" style="padding:10px 2px">${t('hist_empty')}</div>`;
}
function fillHistWallet() {
  $('hist-wallet').innerHTML = WALLETS.map(w => `<option value="${w.id}">${w.label} · ${w.kind === 'kda' ? 'Kadena' : w.netName}</option>`).join('');
  if (HIST_WID && WALLETS.some(w => w.id === HIST_WID)) $('hist-wallet').value = HIST_WID;
  else { const def = WALLETS.find(w => SHOWN.includes(w.id)) || WALLETS[0]; if (def) $('hist-wallet').value = def.id; }
  HIST_WID = $('hist-wallet').value;
}
$('hist-wallet').onchange = () => { HIST_WID = $('hist-wallet').value; refreshHistory(); };
$('btn-history').onclick = async () => { const p = $('history-panel'); if (!p.hidden) { p.hidden = true; return; } fillHistWallet(); p.hidden = false; refreshHistory(); };
$('hist-close').onclick = () => { $('history-panel').hidden = true; };

// CREAR
$('btn-create').onclick = () => { $('create-step1').hidden = false; $('create-step2').hidden = true; $('cr-label').value = ''; msg($('cr-msg'), ''); $('modal-create').hidden = false; };
$('btn-do-create').onclick = async () => { try { msg($('cr-msg'), 'Generando…'); const { kind, net } = parseNet($('cr-net').value); const r = await window.api.createWallet($('cr-label').value.trim(), kind, net); window._pv = r.view; $('cr-seed').textContent = r.mnemonic; $('create-step1').hidden = true; $('create-step2').hidden = false; msg($('cr-msg'), ''); } catch (e) { msg($('cr-msg'), 'Error: ' + e.message, 'err'); } };
$('btn-create-done').onclick = () => { $('modal-create').hidden = true; $('cr-seed').textContent = ''; applyView(window._pv); nav('dashboard'); };

// RENOMBRAR
let renId = null;
function openRename(id, label) { renId = id; $('ren-label').value = label || ''; msg($('ren-msg'), ''); $('modal-rename').hidden = false; $('ren-label').focus(); }
$('btn-do-rename').onclick = async () => { try { const v = await window.api.renameWallet(renId, $('ren-label').value.trim()); $('modal-rename').hidden = true; applyView(v); } catch (e) { msg($('ren-msg'), e.message, 'err'); } };
$('ren-label').addEventListener('keydown', e => { if (e.key === 'Enter') $('btn-do-rename').click(); });

// IMPORTAR
$('btn-import').onclick = () => {
  // Abrir SIEMPRE en la pestaña Semilla, con los campos limpios (antes se quedaba en "Clave privada" y no se veía dónde meter la semilla).
  document.querySelectorAll('.tab').forEach(x => x.classList.remove('on'));
  document.querySelector('.tab[data-tab="mn"]').classList.add('on');
  $('tab-mn').hidden = false; $('tab-pk').hidden = true;
  $('imp-mn').value = ''; $('imp-pk').value = ''; $('imp-label').value = ''; $('seed-accts').innerHTML = '';
  $('modal-import').hidden = false; msg($('imp-msg'), '');
};
// Escanear las cuentas de una semilla (índices 0,1,2… con paginación) y elegir cuál importar, como eckoWallet.
let seedOffset = 0, seedRowsHtml = '';
const METHOD_TAG = { chainweaver: 'Chainweaver', ecko: 'eckoWallet', 'ecko-acct': 'eckoWallet·acct', 'ecko-4': 'eckoWallet·4', 'ecko-3': 'eckoWallet·3', 'ecko-chg': 'eckoWallet·chg', 'ecko-direct': 'eckoWallet·seed', evm: '' };
function wireSeedRows() {
  const mn = $('imp-mn').value.trim(); const { kind, net } = parseNet($('imp-net').value);
  $('seed-accts').querySelectorAll('.seed-imp').forEach(b => b.onclick = async () => {
    try { const v = await window.api.importMnemonic($('imp-label').value.trim(), mn, kind, net, Number(b.dataset.idx), b.dataset.method); $('modal-import').hidden = true; $('imp-mn').value = ''; $('imp-label').value = ''; $('seed-accts').innerHTML = ''; applyView(v); nav('dashboard'); }
    catch (e) { msg($('imp-msg'), 'Error: ' + e.message, 'err'); }
  });
  const more = $('btn-seed-more'); if (more) more.onclick = () => scanSeed(false);
}
async function scanSeed(reset) {
  const mn = $('imp-mn').value.trim(); const { kind, net } = parseNet($('imp-net').value);
  if (!mn) return msg($('imp-msg'), 'Pega la semilla primero.', 'err');
  if (reset) { seedOffset = 0; seedRowsHtml = ''; }
  $('seed-accts').innerHTML = seedRowsHtml + '<div class="muted xs">Buscando cuentas y saldos… (unos segundos)</div>';
  try {
    const accts = await window.api.seedAccounts(mn, kind, net, seedOffset, 5);
    seedOffset += 5;
    seedRowsHtml += accts.map(a => { const tag = METHOD_TAG[a.method] ? ` <span class="mtag">${METHOD_TAG[a.method]}</span>` : ''; return `<div class="seedrow"><div class="sr-acc"><b>#${a.index}</b>${tag} <span class="mono">${a.id.slice(0, 12)}…${a.id.slice(-6)}</span></div><div class="sr-bal ${a.amount > 0 ? 'has' : ''}">${a.amount.toFixed(4)} ${a.unit}</div><button class="tiny seed-imp" data-idx="${a.index}" data-method="${a.method}">Importar</button></div>`; }).join('');
    $('seed-accts').innerHTML = seedRowsHtml + `<button id="btn-seed-more" class="ghost tiny">Ver 5 cuentas más (desde #${seedOffset})</button>`;
    wireSeedRows();
  } catch (e) { $('seed-accts').innerHTML = seedRowsHtml; msg($('imp-msg'), 'Error: ' + e.message, 'err'); }
}
$('btn-seed-scan').onclick = () => scanSeed(true);
// Buscar una cuenta concreta dentro de la semilla (encuentra método+índice exactos)
$('btn-seed-find').onclick = async () => {
  const mn = $('imp-mn').value.trim(); const { kind, net } = parseNet($('imp-net').value); const target = $('imp-target').value.trim();
  if (!mn) return msg($('imp-msg'), 'Pega la semilla primero.', 'err');
  if (!target) return msg($('imp-msg'), 'Pega la cuenta que buscas.', 'err');
  $('seed-accts').innerHTML = '<div class="muted xs">Buscando la cuenta en los índices (0-40, ambos métodos)…</div>';
  try {
    const r = await window.api.seedFind(mn, kind, net, target, 40);
    if (r.found) {
      seedRowsHtml = `<div class="seedrow"><div class="sr-acc">✅ <b>${METHOD_TAG[r.method] || 'EVM'} · #${r.index}</b> <span class="mono">${r.id.slice(0, 14)}…${r.id.slice(-6)}</span></div><button class="tiny seed-imp" data-idx="${r.index}" data-method="${r.method}">Importar esta</button></div>`;
      $('seed-accts').innerHTML = seedRowsHtml; wireSeedRows();
    } else { $('seed-accts').innerHTML = `<div class="muted xs">No aparece en los primeros ${r.scanned} índices con ninguno de los dos métodos. Tu wallet usa otra derivación — dímelo y la añado.</div>`; }
  } catch (e) { $('seed-accts').innerHTML = ''; msg($('imp-msg'), 'Error: ' + e.message, 'err'); }
};
document.querySelectorAll('.tab').forEach(t => t.onclick = () => { document.querySelectorAll('.tab').forEach(x => x.classList.remove('on')); t.classList.add('on'); $('tab-mn').hidden = t.dataset.tab !== 'mn'; $('tab-pk').hidden = t.dataset.tab !== 'pk'; });
$('btn-do-import').onclick = async () => { const label = $('imp-label').value.trim(); const { kind, net } = parseNet($('imp-net').value); const mnMode = document.querySelector('.tab.on').dataset.tab === 'mn'; try { msg($('imp-msg'), 'Importando…'); const v = mnMode ? await window.api.importMnemonic(label, $('imp-mn').value, kind, net) : await window.api.importPrivkey(label, kind, net, $('imp-pk').value); $('modal-import').hidden = true; $('imp-mn').value = ''; $('imp-pk').value = ''; $('imp-label').value = ''; applyView(v); nav('dashboard'); } catch (e) { msg($('imp-msg'), 'Error: ' + e.message, 'err'); } };

// EXPORTAR
let expChain = null, expWid = null;
function openExport(wid, chain) { expWid = wid; expChain = chain; $('exp-chain').textContent = chain === 'kda' ? 'KDA' : 'EVM'; $('exp-chain').className = 'chip ' + (chain === 'kda' ? 'kda' : 'eth'); $('exp-pass').value = ''; $('exp-out').hidden = true; $('exp-secret').textContent = ''; msg($('exp-msg'), ''); $('modal-export').hidden = false; }
$('btn-sec-export').onclick = () => { const w = WALLETS.find(x => x.id === $('sec-wallet').value); if (!w) return; openExport(w.id, w.kind === 'kda' ? 'kda' : 'eth'); };
$('btn-do-export').onclick = async () => { try { const r = await window.api.exportKey($('exp-pass').value, expWid, expChain); $('exp-secret').textContent = r.secret; $('exp-out').hidden = false; msg($('exp-msg'), 'Revelada. Cópiala y cierra.', 'ok'); } catch (e) { msg($('exp-msg'), e.message, 'err'); } };

// borrar wallet: paso 1 (consejo semilla) → paso 2 (última confirmación) → borrar
$('btn-del-next').onclick = () => { $('del-step1').hidden = true; $('del-step2').hidden = false; };
$('btn-del-do').onclick = async () => {
  try { applyView(await window.api.walletRemove(window._delId)); $('modal-del').hidden = true; msg($('wallet-msg'), 'Wallet borrada.', 'ok'); }
  catch (e) { msg($('del-msg'), e.message, 'err'); }
};

// modales + copiar
document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => b.closest('.modal').hidden = true);
document.addEventListener('click', e => { const t = e.target; if (t.classList.contains('copy')) { const txt = t.dataset.ct || (t.dataset.copy ? $(t.dataset.copy).textContent : null); if (txt) navigator.clipboard.writeText(txt); } });

// Botón 👁 ver/ocultar en todos los campos de contraseña (login, setup, firmas, exportar)
function initEyes() {
  const EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/></svg>';
  const EYE_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 12S6 5.5 12 5.5c2.2 0 4 .8 5.5 1.9M21.5 12S18 18.5 12 18.5c-2.2 0-4-.8-5.5-1.9"/><path d="M4.5 19.5 19.5 4.5"/></svg>';
  document.querySelectorAll('input[type="password"]').forEach(inp => {
    let wrap = inp.closest('.auth-input');
    if (!wrap) { wrap = document.createElement('span'); wrap.className = 'pwdwrap'; inp.parentNode.insertBefore(wrap, inp); wrap.appendChild(inp); }
    const b = document.createElement('button'); b.type = 'button'; b.className = 'eye'; b.title = 'Ver / ocultar'; b.innerHTML = EYE;
    b.onclick = () => { const show = inp.type === 'password'; inp.type = show ? 'text' : 'password'; b.innerHTML = show ? EYE_OFF : EYE; inp.focus(); };
    wrap.appendChild(b);
  });
}
initEyes();

boot();
