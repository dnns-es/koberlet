# Auditoría de seguridad y calidad — Koberlet

**Fecha:** 2026-07-13
**Auditor:** Claude (skill protocolo-auditoria-dnns)
**Alcance:** cliente de escritorio Electron multi-cadena (Kadena + EVM). Proceso principal (`main.js`), `preload.js`, `lib/*` (vault, kda, eth, swap, bridge, ethswap, wallets), `renderer/*`, build y dependencias. **No hay backend/BD/servidor** → se saltan las categorías de servidor (WebDAV, IMAP, rate-limiting web, RGPD de servidor, backups de servidor, headers HTTP, operativa SSH).
**Contexto:** auditoría posterior a las correcciones de la auditoría externa de Alex (v1.7.0). Se verifica que esos 8 fixes aguantan y se buscan hallazgos nuevos.

> **RESOLUCIÓN (v1.7.1):** M-1, M-2, L-1 y L-2 **corregidos y probados** (bóveda con test de round-trip). L-3 (code-signing) queda pendiente de certificado. Guardas de navegación y auto-bloqueo (10 min por defecto, configurable en Ajustes) añadidos; etiquetas de wallet y destinatarios escapados; la passphrase ya no se retiene en claro (la sesión guarda la clave derivada).

## Resumen ejecutivo

Koberlet está **sólido**. La arquitectura de confianza es correcta (claves solo en el proceso principal, `contextIsolation`, re-autenticación en cada firma, bóveda AES-256-GCM bien hecha) y **los 8 arreglos de la auditoría de Alex están presentes y bien implementados** (verificados uno a uno abajo). No hay ningún hallazgo crítico ni alto. Lo que queda son **2 medios y 3 bajos de endurecimiento** (defense-in-depth), ninguno explotable de forma directa por un tercero: la app puede abrirse a más gente, y estos puntos se pueden ir cerrando en paralelo.

| Gravedad | Cantidad | Categorías afectadas |
|---|---|---|
| 🔴 Crítico | 0 | — |
| 🟠 Alto | 0 | — |
| 🟡 Medio | 2 | Endurecimiento Electron, Exposición de secretos en RAM |
| 🟢 Bajo | 3 | XSS auto-infligido (CSP-acotado), secreto en memoria, firma de build |

## Verificación de los fixes de Alex (v1.7.0) — todos aguantan

| # | Hallazgo Alex | Estado verificado |
|---|---|---|
| 1 | Auto-update sin verificar (RCE) | ✅ `main.js:554+` fija origen a `descargas.dnns.es`, recomputa sha256, verifica firma Ed25519 con `UPDATE_PUBKEY` y **falla cerrado** sin `sig` |
| 2 | Electron desactualizado | ✅ Electron **43.1.0** en el portable; `npm audit` = **0 vulnerabilidades**; `electron-builder` eliminado |
| 3 | XSS del indexador en `innerHTML` | ✅ `renderer/app.js:481` escapa amt/tok/other/chain/id/title/sub; importes/chain a `Number` |
| 4 | `config:set` repunta endpoints de firma | ✅ `loadConfig` reconstruye kda/evm/bridge desde DEFAULT; solo respeta `enabled` y `rpc` https |
| 5 | Destinatario sin validar en Pact | ✅ `lib/kda.js` `assertKdaAccount` + `lib/swap.js` valida `k:<64hex>` antes de interpolar |
| 6 | Comparación de passphrase no constante | ✅ `main.js:passOk` usa `crypto.timingSafeEqual` (ver residual L-2) |
| 7 | KDF sin suelo al abrir | ✅ `lib/vault.js` rechaza `N<2^14` / `r<8` / `p<1` |
| 8 | Importe distinto en cap vs code | ✅ `lib/kda.js` `canonDecimal` usado en `code` y `clist` |

## 🟡 Findings medios

### M-1 — La ventana no bloquea navegación ni apertura de ventanas nuevas

- **Categoría:** Endurecimiento Electron (checklist cliente Electron).
- **Fichero / línea:** `main.js:169-176` (`createWindow`). No hay `setWindowOpenHandler` ni manejador `will-navigate`/`will-redirect` en `win.webContents`.
- **Impacto:** por defecto, cualquier navegación del marco principal (un enlace, un `window.open`, o contenido inyectado que no dependa de ejecutar JS) puede **sacar la ventana de la app y cargar una web remota dentro del propio Electron**. La CSP y `contextIsolation` acotan mucho el riesgo (el XSS del indexador ya está tapado, y `script-src 'self'` impide ejecutar JS inyectado), pero en una wallet la práctica estándar es **denegar toda navegación** y forzar que los enlaces externos abran en el navegador del sistema. Es barato y elimina toda una clase de ataques de phishing/redirección de un plumazo.
- **Fix propuesto:**

