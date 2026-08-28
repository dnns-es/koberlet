const $ = (id) => document.getElementById(id);
function msg(el, text, kind) { el.className = 'msg ' + (kind || ''); el.textContent = text; }
// L-1: escapar TODO texto (etiquetas de wallet, destinatarios, datos remotos) antes de meterlo en innerHTML.
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Limpia el prefijo técnico de Electron ("Error invoking remote method 'x': Error: …") de los errores IPC.
const cleanErr = (e) => String((e && e.message) || e || '').replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '');
// Estados del Ledger que NO son fallos sino situaciones reintenables (PIN, sin conectar, app cerrada).
const isLedgerWait = (m) => /Ledger está bloqueado|introduce el PIN|No veo ningún Ledger|Abre la app correcta|Blind signing/i.test(m);
let CFG = null, WALLETS = [], SHOWN = [];

// ===== i18n ES/EN =====
const LANG = {
  es: {
    nav_dashboard: 'Panel', nav_wallets: 'Wallets', nav_red: 'Red', nav_mercado: 'Mercado', nav_puente: 'Puente', nav_seguridad: 'Seguridad', nav_ajustes: 'Ajustes', nav_info: 'Info',
    nav_nft: 'NFT', h_nft: 'NFT',
    nft_enviar: 'Enviar', nft_env_ir: 'Enviar', mk_disponible: 'Disponible:',
    nft_env_malacuenta: 'Eso no parece una cuenta k: (k: y 64 caracteres).',
    nft_env_comprobando: 'Comprobando si el contrato la deja mover…',
    mkt_st_sub: 'USDT ⇄ USDC · Uniswap V3, antes de cruzar el puente',
    st_porque: 'En Kadena el único con mercado es kb-USDC: un USDT cruzado tal cual no se puede cambiar a KDA. Cámbialo aquí antes de pasar el puente.',
    st_quote: 'Recibirás aproximadamente {out} {sym} (pool del {fee}%).',
    st_confirm: 'Vas a cambiar {a} {f} por unos {out} {t} en Uniswap. Si el precio se mueve mucho mientras tanto, la operación se cancela sola y no pierdes el dinero.',
    st_ok: 'Cambiado. Has recibido unos {out} {sym}.',
    st_ledger: 'Con Ledger no: el aparato no puede enseñarte la llamada al contrato y sería firmar a ciegas.',
    nav_dca: 'DCA',
    h_dca: 'DCA · compra periódica',
    dca_sub: 'Dejas un bote en el contrato y el vigilante de KoberluSW compra una cuota cada cierto tiempo. Lo firmas tú; Koberlet no ejecuta las compras ni custodia nada.',
    dca_leyendo: 'Leyendo tus planes de la cadena…',
    dca_info: 'Comisión del contrato: {c}% por compra, además del 0,3% del pool. Puedes seguirlo desde el móvil en {w}.',
    dca_pausado_global: 'El contrato DCA está pausado ahora mismo. No se pueden crear ni ejecutar planes.',
    dca_sin_planes: 'No tienes ningún plan todavía.',
    dca_nuevo: 'Nuevo plan',
    dca_entregas: 'Entregas',
    dca_compras: 'Compras',
    dca_bote: 'Bote inicial',
    dca_cuota: 'Cuota por compra',
    dca_cada: 'Cada',
    dca_slip: 'Deslizamiento máximo',
    dca_crear: 'Crear plan',
    dca_recargar: 'Recargar',
    dca_pausar: 'Pausar',
    dca_reanudar: 'Reanudar',
    dca_cerrar: 'Cerrar y recuperar',
    dca_mismo_token: 'El token que entregas y el que compras tienen que ser distintos.',
    dca_cuota_mayor: 'La cuota no puede ser mayor que el bote.',
    dca_min: 'La cuota mínima por compra es {m} {s}.',
    dca_resumen: 'Salen {n} compras de {q} {s}, una cada {p}: {d} en total. La comisión del contrato se llevará ~{c} en total.',
    dca_plan_linea: '{q} {s} cada {p}',
    dca_plan_estado: '{e} · quedan {b} {s} (~{n} compras) · {c} hechas · {r} {o} comprados',
    dca_conf: 'Vas a dejar {d} {s} en el contrato DCA y comprar {q} {s} de {o} cada {p}. Puedes pausarlo o cerrarlo cuando quieras y recuperar lo que quede.',
    dca_creado: 'Plan creado: {id}',
    dca_cuanto: '¿Cuánto quieres añadir al bote, en {s}?',
    dca_conf_top: 'Vas a añadir {a} {s} al bote del plan {id}.',
    dca_conf_pausar: 'Vas a pausar el plan {id}. Deja de comprar, pero el bote sigue guardado.',
    dca_conf_reanudar: 'Vas a reanudar el plan {id}. Volverá a comprar en cuanto toque.',
    dca_conf_cerrar: 'Vas a cerrar el plan {id}. El contrato te devuelve los {b} {s} que quedan y el plan no se puede reabrir.',
    dca_recargado: 'Bote recargado.',
    dca_hecho: 'Hecho.',
    dca_ledger: 'Con Ledger no: el aparato no puede enseñarte la llamada al contrato y sería firmar a ciegas.',
    dca_historial: 'Mis planes',
    dca_cuenta: '({n} en total, {a} abiertos)',
    dca_dias: 'días',
    dca_meses: 'meses',
    oa_titulo: '🔁 En marcha ahora mismo — {p} planes DCA y {o} órdenes límite',
    oa_limite: 'LÍMITE',
    oa_bote: 'quedan {b} {s} · {c} compras hechas',
    oa_orden: '{a} {s} cuando el precio llegue a {p}',
    mkt_t_kda: 'Cambiar kb-USDC ⇄ KDA',
    mkt_t_st: 'Cambiar USDT ⇄ USDC',
    mkt_t_eth: 'Cambiar USDC ⇄ ETH',
    mkt_m_kda: 'Pool de kaddex · chain 2',
    mkt_m_st: 'Uniswap V3 · para poder cruzar el puente',
    mkt_m_eth: 'Uniswap V3 · para reponer gas',
    nft_env_saleonly: 'Esta pieza se acuñó como «solo venta»: el contrato no deja regalarla ni transferirla, '
        + 'ni siquiera a su creador. Solo cambia de dueño vendiéndose.',
    nft_env_conf: 'Vas a enviar «{n}» a {to}. La pieza deja de ser tuya.',
    nft_env_ok: '🎉 «{n}» ya viaja a su nuevo dueño. ¡Envío completado!',
    nft_sub: 'Las piezas que hay en tu wallet, leídas de la cadena. Cada red tiene su propio ledger de NFT.',
    nft_wallet: 'Wallet', nft_red: 'Red', nft_recargar: 'Buscar mis piezas', nft_anadir: 'Añadir por identificador',
    nft_buscando: 'Preguntando a la cadena…', nft_sin_wallet: 'No tienes ninguna wallet de Kadena',
    nft_encontradas: '{n} piezas en {red}.', nft_ninguna: 'Ninguna pieza en {red} de momento.',
    nft_ninguna_manual: 'En {red} no hay quien liste tus piezas: añádelas por su identificador.',
    nft_desc_falla: 'Quien lista las piezas de {red} no ha contestado ({e}). Solo se ven las que hayas añadido a mano.',
    share_tit: 'Pasar Koberlet a un compañero',
    share_hint: 'Copia este enlace y pásaselo a quien quieras. Descarga el instalador oficial, el mismo que usas tú; al abrirlo por primera vez se pone al día solo con la última versión.',
    share_open: 'Abrir la descarga', share_copiado: 'Enlace copiado', share_huella_copiada: 'Huella copiada',
    share_huella: 'Huella del archivo (SHA-256)',
    share_huella_hint: 'Pásala junto al enlace, en el mismo mensaje. Quien lo descargue puede comprobar que el archivo es el nuestro con este comando de PowerShell: Get-FileHash koberlet_vX.Y.Z.zip. Si la huella no coincide, que NO lo abra.',
    share_nota: 'Instalador {v} · se actualiza solo al abrirlo',
    share_nover: 'No se ha podido consultar el enlace del instalador. Inténtalo dentro de un rato.',
    nft_sin_soporte: '{red} todavía no tiene ledger de NFT configurado.',
    nft_sin_imagen: 'sin imagen', nft_quitar: 'quitar', nft_vacio: 'Aquí aparecerán tus piezas.', nft_sueltas: 'Sin colección',
    nft_pide_id: 'Pega el identificador de la pieza (token id):',
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
    set_lock: 'Bloqueo automático por inactividad', lock_never: 'Nunca',
    lock_hint: 'Tras ese tiempo sin usar la app, se bloquea sola y hay que volver a introducir la contraseña. Protege tus claves si dejas el equipo desatendido.',
    nodes_adv: 'Nodos (avanzado)', nodes_kda: 'Nodos Kadena (fijos por seguridad)',
    nodes_hint: 'Servidor de entrada a cada red (RPC). Solo tócalo si el nodo por defecto va lento o quieres usar el tuyo. Debe ser una dirección https. Restablecer vuelve al nodo por defecto.',
    node_save: 'Guardar', node_reset: 'Restablecer', node_saved: 'Nodo guardado.', node_bad: 'Debe ser una dirección https válida.',
    test_mode: '🧪 Modo pruebas — saldos ficticios de la Devnet; las redes reales están ocultas.',
    faucet_wait: 'Recargando desde el grifo… (unos segundos)', faucet_ok: 'Recarga recibida: +{n} KDA en la chain {c}.', faucet_err: 'La recarga falló:',
    upd_available: 'Koberlet v{v} disponible.', update: 'Actualizar',
    whats_new: 'Ver novedades', whats_new_title: 'Novedades de la v{v}',
    upd_applying: 'Actualizando… la app se reiniciará sola. Tus wallets y datos se conservan.',
    upd_auto_applying: 'Actualizando a Koberlet v{v}… la app se reiniciará sola.',
    upd_err: 'Error al actualizar: ', upd_checking: 'Comprobando…',
    upd_new: 'Nueva versión <b>v{v}</b> disponible.', upd_now: 'Actualizar ahora',
    upd_latest: 'Estás en la última versión (v{v}).', upd_nocheck: 'No pude comprobar (¿sin conexión o servidor?).',
    hist_title: 'Historial de operaciones', close: 'cerrar', export_csv: '⬇ CSV',
    addr_confirm: 'He verificado que la dirección de destino es correcta',
    addrbook: 'Libreta de direcciones', add: 'Añadir',
    addrbook_hint: 'Guarda destinatarios con un nombre para elegirlos al enviar y no pegar la dirección a mano.',
    ab_saved: 'Dirección guardada.', ab_bad: 'Indica un nombre y una dirección válida (cuenta de Kadena o 0x…).', ab_pick: '📇 Libreta',
    csv_ok: 'Historial exportado.', csv_empty: 'No hay operaciones que exportar.', low_gas: 'Poco {sym} en {net} para gas ({bal}). Repón antes de operar.',
    converter: '🧮 Conversor', recv_note_kda: 'Recibes en Kadena. Para Mercado/Puente los fondos deben ir a la chain 2.', recv_note_evm: 'Recibes en {net}. La misma dirección 0x vale en todas las redes EVM; asegúrate de que quien te envía usa la red correcta.', share: 'Compartir',
    backup_title: 'Copia de seguridad de la bóveda', backup_do: '⬇ Exportar copia cifrada', restore_do: '⬆ Restaurar copia…',
    backup_hint: 'Guarda una copia cifrada de tu bóveda (a un USB, disco o carpeta segura) para recuperarla en otro equipo. Va cifrada con tu contraseña.',
    restore_hint: 'Restaurar: elige un fichero de copia y su contraseña. Se respalda tu bóveda actual antes de sustituirla.',
    backup_ok: 'Copia guardada en {path}', restore_ok: 'Bóveda restaurada. Desbloquea con la contraseña de esa copia.', restore_need_pass: 'Escribe la contraseña de la copia primero.',
    lbl_bk_newpass: 'Contraseña para la copia', bk_short: 'La contraseña debe tener al menos 10 caracteres.', bk_mismatch: 'Las dos contraseñas no coinciden.', bk_working: 'Trabajando… (el cifrado tarda un momento)', restore_from_backup: '↻ Restaurar desde una copia de seguridad', restore_merged: 'Copia importada: {n} wallet(s) nuevas añadidas.',
    pw_short: 'Muy corta (mínimo 10)', pw_weak: 'Débil — alárgala o mézclala más', pw_ok: 'Aceptable', pw_strong: 'Fuerte 💪',
    upd_verified: '🔒 Actualizaciones firmadas y verificadas (Ed25519) antes de instalarse.',
    edit_wallet: 'Editar wallet', wtag: 'Etiqueta', wtag_none: '— sin etiqueta —', wtag_cold: '❄️ Fría (ahorro)', wtag_hot: '🔥 Caliente (uso diario)', wnote: 'Nota privada',
    welcome_title: 'Bienvenido a Koberlet 👛', welcome_ok: 'Entendido, empezar',
    welcome_1t: 'Apunta tu frase de recuperación', welcome_1: 'Es la ÚNICA forma de recuperar tus fondos si pierdes el equipo. Escríbela en papel y guárdala a salvo.',
    welcome_2t: 'Prueba a recibir', welcome_2: 'En una tarjeta del panel pulsa 📥 Recibir para ver tu dirección y QR. Fíjate en la red/chain.',
    welcome_3t: 'Empieza con poco', welcome_3: 'Haz un primer envío pequeño para coger confianza. La app pedirá contraseña y confirmar la dirección.',
    updated_toast: '✔ Actualizado a v{v} · paquete firmado y verificado',
    hist_loading: 'Cargando historial on-chain…', hist_empty: 'Sin operaciones para esta wallet.',
    hist_in: 'Recibido', hist_out: 'Enviado', hist_from: 'de', hist_to: 'a',
    err_pass_min: 'Mínimo 8 caracteres.', err_pass_match: 'No coinciden.', creating_vault: 'Creando bóveda…', err_wrong_pass: 'Contraseña incorrecta.',
    lbl_from_eth: 'Wallet origen (Ethereum)', lbl_from_kda: 'Wallet origen (Kadena)',
    lbl_dest_kda: 'Wallet destino (Kadena)', lbl_dest_eth: 'Wallet destino (Ethereum)',
    lbl_to_kda: 'Cuenta Kadena destino (k:…)', lbl_to_evm: 'Dirección EVM destino (0x…)',
    no_wallet: '— sin wallet —', other_addr: 'Otra dirección…',
    loading_tokens: 'cargando saldos…', tok_balance: '(saldo {b})',
    br_no_from: 'No hay wallet origen para esa dirección.', br_need: 'Elige destino y cantidad.', br_simulating: 'Simulando…',
    br_sim_ok: '✅ La transacción se arma bien (simulación correcta).',
    br_toll: ' <b>Peaje del puente: {t} KDA</b> (se cobra en Kadena al despachar, aparte del token puenteado).',
    br_sim_approve: '✅ La tx se construye bien y tienes saldo ({b} del token). Revierte solo porque falta el <b>approve</b> (autorizar al router a mover tu token) — es un paso previo que se hará automáticamente en el envío real.',
    br_sim_nobal: '⚠️ Saldo insuficiente en Ethereum: tienes {b}, necesitas {n}.',
    br_sim_nogas: '⚠️ La tx se construye bien, pero esta cuenta KDA no tiene KDA en la chain 2 de Kadena para el gas. Necesitas algo de KDA ahí.',
    br_sim_notok: '⚠️ La tx se construye bien, pero no tienes saldo de ese token. Revisa abajo.',
    br_sim_err: '⚠️ Simulación con error: ',
    step_approve: 'Autorizar token (approve)', step_transfer: 'Enviar al puente (Ethereum)', step_ethconfirm: 'Confirmar en Ethereum', step_kadena: 'Recibir en Kadena (chain 2)',
    step_dispatch: 'Enviar al puente (Kadena, chain 2)', step_kdaconfirm: 'Confirmar en Kadena', step_evm: 'Recibir en Ethereum',
    br_warn_e2k: '⚠️ Mueve fondos reales por el puente. Hará approve + transferRemote y gastará ETH en gas. Usa importes pequeños.',
    br_warn_k2e: '⚠️ Mueve fondos reales por el puente. Quemará el kb-token en Kadena (dispatch) y cobrará además el PEAJE del puente en KDA de la chain 2 (~37 KDA hacia Ethereum; míralo exacto con Simular). Usa importes que compensen el peaje.',
    br_toll_line: '<br><b>Peaje del puente: {t} KDA</b> (en KDA de la chain 2, aparte del token).',
    br_confirm: '<b>ENVÍO REAL por el puente</b> ({r})<br>Puentear <b>{a} {s}</b> a <span class="mono">{to}</span>',
    br_done_kda: '✅ Puente completado — recibido en Kadena.', br_pend_kda: '⏳ Enviado y confirmado en Ethereum. Esperando al relayer para que llegue a Kadena.',
    br_done_eth: '✅ Puente completado — recibido en Ethereum.', br_pend_eth: '⏳ Enviado y confirmado en Kadena. Esperando al relayer hacia Ethereum.',
    evm_ctx_on: 'Marca las redes EVM que quieras ver (la misma dirección 0x vale en todas).',
    evm_ctx_off: 'Estas redes se muestran cuando tienes alguna wallet EVM visible en el dashboard.',
    no_wallet_kda: '— sin wallet Kadena —', no_wallet_eth: '— sin wallet Ethereum —',
    mk_quoting: 'Calculando precio del pool…',
    mk_quote_html: 'Recibes ≈ <b>{out} {tok}</b> · mínimo {min} (slippage {slip}%)<br>Precio {p} kb-USDC/KDA · impacto {imp}%',
    err_no_kda_wallet: 'No hay wallet Kadena.', err_no_eth_wallet: 'No hay wallet Ethereum.', err_need_amt: 'Indica la cantidad.',
    mk_confirm: 'Cambiar <b>{a} {f}</b> → <b>{t}</b><br><span class="muted">Pool de Kadena (kaddex.exchange, chain 2), no custodial. Precio fresco al firmar.</span>',
    mk_sent: 'Swap enviado. requestKey: ',
    es_quoting: 'Consultando Uniswap…',
    es_quote_html: 'Recibes ≈ <b>{out} {sym}</b> · mínimo {min} (slippage {slip}%)',
    es_gas_note: '<br>⛽ Gas estimado del swap: ~{g} ETH — se paga en ETH: no esperes a quedarte a cero.',
    es_wait_quote: 'Espera a la cotización (o vuelve a escribir la cantidad) antes de firmar.',
    es_confirm: 'Cambiar <b>{a} {f}</b> → <b>{t}</b> en Uniswap (Ethereum)<br><span class="muted">No custodial; recibes como mínimo <b>{min} {t}</b> (lo que viste al cotizar). Si el precio real cae por debajo, la operación se revierte. El gas se paga en ETH.</span>',
    es_ok: '✅ Swap confirmado.', es_check: '⚠️ Swap enviado, revisa la tx.',
    ttl_show_dash: 'Ver en el dashboard', ttl_rename: 'Renombrar', ttl_del: 'Borrar', on_dash: 'en dashboard', this_wallet: 'esta wallet',
    spread: 'Repartido: ', no_bal_yet: 'Sin saldo aún.',
    lbl_chain_from: 'Chain origen', lbl_chain_to: 'Chain destino', lbl_dest_k: 'Destino (k:…)', lbl_dest_0x: 'Destino (0x…)', lbl_amount: 'Cantidad', lbl_asset: 'Activo',
    ph_kda_dest: 'k:... o elige de la libreta', ph_evm_dest: '0x... o elige de la libreta',
    xchain_hint: '↔ Envío entre chains distintas (cross-chain): tarda algo más (dos pasos + prueba SPV).',
    send: 'Enviar', btn_recv: '📥 Recibir', btn_send: '📤 Enviar', btn_faucet: '🚰 +1.000 KDA', offline: 'sin conexión',
    btn_expand: 'Ampliar', btn_back: '← Volver al panel',
    loading_balances: 'Cargando saldos…',
    no_wallets_visible: 'No hay wallets visibles. Marca alguna en la sección Wallets.',
    err_fill_dest_amt: 'Rellena destino y cantidad.',
    cf_send_kda: 'Enviar <b>{a} KDA</b> (chain {c})<br>a <span class="mono">{to}</span>',
    cf_send_tok: 'Enviar <b>{a} {s}</b> (token de Kadena)<br>a <span class="mono">{to}</span>',
    err_tok_ledger: 'El envío de tokens KDA con Ledger aún no está disponible. Usa una wallet de semilla o clave privada.',
    cf_send_kda_x: 'Enviar <b>{a} KDA</b> de <b>chain {c1} → {c2}</b> (cross-chain)<br>a <span class="mono">{to}</span>',
    cf_send_kda_sweep: 'Enviar <b>{a} KDA</b> recibidos en la <b>chain {c}</b>.<br>Se juntará de varias chains (~{n}) mediante cross-chain — <b>tarda unos minutos</b>.<br>a <span class="mono">{to}</span>',
    cf_send_evm: 'Enviar <b>{a} {s}</b> en {net}<br>a <span class="mono">{to}</span>',
    sent_rk: 'Enviado. requestKey: ', xchain_done: 'Cross-chain completado. pactId: ', sweep_done: 'Barrido completado. requestKey: ', sent_tx: 'Enviado. tx: ',
    err_sweep_bal: 'No hay saldo suficiente ni sumando todas las chains (disponible ~{b} KDA dejando gas).',
    signing: 'Firmando y enviando… (puede tardar)',
    generating: 'Generando…', importing: 'Importando…',
    err_paste_seed: 'Pega la semilla primero.', err_paste_target: 'Pega la cuenta que buscas.',
    seed_scanning: 'Buscando cuentas y saldos… (unos segundos)',
    seed_finding: 'Buscando la cuenta en los índices (0-40, ambos métodos)…',
    seed_more: 'Ver 5 cuentas más (desde #{n})', import_this: 'Importar esta',
    seed_notfound: 'No aparece en los primeros {n} índices con ninguno de los dos métodos. Tu wallet usa otra derivación — dímelo y la añado.',
    exp_revealed: 'Revelada. Cópiala y cierra.', wallet_deleted: 'Wallet borrada.',
    ttl_eye: 'Ver / ocultar', ttl_copy_id: 'copiar id',
    tag_cold: '❄️ Fría', tag_hot: '🔥 Caliente',
    kda_mode_both: 'Ambas (Kadena + Kadena Inc)', kda_mode_inc: 'Solo Kadena (Inc)', kda_mode_comm: 'Solo Kadena',
    kda_mode_hint: 'Qué tarjetas Kadena se muestran para cada wallet. Úsalo para limpiar el dashboard si no usas una de las redes. (Equivale a los interruptores de la sección Red.)',
    min_5: '5 minutos', min_10: '10 minutos', min_30: '30 minutos',
    sec_intro: 'Revela la clave privada de una de tus wallets. Requiere la contraseña de la bóveda. No la compartas con nadie.',
    sec_view_pk: '🔑 Ver clave privada',
    sec_note: 'La bóveda está cifrada (AES-256-GCM + scrypt) y las privadas nunca salen del proceso principal salvo aquí, con tu contraseña.',
    lbl_backup_pass: 'Contraseña de la copia',
    br_sim_btn: '🧪 Simular', br_send_btn: '🚀 Ejecutar de verdad',
    br_code_lbl: 'Código Pact que se ejecutaría', br_result_lbl: 'Resultado de la simulación',
    create_title: 'Crear nueva wallet', lbl_name: 'Nombre', lbl_net: 'Red', generate: 'Generar', cancel: 'Cancelar',
    ph_cr_label: 'p.ej. Wallet fría', ph_ren_label: 'p.ej. Mi wallet Kadena', ph_imp_label: 'p.ej. Mi wallet ecko', ph_optional: 'opcional',
    seed_warn2: '⚠️ Apunta esta semilla en papel y guárdala a salvo. Es la ÚNICA forma de recuperar esta wallet. No se volverá a mostrar.',
    del_title: 'Borrar wallet',
    del_q: '¿Seguro que quieres borrar <b>{w}</b>?',
    del_warn1: '💡 Antes de borrar, <b>copia su semilla o su clave privada</b> (sección 🛡️ Seguridad → Ver clave privada) y guárdala a salvo. Es lo ÚNICO que te permitirá restaurar esta wallet si cambias de idea.',
    del_warn2: '⚠️ <b>Última confirmación:</b> la wallet <b>{w}</b> se eliminará de la app. Si no guardaste su semilla o su clave privada, <b>perderás el acceso a sus fondos para siempre</b>.',
    del_have: 'Ya la tengo, continuar', del_yes: 'Sí, borrar definitivamente',
    imp_title: 'Importar wallet', tab_seed: 'Semilla', tab_pk: 'Clave privada',
    lbl_seed: 'Semilla (12/24 palabras)',
    imp_hint: 'Una semilla contiene varias cuentas (índice 0, 1, 2…), como en eckoWallet. Pulsa "Ver cuentas" para elegir la que tiene tus fondos, o importa directamente la índice 0.',
    btn_seed_scan: '🔍 Ver cuentas de esta semilla', lbl_seed_target: '¿Buscas una cuenta concreta? (opcional)', ph_seed_target: 'k:… (Kadena) o 0x… (EVM)', btn_seed_find: '🎯 Buscar esa cuenta en la semilla',
    exp_title: 'Ver clave privada', exp_intro: 'Introduce la contraseña de la bóveda para revelar la privada. No la compartas.', reveal: 'Revelar', close_btn: 'Cerrar',
    send_title: 'Confirmar envío', lbl_vault_pass: 'Contraseña de la bóveda', btn_sign_send: 'Firmar y enviar',
    ttl_invert: 'Invertir', ttl_theme: 'Tema claro / oscuro',
    ledger_btn: '🔐 Ledger', ledger_title: 'Conectar Ledger',
    ledger_hint: 'Conecta el Ledger por USB, desbloquéalo con el PIN y abre la app de la red (Kadena o Ethereum). Cierra Ledger Live si está abierto. La clave privada nunca sale del aparato: cada envío se confirma en su pantalla.',
    ph_lg_label: 'p.ej. Ledger ahorro', lbl_lg_index: 'Índice de cuenta (0 = la primera)',
    ledger_read: '🔍 Leer cuenta del Ledger', ledger_add: 'Añadir esta cuenta',
    ledger_reading: 'Leyendo del aparato… (mira el Ledger)', ledger_added: 'Cuenta del Ledger añadida.',
    ledger_badge: '🔐 Ledger',
    ledger_confirm_note: '🔐 Wallet Ledger: revisa y confirma la operación en la pantalla del aparato.',
    ttl_max: 'Máximo enviable (descontando el gas)', ttl_priv: 'Ocultar / mostrar saldos'
  },
  en: {
    nav_dashboard: 'Dashboard', nav_wallets: 'Wallets', nav_red: 'Network', nav_mercado: 'Market', nav_puente: 'Bridge', nav_seguridad: 'Security', nav_ajustes: 'Settings', nav_info: 'Info',
    nav_nft: 'NFT', h_nft: 'NFT',
    nft_enviar: 'Send', nft_env_ir: 'Send', mk_disponible: 'Available:',
    nft_env_malacuenta: 'That does not look like a k: account (k: plus 64 characters).',
    nft_env_comprobando: 'Checking whether the contract allows moving it…',
    mkt_st_sub: 'USDT ⇄ USDC · Uniswap V3, before crossing the bridge',
    st_porque: 'On Kadena only kb-USDC has a market: a USDT bridged as-is cannot be swapped for KDA. Convert it here before crossing.',
    st_quote: 'You will get roughly {out} {sym} ({fee}% pool).',
    st_confirm: 'You are about to swap {a} {f} for about {out} {t} on Uniswap. If the price moves too much meanwhile, the operation cancels itself and you lose nothing.',
    st_ok: 'Swapped. You received about {out} {sym}.',
    st_ledger: 'Not with Ledger: the device cannot show you the contract call and it would mean blind signing.',
    nav_dca: 'DCA',
    h_dca: 'DCA · recurring buys',
    dca_sub: 'You leave a pot in the contract and the KoberluSW watcher buys a slice every so often. You sign it; Koberlet neither executes the buys nor holds anything.',
    dca_leyendo: 'Reading your plans from the chain…',
    dca_info: 'Contract fee: {c}% per buy, on top of the pool\'s 0.3%. You can follow it from your phone at {w}.',
    dca_pausado_global: 'The DCA contract is paused right now. Plans cannot be created or executed.',
    dca_sin_planes: 'You have no plans yet.',
    dca_nuevo: 'New plan',
    dca_entregas: 'You give',
    dca_compras: 'You buy',
    dca_bote: 'Initial pot',
    dca_cuota: 'Amount per buy',
    dca_cada: 'Every',
    dca_slip: 'Max slippage',
    dca_crear: 'Create plan',
    dca_recargar: 'Top up',
    dca_pausar: 'Pause',
    dca_reanudar: 'Resume',
    dca_cerrar: 'Close and refund',
    dca_mismo_token: 'The token you give and the one you buy must be different.',
    dca_cuota_mayor: 'The amount per buy cannot exceed the pot.',
    dca_min: 'The minimum per buy is {m} {s}.',
    dca_resumen: 'That is {n} buys of {q} {s}, one every {p}: {d} in total. The contract fee will take ~{c} in total.',
    dca_plan_linea: '{q} {s} every {p}',
    dca_plan_estado: '{e} · {b} {s} left (~{n} buys) · {c} done · {r} {o} bought',
    dca_conf: 'You are about to leave {d} {s} in the DCA contract and buy {q} {s} worth of {o} every {p}. You can pause or close it whenever you like and get back whatever is left.',
    dca_creado: 'Plan created: {id}',
    dca_cuanto: 'How much do you want to add to the pot, in {s}?',
    dca_conf_top: 'You are about to add {a} {s} to the pot of plan {id}.',
    dca_conf_pausar: 'You are about to pause plan {id}. It stops buying, but the pot stays put.',
    dca_conf_reanudar: 'You are about to resume plan {id}. It will buy again when due.',
    dca_conf_cerrar: 'You are about to close plan {id}. The contract returns the {b} {s} left and the plan cannot be reopened.',
    dca_recargado: 'Pot topped up.',
    dca_hecho: 'Done.',
    dca_ledger: 'Not with Ledger: the device cannot show you the contract call and it would mean blind signing.',
    dca_historial: 'My plans',
    dca_cuenta: '({n} total, {a} open)',
    dca_dias: 'days',
    dca_meses: 'months',
    oa_titulo: '🔁 Running right now — {p} DCA plans and {o} limit orders',
    oa_limite: 'LIMIT',
    oa_bote: '{b} {s} left · {c} buys done',
    oa_orden: '{a} {s} when the price reaches {p}',
    mkt_t_kda: 'Swap kb-USDC ⇄ KDA',
    mkt_t_st: 'Swap USDT ⇄ USDC',
    mkt_t_eth: 'Swap USDC ⇄ ETH',
    mkt_m_kda: 'kaddex pool · chain 2',
    mkt_m_st: 'Uniswap V3 · so you can cross the bridge',
    mkt_m_eth: 'Uniswap V3 · to top up gas',
    nft_env_saleonly: 'This piece was minted as «sale-only»: the contract does not allow gifting or '
        + 'transferring it, not even by its creator. It only changes hands through a sale.',
    nft_env_conf: 'You are about to send «{n}» to {to}. The piece will no longer be yours.',
    nft_env_ok: '🎉 «{n}» is on its way to its new owner. Sent!',
    nft_sub: 'The pieces held by your wallet, read from the chain. Each network has its own NFT ledger.',
    nft_wallet: 'Wallet', nft_red: 'Network', nft_recargar: 'Find my pieces', nft_anadir: 'Add by identifier',
    nft_buscando: 'Asking the chain…', nft_sin_wallet: 'You have no Kadena wallet',
    nft_encontradas: '{n} pieces on {red}.', nft_ninguna: 'No pieces on {red} yet.',
    nft_ninguna_manual: 'Nothing lists your pieces on {red}: add them by identifier.',
    nft_desc_falla: 'Whoever lists the pieces on {red} did not answer ({e}). You only see the ones you added by hand.',
    share_tit: 'Pass Koberlet on to a mate',
    share_hint: 'Copy this link and send it to whoever you like. It downloads the official installer, the same one you use; the first time it opens it brings itself up to the latest version.',
    share_open: 'Open the download', share_copiado: 'Link copied', share_huella_copiada: 'Fingerprint copied',
    share_huella: 'File fingerprint (SHA-256)',
    share_huella_hint: 'Send it along with the link, in the same message. Whoever downloads it can check the file is ours with this PowerShell command: Get-FileHash koberlet_vX.Y.Z.zip. If the fingerprint does not match, they must NOT open it.',
    share_nota: 'Installer {v} · updates itself when opened',
    share_nover: 'Could not fetch the installer link. Try again in a while.',
    nft_sin_soporte: '{red} has no NFT ledger configured yet.',
    nft_sin_imagen: 'no image', nft_quitar: 'remove', nft_vacio: 'Your pieces will show up here.', nft_sueltas: 'No collection',
    nft_pide_id: 'Paste the piece identifier (token id):',
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
    set_lock: 'Auto-lock on inactivity', lock_never: 'Never',
    lock_hint: 'After that idle time the app locks itself and you must re-enter your password. Protects your keys if you leave the computer unattended.',
    nodes_adv: 'Nodes (advanced)', nodes_kda: 'Kadena nodes (fixed for security)',
    nodes_hint: 'Entry server for each network (RPC). Only touch it if the default node is slow or you want to use your own. Must be an https address. Reset returns to the default node.',
    node_save: 'Save', node_reset: 'Reset', node_saved: 'Node saved.', node_bad: 'Must be a valid https address.',
    test_mode: '🧪 Test mode — fictitious Devnet balances; real networks are hidden.',
    faucet_wait: 'Topping up from the faucet… (a few seconds)', faucet_ok: 'Top-up received: +{n} KDA on chain {c}.', faucet_err: 'Top-up failed:',
    upd_available: 'Koberlet v{v} available.', update: 'Update',
    whats_new: "What's new", whats_new_title: "What's new in v{v}",
    upd_applying: 'Updating… the app will restart by itself. Your wallets and data are preserved.',
    upd_auto_applying: 'Updating to Koberlet v{v}… the app will restart by itself.',
    upd_err: 'Update error: ', upd_checking: 'Checking…',
    upd_new: 'New version <b>v{v}</b> available.', upd_now: 'Update now',
    upd_latest: 'You are on the latest version (v{v}).', upd_nocheck: 'Could not check (offline or server down?).',
    hist_title: 'Operation history', close: 'close', export_csv: '⬇ CSV',
    addr_confirm: 'I have verified the destination address is correct',
    addrbook: 'Address book', add: 'Add',
    addrbook_hint: 'Save recipients with a name to pick them when sending instead of pasting the address.',
    ab_saved: 'Address saved.', ab_bad: 'Enter a name and a valid address (a Kadena account or 0x…).', ab_pick: '📇 Book',
    csv_ok: 'History exported.', csv_empty: 'No operations to export.', low_gas: 'Low {sym} on {net} for gas ({bal}). Top up before operating.',
    converter: '🧮 Converter', recv_note_kda: 'Receiving on Kadena. For Market/Bridge funds must be on chain 2.', recv_note_evm: 'Receiving on {net}. The same 0x address works on all EVM networks; make sure the sender uses the right network.', share: 'Share',
    backup_title: 'Vault backup', backup_do: '⬇ Export encrypted backup', restore_do: '⬆ Restore backup…',
    backup_hint: 'Save an encrypted copy of your vault (to a USB, disk or safe folder) to recover it on another computer. It is encrypted with your password.',
    restore_hint: 'Restore: pick a backup file and its password. Your current vault is backed up before being replaced.',
    backup_ok: 'Backup saved to {path}', restore_ok: 'Vault restored. Unlock with that backup\'s password.', restore_need_pass: 'Enter the backup password first.',
    lbl_bk_newpass: 'Password for the backup', bk_short: 'The password must be at least 10 characters.', bk_mismatch: 'The two passwords do not match.', bk_working: 'Working… (encryption takes a moment)', restore_from_backup: '↻ Restore from a backup', restore_merged: 'Backup imported: {n} new wallet(s) added.',
    pw_short: 'Too short (min 10)', pw_weak: 'Weak — make it longer or mix it more', pw_ok: 'Acceptable', pw_strong: 'Strong 💪',
    upd_verified: '🔒 Updates are signed and verified (Ed25519) before installing.',
    edit_wallet: 'Edit wallet', wtag: 'Tag', wtag_none: '— no tag —', wtag_cold: '❄️ Cold (savings)', wtag_hot: '🔥 Hot (daily use)', wnote: 'Private note',
    welcome_title: 'Welcome to Koberlet 👛', welcome_ok: 'Got it, start',
    welcome_1t: 'Write down your recovery phrase', welcome_1: 'It is the ONLY way to recover your funds if you lose the device. Write it on paper and keep it safe.',
    welcome_2t: 'Try receiving', welcome_2: 'On a dashboard card tap 📥 Receive to see your address and QR. Mind the network/chain.',
    welcome_3t: 'Start small', welcome_3: 'Make a first small send to build confidence. The app asks for your password and to confirm the address.',
    updated_toast: '✔ Updated to v{v} · signed and verified package',
    hist_loading: 'Loading on-chain history…', hist_empty: 'No operations for this wallet.',
    hist_in: 'Received', hist_out: 'Sent', hist_from: 'from', hist_to: 'to',
    err_pass_min: 'At least 8 characters.', err_pass_match: 'Passwords do not match.', creating_vault: 'Creating vault…', err_wrong_pass: 'Wrong password.',
    lbl_from_eth: 'Source wallet (Ethereum)', lbl_from_kda: 'Source wallet (Kadena)',
    lbl_dest_kda: 'Destination wallet (Kadena)', lbl_dest_eth: 'Destination wallet (Ethereum)',
    lbl_to_kda: 'Destination Kadena account (k:…)', lbl_to_evm: 'Destination EVM address (0x…)',
    no_wallet: '— no wallet —', other_addr: 'Other address…',
    loading_tokens: 'loading balances…', tok_balance: '(balance {b})',
    br_no_from: 'No source wallet for that address.', br_need: 'Choose destination and amount.', br_simulating: 'Simulating…',
    br_sim_ok: '✅ The transaction builds correctly (simulation OK).',
    br_toll: ' <b>Bridge toll: {t} KDA</b> (charged on Kadena when dispatching, besides the bridged token).',
    br_sim_approve: '✅ The tx builds correctly and you have balance ({b} of the token). It only reverts because the <b>approve</b> is missing (authorizing the router to move your token) — a prior step done automatically in the real send.',
    br_sim_nobal: '⚠️ Insufficient balance on Ethereum: you have {b}, you need {n}.',
    br_sim_nogas: '⚠️ The tx builds correctly, but this KDA account has no KDA on Kadena chain 2 for gas. You need some KDA there.',
    br_sim_notok: '⚠️ The tx builds correctly, but you have no balance of that token. Check below.',
    br_sim_err: '⚠️ Simulation error: ',
    step_approve: 'Approve token', step_transfer: 'Send to bridge (Ethereum)', step_ethconfirm: 'Confirm on Ethereum', step_kadena: 'Receive on Kadena (chain 2)',
    step_dispatch: 'Send to bridge (Kadena, chain 2)', step_kdaconfirm: 'Confirm on Kadena', step_evm: 'Receive on Ethereum',
    br_warn_e2k: '⚠️ Moves real funds through the bridge. It will approve + transferRemote and spend ETH on gas. Use small amounts.',
    br_warn_k2e: '⚠️ Moves real funds through the bridge. It burns the kb-token on Kadena (dispatch) and also charges the bridge TOLL in KDA on chain 2 (~37 KDA towards Ethereum; check the exact value with Simulate). Use amounts that make the toll worth it.',
    br_toll_line: '<br><b>Bridge toll: {t} KDA</b> (in KDA on chain 2, besides the token).',
    br_confirm: '<b>REAL SEND through the bridge</b> ({r})<br>Bridge <b>{a} {s}</b> to <span class="mono">{to}</span>',
    br_done_kda: '✅ Bridge completed — received on Kadena.', br_pend_kda: '⏳ Sent and confirmed on Ethereum. Waiting for the relayer to deliver on Kadena.',
    br_done_eth: '✅ Bridge completed — received on Ethereum.', br_pend_eth: '⏳ Sent and confirmed on Kadena. Waiting for the relayer towards Ethereum.',
    evm_ctx_on: 'Tick the EVM networks you want to see (the same 0x address works on all of them).',
    evm_ctx_off: 'These networks are shown when you have an EVM wallet visible on the dashboard.',
    no_wallet_kda: '— no Kadena wallet —', no_wallet_eth: '— no Ethereum wallet —',
    mk_quoting: 'Reading pool price…',
    mk_quote_html: 'You receive ≈ <b>{out} {tok}</b> · minimum {min} (slippage {slip}%)<br>Price {p} kb-USDC/KDA · impact {imp}%',
    err_no_kda_wallet: 'No Kadena wallet.', err_no_eth_wallet: 'No Ethereum wallet.', err_need_amt: 'Enter the amount.',
    mk_confirm: 'Swap <b>{a} {f}</b> → <b>{t}</b><br><span class="muted">Kadena pool (kaddex.exchange, chain 2), non-custodial. Fresh price at signing.</span>',
    mk_sent: 'Swap sent. requestKey: ',
    es_quoting: 'Querying Uniswap…',
    es_quote_html: 'You receive ≈ <b>{out} {sym}</b> · minimum {min} (slippage {slip}%)',
    es_gas_note: '<br>⛽ Estimated swap gas: ~{g} ETH — paid in ETH: don\'t wait until you hit zero.',
    es_wait_quote: 'Wait for the quote (or re-type the amount) before signing.',
    es_confirm: 'Swap <b>{a} {f}</b> → <b>{t}</b> on Uniswap (Ethereum)<br><span class="muted">Non-custodial; you receive at least <b>{min} {t}</b> (what you saw when quoting). If the real price drops below it, the operation reverts. Gas is paid in ETH.</span>',
    es_ok: '✅ Swap confirmed.', es_check: '⚠️ Swap sent, check the tx.',
    ttl_show_dash: 'Show on the dashboard', ttl_rename: 'Rename', ttl_del: 'Delete', on_dash: 'on dashboard', this_wallet: 'this wallet',
    spread: 'Spread: ', no_bal_yet: 'No balance yet.',
    lbl_chain_from: 'Source chain', lbl_chain_to: 'Destination chain', lbl_dest_k: 'Destination (k:…)', lbl_dest_0x: 'Destination (0x…)', lbl_amount: 'Amount', lbl_asset: 'Asset',
    ph_kda_dest: 'k:... or pick from the book', ph_evm_dest: '0x... or pick from the book',
    xchain_hint: '↔ Send between different chains (cross-chain): takes a bit longer (two steps + SPV proof).',
    send: 'Send', btn_recv: '📥 Receive', btn_send: '📤 Send', btn_faucet: '🚰 +1,000 KDA', offline: 'offline',
    btn_expand: 'Expand', btn_back: '← Back to panel',
    loading_balances: 'Loading balances…',
    no_wallets_visible: 'No visible wallets. Tick one in the Wallets section.',
    err_fill_dest_amt: 'Fill in destination and amount.',
    cf_send_kda: 'Send <b>{a} KDA</b> (chain {c})<br>to <span class="mono">{to}</span>',
    cf_send_tok: 'Send <b>{a} {s}</b> (Kadena token)<br>to <span class="mono">{to}</span>',
    err_tok_ledger: 'Sending KDA tokens with Ledger is not available yet. Use a seed or private-key wallet.',
    cf_send_kda_x: 'Send <b>{a} KDA</b> from <b>chain {c1} → {c2}</b> (cross-chain)<br>to <span class="mono">{to}</span>',
    cf_send_kda_sweep: 'Send <b>{a} KDA</b> received on <b>chain {c}</b>.<br>It will be gathered from several chains (~{n}) via cross-chain — <b>takes a few minutes</b>.<br>to <span class="mono">{to}</span>',
    cf_send_evm: 'Send <b>{a} {s}</b> on {net}<br>to <span class="mono">{to}</span>',
    sent_rk: 'Sent. requestKey: ', xchain_done: 'Cross-chain completed. pactId: ', sweep_done: 'Sweep completed. requestKey: ', sent_tx: 'Sent. tx: ',
    err_sweep_bal: 'Not enough balance even adding up all chains (about {b} KDA available leaving gas).',
    signing: 'Signing and sending… (may take a while)',
    generating: 'Generating…', importing: 'Importing…',
    err_paste_seed: 'Paste the seed first.', err_paste_target: 'Paste the account you are looking for.',
    seed_scanning: 'Looking up accounts and balances… (a few seconds)',
    seed_finding: 'Searching for the account across indexes (0-40, both methods)…',
    seed_more: 'Show 5 more accounts (from #{n})', import_this: 'Import this one',
    seed_notfound: 'Not found in the first {n} indexes with either method. Your wallet uses another derivation — tell me and I will add it.',
    exp_revealed: 'Revealed. Copy it and close.', wallet_deleted: 'Wallet deleted.',
    ttl_eye: 'Show / hide', ttl_copy_id: 'copy id',
    tag_cold: '❄️ Cold', tag_hot: '🔥 Hot',
    kda_mode_both: 'Both (Kadena + Kadena Inc)', kda_mode_inc: 'Only Kadena (Inc)', kda_mode_comm: 'Only Kadena',
    kda_mode_hint: 'Which Kadena cards are shown for each wallet. Use it to declutter the dashboard if you do not use one of the networks. (Same as the switches in the Network section.)',
    min_5: '5 minutes', min_10: '10 minutes', min_30: '30 minutes',
    sec_intro: 'Reveals the private key of one of your wallets. Requires the vault password. Never share it with anyone.',
    sec_view_pk: '🔑 View private key',
    sec_note: 'The vault is encrypted (AES-256-GCM + scrypt) and private keys never leave the main process except here, with your password.',
    lbl_backup_pass: 'Backup password',
    br_sim_btn: '🧪 Simulate', br_send_btn: '🚀 Send for real',
    br_code_lbl: 'Pact code that would run', br_result_lbl: 'Simulation result',
    create_title: 'Create new wallet', lbl_name: 'Name', lbl_net: 'Network', generate: 'Generate', cancel: 'Cancel',
    ph_cr_label: 'e.g. Cold wallet', ph_ren_label: 'e.g. My Kadena wallet', ph_imp_label: 'e.g. My ecko wallet', ph_optional: 'optional',
    seed_warn2: '⚠️ Write this seed on paper and keep it safe. It is the ONLY way to recover this wallet. It will not be shown again.',
    del_title: 'Delete wallet',
    del_q: 'Are you sure you want to delete <b>{w}</b>?',
    del_warn1: '💡 Before deleting, <b>copy its seed or private key</b> (🛡️ Security section → View private key) and keep it safe. It is the ONLY thing that will let you restore this wallet if you change your mind.',
    del_warn2: '⚠️ <b>Final confirmation:</b> wallet <b>{w}</b> will be removed from the app. If you did not save its seed or private key, <b>you will lose access to its funds forever</b>.',
    del_have: 'Got it, continue', del_yes: 'Yes, delete permanently',
    imp_title: 'Import wallet', tab_seed: 'Seed', tab_pk: 'Private key',
    lbl_seed: 'Seed (12/24 words)',
    imp_hint: 'A seed holds several accounts (index 0, 1, 2…), like in eckoWallet. Hit "View accounts" to pick the one holding your funds, or import index 0 directly.',
    btn_seed_scan: "🔍 View this seed's accounts", lbl_seed_target: 'Looking for a specific account? (optional)', ph_seed_target: 'k:… (Kadena) or 0x… (EVM)', btn_seed_find: '🎯 Find that account in the seed',
    exp_title: 'View private key', exp_intro: 'Enter the vault password to reveal the private key. Do not share it.', reveal: 'Reveal', close_btn: 'Close',
    send_title: 'Confirm send', lbl_vault_pass: 'Vault password', btn_sign_send: 'Sign and send',
    ttl_invert: 'Reverse', ttl_theme: 'Light / dark theme',
    ledger_btn: '🔐 Ledger', ledger_title: 'Connect Ledger',
    ledger_hint: 'Plug in your Ledger via USB, unlock it with the PIN and open the network app (Kadena or Ethereum). Close Ledger Live if it is running. The private key never leaves the device: every send is confirmed on its screen.',
    ph_lg_label: 'e.g. Savings Ledger', lbl_lg_index: 'Account index (0 = first)',
    ledger_read: '🔍 Read account from Ledger', ledger_add: 'Add this account',
    ledger_reading: 'Reading from the device… (check the Ledger)', ledger_added: 'Ledger account added.',
    ledger_badge: '🔐 Ledger',
    ledger_confirm_note: '🔐 Ledger wallet: review and confirm the operation on the device screen.',
    ttl_max: 'Max sendable (minus gas)', ttl_priv: 'Hide / show balances'
  }
};
let LNG = localStorage.getItem('koberlet-lang'); if (LNG !== 'en' && LNG !== 'es') LNG = (navigator.language || 'es').slice(0, 2) === 'en' ? 'en' : 'es';
function t(k) { return (LANG[LNG] && LANG[LNG][k]) || LANG.es[k] || k; }
// t() con variables: tr('clave', {a: 5}) sustituye TODAS las apariciones de {a} (replace solo cambia la primera).
function tr(k, vars) { let s = t(k); for (const x in (vars || {})) s = s.split('{' + x + '}').join(String(vars[x])); return s; }
function applyLang() {
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-ph]').forEach(el => { el.placeholder = t(el.dataset.i18nPh); });
  document.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = t(el.dataset.i18nTitle); });
  const on = document.querySelector('.nav.on'); if (on && $('crumb')) $('crumb').textContent = t('nav_' + on.dataset.nav);
  document.querySelectorAll('.lang-es').forEach(e => { e.hidden = (LNG !== 'es'); });
  document.querySelectorAll('.lang-en').forEach(e => { e.hidden = (LNG !== 'en'); });
  document.querySelectorAll('.langbtn').forEach(b => b.textContent = LNG === 'es' ? 'EN' : 'ES');
  document.documentElement.lang = LNG;
  if (typeof renderNodes === 'function' && CFG) renderNodes();
}
function setLang(l) {
  LNG = l; localStorage.setItem('koberlet-lang', l); applyLang();
  if ($('history-panel') && !$('history-panel').hidden) refreshHistory();
  // Re-renderizar las secciones dinámicas (montadas por JS) para que cambien de idioma al vuelo
  if ($('app') && !$('app').hidden && WALLETS.length) { renderBridge(); renderMercado(); renderEthSwap(); updateNetContext(); loadBalances(); }
  pintarCompartir();                       // el texto del instalador, también
  // el aviso de actualización y sus novedades también cambian de idioma al vuelo
  if (window._upd && window._upd.newer) {
    if ($('update-text')) $('update-text').textContent = t('upd_available').replace('{v}', window._upd.latest);
    if ($('btn-update-dl')) $('btn-update-dl').textContent = window._upd.canAuto ? t('update') : t('download');
    const abierto = $('update-notes') && !$('update-notes').hidden;
    setupNotes(window._upd);
    if (abierto && $('update-notes')) $('update-notes').hidden = false;
  }
  if (typeof NFT_CACHE !== 'undefined' && NFT_CACHE.length && $('view-nft') && !$('view-nft').hidden) nftCargar();
}

// ===== Privacidad: ocultar saldos con ••••• (como en las apps de banca) =====
let HIDEBAL = localStorage.getItem('koberlet-hidebal') === '1';
function applyPriv() { document.body.classList.toggle('hidebal', HIDEBAL); const b = $('btn-priv'); if (b) b.textContent = HIDEBAL ? '🙈' : '👁'; }
if ($('btn-priv')) $('btn-priv').onclick = () => { HIDEBAL = !HIDEBAL; localStorage.setItem('koberlet-hidebal', HIDEBAL ? '1' : '0'); applyPriv(); };
applyPriv();

// ===== Idea 7: tema claro / oscuro =====
let THEME = localStorage.getItem('koberlet-theme') || 'light';
function applyTheme() { document.documentElement.setAttribute('data-theme', THEME); const b = $('btn-theme'); if (b) b.textContent = THEME === 'dark' ? '☀️' : '🌙'; }
if ($('btn-theme')) $('btn-theme').onclick = () => { THEME = THEME === 'dark' ? 'light' : 'dark'; localStorage.setItem('koberlet-theme', THEME); applyTheme(); };
applyTheme();

// ===== Precios (idea 5/6): variación 24h + fiat. PRICES = { cgId:{usd,eur,chg} } =====
let PRICES = {};
const CG_EXTRA = { KDA: 'kadena', 'kb-USDC': 'usd-coin', 'kb-USDT': 'tether', 'kb-DAI': 'dai', 'kb-WBTC': 'wrapped-bitcoin' };
function cgFor(sym) {
  if (CG_EXTRA[sym]) return CG_EXTRA[sym];
  if (CFG) for (const n of CFG.evm) { if (n.symbol === sym) return n.cg; for (const tk of (n.tokens || [])) if (tk.symbol === sym) return tk.cg; }
  return null;
}
function chgHtml(sym) {
  const cg = cgFor(sym); const p = cg && PRICES[cg];
  if (!p || p.chg == null) return '';
  const up = p.chg >= 0;
  return `<span class="chg ${up ? 'up' : 'down'}">${up ? '▲' : '▼'}${Math.abs(p.chg).toFixed(1)}%</span>`;
}
// ===== Idea 6: conversor cripto ⇄ fiat =====
let _convInit = false;
function initConverter() {
  if (!$('conv-asset')) return;
  if (!$('conv-asset').options.length) $('conv-asset').innerHTML = ['KDA', 'ETH', 'BNB', 'POL'].map(s => `<option value="${s}">${s}</option>`).join('');
  const recalc = (from) => {
    const cg = cgFor($('conv-asset').value), fiat = $('conv-fiat').value;
    const px = cg && PRICES[cg] && PRICES[cg][fiat];
    if (!px) { $('conv-rate').textContent = '—'; return; }
    if (from === 'fiat') { const v = Number($('conv-fiat-amt').value || 0) / px; $('conv-amt').value = v ? v.toFixed(6) : ''; }
    else { const v = Number($('conv-amt').value || 0) * px; $('conv-fiat-amt').value = v ? v.toFixed(6) : ''; }
    $('conv-rate').textContent = `1 ${$('conv-asset').value} = ${px.toFixed(4)} ${fiat.toUpperCase()}`;
  };
  if (!_convInit) {
    $('conv-amt').oninput = () => recalc('crypto');
    $('conv-fiat-amt').oninput = () => recalc('fiat');
    $('conv-asset').onchange = () => recalc('crypto');
    $('conv-fiat').onchange = () => recalc('crypto');
    _convInit = true;
  }
  recalc('crypto');
}
document.querySelectorAll('.langbtn').forEach(b => b.onclick = () => setLang(LNG === 'es' ? 'en' : 'es'));