```js
// en createWindow, tras crear win:
win.webContents.setWindowOpenHandler(({ url }) => {
  if (/^https:\/\//.test(url)) shell.openExternal(url);
  return { action: 'deny' };            // nunca abrir ventanas Electron nuevas
});
win.webContents.on('will-navigate', (e, url) => {
  const here = 'file://';
  if (!url.startsWith(here)) { e.preventDefault(); if (/^https:\/\//.test(url)) shell.openExternal(url); }
});
```

- **Prioridad:** antes de abrir a público. No urgente hoy (no hay vector activo tras el fix de XSS), pero es endurecimiento de manual.

### M-2 — Sin auto-bloqueo por inactividad: las claves descifradas viven en RAM mientras la app está abierta

- **Categoría:** Exposición de secretos en memoria.
- **Fichero / línea:** `main.js:65` (`let unlocked = ...`). Solo se limpia con el botón "Bloquear" o al cerrar la ventana (`window-all-closed`). No hay temporizador de inactividad.
- **Impacto:** tras desbloquear, las semillas/claves privadas quedan en memoria del proceso principal **indefinidamente** mientras la app siga abierta. Si el usuario deja el equipo desatendido con Koberlet abierto, cualquiera con acceso físico opera la wallet sin la contraseña. Además, choca con la norma propia DNNS (`feedback_secretos_cifrados_ram`: secretos en RAM máx. ~5 min). El botón manual existe, pero un **auto-bloqueo por inactividad** (5-10 min) es lo esperable en un monedero.
- **Fix propuesto:** temporizador en el main que ponga `unlocked = null` y avise al renderer para volver a la pantalla de desbloqueo; resetearlo en cada IPC de actividad. ~15 líneas, opcionalmente configurable en Ajustes.
- **Prioridad:** antes de abrir a público.

## 🟢 Findings bajos / mejoras opcionales

### L-1 — Etiqueta de wallet (y destinatario en el modal) sin escapar en `innerHTML`