function screen(name) { ['scr-setup', 'scr-unlock'].forEach(s => $(s).hidden = true); $('app').hidden = true; if (name === 'app') $('app').hidden = false; else $(name).hidden = false; }
function nav(v) { ['dashboard', 'wallets', 'nft', 'red', 'dca', 'mercado', 'puente', 'seguridad', 'ajustes', 'info'].forEach(n => $('view-' + n).hidden = (n !== v)); document.querySelectorAll('.nav').forEach(a => a.classList.toggle('on', a.dataset.nav === v)); $('crumb').textContent = t('nav_' + v); }

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
  try {
    const info = await window.api.appInfo(); const v = 'v' + info.version; document.title = 'Koberlet ' + v; ['app-ver', 'auth-ver', 'auth-ver-s'].forEach(id => { if ($(id)) $(id).textContent = v; });
    // Idea 13: si la versión cambió desde el último arranque, avisa de que se actualizó y verificó.
    const last = localStorage.getItem('koberlet-last-ver');
    if (last && last !== info.version) toast(t('updated_toast').replace('{v}', info.version));
    localStorage.setItem('koberlet-last-ver', info.version);
  } catch (_) {}
  try {
    const u = await window.api.updateCheck();
    pintarCompartir(u);
    if (u.newer) {
      window._upd = u;
      if (CFG && CFG.updateMode === 'auto' && u.canAuto) {
        $('update-text').textContent = t('upd_auto_applying').replace('{v}', u.latest);
        $('btn-update-dl').hidden = true; $('update-banner').hidden = false;
        try { await window.api.updateApply(); return; }
        catch (_) { $('btn-update-dl').hidden = false; } // si falla, cae al aviso manual
      }
      $('update-text').textContent = t('upd_available').replace('{v}', u.latest);
      $('btn-update-dl').textContent = u.canAuto ? t('update') : t('download');
      setupNotes(u);
      $('update-banner').hidden = false;
    }
  } catch (_) { pintarCompartir(null); }
}
// Enlace para pasarle la app a otro. Sale del `url` de latest.json, que el main ya
// ha validado contra el origen oficial (revisión 2026-07-21 #1): así el enlace que
// se copia no puede acabar apuntando a otro sitio aunque el server mienta.
let SHARE_URL = null;
function pintarCompartir(u) {
    const caja = $('share-url'), boton = $('share-copy'), nota = $('share-nota');
    if (!caja) return;
    if (u !== undefined) window._share = u;                 // para repintarlo al cambiar de idioma
    u = window._share;
    SHARE_URL = (u && typeof u.url === 'string') ? u.url : null;
    if (!SHARE_URL) { caja.textContent = t('share_nover'); if (boton) boton.hidden = true; return; }
    caja.textContent = SHARE_URL;
    if (boton) { boton.hidden = false; boton.dataset.ct = SHARE_URL; }
    // La huella solo se enseña si viene bien formada; si no, mejor nada que algo a medias
    const huella = (u && typeof u.urlSha256 === 'string') ? u.urlSha256 : null;
    if ($('share-huella-caja')) {
        $('share-huella-caja').hidden = !huella;
        if (huella) { $('share-huella').textContent = huella; $('share-huella-copy').dataset.ct = huella; }
    }
    // la versión sale del nombre del fichero (koberlet_v2.3.0.zip): es el instalador
    // completo, que puede ir por detrás de la última actualización de código
    const m = /_v(\d+\.\d+\.\d+)\.zip$/.exec(SHARE_URL);
    if (nota) nota.textContent = m ? tr('share_nota', { v: 'v' + m[1] }) : '';
}
function initCompartir() {
    if (!$('share-copy')) return;
    $('share-copy').addEventListener('click', () => { if (SHARE_URL) toast(t('share_copiado')); });
    if ($('share-huella-copy')) $('share-huella-copy').addEventListener('click', () => toast(t('share_huella_copiada')));
    $('share-open').onclick = () => { if (SHARE_URL) window.api.openExternal(SHARE_URL); };
}
initCompartir();

// Novedades de la versión nueva (campo `notes` de latest.json). Se renderiza escapado;
// los saltos de línea y las viñetas "• / - / ·" al inicio de línea se muestran como lista.
// las notas pueden venir por idioma: {es:'…', en:'…'}
function notesDelIdioma(notes) {
  if (!notes) return '';
  if (typeof notes === 'string') return notes;
  return notes[LNG] || notes.es || notes.en || '';
}
function notesToHtml(notes) {
  notes = notesDelIdioma(notes);
  if (!notes) return '';
  const items = String(notes).split(/\r?\n|\s+·\s+|\s+•\s+/).map(s => s.trim()).filter(Boolean);
  if (items.length > 1) return '<ul class="nlist">' + items.map(i => `<li>${esc(i.replace(/^[-•·]\s*/, ''))}</li>`).join('') + '</ul>';
  return `<div>${esc(items[0] || '')}</div>`;
}
function setupNotes(u) {
  const tog = $('update-notes-toggle'), box = $('update-notes');
  if (!notesDelIdioma(u.notes)) { tog.hidden = true; box.hidden = true; box.innerHTML = ''; return; }
  box.innerHTML = `<div class="ntitle">${t('whats_new_title').replace('{v}', esc(u.latest))}</div>` + notesToHtml(u.notes);
  tog.hidden = false; box.hidden = true;
  tog.onclick = () => { box.hidden = !box.hidden; tog.textContent = box.hidden ? t('whats_new') : '▲'; };
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
    if (u.newer) {
      $('upd-status').innerHTML = t('upd_new').replace('{v}', esc(u.latest)) + ` <a href="#" id="upd-dl-link" class="grn">${u.canAuto ? t('upd_now') : t('download')}</a>`
        + (notesDelIdioma(u.notes) ? `<div class="updnotes" style="margin-top:8px"><div class="ntitle">${t('whats_new_title').replace('{v}', esc(u.latest))}</div>${notesToHtml(u.notes)}</div>` : '');
      $('upd-dl-link').onclick = (e) => { e.preventDefault(); e.target.style.pointerEvents = 'none'; e.target.style.opacity = .5; doUpdate(u, $('upd-status')); }; // un solo intento: dos a la vez se pisan la carpeta _update
    }
    else if (u.latest) msg($('upd-status'), t('upd_latest').replace('{v}', u.current), 'ok');
    else msg($('upd-status'), t('upd_nocheck'), 'err');
  } catch (e) { msg($('upd-status'), e.message, 'err'); }
};
$('btn-setup').onclick = async () => {
  const p = $('setup-pass').value, p2 = $('setup-pass2').value;
  if (p.length < 8) return msg($('setup-msg'), t('err_pass_min'), 'err');
  if (p !== p2) return msg($('setup-msg'), t('err_pass_match'), 'err');
  const { kind, net } = parseNet($('setup-net').value);
  try { msg($('setup-msg'), t('creating_vault')); const r = await window.api.setup(p, kind, net); $('setup-seed').textContent = r.mnemonic; $('setup-step1').hidden = true; $('setup-step2').hidden = false; }
  catch (e) { msg($('setup-msg'), 'Error: ' + e.message, 'err'); }
};
$('btn-setup-done').onclick = () => screen('scr-unlock');
$('btn-unlock').onclick = async () => { try { const r = await window.api.unlock($('unlock-pass').value); enter(r.view); } catch (_) { msg($('unlock-msg'), t('err_wrong_pass'), 'err'); } };
$('unlock-pass').addEventListener('keydown', e => { if (e.key === 'Enter') $('btn-unlock').click(); });
$('btn-lock').onclick = async () => { await window.api.lock(); location.reload(); };

// ===== NFT =====
// Solo lectura de momento: enseña lo que la cadena confirma que tiene la wallet.
// Las imágenes llegan del main ya como data URL (la CSP no deja cargar remotas).
let NFT_CACHE = [];
let NFT_ABIERTA = null;           // colección desplegada ahora mismo

// La wallet y la red elegidas en NFT se recuerdan: quien tiene sus piezas en una
// red concreta no quiere volver a elegirla cada vez que entra en la sección.
const NFT_ELEC = { w: 'koberlet-nft-wallet', r: 'koberlet-nft-red' };
function nftRecordar() {
    try {
        localStorage.setItem(NFT_ELEC.w, $('nft-wallet').value || '');
        localStorage.setItem(NFT_ELEC.r, $('nft-red').value || '');
    } catch (e) { /* sin localStorage: se elige a mano y ya */ }
}

function nftRellenarSelectores() {
    const wsel = $('nft-wallet'), rsel = $('nft-red');
    if (!wsel || !rsel) return;
    const kdas = (WALLETS || []).filter(w => w.kind === 'kda');
    wsel.innerHTML = kdas.map(w => `<option value="${esc(w.id)}">${esc(w.label)}</option>`).join('')
                     || `<option value="">${t('nft_sin_wallet')}</option>`;
    const redes = ((CFG && CFG.kda && CFG.kda.networks) || []).filter(r => r.nft && r.nft.ledger);
    rsel.innerHTML = redes.map(r => `<option value="${esc(r.key)}">${esc(r.name)}</option>`).join('')
                     || `<option value="">—</option>`;
    // se recupera lo último elegido, pero solo si sigue existiendo (wallet borrada,
    // red quitada del catálogo…); si no, se queda la primera opción de siempre
    try {
        const w = localStorage.getItem(NFT_ELEC.w), r = localStorage.getItem(NFT_ELEC.r);
        if (w && kdas.some(x => x.id === w)) wsel.value = w;
        if (r && redes.some(x => x.key === r)) rsel.value = r;
    } catch (e) { /* idem */ }
}

function nftPintar(d) {
    const grid = $('nft-grid'), aviso = $('nft-aviso');
    if (!grid) return;
    if (d && d.sinSoporte) {
        aviso.textContent = tr('nft_sin_soporte', { red: d.red });
        grid.innerHTML = '';
        return;
    }
    const piezas = (d && d.piezas) || [];
    NFT_CACHE = piezas;
    aviso.textContent = piezas.length
        ? tr('nft_encontradas', { n: piezas.length, red: d.red })
        : (d && d.conDescubridor ? tr('nft_ninguna', { red: d.red }) : tr('nft_ninguna_manual', { red: d.red }));
    // Si quien lista las piezas no contesta, decirlo: si no, "ninguna pieza"
    // parece que no tienes nada cuando en realidad no se ha podido preguntar.
    if (d && d.avisoDescubridor) {
        aviso.textContent += ' ⚠️ ' + tr('nft_desc_falla', { red: d.red, e: d.avisoDescubridor });
    }
    // Cada colección es una TARJETA con la portada (su pieza #1), el título y
    // cuántas piezas tiene. Al pulsarla se despliega ocupando la fila entera y
    // enseña sus piezas; al volver a pulsar, se cierra.
    const grupos = new Map();
    piezas.forEach((p, i) => {
        const clave = p.coleccion || t('nft_sueltas');
        if (!grupos.has(clave)) grupos.set(clave, []);
        grupos.get(clave).push({ p, i });
    });
    const numero = (x) => {
        const m = /#\s*(\d+)/.exec(x.p.nombre || '');
        return m ? Number(m[1]) : 1e9;
    };
    const tarjetaPieza = ({ p, i }) => `
        <div class="nft-card">
            ${p.manual ? `<button class="nft-quitar" data-i="${i}">${t('nft_quitar')}</button>` : ''}
            ${p.imagen ? `<img src="${esc(p.imagen)}" alt="">` : `<div class="sinimg">${t('nft_sin_imagen')}</div>`}
            <div class="nft-body">
                <div class="nft-nom" title="${esc(p.nombre)}">${esc(p.nombre)}</div>
                ${p.atributos.length ? `<div class="nft-attrs">${p.atributos.slice(0, 3).map(a =>
                    `<span class="nft-at">${esc(a.value ?? '')}</span>`).join('')}</div>` : ''}
                <button class="ghost nft-env-btn" data-env="${i}">${t('nft_enviar')}</button>
                <div class="nft-env" id="nft-env-${i}" hidden>
                    <input placeholder="k:…" spellcheck="false">
                    <button class="ghost" data-envir="${i}">${t('nft_env_ir')}</button>
                    <div class="nft-env-msg muted xs"></div>
                </div>
            </div>
        </div>`;

    grid.innerHTML = [...grupos.entries()]
        .sort((a, b) => a[0].localeCompare(b[0], 'es'))
        .map(([nombre, items]) => {
            items.sort((a, b) => numero(a) - numero(b));
            const portada = (items.find(x => x.p.imagen) || items[0]).p;
            const abierta = NFT_ABIERTA === nombre;
            return `<section class="nft-col${abierta ? ' abierta' : ''}">
                <div class="nft-portada" data-col="${esc(nombre)}" title="${esc(nombre)}">
                    ${portada.imagen ? `<img src="${portada.imagen}" alt="">`
                                     : `<div class="sinimg">${t('nft_sin_imagen')}</div>`}
                    <div class="nft-portada-pie">
                        <div class="nft-portada-tit">${esc(nombre)}</div>
                        <span class="nft-col-n">${items.length}</span>
                    </div>
                </div>
                ${abierta ? `<div class="nft-desplegado">
                    <div class="nft-grid">${items.map(tarjetaPieza).join('')}</div>
                </div>` : ''}
            </section>`;
        }).join('') || `<div class="nft-vacio">${t('nft_vacio')}</div>`;

    grid.querySelectorAll('.nft-portada').forEach(h => h.onclick = () => {
        NFT_ABIERTA = (NFT_ABIERTA === h.dataset.col) ? null : h.dataset.col;
        nftPintar(d);
        if (NFT_ABIERTA) {
            const abierta = grid.querySelector('.nft-col.abierta');
            if (abierta) abierta.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    });

    // Enganchados aquí y no con onclick= en el HTML: la CSP de la app no permite
    // scripts en línea, así que un onclick generado NO se ejecuta (auditoría F-1).
    grid.querySelectorAll('[data-env]').forEach(b => b.onclick = () => nftAbrirEnvio(Number(b.dataset.env)));
    grid.querySelectorAll('[data-envir]').forEach(b => b.onclick = () => nftEnviarPieza(Number(b.dataset.envir)));

    grid.querySelectorAll('.nft-quitar').forEach(b => b.onclick = async () => {
        const p = NFT_CACHE[Number(b.dataset.i)];
        await window.api.nftRemove({ walletId: $('nft-wallet').value, redKey: $('nft-red').value, id: p.id });
        nftCargar();
    });
}

async function nftCargar() {
    const grid = $('nft-grid'), aviso = $('nft-aviso');
    const walletId = $('nft-wallet').value, redKey = $('nft-red').value;
    if (!walletId || !redKey) { nftPintar({ piezas: [] }); return; }
    aviso.textContent = t('nft_buscando');
    grid.innerHTML = '';
    try {
        nftPintar(await window.api.nftList({ walletId, redKey }));
    } catch (e) {
        aviso.textContent = '⚠️ ' + (e.message || e);
    }
}

function initNft() {
    if (!$('nft-recargar')) return;
    $('nft-recargar').onclick = nftCargar;
    $('nft-wallet').onchange = () => { nftRecordar(); nftCargar(); };
    $('nft-red').onchange = () => { nftRecordar(); nftCargar(); };
    $('nft-anadir').onclick = async () => {
        const id = (prompt(t('nft_pide_id')) || '').trim();
        if (!id) return;
        try {
            await window.api.nftAdd({ walletId: $('nft-wallet').value, redKey: $('nft-red').value, id });
            nftCargar();
        } catch (e) { alert(e.message || e); }
    };
}

document.querySelectorAll('.nav').forEach(a => a.onclick = () => nav(a.dataset.nav));
document.querySelectorAll('.nav[data-nav="nft"]').forEach(a => a.addEventListener('click', () => {
  nftRellenarSelectores();
  if (!NFT_CACHE.length) nftCargar();
}));
initNft();

async function enter(v) {
  screen('app'); nav('dashboard'); maybeWelcome();
  // interruptores de redes Kadena (Oficial / Fork), como las EVM
  $('kda-nets').innerHTML = CFG.kda.networks.map(n => `<label class="toggle"><input type="checkbox" data-knet="${n.key}" ${n.enabled ? 'checked' : ''}/><span class="tdot" style="background:${n.color}"></span>${n.name}</label>`).join('');
  $('kda-nets').querySelectorAll('input').forEach(cb => cb.onchange = async () => {
    CFG.kda.networks.find(x => x.key === cb.dataset.knet).enabled = cb.checked;
    // Modo pruebas excluyente: activar la Devnet apaga las redes reales, y al revés
    if (cb.checked && cb.dataset.knet === 'devnet') CFG.kda.networks.forEach(n => { if (n.key !== 'devnet') n.enabled = false; });
    if (cb.checked && cb.dataset.knet !== 'devnet') CFG.kda.networks.forEach(n => { if (n.key === 'devnet') n.enabled = false; });
    await window.api.setConfig(CFG); syncKdaControls(); updateNetContext(); loadBalances();
  });
  // Ajustes: modo de redes Kadena en el dashboard (Ambas / Solo oficial / Solo fork), sincronizado con los interruptores de Red
  $('set-kda-mode').onchange = async () => {
    const v = $('set-kda-mode').value;
    CFG.kda.networks.find(n => n.key === 'mainnet').enabled = v !== 'fork';
    CFG.kda.networks.find(n => n.key === 'fork').enabled = v !== 'oficial';
    // Elegir redes reales desde Ajustes también saca del modo pruebas
    CFG.kda.networks.forEach(n => { if (n.key === 'devnet') n.enabled = false; });
    await window.api.setConfig(CFG); syncKdaControls(); updateNetContext(); loadBalances();
  };
  syncKdaControls();
  // Ajustes: modo de actualización (manual por defecto / automática)
  $('set-upd-mode').value = CFG.updateMode || 'manual';
  $('set-upd-mode').onchange = async () => { CFG.updateMode = $('set-upd-mode').value; await window.api.setConfig(CFG); };
  $('set-lock-mode').value = String(CFG.lockMinutes ?? 10);
  $('set-lock-mode').onchange = async () => { CFG.lockMinutes = Number($('set-lock-mode').value); await window.api.setConfig(CFG); };
  // interruptores de redes EVM
  $('evm-nets').innerHTML = CFG.evm.map(n => `<label class="toggle"><input type="checkbox" data-net="${n.key}" ${n.enabled ? 'checked' : ''}/><span class="tdot" style="background:${n.color}"></span>${n.name}</label>`).join('');
  $('evm-nets').querySelectorAll('input').forEach(cb => cb.onchange = async () => { CFG.evm.find(x => x.key === cb.dataset.net).enabled = cb.checked; await window.api.setConfig(CFG); loadBalances(); });
  renderNodes();
  renderAddressBook();
  applyView(v);
}
const shortAddr = (a) => a ? a.slice(0, 8) + '…' + a.slice(-4) : '';
let DIR = 'evm2kda'; // por defecto Ethereum -> Kadena
function renderBridge() {
  const evm2 = DIR === 'evm2kda';
  $('dir-from').textContent = evm2 ? 'Ethereum' : 'Kadena';
  $('dir-to').textContent = evm2 ? 'Kadena' : 'Ethereum';
  $('lbl-from').textContent = evm2 ? t('lbl_from_eth') : t('lbl_from_kda');
  $('lbl-dest').textContent = evm2 ? t('lbl_dest_kda') : t('lbl_dest_eth');
  $('lbl-to').textContent = evm2 ? t('lbl_to_kda') : t('lbl_to_evm');
  $('br-to').placeholder = evm2 ? 'k:...' : '0x...';
  const fromW = WALLETS.filter(w => evm2 ? w.ethAddress : w.kdaAccount);
  const destW = WALLETS.filter(w => evm2 ? w.kdaAccount : w.ethAddress);
  $('br-from').innerHTML = fromW.map(w => `<option value="${w.id}">${esc(w.label)} · ${shortAddr(evm2 ? w.ethAddress : w.kdaAccount)}</option>`).join('') || `<option value="">${t('no_wallet')}</option>`;
  $('br-dest').innerHTML = destW.map(w => `<option value="${evm2 ? w.kdaAccount : w.ethAddress}">${esc(w.label)} · ${shortAddr(evm2 ? w.kdaAccount : w.ethAddress)}</option>`).join('') + `<option value="otra">${t('other_addr')}</option>`;
  $('br-to').setAttribute('list', evm2 ? 'dl-kda' : 'dl-evm'); // libreta: destino Kadena o EVM según el sentido
  $('br-dest').onchange = () => { $('br-to-wrap').hidden = $('br-dest').value !== 'otra'; };
  $('br-dest').onchange();
  $('br-from').onchange = () => loadBridgeTokens($('br-from').value);
  if (fromW.length) loadBridgeTokens(fromW[0].id); else $('br-token').innerHTML = '';
}
$('btn-invert').onclick = () => { DIR = DIR === 'evm2kda' ? 'kda2evm' : 'evm2kda'; renderBridge(); msg($('br-msg'), ''); $('br-out').hidden = true; };
async function loadBridgeTokens(walletId) {
  if (!walletId) { $('br-token').innerHTML = ''; return; }
  $('br-token').innerHTML = `<option>${t('loading_tokens')}</option>`; $('br-tokhint').textContent = '';
  const toks = await window.api.bridgeTokens(walletId, DIR);
  $('br-token').innerHTML = toks.map(tk => `<option value="${tk.symbol}" data-bal="${tk.balance}">${tk.symbol} — ${tk.balance}</option>`).join('');
  $('br-token').onchange = () => { const o = $('br-token').selectedOptions[0]; $('br-tokhint').textContent = o ? tr('tok_balance', { b: o.dataset.bal }) : ''; };
  $('br-token').onchange();
}
$('btn-bridge-sim').onclick = async () => {
  const from = $('br-from').value, symbol = $('br-token').value, amt = $('br-amt').value;
  const to = $('br-dest').value === 'otra' ? $('br-to').value.trim() : $('br-dest').value;
  if (!from) return msg($('br-msg'), t('br_no_from'), 'err');
  if (!to || !amt) return msg($('br-msg'), t('br_need'), 'err');
  try {
    msg($('br-msg'), t('br_simulating')); $('br-out').hidden = true;
    const r = await window.api.bridgeDryRun(DIR, from, symbol, to, amt);
    $('br-code').textContent = r.code;
    $('br-result').textContent = JSON.stringify(r.result, null, 2);
    $('br-out').hidden = false;
    const st = r.result && r.result.status; const err = (r.result && r.result.error && r.result.error.message) || '';
    let m, kind;
    if (st === 'success') { window._brToll = (r.toll != null) ? { dir: DIR, key: String(amt) + '|' + symbol + '|' + to, toll: Number(r.toll) } : null; m = t('br_sim_ok') + (r.gas ? ' Gas: ' + esc(String(r.gas)) + '.' : '') + (r.toll ? tr('br_toll', { t: Number(r.toll).toFixed(2) }) : ''); kind = 'ok'; }
    else if (DIR === 'evm2kda' && r.enoughBalance && r.missingApprove) { m = tr('br_sim_approve', { b: r.balance }); kind = 'ok'; }
    else if (DIR === 'evm2kda' && !r.enoughBalance) { m = tr('br_sim_nobal', { b: r.balance, n: r.need }); kind = 'err'; }
    else if (/buy gas/i.test(err)) { m = t('br_sim_nogas'); kind = 'err'; }
    else if (/row not found|No value found|Insufficient|balance/i.test(err)) { m = t('br_sim_notok'); kind = 'err'; }
    else { m = t('br_sim_err') + esc(err.slice(0, 140)); kind = 'err'; }
    $('br-msg').innerHTML = m; $('br-msg').className = 'msg ' + kind;
  } catch (e) { msg($('br-msg'), 'Error: ' + e.message, 'err'); }
};
const STEP_SETS = {
  evm2kda: { approve: 'step_approve', transfer: 'step_transfer', ethconfirm: 'step_ethconfirm', kadena: 'step_kadena' },
  kda2evm: { dispatch: 'step_dispatch', kdaconfirm: 'step_kdaconfirm', evm: 'step_evm' }
};
const STEP_ICON = { pending: '⚪', run: '⏳', ok: '✅', skip: '⏭️', fail: '❌' };
function initSteps(dir) { const L = STEP_SETS[dir] || STEP_SETS.evm2kda; $('send-steps').innerHTML = Object.keys(L).map(k => `<div class="stp" data-step="${k}"><span class="si">⚪</span> <span class="sl">${t(L[k])}</span> <span class="sd"></span></div>`).join(''); }
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
  if (!from) return msg($('br-msg'), t('br_no_from'), 'err');
  if (!to || !amt) return msg($('br-msg'), t('br_need'), 'err');
  const rutaTxt = DIR === 'evm2kda' ? 'Ethereum → Kadena' : 'Kadena → Ethereum';
  const avisoTxt = DIR === 'evm2kda' ? t('br_warn_e2k') : t('br_warn_k2e');
  const _bt = window._brToll; // solo si la simulación fue de ESTOS mismos parámetros (si no, se muestra sin toll)
  const tollTxt = (DIR === 'kda2evm' && _bt && _bt.dir === DIR && _bt.key === (String(amt) + '|' + symbol + '|' + to)) ? tr('br_toll_line', { t: Number(_bt.toll).toFixed(2) }) : '';
  askSend(tr('br_confirm', { r: rutaTxt, a: esc(amt), s: esc(symbol), to: esc(to) }) + `${tollTxt}<br><span class="warn" style="display:block;margin-top:8px">${avisoTxt}</span>` + ledgerNote(from),
    async (pass) => {
      initSteps(DIR);
      const off = window.api.onBridgeStep(updateStep);
      try {
        const r = await window.api.bridgeSend(DIR, pass, from, symbol, to, amt);
        const okTxt = DIR === 'evm2kda'
          ? (r.arrived ? t('br_done_kda') : t('br_pend_kda'))
          : (r.arrived ? t('br_done_eth') : t('br_pend_eth'));
        return okTxt + ' tx: ' + (r.txHash || '').slice(0, 14) + '…';
      }
      finally { off(); }
    }, to, { ledger: isLedgerW(from) });
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
  if ($('evm-ctx')) $('evm-ctx').textContent = anyEvmShown ? t('evm_ctx_on') : t('evm_ctx_off');
  const nets = $('evm-nets');
  if (nets) nets.style.opacity = anyEvmShown ? 1 : .55;
}