- **Categoría:** Inyección (XSS auto-infligido, acotado por CSP).
- **Fichero / línea:** `renderer/app.js:399` (`${bl.walletLabel}`), también en desplegables/listas (`w.label` en `:189,190,288,321,358,359,493`) y el resumen de envío (`:249`, `to`/`symbol`).
- **Impacto:** el nombre de wallet lo teclea el propio usuario; si mete `<img src=x ...>` se inyecta HTML en su propia UI. **No ejecuta JS** (CSP `script-src 'self'` bloquea `onerror`/inline), así que no hay robo de claves; el peor caso es romper el layout o colar un elemento en su propia vista. Riesgo real bajo (uno se ataca a sí mismo), pero conviene escapar por higiene y para cerrar la clase por completo, igual que se hizo con el historial (fix #3 de Alex).
- **Fix propuesto:** reutilizar el helper `esc()` que ya existe en `refreshHistory` (extraerlo a util) y envolver `bl.walletLabel`, `w.label` y el `to`/`symbol` del modal de confirmación.

### L-2 — La passphrase se guarda en claro en memoria para las re-comprobaciones

- **Categoría:** Exposición de secretos.
- **Fichero / línea:** `main.js` `unlocked.pass` (la usa `passOk`).
- **Impacto:** el fix #6 de Alex resolvió la comparación en tiempo constante, pero se sigue guardando la contraseña en texto en RAM para poder compararla en cada firma. La propia recomendación de Alex era ir un paso más: no retener la passphrase en claro, sino **re-derivar la clave de la bóveda** para autorizar (o guardar solo un hash de la passphrase). Impacto bajo (requiere volcado de memoria del proceso; las claves ya están en RAM de todos modos), pero elimina un secreto redundante en memoria.
- **Fix propuesto:** sustituir `unlocked.pass` por `unlocked.passHash` (p.ej. scrypt/sha-256 con sal de sesión) y comparar contra el hash en `passOk`.

### L-3 — Build sin firmar (code-signing)

- **Categoría:** Integridad de distribución. (= #9 de Alex, ya conocido.)
- **Impacto:** el ejecutable/instalador no está firmado → fricción de SmartScreen y sin gate de autenticidad del SO en la descarga inicial. El auto-update ya va firmado (Ed25519), así que el riesgo continuo está cubierto; esto afecta solo al arranque inicial.
- **Fix propuesto:** firmar el artefacto cuando haya certificado (pendiente de adquirir). Sin acción inmediata.

## Categorías sin findings (revisadas)

- **Bóveda / cifrado (Cat. 5):** AES-256-GCM con sal(16)+IV(12) aleatorios por escritura, auth-tag verificado, scrypt N=2^15, `key.fill(0)`, fichero `0600`, suelo KDF al leer. Impecable.
- **Autorización IPC (Cat. 2):** todos los handlers que mueven valor o exportan secretos (`wallet:export`, `send:kda`, `send:evm`, `bridge:send`, `swap:exec`, `ethswap:exec`) comprueban `unlocked` **y** `passOk(passphrase)` antes de firmar. `view()` solo expone campos públicos (cuenta/dirección), nunca `.secret`. La clave privada solo sale del main por `wallet:export`, con contraseña.
- **Inyección Pact (Cat. 3):** destinatarios KDA validados; `bridge.js` ya validaba con rigor; swap valida `k:`. Sin SQL/shell (no aplica).
- **Superficie renderer↔main:** `preload.js` expone una API acotada por `contextBridge`; el renderer nunca recibe `ipcRenderer` crudo. Sin `<webview>`, sin `nodeIntegration`, sin `webSecurity:false`.
- **Enlaces externos:** `open:external` restringido a `https://`.
- **Logs (Cat. 9):** ningún `console.log`/history escribe secretos (verificado por grep). `history.json` solo guarda desc/to/id públicos.
- **Dependencias (Cat. 12):** `npm audit` = 0; `package-lock.json` comiteado; deps de crypto (ethers, tweetnacl, blakejs, @kadena) sin advisories.

## Plan de implementación sugerido

1. **Antes de abrir a público** — M-1 (guardas de navegación) y M-2 (auto-bloqueo). Son ~30 líneas entre las dos y elevan el listón de una wallet a estándar.
2. **Higiene, cuando toque** — L-1 (escapar labels) y L-2 (no retener passphrase en claro).
3. **Cuando haya certificado** — L-3 (firma del ejecutable).

Todo esto viaja por auto-update firmado (es código en `resources/app`), salvo que se cambie algo del binario Electron.

## Nota para Antonio (lenguaje llano)

> Koberlet está bien, Antonio — mejor que bien. Todo lo que encontró Alex está tapado y bien tapado, lo he comprobado línea a línea. No hay nada grave ni urgente. Lo que queda son cinco mejoras de "cinturón y tirantes", y las dos que yo haría antes de dárselo a más gente son:
>
> 1. **Cerrarle la puerta a que la ventana se vaya a una web de fuera.** Ahora mismo, si por lo que fuera se colara un enlace, la app podría navegar a otra página dentro de su propia ventana. No hay forma activa de que pase (ya tapamos el agujero del historial), pero en un monedero se bloquea por norma. Son cuatro líneas.
> 2. **Que se bloquee sola si te levantas.** Cuando abres la wallet con tu contraseña, las claves se quedan "calientes" en memoria mientras la tengas abierta. Si dejas el ordenador sin bloquear, alguien podría operar sin la contraseña. Lo suyo es que a los 5-10 minutos sin tocarla se bloquee sola (además es lo que tú mismo tienes como norma para los secretos). El botón de bloquear ya está; falta el automático.
>
> Las otras tres son menores: escapar los nombres de las wallets (por si alguien se pone un nombre raro, se ataca solo a sí mismo, riesgo casi nulo), no guardar la contraseña en memoria más de lo necesario, y firmar el ejecutable cuando tengamos certificado. Nada corre prisa.
>
> Resumen: apto para abrir a público; yo metería los dos "medios" antes y el resto lo vamos puliendo.

## Apéndice: comandos clave ejecutados

```bash
grep -n "webPreferences|contextIsolation|nodeIntegration|setWindowOpenHandler|will-navigate" main.js
grep -n "ipcMain.handle" main.js            # mapa de la superficie IPC
grep -n "secret" main.js                    # rastreo de fugas de clave privada
grep -n "innerHTML" renderer/app.js         # sinks de DOM y su origen
grep -rn "console.log|console.error" main.js lib/ | grep -iE "secret|priv|pass|seed"
npm audit                                    # 0 vulnerabilidades
```