// Sección "Nodos (avanzado)": RPC editable por cada red EVM; nodos Kadena de solo lectura (firman → fijos por seguridad).
function renderNodes() {
  if (!CFG || !$('evm-nodes')) return;
  const isHttps = (u) => { try { return new URL(u).protocol === 'https:'; } catch (_) { return false; } };
  $('evm-nodes').innerHTML = CFG.evm.map(n => `
    <div class="noderow">
      <div class="nodename"><span class="tdot" style="background:${n.color}"></span>${n.name}</div>
      <input class="node-rpc" data-net="${n.key}" value="${esc(n.rpc)}" placeholder="https://..." />
      <button class="tiny node-save" data-net="${n.key}">${t('node_save')}</button>
      <button class="tiny ghost node-reset" data-net="${n.key}">${t('node_reset')}</button>
    </div>`).join('');
  const persist = async (key, rpc) => {
    CFG.evm.find(x => x.key === key).rpc = rpc;
    await window.api.setConfig(CFG);
    CFG = await window.api.getConfig();   // releer: el main puede haber descartado un rpc no-https → refleja lo real
    renderNodes(); loadBalances();
  };
  $('evm-nodes').querySelectorAll('.node-save').forEach(b => b.onclick = async () => {
    const inp = $('evm-nodes').querySelector(`.node-rpc[data-net="${b.dataset.net}"]`);
    const v = inp.value.trim();
    if (!isHttps(v)) return msg($('wallet-msg'), t('node_bad'), 'err');
    await persist(b.dataset.net, v); msg($('wallet-msg'), t('node_saved'), 'ok');
  });
  $('evm-nodes').querySelectorAll('.node-reset').forEach(b => b.onclick = async () => {
    await persist(b.dataset.net, '');    // vacío → loadConfig vuelve al rpc por defecto del código
    msg($('wallet-msg'), t('node_saved'), 'ok');
  });
  // Nodos Kadena: solo lectura (no repuntables por seguridad — auditoría #4)
  if ($('kda-nodes')) $('kda-nodes').innerHTML = CFG.kda.networks.map(n => `
    <div class="noderow ro"><div class="nodename"><span class="tdot" style="background:${n.color}"></span>${n.name}</div><code class="nodero">${esc(n.node)}</code></div>`).join('');
}

// MERCADO (swap KDA <-> kb-USDC en el pool del fork)
let MKDIR = 'compra'; // 'compra' = entregas kb-USDC, recibes KDA · 'venta' = al revés
// Saldo disponible de una wallet para un símbolo concreto, sacado del último
// refresco de saldos. Devuelve null si aún no se han cargado o no aparece.
function saldoDe(walletId, simbolo) {
    const b = window._bal;
    if (!b || !b.blocks) return null;
    const w = WALLETS.find(x => x.id === walletId);
    if (!w) return null;
    const dir = w.kind === 'kda' ? w.kdaAccount : w.ethAddress;
    let total = null;
    for (const bl of b.blocks) {
        if (bl.address !== dir) continue;
        if (simbolo === 'KDA' && bl.kind === 'kda') total = (total || 0) + (bl.native || 0);
        else if ((simbolo === 'ETH' && bl.kind !== 'kda' && (bl.symbol === 'ETH' || bl.nativeSymbol === 'ETH'))) {
            total = (total || 0) + (bl.native || 0);
        } else {
            for (const tk of (bl.tokens || [])) {
                if (String(tk.symbol).toLowerCase() === String(simbolo).toLowerCase()) total = (total || 0) + tk.amount;
            }
        }
    }
    return total;
}

// Pinta "Disponible: X" justo bajo el botón de un token del par.
// Cada lado pinta el símbolo que tenga en ese momento, así al invertir el sentido
// el saldo viaja con su token (renderMercado/renderEthSwap repintan los dos lados).
function pintarDisponible(idZona, walletId, simbolo) {
    const el = $(idZona);
    if (!el) return;
    const v = saldoDe(walletId, simbolo);
    el.innerHTML = t('mk_disponible') + ' <b>' + (v === null ? '—' : v.toLocaleString('es-ES', { maximumFractionDigits: 6 })) + '</b>';
}

function renderMercado() {
  const kdaW = WALLETS.filter(w => w.kind === 'kda');
  $('mk-wallet').innerHTML = kdaW.map(w => `<option value="${w.id}">${esc(w.label)} · ${shortAddr(w.kdaAccount)}</option>`).join('') || `<option value="">${t('no_wallet_kda')}</option>`;
  const compra = MKDIR === 'compra';
  $('mk-from').textContent = compra ? 'kb-USDC' : 'KDA';
  $('mk-to').textContent = compra ? 'KDA' : 'kb-USDC';
  $('mk-lbl-amt').textContent = t('mk_amount') + ' (' + (compra ? 'kb-USDC' : 'KDA') + ')';
  pintarSaldosMercado();
  mkQuote();
}
// Saldos de cada lado del par según el sentido actual (lee el símbolo del propio chip).
function pintarSaldosMercado() {
  pintarDisponible('mk-bal-from', $('mk-wallet').value, $('mk-from').textContent);
  pintarDisponible('mk-bal-to', $('mk-wallet').value, $('mk-to').textContent);
}
function pintarSaldosEthSwap() {
  pintarDisponible('es-bal-from', $('es-wallet').value, $('es-from').textContent);
  pintarDisponible('es-bal-to', $('es-wallet').value, $('es-to').textContent);
}
if ($('mk-wallet')) $('mk-wallet').addEventListener('change', pintarSaldosMercado);
if ($('es-wallet')) $('es-wallet').addEventListener('change', pintarSaldosEthSwap);
$('mk-invert').onclick = () => { MKDIR = MKDIR === 'compra' ? 'venta' : 'compra'; renderMercado(); };
let _mkT = null;
$('mk-amt').oninput = () => { clearTimeout(_mkT); _mkT = setTimeout(mkQuote, 400); };
async function mkQuote() {
  const amt = $('mk-amt').value;
  if (!amt || Number(amt) <= 0) { $('mk-quote').textContent = ''; return; }
  try {
    msg($('mk-quote'), t('mk_quoting'));
    const q = await window.api.swapQuote(MKDIR, amt);
    $('mk-quote').innerHTML = tr('mk_quote_html', { out: q.esperada.toFixed(6), tok: q.tokenOut, min: q.minimo.toFixed(6), slip: q.slippagePct, p: q.precio.toFixed(6), imp: q.impacto.toFixed(2) });
    $('mk-quote').className = 'msg';
  } catch (e) { msg($('mk-quote'), e.message, 'err'); }
}
$('mk-swap').onclick = () => {
  const wid = $('mk-wallet').value, amt = $('mk-amt').value;
  if (!wid) return msg($('mk-msg'), t('err_no_kda_wallet'), 'err');
  if (!amt || Number(amt) <= 0) return msg($('mk-msg'), t('err_need_amt'), 'err');
  const compra = MKDIR === 'compra';
  askSend(tr('mk_confirm', { a: esc(amt), f: compra ? 'kb-USDC' : 'KDA', t: compra ? 'KDA' : 'kb-USDC' }),
    async (pass) => { const r = await window.api.swapExec(pass, wid, MKDIR, amt); return t('mk_sent') + r.requestKey; });
};

// SWAP ETH (USDC <-> ETH en Uniswap, Ethereum mainnet) — para reponer ETH de gas con USDC
let ESDIR = 'usdc2eth';
function renderEthSwap() {
  const evmW = WALLETS.filter(w => w.ethAddress);
  $('es-wallet').innerHTML = evmW.map(w => `<option value="${w.id}">${esc(w.label)} · ${shortAddr(w.ethAddress)}</option>`).join('') || `<option value="">${t('no_wallet_eth')}</option>`;
  const u2e = ESDIR === 'usdc2eth';
  $('es-from').textContent = u2e ? 'USDC' : 'ETH';
  $('es-to').textContent = u2e ? 'ETH' : 'USDC';
  $('es-lbl-amt').textContent = t('mk_amount') + ' (' + (u2e ? 'USDC' : 'ETH') + ')';
  pintarSaldosEthSwap();
  esQuote();
}
$('es-invert').onclick = () => { ESDIR = ESDIR === 'usdc2eth' ? 'eth2usdc' : 'usdc2eth'; renderEthSwap(); };
let _esT = null;
let _esQuote = null; // último quote confirmado (dir+amt+min) — se firma este `min`, no uno recalculado del RPC (rev. 2026-07-21 #3)
$('es-amt').oninput = () => { clearTimeout(_esT); _esT = setTimeout(esQuote, 500); };
async function esQuote() {
  const amt = $('es-amt').value;
  if (!amt || Number(amt) <= 0) { $('es-quote').textContent = ''; _esQuote = null; return; }
  try {
    msg($('es-quote'), t('es_quoting'));
    const q = await window.api.ethswapQuote(ESDIR, amt);
    _esQuote = { dir: ESDIR, amt: String(amt), min: q.min };
    const outSym = ESDIR === 'usdc2eth' ? 'ETH' : 'USDC';
    $('es-quote').innerHTML = tr('es_quote_html', { out: q.out.toFixed(6), sym: outSym, min: q.min.toFixed(6), slip: q.slipPct }) +
      (q.gasEth != null ? tr('es_gas_note', { g: q.gasEth.toFixed(5) }) : '');
    $('es-quote').className = 'msg';
  } catch (e) { _esQuote = null; msg($('es-quote'), e.message, 'err'); }
}
$('es-swap').onclick = () => {
  const wid = $('es-wallet').value, amt = $('es-amt').value;
  if (!wid) return msg($('es-msg'), t('err_no_eth_wallet'), 'err');
  if (!amt || Number(amt) <= 0) return msg($('es-msg'), t('err_need_amt'), 'err');
  if (!_esQuote || _esQuote.dir !== ESDIR || _esQuote.amt !== String(amt)) return msg($('es-msg'), t('es_wait_quote'), 'err');
  const minOut = _esQuote.min;
  const u2e = ESDIR === 'usdc2eth';
  askSend(tr('es_confirm', { a: esc(amt), f: u2e ? 'USDC' : 'ETH', t: u2e ? 'ETH' : 'USDC', min: esc(String(minOut)) }),
    async (pass) => { const r = await window.api.ethswapExec(pass, wid, ESDIR, amt, minOut); return (r.ok ? t('es_ok') : t('es_check')) + ' tx: ' + (r.txHash || '').slice(0, 14) + '…'; });
};

// SWAP DE ESTABLES (USDT <-> USDC en Uniswap V3, Ethereum). Existe por el puente: en
// Kadena el unico token con mercado es kb-USDC, asi que un USDT cruzado tal cual se
// queda sin poder cambiarse a KDA. Se cambia aqui ANTES de cruzar.
let STDIR = { de: 'USDT', a: 'USDC' };
function renderStableSwap() {
  if (!$('st-wallet')) return;
  const evmW = WALLETS.filter(w => w.ethAddress);
  $('st-wallet').innerHTML = evmW.map(w => `<option value="${w.id}">${esc(w.label)} · ${shortAddr(w.ethAddress)}</option>`).join('') || `<option value="">${t('no_wallet_eth')}</option>`;
  $('st-from').textContent = STDIR.de;
  $('st-to').textContent = STDIR.a;
  $('st-lbl-amt').textContent = t('mk_amount') + ' (' + STDIR.de + ')';
  stQuote();
}
// Enganchados con guarda: si algun dia falta el elemento, un TypeError aqui arriba se
// llevaria por delante TODO el script del renderer (la app entera se quedaria en blanco).
if ($('st-invert')) $('st-invert').onclick = () => { STDIR = { de: STDIR.a, a: STDIR.de }; renderStableSwap(); };
let _stT = null, _stQuote = null;
if ($('st-amt')) $('st-amt').oninput = () => { clearTimeout(_stT); _stT = setTimeout(stQuote, 500); };
async function stQuote() {
  if (!$('st-amt')) return;
  const amt = $('st-amt').value;
  if (!amt || Number(amt) <= 0) { $('st-quote').textContent = ''; _stQuote = null; return; }
  try {
    msg($('st-quote'), t('es_quoting'));
    const q = await window.api.evmSwapCotizar({ de: STDIR.de, a: STDIR.a, amount: amt });
    _stQuote = { de: STDIR.de, a: STDIR.a, amt: String(amt), salida: q.salida };
    $('st-quote').textContent = tr('st_quote', { out: q.salida.toFixed(6), sym: STDIR.a, fee: String(q.fee / 10000) });
    $('st-quote').className = 'msg';
  } catch (e) { _stQuote = null; msg($('st-quote'), cleanErr(e), 'err'); }
}
if ($('st-swap')) $('st-swap').onclick = () => {
  const wid = $('st-wallet').value, amt = $('st-amt').value;
  if (!wid) return msg($('st-msg'), t('err_no_eth_wallet'), 'err');
  if (!amt || Number(amt) <= 0) return msg($('st-msg'), t('err_need_amt'), 'err');
  // Se exige cotizacion fresca de ESTE importe y ESTA direccion, como en la otra tarjeta.
  if (!_stQuote || _stQuote.de !== STDIR.de || _stQuote.amt !== String(amt)) return msg($('st-msg'), t('es_wait_quote'), 'err');
  if (isLedgerW(wid)) return msg($('st-msg'), t('st_ledger'), 'err');
  askSend(tr('st_confirm', { a: esc(amt), f: STDIR.de, t: STDIR.a, out: _stQuote.salida.toFixed(6) }),
    async (pass) => {
      const r = await window.api.evmSwapEnviar({ passphrase: pass, walletId: wid, de: STDIR.de, a: STDIR.a, amount: amt });
      return tr('st_ok', { out: r.esperado.toFixed(6), sym: STDIR.a }) + ' tx: ' + String(r.hash || '').slice(0, 14) + '…';
    });
};
try { window.api.onEvmSwapProgress && window.api.onEvmSwapProgress((m) => msg($('st-msg'), m)); } catch (_) {}

// ===== DCA (contrato free.ksw-dca2 en el fork) =====
// Koberlet crea, recarga, pausa y cierra planes. Las compras las dispara el vigilante
// de KoberluSW pagando su propio gas: aqui no se ejecuta ninguna compra.
let DCA = null;
let DCA_DIR = { de: 'kb-USDC', a: 'KDA' };   // direccion del plan nuevo
const DCA_PERIODOS = [[300, '5 min'], [900, '15 min'], [3600, '1 h'], [21600, '6 h'], [43200, '12 h'], [86400, '1 día'], [604800, '1 semana'], [2592000, '30 días']];
const DCA_SLIPS = [[0.005, '0,5%'], [0.01, '1%'], [0.02, '2%'], [0.05, '5%'], [0.1, '10%']];

// Pact devuelve los decimales como {decimal:"1.0"} y los enteros como {int:3}.
function dcaNum(v) { const n = Number(typeof v === 'object' && v ? (v.decimal != null ? v.decimal : v.int) : v); return isFinite(n) ? n : 0; }
function dcaPeriodoTxt(seg) { const f = DCA_PERIODOS.find(x => x[0] === Number(seg)); return f ? f[1] : Math.round(Number(seg) / 60) + ' min'; }
function dcaSimbolo(mod) { return mod === 'coin' ? 'KDA' : 'kb-USDC'; }


function dcaPintarDireccion() {
  if (!$('dca-de')) return;
  $('dca-de').textContent = DCA_DIR.de;
  $('dca-a').textContent = DCA_DIR.a;
  // Saldo de la wallet elegida, para no tener que ir al Panel a mirarlo. Sale de los
  // saldos ya cacheados (window._bal), asi que no cuesta una lectura extra a la cadena.
  const wid = $('dca-wallet') ? $('dca-wallet').value : '';
  pintarDisponible('dca-bal-de', wid, DCA_DIR.de);
  pintarDisponible('dca-bal-a', wid, DCA_DIR.a);
}
// Duracion legible: con periodos cortos, decir "0 dias" no informaba de nada.
function dcaDuracion(seg) {
  const s = Math.max(0, Math.round(seg));
  if (s < 3600) return Math.round(s / 60) + ' min';
  if (s < 172800) return Math.round(s / 3600) + ' h';
  if (s < 5184000) return Math.round(s / 86400) + ' ' + t('dca_dias');
  return Math.round(s / 2592000) + ' ' + t('dca_meses');
}

async function renderDca() {
  if (!$('dca-wallet')) return;
  const kdaW = WALLETS.filter(w => w.kdaAccount);
  const prev = $('dca-wallet').value;
  $('dca-wallet').innerHTML = kdaW.map(w => `<option value="${w.id}">${esc(w.label)} · ${shortAddr(w.kdaAccount)}</option>`).join('') || `<option value="">${t('nft_sin_wallet')}</option>`;
  if (prev) $('dca-wallet').value = prev;
  if (!$('dca-periodo').options.length) {
    $('dca-periodo').innerHTML = DCA_PERIODOS.map(([v, n]) => `<option value="${v}"${v === 86400 ? ' selected' : ''}>${n}</option>`).join('');
    $('dca-slip').innerHTML = DCA_SLIPS.map(([v, n]) => `<option value="${v}"${v === 0.05 ? ' selected' : ''}>${n}</option>`).join('');
  }
  await dcaCargar();
}

async function dcaCargar() {
  if (!$('dca-wallet')) return;
  const wid = $('dca-wallet').value;
  msg($('dca-aviso'), t('dca_leyendo'));
  try {
    DCA = await window.api.dcaEstado({ walletId: wid });
  } catch (e) { DCA = null; return msg($('dca-aviso'), cleanErr(e), 'err'); }
  // El aviso solo aparece cuando hay algo que decir: las comisiones y el como funciona
  // viven en Info, que es donde se leen una vez y no estorban cada dia.
  if (DCA.pausado) { $('dca-aviso').innerHTML = `<span class="warn">${t('dca_pausado_global')}</span>`; }
  else { $('dca-aviso').textContent = ''; $('dca-aviso').className = 'msg'; }
  dcaPintarDireccion();
  dcaPintarPlanes();
  dcaResumen();
}

function dcaPintarPlanes() {
  const zona = $('dca-lista');
  const planes = (DCA && DCA.planes) || [];
  const cont = $('dca-cuenta-planes');
  const abiertos = planes.filter(p => p.status !== 'closed').length;
  if (cont) cont.textContent = planes.length ? tr('dca_cuenta', { n: planes.length, a: abiertos }) : '';
  if (!planes.length) { zona.innerHTML = `<div class="muted xs">${t('dca_sin_planes')}</div>`; return; }
  zona.innerHTML = planes.map((p, i) => {
    const abierto = p.status !== 'closed';
    const bote = dcaNum(p.balance), cuota = dcaNum(p.quota);
    const quedan = cuota > 0 ? Math.floor(bote / cuota) : 0;
    const simIn = dcaSimbolo(p.tokenIn), simOut = dcaSimbolo(p.tokenOut);
    return `<div class="asset dcaplan">
      <div><b>${esc(simIn)} → ${esc(simOut)}</b> <span class="muted xs">${esc(p.id)}</span></div>
      <div class="muted xs">${tr('dca_plan_linea', { q: cuota, s: esc(simIn), p: dcaPeriodoTxt(dcaNum(p.period)) })}</div>
      <div class="muted xs">${tr('dca_plan_estado', { e: esc(p.status), b: bote, s: esc(simIn), n: quedan, c: dcaNum(p.buys), r: dcaNum(p.received), o: esc(simOut) })}</div>
      ${abierto ? `<div class="dcabtns">
        <button class="tiny ghost dca-top" data-i="${i}">${t('dca_recargar')}</button>
        <button class="tiny ghost dca-pr" data-i="${i}">${p.status === 'paused' ? t('dca_reanudar') : t('dca_pausar')}</button>
        <button class="tiny ghost dca-cerrar" data-i="${i}">${t('dca_cerrar')}</button>
      </div>` : ''}
    </div>`;
  }).join('');
  zona.querySelectorAll('.dca-top').forEach(b => b.onclick = () => dcaRecargar(Number(b.dataset.i)));
  zona.querySelectorAll('.dca-pr').forEach(b => b.onclick = () => dcaAccion(Number(b.dataset.i), DCA.planes[Number(b.dataset.i)].status === 'paused' ? 'reanudar' : 'pausar'));
  zona.querySelectorAll('.dca-cerrar').forEach(b => b.onclick = () => dcaAccion(Number(b.dataset.i), 'cerrar'));
}

// Resumen antes de firmar: cuántas compras salen, cuánto dura y qué se lleva la comisión.
function dcaResumen() {
  if (!DCA || !$('dca-de')) return;
  const de = DCA_DIR.de, a = DCA_DIR.a;
  const dep = Number($('dca-dep').value), cuota = Number($('dca-cuota').value);
  const tk = (DCA.tokens || {})[de] || {};
  $('dca-lbl-dep').textContent = t('dca_bote') + ' (' + de + ')';
  $('dca-lbl-cuota').textContent = t('dca_cuota') + ' (' + de + ')';
  if (de === a) return msg($('dca-resumen'), t('dca_mismo_token'), 'err');
  if (!dep || !cuota) { $('dca-resumen').textContent = ''; return; }
  if (cuota < (tk.minCuota || 0)) return msg($('dca-resumen'), tr('dca_min', { m: tk.minCuota, s: de }), 'err');
  if (cuota > dep) return msg($('dca-resumen'), t('dca_cuota_mayor'), 'err');
  const n = Math.floor(dep / cuota);
  const seg = Number($('dca-periodo').value);
  msg($('dca-resumen'), tr('dca_resumen', { n: n, q: cuota, s: de, p: dcaPeriodoTxt(seg), d: dcaDuracion(n * seg), c: (dep * (DCA.comision || 0)).toFixed(4) + ' ' + de }));
}

// Enganches con guarda: un TypeError aquí arriba dejaría toda la interfaz en blanco.
if ($('dca-wallet')) $('dca-wallet').onchange = () => { dcaPintarDireccion(); dcaCargar(); };
if ($('dca-invert')) $('dca-invert').onclick = () => { DCA_DIR = { de: DCA_DIR.a, a: DCA_DIR.de }; dcaPintarDireccion(); dcaResumen(); };
for (const idc of ['dca-dep', 'dca-cuota', 'dca-periodo', 'dca-slip']) {
  if ($(idc)) { $(idc).oninput = dcaResumen; $(idc).onchange = dcaResumen; }
}

if ($('dca-crear')) $('dca-crear').onclick = () => {
  const wid = $('dca-wallet').value;
  const de = DCA_DIR.de, a = DCA_DIR.a;
  const dep = $('dca-dep').value, cuota = $('dca-cuota').value;
  const periodo = Number($('dca-periodo').value), slippage = Number($('dca-slip').value);
  if (!wid) return msg($('dca-msg'), t('nft_sin_wallet'), 'err');
  if (de === a) return msg($('dca-msg'), t('dca_mismo_token'), 'err');
  if (!dep || !cuota) return msg($('dca-msg'), t('err_fill_dest_amt'), 'err');
  if (isLedgerW(wid)) return msg($('dca-msg'), t('dca_ledger'), 'err');
  askSend(tr('dca_conf', { d: esc(dep), s: esc(de), q: esc(cuota), p: dcaPeriodoTxt(periodo), o: esc(a) }),
    async (pass) => {
      const r = await window.api.dcaCrear({ passphrase: pass, walletId: wid, de: de, a: a, deposito: dep, cuota: cuota, periodo: periodo, slippage: slippage });
      setTimeout(() => { dcaCargar(); renderOrdenesActivas(); }, 4000);
      return tr('dca_creado', { id: r.id });
    });
};

function dcaRecargar(i) {
  const p = DCA && DCA.planes[i]; if (!p) return;
  const sim = dcaSimbolo(p.tokenIn);
  const cant = prompt(tr('dca_cuanto', { s: sim }));
  if (!cant || !(Number(cant) > 0)) return;
  askSend(tr('dca_conf_top', { a: esc(cant), s: esc(sim), id: esc(p.id) }),
    async (pass) => {
      await window.api.dcaRecargar({ passphrase: pass, walletId: $('dca-wallet').value, id: p.id, cantidad: cant });
      setTimeout(() => { dcaCargar(); renderOrdenesActivas(); }, 4000);
      return t('dca_recargado');
    });
}

function dcaAccion(i, que) {
  const p = DCA && DCA.planes[i]; if (!p) return;
  askSend(tr('dca_conf_' + que, { id: esc(p.id), b: dcaNum(p.balance), s: dcaSimbolo(p.tokenIn) }),
    async (pass) => {
      await window.api.dcaAccion({ passphrase: pass, walletId: $('dca-wallet').value, id: p.id, que: que });
      setTimeout(() => { dcaCargar(); renderOrdenesActivas(); }, 4000);
      return t('dca_hecho');
    });
}

// ===== Ordenes activas en el Panel =====
// Un vistazo a lo que esta corriendo solo: planes DCA y ordenes limite abiertas de las
// wallets visibles. Se lee de la cadena; si falla, el bloque simplemente no aparece.
async function renderOrdenesActivas() {
  const zona = $('ordenes-activas');
  if (!zona) return;
  let r = null;
  try { r = await window.api.dcaPanel(); } catch (_) { zona.hidden = true; return; }
  const filas = (r && r.filas) || [];
  if (!filas.length) { zona.hidden = true; zona.innerHTML = ''; return; }
  const nPlanes = filas.reduce((n, f) => n + f.planes.length, 0);
  const nOrd = filas.reduce((n, f) => n + f.ordenes.length, 0);
  const trozos = filas.map(f => {
    const planes = f.planes.map(p => {
      const pausa = p.estado === 'paused' ? ` <span class="warn">${t('dca_pausar')}</span>` : '';
      return `<div class="oa-linea"><span class="oa-tipo">DCA</span> <b>${esc(dcaSimbolo(p.tokenIn))} \u2192 ${esc(dcaSimbolo(p.tokenOut))}</b>
        <span class="muted xs">${tr('dca_plan_linea', { q: dcaNum(p.cuota), s: esc(dcaSimbolo(p.tokenIn)), p: dcaPeriodoTxt(dcaNum(p.periodo)) })}</span>
        <span class="muted xs">\u00b7 ${tr('oa_bote', { b: dcaNum(p.balance), s: esc(dcaSimbolo(p.tokenIn)), c: dcaNum(p.buys) })}</span>${pausa}</div>`;
    }).join('');
    const ordenes = f.ordenes.map(o => `<div class="oa-linea"><span class="oa-tipo oa-lim">${t('oa_limite')}</span>
      <b>${esc(dcaSimbolo(o.tokenIn))} \u2192 ${esc(dcaSimbolo(o.tokenOut))}</b>
      <span class="muted xs">${tr('oa_orden', { a: dcaNum(o.entra), s: esc(dcaSimbolo(o.tokenIn)), p: dcaNum(o.precio) })}</span></div>`).join('');
    return `<div class="oa-wallet"><div class="muted xs">${esc(f.wallet)} \u00b7 ${shortAddr(f.cuenta)}</div>${planes}${ordenes}</div>`;
  }).join('');
  zona.hidden = false;
  zona.innerHTML = `<details class="conv-card" id="oa-det" open>
    <summary>${tr('oa_titulo', { p: nPlanes, o: nOrd })}</summary>
    <div class="oa-cuerpo">${trozos}</div>
  </details>`;
}

// ===== Mercado: menu + modal =====
// Los formularios son los MISMOS de antes (mk-*, st-*, es-*), solo que ahora viven en
// paneles dentro de un modal grande. Se abre el que toque y se refrescan sus saldos.
const MKT_PANELES = {
  kda: { titulo: 'mkt_t_kda', render: () => renderMercado() },
  st:  { titulo: 'mkt_t_st',  render: () => renderStableSwap() },
  eth: { titulo: 'mkt_t_eth', render: () => renderEthSwap() }
};
function abrirMercado(cual) {
  const cfgp = MKT_PANELES[cual];
  if (!cfgp || !$('modal-mkt')) return;
  for (const k of Object.keys(MKT_PANELES)) {
    const el = $('mkt-p-' + k);
    if (el) el.hidden = (k !== cual);
  }
  $('mkt-titulo').textContent = t(cfgp.titulo);
  $('modal-mkt').hidden = false;
  try { cfgp.render(); } catch (_) {}
}
document.querySelectorAll('.mkt-item').forEach(b => b.onclick = () => abrirMercado(b.dataset.mkt));
// Cerrar tocando fuera de la tarjeta, como se espera de un modal.
if ($('modal-mkt')) $('modal-mkt').onclick = (e) => { if (e.target.id === 'modal-mkt') $('modal-mkt').hidden = true; };

async function applyView(v) {
  WALLETS = v.wallets; SHOWN = v.shown;
  renderBridge();
  renderMercado();
  renderEthSwap();
  renderStableSwap();
  renderDca();
  renderOrdenesActivas();
  updateNetContext();
  $('sec-wallet').innerHTML = v.wallets.map(w => `<option value="${w.id}">${esc(w.label)} · ${w.kind === 'kda' ? 'Kadena' : w.netName}</option>`).join('');
  $('wallet-list').innerHTML = v.wallets.map(w => `<div class="wrow ${w.shown ? 'active' : ''}">
    <label class="wshow" title="${t('ttl_show_dash')}"><input type="checkbox" data-show="${w.id}" ${w.shown ? 'checked' : ''}/> <span class="tdot" style="background:${w.kind === 'kda' ? '#63e038' : '#627eea'}"></span></label>
    <div class="wmeta"><div class="wl">${esc(w.label)} ${w.ledger ? `<span class="wtag ledger">${t('ledger_badge')}</span>` : ''} ${wTagBadge(w.id)}</div><div class="wa">${w.kind === 'kda' ? 'Kadena' : w.netName}${w.shown ? ` · <span class="grn">${t('on_dash')}</span>` : ''}${wNote(w.id)}</div></div>
    <div class="wact"><button class="copy" data-ren="${w.id}" title="${t('ttl_rename')}">✏️</button><button class="copy" data-del="${w.id}" title="${t('ttl_del')}">🗑</button></div></div>`).join('');
  $('wallet-list').querySelectorAll('[data-show]').forEach(cb => cb.onchange = async () => applyView(await window.api.walletShown(cb.dataset.show, cb.checked)));
  $('wallet-list').querySelectorAll('[data-ren]').forEach(b => b.onclick = () => { const w = WALLETS.find(x => x.id === b.dataset.ren); openRename(b.dataset.ren, w ? w.label : ''); });
  // Borrar con DOBLE confirmación + consejo de copiar la semilla antes (modal-del)
  $('wallet-list').querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
    const w = WALLETS.find(x => x.id === b.dataset.del);
    window._delId = b.dataset.del;
    const wname = esc(w ? w.label : t('this_wallet'));
    $('del-q').innerHTML = tr('del_q', { w: wname });
    $('del-warn1').innerHTML = t('del_warn1');
    $('del-warn2').innerHTML = tr('del_warn2', { w: wname });
    $('del-step1').hidden = false; $('del-step2').hidden = true; msg($('del-msg'), '');
    $('modal-del').hidden = false;
  });
  loadBalances();
}

function assetRow(sym, amt, usd) { return `<div class="asset"><span class="a-sym">${esc(sym)}</span><span class="a-amt">${amt}</span><span class="a-chg">${chgHtml(sym)}</span><span class="a-usd">$${(usd || 0).toFixed(2)}</span></div>`; }
// Una tarjeta = una red de una wallet visible. Colapsada por defecto: solo red + total. Clic en el título despliega tokens/chains.
function cardBlock(bl, qr) {
  let rows, extra = '', sendForm;
  if (bl.kind === 'kda') {
    const toks = bl.tokens || [];
    // Enviable = todo lo que se ve en la tarjeta, kb-* incluidos. Antes se escondian los
    // kb-* «porque van por el puente», pero eso confundia dos cosas: el puente hace falta para
    // CRUZAR a EVM, no para mover el token entre dos cuentas de Kadena. Comprobado en cadena
    // (26/08/2026) que kb-USDC/USDT/DAI/WBTC son fungible-v2 corrientes, asi que viajan con el
    // mismo transfer que PCO. Antonio tenia 4 kb-USDC y la app no le dejaba enviarlos.
    const sendable = toks;
    const kdaUsd = (bl.usd || 0) - toks.reduce((s, t) => s + t.usd, 0);
    rows = assetRow('KDA', bl.native.toFixed(4), kdaUsd) + toks.map(t => assetRow(t.symbol, t.amount.toFixed(4), t.usd)).join('');
    const per = Object.keys(bl.perChain || {}).length ? t('spread') + Object.entries(bl.perChain).sort((a, b) => a[0] - b[0]).map(([c, x]) => `Chain ${c} → ${Number(x).toFixed(4)}`).join('  ·  ') : t('no_bal_yet');
    extra = `<div class="muted xs perline">${per}</div>`;
    const assetSel = sendable.length ? `<label>${t('lbl_asset')}</label><select class="k-asset"><option value="__kda__" data-native="1">KDA</option>${sendable.map(x => `<option value="${esc(x.symbol)}" data-bal="${x.amount}">${esc(x.symbol)}</option>`).join('')}</select>` : '';
    sendForm = `${assetSel}<div class="k-chainrow"><div class="row2"><div><label>${t('lbl_chain_from')}</label><input class="k-chain" type="number" value="0" min="0" max="19"/></div>
      <div><label>${t('lbl_chain_to')}</label><input class="k-tochain" type="number" value="0" min="0" max="19"/></div></div></div>
      <label>${t('lbl_dest_k')}</label><input class="k-to" list="dl-kda" placeholder="${t('ph_kda_dest')}"/>
      <label>${t('lbl_amount')}</label><div class="amtrow"><input class="k-amt" type="number" step="0.0001"/><button type="button" class="tiny ghost k-max" title="${t('ttl_max')}">MAX</button></div>
      <div class="muted xs k-xhint" hidden>${t('xchain_hint')}</div>
      <button class="primary k-send" data-wid="${bl.walletId}" data-knet="${bl.knet}" data-perchain='${JSON.stringify(bl.perChain || {})}'>${t('send')}</button>`;
  } else {
    rows = assetRow(bl.symbol, bl.native.toFixed(4), bl.nativeUsd) + bl.tokens.map(t => assetRow(t.symbol, t.amount.toFixed(4), t.usd)).join('');
    const opts = `<option value="${bl.symbol}" data-amt="${bl.native}" data-native="1">${bl.symbol}</option>` + bl.tokens.map(t => `<option value="${t.address}" data-amt="${t.amount}">${t.symbol}</option>`).join('');
    sendForm = `<label>${t('lbl_asset')}</label><select class="e-asset" data-sym="${bl.symbol}">${opts}</select>
      <label>${t('lbl_dest_0x')}</label><input class="e-to" list="dl-evm" placeholder="${t('ph_evm_dest')}"/>
      <label>${t('lbl_amount')}</label><div class="amtrow"><input class="e-amt" type="number" step="0.0001"/><button type="button" class="tiny ghost e-max" title="${t('ttl_max')}">MAX</button></div>
      <button class="primary e-send" data-wid="${bl.walletId}" data-net="${bl.key}" data-netname="${bl.name}">${t('send')}</button>`;
  }
  return `<div class="card netcard" style="border-top:3px solid ${bl.color}">
    <div class="nc-head" data-toggle="body"><span class="netdot" style="background:${bl.color}"></span><span class="chev">▸</span> ${bl.name} <small class="muted">${esc(bl.walletLabel)}</small>${bl.error ? ` <small class="err">${t('offline')}</small>` : ''}<span class="nc-sub">${bl.knet === 'devnet' ? (bl.native || 0).toLocaleString(undefined, { maximumFractionDigits: 2 }) + ' KDA' : '$' + (bl.usd || 0).toFixed(2)}</span></div>
    <div class="nc-body" hidden>
      <div class="assets">${rows}</div>
      ${extra}
    </div>
    <div class="nc-actions">
      <button class="act-btn" data-panel="recv">${t('btn_recv')}</button>
      <button class="act-btn" data-panel="send">${t('btn_send')}</button>
      <button class="act-btn nc-expand" title="${t('btn_expand')}">⛶ ${t('btn_expand')}</button>
      ${bl.kind === 'kda' && bl.knet === 'devnet' ? `<button class="act-btn k-faucet" data-wid="${bl.walletId}">${t('btn_faucet')}</button>` : ''}
    </div>
    <div class="nc-panel" data-pan="recv" hidden>
      <div class="recv-note muted xs">📥 ${bl.kind === 'kda' ? t('recv_note_kda') : t('recv_note_evm').replace('{net}', esc(bl.name))}</div>
      <div class="addr"><span class="mono">${esc(bl.address)}</span><button class="copy" data-ct="${esc(bl.address)}">${t('copy')}</button></div>
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
  msg($('wallet-msg'), t('loading_balances'));
  document.body.classList.remove('focus-mode'); // un refresco de saldos regenera las tarjetas → volver al panel
  try {
    PRICES = await window.api.prices().catch(() => PRICES); // idea 5/6: variación 24h + fiat
    const b = await window.api.balances();
    window._bal = b;                       // el Mercado los usa para enseñar el disponible
    const blocks = b.blocks || [];
    const qrs = {};
    for (const bl of blocks) { if (!(bl.address in qrs)) qrs[bl.address] = await window.api.qr(bl.address); }
    const aviso = b.modoPruebas ? '<p class="testmode">' + t('test_mode') + '</p>' : '';
    $('net-cards').innerHTML = aviso + (blocks.map(bl => cardBlock(bl, qrs[bl.address])).join('') || `<p class="muted">${t('no_wallets_visible')}</p>`);
    $('total-usd').textContent = '$' + (b.total || 0).toFixed(2);
    const segMap = {};
    blocks.forEach(bl => { (segMap[bl.name] = segMap[bl.name] || { name: bl.name, color: bl.color, usd: 0 }).usd += bl.usd; });
    donut(Object.values(segMap), b.total || 0);
    wireCards();
    renderGasWarnings(blocks);
    initConverter();
    msg($('wallet-msg'), '');
  } catch (e) { msg($('wallet-msg'), 'Error: ' + e.message, 'err'); }
}
// Idea 2: aviso de gas bajo. Umbral por símbolo del token nativo de cada red.
const GAS_MIN = { ETH: 0.0015, BNB: 0.005, POL: 1, MATIC: 1, KDA: 0.5 };
function renderGasWarnings(blocks) {
  const el = $('gas-warn'); if (!el) return;
  const warns = [];
  for (const bl of blocks) {
    if (bl.error) continue;
    const sym = bl.kind === 'kda' ? 'KDA' : bl.symbol;
    const bal = Number(bl.native || 0);
    const min = GAS_MIN[sym] ?? 0.001;
    if (bal < min) warns.push(t('low_gas').replace('{sym}', sym).replace('{net}', bl.name + (bl.walletLabel ? ' · ' + bl.walletLabel : '')).replace('{bal}', bal.toFixed(sym === 'KDA' ? 2 : 5)));
  }
  el.innerHTML = warns.length ? warns.map(w => `<div class="gwrow">⛽ ${esc(w)}</div>`).join('') : '';
  el.hidden = !warns.length;
}
// Aviso extra en la confirmación cuando la wallet es de Ledger (hay que aprobar en el aparato)
function isLedgerW(wid) { const w = WALLETS.find(x => x.id === wid); return !!(w && w.ledger); }
function ledgerNote(wid) { return isLedgerW(wid) ? `<br><span class="warn" style="display:block;margin-top:8px">${t('ledger_confirm_note')}</span>` : ''; }
// Vista ampliada: una wallet ocupa todo el dashboard para trabajar cómodo con ella.
function enterFocus(card) {
  if (!card) return;
  document.querySelectorAll('.netcard').forEach(c => c.classList.toggle('focused', c === card));
  const body = card.querySelector('.nc-body'); // desplegar sus saldos al ampliar
  if (body) { body.hidden = false; const ch = card.querySelector('.chev'); if (ch) ch.textContent = '▾'; }
  // Al ampliar, mostrar TODO a la vez: Recibir y Enviar desplegados (y sus botones marcados).
  card.querySelectorAll('.nc-panel').forEach(p => { p.hidden = false; });
  card.querySelectorAll('.act-btn[data-panel]').forEach(b => b.classList.add('on'));
  document.body.classList.add('focus-mode');
  window.scrollTo(0, 0);
}
function exitFocus() {
  document.body.classList.remove('focus-mode');
  document.querySelectorAll('.netcard.focused').forEach(c => {
    c.classList.remove('focused');
    // dejar la tarjeta recogida como estaba (paneles cerrados, botones sin marcar)
    c.querySelectorAll('.nc-panel').forEach(p => { p.hidden = true; });
    c.querySelectorAll('.act-btn[data-panel]').forEach(b => b.classList.remove('on'));
  });
}
function wireCards() {
  // Título → despliega tokens/chains
  document.querySelectorAll('.netcard .nc-head[data-toggle]').forEach(h => h.onclick = () => {
    const b = h.parentElement.querySelector('.nc-body'); if (!b) return;
    b.hidden = !b.hidden; const c = h.querySelector('.chev'); if (c) c.textContent = b.hidden ? '▸' : '▾';
  });
  // Botones Recibir/Enviar → despliegan su panel (uno u otro). Solo los que llevan data-panel
  // (así NO entra el botón Ampliar, que también es .act-btn).
  document.querySelectorAll('.netcard .act-btn[data-panel]').forEach(btn => btn.onclick = () => {
    const card = btn.closest('.netcard'); const which = btn.dataset.panel;
    const panel = card.querySelector(`.nc-panel[data-pan="${which}"]`);
    const other = card.querySelector(`.nc-panel[data-pan="${which === 'recv' ? 'send' : 'recv'}"]`);
    if (other) other.hidden = true;
    panel.hidden = !panel.hidden;
    card.querySelectorAll('.act-btn[data-panel]').forEach(b => b.classList.toggle('on', b === btn && !panel.hidden));
  });
  // Ampliar: la wallet ocupa todo el dashboard (vista de trabajo). Vuelve con "← Volver al panel".
  document.querySelectorAll('.netcard .nc-expand').forEach(btn => btn.onclick = (e) => { e.stopPropagation(); enterFocus(btn.closest('.netcard')); });
  const back = $('focus-back'); if (back) back.onclick = exitFocus;
  // Grifo devnet: pide 1.000 KDA de prueba a sender00 (sin contraseña: no toca claves propias)
  document.querySelectorAll('.k-faucet').forEach(btn => btn.onclick = async () => {
    btn.disabled = true; msg($('wallet-msg'), t('faucet_wait'));
    try { const r = await window.api.devnetFaucet(btn.dataset.wid); msg($('wallet-msg'), t('faucet_ok').replace('{n}', r.amount).replace('{c}', r.chain), 'ok'); loadBalances(); }
    catch (e) { msg($('wallet-msg'), t('faucet_err') + ' ' + e.message, 'err'); btn.disabled = false; }
  });
  // MAX: rellena la cantidad con el máximo enviable, DESCONTANDO la reserva de gas.
  // KDA: saldo de la chain origen − 0,11 (colchón del gas). EVM nativo: saldo − GAS_MIN de esa red. Token: saldo entero (el gas va en el nativo).
  document.querySelectorAll('.k-max').forEach(btn => btn.onclick = () => {
    const c = btn.closest('.netcard'); const send = c.querySelector('.k-send');
    const aSel = c.querySelector('.k-asset');
    if (aSel && aSel.value !== '__kda__') { // token: MAX = saldo entero del token (el gas se paga en KDA aparte)
      const o = aSel.selectedOptions[0]; const bal = o ? Number(o.dataset.bal || 0) : 0;
      c.querySelector('.k-amt').value = bal > 0 ? (Math.floor(bal * 1e6) / 1e6) : ''; return;
    }
    let per = {}; try { per = JSON.parse(send.dataset.perchain || '{}'); } catch (_) {}
    const chain = Number(c.querySelector('.k-chain').value || 0);
    const max = Math.max(0, (per[chain] || 0) - 0.11);
    c.querySelector('.k-amt').value = max > 0 ? (Math.floor(max * 1e6) / 1e6) : '';
  });
  document.querySelectorAll('.e-max').forEach(btn => btn.onclick = () => {
    const c = btn.closest('.netcard'); const sel = c.querySelector('.e-asset');
    const o = sel.selectedOptions[0]; if (!o) return;
    const amt = Number(o.dataset.amt || 0);
    const max = o.dataset.native ? Math.max(0, amt - (GAS_MIN[sel.dataset.sym] ?? 0.002)) : amt;
    c.querySelector('.e-amt').value = max > 0 ? (Math.floor(max * 1e6) / 1e6) : '';
  });
  // Aviso visual cuando origen ≠ destino (cross-chain)
  document.querySelectorAll('.netcard').forEach(card => {
    const src = card.querySelector('.k-chain'), tgt = card.querySelector('.k-tochain'), hint = card.querySelector('.k-xhint');
    if (src && tgt && hint) { const upd = () => { hint.hidden = src.value === tgt.value; }; src.oninput = upd; tgt.oninput = upd; }
  });
  // Selector de activo KDA: al elegir un token (PCO), oculta las chains (el token vive en su chain fija).
  document.querySelectorAll('.k-asset').forEach(sel => {
    const c = sel.closest('.netcard');
    const upd = () => { const tok = sel.value !== '__kda__'; const cr = c.querySelector('.k-chainrow'); if (cr) cr.hidden = tok; const xh = c.querySelector('.k-xhint'); if (xh && tok) xh.hidden = true; };
    sel.onchange = upd; upd();
  });
  document.querySelectorAll('.k-send').forEach(btn => btn.onclick = () => {
    const c = btn.closest('.netcard');
    const wid = btn.dataset.wid, knet = btn.dataset.knet;
    // Rama TOKEN (PCO…): envío del fungible por su módulo, en su chain fija; sin cross-chain ni barrido.
    const aSel = c.querySelector('.k-asset');
    if (aSel && aSel.value !== '__kda__') {
      const symbol = aSel.value;
      const toT = c.querySelector('.k-to').value.trim(), amtT = c.querySelector('.k-amt').value;
      if (!toT || !amtT) return msg($('wallet-msg'), t('err_fill_dest_amt'), 'err');
      if (isLedgerW(wid)) return msg($('wallet-msg'), t('err_tok_ledger'), 'err');
      return askSend(tr('cf_send_tok', { a: esc(amtT), s: esc(symbol), to: esc(toT) }),
        async (pass) => { const r = await window.api.sendKdaToken(pass, wid, symbol, toT, amtT); return t('sent_rk') + r.requestKey; }, toT, {});
    }
    const chain = Number(c.querySelector('.k-chain').value), tochain = Number(c.querySelector('.k-tochain').value);
    const to = c.querySelector('.k-to').value.trim(), amt = c.querySelector('.k-amt').value;
    if (!to || !amt) return msg($('wallet-msg'), t('err_fill_dest_amt'), 'err');
    const num = Number(amt);
    let per = {}; try { per = JSON.parse(btn.dataset.perchain || '{}'); } catch (_) {}
    const RES = 0.11;
    const enChainOrigen = per[chain] || 0;
    if (chain === tochain && num <= enChainOrigen - RES) {
      // Cabe en la propia chain: envío normal
      askSend(tr('cf_send_kda', { a: esc(amt), c: esc(chain), to: esc(to) }) + ledgerNote(wid), async (pass) => { const r = await window.api.sendKda(pass, wid, knet, chain, to, amt); return t('sent_rk') + r.requestKey; }, to, { ledger: isLedgerW(wid) });
    } else if (chain !== tochain && num <= enChainOrigen - RES) {
      // Cross-chain simple: la chain origen tiene bastante
      askSend(tr('cf_send_kda_x', { a: esc(amt), c1: esc(chain), c2: esc(tochain), to: esc(to) }) + ledgerNote(wid), async (pass) => { const r = await window.api.sendKdaXchain(pass, wid, knet, chain, tochain, to, amt); return t('xchain_done') + r.pactId; }, to, { ledger: isLedgerW(wid) });
    } else {
      // No cabe en una sola chain → BARRIDO: juntar de varias hacia la chain destino
      const disponible = Object.values(per).reduce((s, x) => s + Math.max(0, x - RES), 0);
      if (num > disponible) return msg($('wallet-msg'), tr('err_sweep_bal', { b: disponible.toFixed(2) }), 'err');
      const nchains = Object.keys(per).filter(k => (per[k] || 0) > RES).length;
      askSend(tr('cf_send_kda_sweep', { a: esc(amt), c: esc(tochain), n: nchains, to: esc(to) }) + ledgerNote(wid), async (pass) => { const r = await window.api.sendKdaSmart(pass, wid, knet, tochain, to, amt); return t('sweep_done') + r.requestKey; }, to, { ledger: isLedgerW(wid) });
    }
  });
  document.querySelectorAll('.e-send').forEach(btn => btn.onclick = () => {
    const c = btn.closest('.netcard'); const sel = c.querySelector('.e-asset'); const asset = sel.value, label = sel.options[sel.selectedIndex].textContent, to = c.querySelector('.e-to').value.trim(), amt = c.querySelector('.e-amt').value;
    if (!to || !amt) return msg($('wallet-msg'), t('err_fill_dest_amt'), 'err');
    const wid = btn.dataset.wid;
    askSend(tr('cf_send_evm', { a: esc(amt), s: esc(label), net: esc(btn.dataset.netname), to: esc(to) }) + ledgerNote(wid), async (pass) => { const r = await window.api.sendEvm(pass, wid, btn.dataset.net, asset, to, amt); return t('sent_tx') + r.hash; }, to, { ledger: isLedgerW(wid) });
  });
}
// confirmación de envío con contraseña
// Idea 3: si se pasa `recipient`, se muestra la dirección destacada (cabeza/cola) y se exige marcar el visto bueno antes de firmar.
function fmtAddr(a) { const s = String(a || ''); if (s.length <= 16) return esc(s); return `<span class="ah">${esc(s.slice(0, 8))}</span>${esc(s.slice(8, -6))}<span class="ah">${esc(s.slice(-6))}</span>`; }
function askSend(summary, fn, recipient, opts) {
  window._sendFn = fn; $('send-summary').innerHTML = summary; $('send-pass').value = ''; msg($('send-msg'), ''); $('send-steps').innerHTML = '';
  // Wallet Ledger: sin contraseña de bóveda (la clave no está en ella; la confirmación es física, en el aparato)
  const isLedger = !!(opts && opts.ledger);
  const pw = $('send-pass'); const pwWrap = pw.closest('.pwdwrap') || pw;
  pwWrap.hidden = isLedger; if ($('send-pass-lbl')) $('send-pass-lbl').hidden = isLedger;
  const chk = $('send-addr-check'), ok = $('send-addr-ok'), btn = $('btn-confirm-send');
  if (recipient) {
    $('send-addr-big').innerHTML = fmtAddr(recipient); ok.checked = false; chk.hidden = false; btn.disabled = true;
    ok.onchange = () => { btn.disabled = !ok.checked; };
  } else { chk.hidden = true; btn.disabled = false; ok.onchange = null; }
  $('modal-send').hidden = false;
}
$('btn-confirm-send').onclick = async () => { if ($('btn-confirm-send').disabled) return; try { msg($('send-msg'), t('signing')); const okmsg = await window._sendFn($('send-pass').value); msg($('send-msg'), '✅ ' + okmsg, 'ok'); loadBalances(); setTimeout(() => { $('modal-send').hidden = true; }, 2500); } catch (e) { const m = cleanErr(e); msg($('send-msg'), isLedgerWait(m) ? '⏸ ' + m : m, isLedgerWait(m) ? 'warn' : 'err'); } };
$('send-pass').addEventListener('keydown', e => { if (e.key === 'Enter') $('btn-confirm-send').click(); });
$('btn-refresh').onclick = loadBalances;

// HISTORIAL (plegado por defecto) — de la wallet seleccionada: on-chain de kdaindex + local (EVM/puente)
const HIST_ICON = { in: '📥', out: '📤', 'send-evm': '📤', bridge: '🌉' };
let HIST_WID = null;
async function refreshHistory() {
  const wid = $('hist-wallet').value || null;
  $('hist-list').innerHTML = `<div class="muted xs" style="padding:10px 2px">${t('hist_loading')}</div>`;
  let list = [];
  try { list = await window.api.history(wid); window._histList = list; } catch (e) { $('hist-list').innerHTML = '<div class="msg err">Error: ' + e.message + '</div>'; return; }
  // Alex #3: todo lo que venga del indexador (amt/tok/other/chain/id/title/sub) se ESCAPA antes de ir a innerHTML.
  $('hist-list').innerHTML = list.length ? list.map(h => {
    const fecha = new Date(h.ts).toLocaleString(LNG === 'en' ? 'en-GB' : 'es-ES');
    const idShort = h.id ? esc(String(h.id).slice(0, 12)) + '…' : '';
    // on-chain: campos estructurados (amt/chain se fuerzan a número); locales EVM/puente usan title/sub
    const title = h.dir ? `${t(h.dir === 'in' ? 'hist_in' : 'hist_out')} ${esc(Number(h.amt))} ${esc(h.tok)}` : esc(h.title);
    const sub = h.dir ? `${esc(h.wlabel)} · ${t(h.dir === 'in' ? 'hist_from' : 'hist_to')} ${esc(h.other)} · chain ${esc(Number(h.chain))}` : esc(h.sub);
    return `<div class="hrow"><div class="hi">${HIST_ICON[h.kind] || '•'}</div><div class="hmeta"><div class="hd">${title}</div><div class="hx muted">${esc(fecha)}${sub ? ' · ' + sub : ''}${idShort ? ' · ' + idShort : ''}</div></div>${h.id ? `<button class="copy" data-ct="${esc(h.id)}" title="${t('ttl_copy_id')}">⧉</button>` : ''}</div>`;
  }).join('') : `<div class="muted xs" style="padding:10px 2px">${t('hist_empty')}</div>`;
}
function fillHistWallet() {
  $('hist-wallet').innerHTML = WALLETS.map(w => `<option value="${w.id}">${esc(w.label)} · ${w.kind === 'kda' ? 'Kadena' : w.netName}</option>`).join('');
  if (HIST_WID && WALLETS.some(w => w.id === HIST_WID)) $('hist-wallet').value = HIST_WID;
  else { const def = WALLETS.find(w => SHOWN.includes(w.id)) || WALLETS[0]; if (def) $('hist-wallet').value = def.id; }
  HIST_WID = $('hist-wallet').value;
}
$('hist-wallet').onchange = () => { HIST_WID = $('hist-wallet').value; refreshHistory(); };
$('btn-history').onclick = async () => { const p = $('history-panel'); if (!p.hidden) { p.hidden = true; return; } fillHistWallet(); p.hidden = false; refreshHistory(); };
$('hist-close').onclick = () => { $('history-panel').hidden = true; };

// CREAR
$('btn-create').onclick = () => { $('create-step1').hidden = false; $('create-step2').hidden = true; $('cr-label').value = ''; msg($('cr-msg'), ''); $('modal-create').hidden = false; };
$('btn-do-create').onclick = async () => { try { msg($('cr-msg'), t('generating')); const { kind, net } = parseNet($('cr-net').value); const r = await window.api.createWallet($('cr-label').value.trim(), kind, net); window._pv = r.view; $('cr-seed').textContent = r.mnemonic; $('create-step1').hidden = true; $('create-step2').hidden = false; msg($('cr-msg'), ''); } catch (e) { msg($('cr-msg'), 'Error: ' + e.message, 'err'); } };
$('btn-create-done').onclick = () => { $('modal-create').hidden = true; $('cr-seed').textContent = ''; applyView(window._pv); nav('dashboard'); };

// RENOMBRAR
let renId = null;
function openRename(id, label) {
  renId = id; $('ren-label').value = label || ''; msg($('ren-msg'), '');
  const m = (CFG.walletMeta && CFG.walletMeta[id]) || {}; // idea 15: etiqueta + nota
  $('ren-tag').value = m.tag || ''; $('ren-note').value = m.note || '';
  $('modal-rename').hidden = false; $('ren-label').focus();
}
$('btn-do-rename').onclick = async () => {
  try {
    const v = await window.api.renameWallet(renId, $('ren-label').value.trim());
    CFG.walletMeta = CFG.walletMeta || {};
    CFG.walletMeta[renId] = { tag: $('ren-tag').value, note: $('ren-note').value.trim() };
    await window.api.setConfig(CFG);
    $('modal-rename').hidden = true; applyView(v);
  } catch (e) { msg($('ren-msg'), e.message, 'err'); }
};
$('ren-label').addEventListener('keydown', e => { if (e.key === 'Enter') $('btn-do-rename').click(); });

// LEDGER: leer cuenta del aparato y añadirla como wallet (la clave se queda en el aparato)
$('btn-ledger').onclick = () => {
  $('lg-net').innerHTML = netOptions();
  $('lg-label').value = ''; $('lg-index').value = '0';
  $('lg-acct').hidden = true; $('lg-acct-txt').textContent = ''; $('btn-lg-add').disabled = true;
  msg($('lg-msg'), ''); $('modal-ledger').hidden = false;
};
$('btn-lg-peek').onclick = async () => {
  const { kind } = parseNet($('lg-net').value);
  $('btn-lg-peek').disabled = true; $('btn-lg-add').disabled = true; $('lg-acct').hidden = true;
  msg($('lg-msg'), t('ledger_reading'));
  try {
    const r = await window.api.ledgerPeek(kind, Number($('lg-index').value || 0), false);
    $('lg-acct-txt').textContent = r.account; $('lg-acct').hidden = false;
    $('btn-lg-add').disabled = false; msg($('lg-msg'), '');
  } catch (e) { const m = cleanErr(e); msg($('lg-msg'), isLedgerWait(m) ? '⏸ ' + m : m, isLedgerWait(m) ? 'warn' : 'err'); }
  finally { $('btn-lg-peek').disabled = false; }
};
$('btn-lg-add').onclick = async () => {
  const { kind, net } = parseNet($('lg-net').value);
  $('btn-lg-add').disabled = true;
  try {
    const r = await window.api.ledgerImport($('lg-label').value.trim(), kind, net, Number($('lg-index').value || 0));
    $('modal-ledger').hidden = true; applyView(r.view); nav('dashboard'); msg($('wallet-msg'), t('ledger_added'), 'ok');
  } catch (e) { msg($('lg-msg'), e.message, 'err'); $('btn-lg-add').disabled = false; }
};
// El selector de red del modal Ledger cambia la cuenta → invalidar la leída
$('lg-net').onchange = () => { $('lg-acct').hidden = true; $('btn-lg-add').disabled = true; };
$('lg-index').oninput = () => { $('lg-acct').hidden = true; $('btn-lg-add').disabled = true; };

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
  if (!mn) return msg($('imp-msg'), t('err_paste_seed'), 'err');
  if (reset) { seedOffset = 0; seedRowsHtml = ''; }
  $('seed-accts').innerHTML = seedRowsHtml + `<div class="muted xs">${t('seed_scanning')}</div>`;
  try {
    const accts = await window.api.seedAccounts(mn, kind, net, seedOffset, 5);
    seedOffset += 5;
    seedRowsHtml += accts.map(a => { const tag = METHOD_TAG[a.method] ? ` <span class="mtag">${METHOD_TAG[a.method]}</span>` : ''; return `<div class="seedrow"><div class="sr-acc"><b>#${a.index}</b>${tag} <span class="mono">${a.id.slice(0, 12)}…${a.id.slice(-6)}</span></div><div class="sr-bal ${a.amount > 0 ? 'has' : ''}">${a.amount.toFixed(4)} ${a.unit}</div><button class="tiny seed-imp" data-idx="${a.index}" data-method="${a.method}">${t('import')}</button></div>`; }).join('');
    $('seed-accts').innerHTML = seedRowsHtml + `<button id="btn-seed-more" class="ghost tiny">${tr('seed_more', { n: seedOffset })}</button>`;
    wireSeedRows();
  } catch (e) { $('seed-accts').innerHTML = seedRowsHtml; msg($('imp-msg'), 'Error: ' + e.message, 'err'); }
}
$('btn-seed-scan').onclick = () => scanSeed(true);
// Buscar una cuenta concreta dentro de la semilla (encuentra método+índice exactos)
$('btn-seed-find').onclick = async () => {
  const mn = $('imp-mn').value.trim(); const { kind, net } = parseNet($('imp-net').value); const target = $('imp-target').value.trim();
  if (!mn) return msg($('imp-msg'), t('err_paste_seed'), 'err');
  if (!target) return msg($('imp-msg'), t('err_paste_target'), 'err');
  $('seed-accts').innerHTML = `<div class="muted xs">${t('seed_finding')}</div>`;
  try {
    const r = await window.api.seedFind(mn, kind, net, target, 40);
    if (r.found) {
      seedRowsHtml = `<div class="seedrow"><div class="sr-acc">✅ <b>${METHOD_TAG[r.method] || 'EVM'} · #${r.index}</b> <span class="mono">${r.id.slice(0, 14)}…${r.id.slice(-6)}</span></div><button class="tiny seed-imp" data-idx="${r.index}" data-method="${r.method}">${t('import_this')}</button></div>`;
      $('seed-accts').innerHTML = seedRowsHtml; wireSeedRows();
    } else { $('seed-accts').innerHTML = `<div class="muted xs">${tr('seed_notfound', { n: r.scanned })}</div>`; }
  } catch (e) { $('seed-accts').innerHTML = ''; msg($('imp-msg'), 'Error: ' + e.message, 'err'); }
};
document.querySelectorAll('.tab').forEach(t => t.onclick = () => { document.querySelectorAll('.tab').forEach(x => x.classList.remove('on')); t.classList.add('on'); $('tab-mn').hidden = t.dataset.tab !== 'mn'; $('tab-pk').hidden = t.dataset.tab !== 'pk'; });
$('btn-do-import').onclick = async () => { const label = $('imp-label').value.trim(); const { kind, net } = parseNet($('imp-net').value); const mnMode = document.querySelector('.tab.on').dataset.tab === 'mn'; try { msg($('imp-msg'), t('importing')); const v = mnMode ? await window.api.importMnemonic(label, $('imp-mn').value, kind, net) : await window.api.importPrivkey(label, kind, net, $('imp-pk').value); $('modal-import').hidden = true; $('imp-mn').value = ''; $('imp-pk').value = ''; $('imp-label').value = ''; applyView(v); nav('dashboard'); } catch (e) { msg($('imp-msg'), 'Error: ' + e.message, 'err'); } };

// EXPORTAR
let expChain = null, expWid = null;
function openExport(wid, chain) { expWid = wid; expChain = chain; $('exp-chain').textContent = chain === 'kda' ? 'KDA' : 'EVM'; $('exp-chain').className = 'chip ' + (chain === 'kda' ? 'kda' : 'eth'); $('exp-pass').value = ''; $('exp-out').hidden = true; $('exp-secret').textContent = ''; msg($('exp-msg'), ''); $('modal-export').hidden = false; }
$('btn-sec-export').onclick = () => { const w = WALLETS.find(x => x.id === $('sec-wallet').value); if (!w) return; openExport(w.id, w.kind === 'kda' ? 'kda' : 'eth'); };
$('btn-do-export').onclick = async () => { try { const r = await window.api.exportKey($('exp-pass').value, expWid, expChain); $('exp-secret').textContent = r.secret; $('exp-out').hidden = false; msg($('exp-msg'), t('exp_revealed'), 'ok'); } catch (e) { msg($('exp-msg'), e.message, 'err'); } };

// borrar wallet: paso 1 (consejo semilla) → paso 2 (última confirmación) → borrar
$('btn-del-next').onclick = () => { $('del-step1').hidden = true; $('del-step2').hidden = false; };
$('btn-del-do').onclick = async () => {
  try { applyView(await window.api.walletRemove(window._delId)); $('modal-del').hidden = true; msg($('wallet-msg'), t('wallet_deleted'), 'ok'); }
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
    const b = document.createElement('button'); b.type = 'button'; b.className = 'eye'; b.title = t('ttl_eye'); b.innerHTML = EYE;
    b.onclick = () => { const show = inp.type === 'password'; inp.type = show ? 'text' : 'password'; b.innerHTML = show ? EYE_OFF : EYE; inp.focus(); };
    wrap.appendChild(b);
  });
}
initEyes();

// ===== Toast breve =====
function toast(text, ms) { const el = $('toast'); if (!el) return; el.textContent = text; el.hidden = false; el.classList.add('show'); clearTimeout(el._t); el._t = setTimeout(() => { el.classList.remove('show'); setTimeout(() => { el.hidden = true; }, 300); }, ms || 4500); }

// ===== Idea 15: etiqueta + nota por wallet =====
function wTagBadge(id) { const m = (CFG && CFG.walletMeta && CFG.walletMeta[id]) || {}; if (m.tag === 'fria') return `<span class="wtag cold">${t('tag_cold')}</span>`; if (m.tag === 'caliente') return `<span class="wtag hot">${t('tag_hot')}</span>`; return ''; }
function wNote(id) { const m = (CFG && CFG.walletMeta && CFG.walletMeta[id]) || {}; return m.note ? ` · <span class="wnote">📝 ${esc(m.note)}</span>` : ''; }

// ===== Copia de seguridad cifrada portable (contraseña dedicada) =====
// Medidor simple de fortaleza: longitud + variedad de tipos de carácter.
function pwStrength(p) {
  p = String(p || '');
  let score = 0;
  if (p.length >= 10) score++; if (p.length >= 14) score++; if (p.length >= 20) score++;
  if (/[a-z]/.test(p) && /[A-Z]/.test(p)) score++;
  if (/[0-9]/.test(p)) score++; if (/[^a-zA-Z0-9]/.test(p)) score++;
  if (p.length < 10) return { txt: t('pw_short'), color: '#c0392b' };
  if (score <= 2) return { txt: t('pw_weak'), color: '#c0392b' };
  if (score <= 4) return { txt: t('pw_ok'), color: '#b8860b' };
  return { txt: t('pw_strong'), color: '#2e8b3e' };
}
if ($('bk-pass')) $('bk-pass').oninput = () => { const s = pwStrength($('bk-pass').value); const el = $('bk-strength'); el.textContent = $('bk-pass').value ? s.txt : ''; el.style.color = s.color; };
$('btn-backup').onclick = async () => {
  const p = $('bk-pass').value, p2 = $('bk-pass2').value;
  if (p.length < 10) return msg($('backup-msg'), t('bk_short'), 'err');
  if (p !== p2) return msg($('backup-msg'), t('bk_mismatch'), 'err');
  msg($('backup-msg'), t('bk_working'));
  try {
    const r = await window.api.backupExport(p);
    if (r.ok) { msg($('backup-msg'), t('backup_ok').replace('{path}', r.path), 'ok'); $('bk-pass').value = ''; $('bk-pass2').value = ''; $('bk-strength').textContent = ''; }
    else msg($('backup-msg'), '', '');
  } catch (e) { msg($('backup-msg'), 'Error: ' + e.message, 'err'); }
};
$('btn-restore').onclick = async () => {
  const p = $('restore-pass').value;
  if (!p) return msg($('restore-msg'), t('restore_need_pass'), 'err');
  msg($('restore-msg'), t('bk_working'));
  try {
    const r = await window.api.backupImport(p);
    if (r.ok) { msg($('restore-msg'), (r.mode === 'merge' ? t('restore_merged').replace('{n}', r.added) : t('restore_ok')), 'ok'); setTimeout(() => location.reload(), 1500); }
    else msg($('restore-msg'), '', '');
  } catch (e) { msg($('restore-msg'), 'Error: ' + e.message, 'err'); }
};
// Restaurar desde la pantalla de arranque (recuperación en un equipo nuevo, sin bóveda).
async function restoreFromAuth(passId, msgId) {
  const p = $(passId).value;
  if (!p) return msg($(msgId), t('restore_need_pass'), 'err');
  msg($(msgId), t('bk_working'));
  try { const r = await window.api.backupImport(p); if (r.ok) location.reload(); else msg($(msgId), '', ''); }
  catch (e) { msg($(msgId), 'Error: ' + e.message, 'err'); }
}
if ($('lnk-restore-u')) $('lnk-restore-u').onclick = (e) => { e.preventDefault(); restoreFromAuth('unlock-pass', 'unlock-msg'); };
if ($('lnk-restore-s')) $('lnk-restore-s').onclick = (e) => { e.preventDefault(); restoreFromAuth('setup-pass', 'setup-msg'); };

// ===== Idea 14: bienvenida la primera vez =====
function maybeWelcome() { if (!localStorage.getItem('koberlet-welcomed')) { $('modal-welcome').hidden = false; } }
$('btn-welcome-ok').onclick = () => { localStorage.setItem('koberlet-welcomed', '1'); $('modal-welcome').hidden = true; };

// ===== Idea 1: Libreta de direcciones =====
function abKind(a) { return /^0x/i.test(a) ? 'evm' : 'kda'; }
function renderAddressBook() {
  if (!CFG || !$('ab-list')) return;
  const ab = CFG.addressBook || [];
  $('ab-list').innerHTML = ab.length ? ab.map((e, i) => `<div class="abrow"><span class="abtag ${e.kind}">${e.kind === 'kda' ? 'KDA' : 'EVM'}</span><b>${esc(e.alias)}</b> <span class="mono abaddr">${esc(shortAddr(e.address))}</span><button class="copy ab-del" data-i="${i}" title="Borrar">🗑</button></div>`).join('') : `<div class="muted xs">—</div>`;
  $('ab-list').querySelectorAll('.ab-del').forEach(b => b.onclick = async () => { CFG.addressBook.splice(Number(b.dataset.i), 1); await window.api.setConfig(CFG); renderAddressBook(); });
  const opt = arr => arr.map(e => `<option value="${esc(e.address)}" label="${esc(e.alias)}">`).join('');
  if ($('dl-kda')) $('dl-kda').innerHTML = opt(ab.filter(e => e.kind === 'kda'));
  if ($('dl-evm')) $('dl-evm').innerHTML = opt(ab.filter(e => e.kind === 'evm'));
}
$('ab-save').onclick = async () => {
  const alias = $('ab-alias').value.trim(), addr = $('ab-addr').value.trim();
  // KDA: se pregunta al proceso principal para usar el MISMO validador que el envio
  // (lib/kda.js). Antes solo se admitian k:, asi que no se podia guardar en la agenda
  // una gasolinera c:, un keyset r: ni una cuenta antigua con nombre.
  const okAddr = /^0x[0-9a-fA-F]{40}$/.test(addr)
    ? true
    : await window.api.kdaValidar(addr);
  if (!alias || !okAddr) return msg($('ab-msg'), t('ab_bad'), 'err');
  CFG.addressBook = CFG.addressBook || [];
  CFG.addressBook.push({ alias, address: addr, kind: abKind(addr) });
  await window.api.setConfig(CFG);
  $('ab-alias').value = ''; $('ab-addr').value = ''; msg($('ab-msg'), t('ab_saved'), 'ok'); renderAddressBook();
};

// ===== Idea 4: Exportar historial a CSV =====
$('hist-csv').onclick = async () => {
  const list = window._histList || [];
  if (!list.length) return msg($('wallet-msg'), t('csv_empty'), 'err');
  const rows = list.map(h => ({
    fecha: new Date(h.ts).toLocaleString(LNG === 'en' ? 'en-GB' : 'es-ES'),
    tipo: h.dir ? (h.dir === 'in' ? t('hist_in') : t('hist_out')) : (h.kind || h.type || ''),
    desc: h.dir ? `${h.amt} ${h.tok}` : (h.title || ''),
    other: h.other || h.wlabel || '', chain: h.chain != null ? h.chain : '', id: h.id || ''
  }));
  try { const r = await window.api.exportHistory(rows, 'koberlet-historial.csv'); if (r.ok) msg($('wallet-msg'), t('csv_ok'), 'ok'); } catch (e) { msg($('wallet-msg'), e.message, 'err'); }
};

// M-2: avisar al main de actividad del usuario (throttle 15s) para reiniciar el auto-bloqueo,
// y reaccionar al bloqueo automático volviendo a la pantalla de desbloqueo.
let _lastPing = 0;
function pingActivity() { const now = Date.now(); if (now - _lastPing > 15000) { _lastPing = now; try { window.api.pingActivity(); } catch (_) {} } }
['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach(ev => window.addEventListener(ev, pingActivity, { passive: true }));
window.api.onLocked(() => { location.reload(); });
// Progreso del envío cross-chain (dos pasos + SPV): se muestra en la barra de estado
if (window.api.onXchainProgress) window.api.onXchainProgress((m) => msg($('wallet-msg'), m));

boot();

    // ===== Enviar una pieza a otra wallet =====
    // El destino se pide en la propia tarjeta y, antes de pedir la contraseña, se
    // SIMULA en el nodo: muchas piezas con royalty se acuñan «sale-only» y el
    // contrato no deja transferirlas (ni al creador). Mejor avisar con claridad
    // que soltar el error crudo del contrato cuando ya has firmado.
    window.nftAbrirEnvio = function (indice) {
        const zona = document.getElementById('nft-env-' + indice);
        if (!zona) return;
        zona.hidden = !zona.hidden;
        // Con el formulario abierto sobran dos botones «Enviar» seguidos: el de arriba
        // pasa a ser el de cerrar, y el de dentro es el que envía de verdad.
        const abrir = zona.parentElement.querySelector('.nft-env-btn');
        if (abrir) abrir.textContent = zona.hidden ? t('nft_enviar') : t('cancel');
        if (!zona.hidden) zona.querySelector('input').focus();
    };

    window.nftEnviarPieza = async function (indice) {
        const p = NFT_CACHE[indice];
        const zona = document.getElementById('nft-env-' + indice);
        if (!p || !zona) return;
        const destino = zona.querySelector('input').value.trim();
        const aviso = zona.querySelector('.nft-env-msg');
        const walletId = $('nft-wallet').value, redKey = $('nft-red').value;

        // Aqui SI tiene que ser k: y no es un capricho: el ledger usa transfer-create y
        // monta el keyset del destino con su clave publica, que solo lleva dentro una k:.
        // Una c:/r:/w: no tiene clave que meter ahi. El hex puede venir en mayusculas.
        if (!/^k:[0-9a-fA-F]{64}$/.test(destino)) { aviso.textContent = t('nft_env_malacuenta'); return; }
        aviso.textContent = t('nft_env_comprobando');

        let veredicto;
        try {
            veredicto = await window.api.nftComprobar({ walletId, redKey, id: p.id, destino });
        } catch (e) { aviso.textContent = '⚠️ ' + cleanErr(e); return; }

        if (!veredicto.puede) {
            aviso.innerHTML = veredicto.motivo === 'sale-only'
                ? `<div class="warn">${t('nft_env_saleonly')}</div>`
                : `<div class="warn">${esc(veredicto.mensaje || '')}</div>`;
            return;
        }

        aviso.textContent = '';
        askSend(tr('nft_env_conf', { n: esc(p.nombre), to: esc(destino) }), async (pass) => {
            const r = await window.api.nftEnviar({ walletId, redKey, id: p.id, destino, passphrase: pass });
            // pollResult devuelve la entrada del /poll: { reqKey, result: { status, ... } }.
            // OJO: el estado va DENTRO de .result, no en la raiz (ese era el fallo de antes,
            // que serializaba un error vacio "{}" y daba por fallado cualquier envio bueno).
            const rr = (r.resultado && r.resultado.result) || null;
            // Si el poll aun no ve el bloque (rr null) la tx esta en vuelo, no fallada:
            // minar tarda ~30 s. Solo cortamos cuando la cadena dice "failure" de verdad.
            if (rr && rr.status === 'failure') {
                const m = (rr.error && (rr.error.message || rr.error)) || 'la cadena rechazo el envio';
                throw new Error(String(m).slice(0, 240));
            }
            zona.hidden = true;
            setTimeout(nftCargar, 1500);
            return tr('nft_env_ok', { n: p.nombre });   // «X» enviada
        }, destino, { ledger: false });
    };
