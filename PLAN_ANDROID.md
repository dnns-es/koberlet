# Koberlet Android — plan de portado por fases

Fecha: 2026-08-27 · Base: Koberlet v2.7.11 (Electron, ~5.700 líneas)
Objetivo: app Android nativa-instalable con el mismo núcleo cripto, **sin bajar el listón de seguridad**.

---

## Decisión de arquitectura

**Capacitor** (WebView + plugins nativos Kotlin), no React Native ni Kotlin puro.

Motivo: todo el núcleo cripto ya es JavaScript puro y se reaprovecha entero
(`tweetnacl`, `blakejs`, `ethers v6`, `@kadena/hd-wallet`, `@kadena/cryptography-utils`).
La UI (`renderer/`, 2.700 líneas) también se reaprovecha. Lo único que se reescribe
de verdad es la capa que hoy da Electron.

### El punto crítico: dónde vive la clave privada

Hoy en Electron hay dos procesos: las privadas viven en `main.js` y el `renderer` **nunca**
las ve (contextIsolation + preload acotado). En Capacitor el renderer y la lógica JS son el
**mismo WebView** — si se porta tal cual, ese aislamiento desaparece.

Y el riesgo no es teórico: `renderer/app.js` pinta datos remotos (metadatos de NFT, nombres
de token, respuestas de la API). Un XSS ahí, hoy, no llega a las claves; en un WebView plano, sí.

**Por eso la bóveda y la firma van en un plugin Kotlin desde el principio**, no "ya lo moveremos".
El plugin sustituye al proceso principal: recibe la operación, firma dentro y devuelve solo la firma.

```
WebView (renderer + lib/*.js)  ──►  Plugin Kotlin "KoberletVault"  ──►  Android Keystore
   nunca ve claves                     descifra, firma, borra
```

---

## Fase 0 — Verificación previa (1 día)

Antes de escribir nada. Tres cosas pueden hundir el plan y hay que comprobarlas ya:

1. **`@kadena/hd-wallet` en WebView.** Verificar que no depende de `node:crypto` ni de WASM
   que Android bloquee. Si depende, alternativa: derivación BIP44/SLIP-0010 con `@noble/*`
   (el método `ecko` de `lib/wallets.js` ya va por ahí).
2. **CORS.** En Electron el `fetch` sale desde contexto Node, sin CORS. En un WebView, `fetch`
   contra `api.chainweb.com` / RPC EVM lo bloquea el navegador. Solución: `CapacitorHttp`
   (HTTP nativo, sin CORS) parcheando `fetch` globalmente. Probar con una llamada real a
   `/local (coin.get-balance)`.
3. **`Buffer`.** Lo usan 8 ficheros de `lib/`. Se resuelve con el polyfill `buffer` en el
   bundler (Vite), pero hay que confirmar que `tweetnacl` y `blakejs` van finos con él.

**Decisión de negocio que hay que tomar aquí:** ¿distribución por **APK propio** en
descargas.dnns.es (como el resto del ecosistema, control total, con la fricción del sideload)
o **Google Play**? Play permite monederos no custodios pero exige declaración de producto
financiero y revisión; además el auto-update propio deja de valer. Mi recomendación: APK
propio para la v1, Play más adelante si interesa.

Salida: informe de 1 página con los 3 puntos verificados o con plan B para el que falle.

---

## Fase 1 — Esqueleto y capa de red (2 días)

- Proyecto Capacitor + Vite, `renderer/` como raíz web.
- Shim de `fetch` sobre `CapacitorHttp` para toda la app.
- Polyfill de `Buffer`.
- `lib/nft.js`: quitar `require('https')`/`require('http')` y pasar a `fetch`
  (es el único fichero con HTTP a mano).
- CSP estricta equivalente a la de escritorio.
- **Hito verificable:** la app arranca en el móvil y lee un saldo KDA real de mainnet.

---

## Fase 2 — Bóveda nativa (3 días) — el corazón

Plugin Kotlin `KoberletVault`, equivalente a `lib/vault.js`:

- AES-256-GCM + scrypt (N=2^15, r=8, p=1) — **mismo formato de fichero `vault.json`**,
  para que una copia de escritorio se pueda restaurar en el móvil y al revés.
- Fichero en almacenamiento interno de la app (no accesible a otras apps, sin backup de Google).
- Clave derivada retenida en memoria nativa mientras la sesión está abierta; bloqueo por
  inactividad igual que hoy (5 min).
- **Biometría opcional**: huella/cara para desbloquear, con la clave envuelta en Android
  Keystore. La passphrase sigue siendo la fuente de verdad; la biometría es solo un atajo.
- El WebView solo puede pedir: crear, desbloquear, bloquear, estado, listar cuentas
  (públicas), exportar (con passphrase). **Nunca** "dame la privada" sin passphrase explícita.

Aviso: scrypt N=2^15 en un móvil de gama media tarda **2-4 segundos**. Es aceptable y es el
precio de la seguridad — pero hay que enseñarlo en la UI con un indicador, no dejar la
pantalla congelada.

**Hito verificable:** crear bóveda, cerrar app, reabrir, desbloquear, y restaurar en el móvil
una copia exportada desde el escritorio.

---

## Fase 3 — Firma y envío (2 días)

- Firma ed25519 (KDA) y secp256k1 (EVM) **dentro del plugin**, no en el WebView.
- El WebView manda: `{ walletId, payloadHash, tipo }` → plugin devuelve firma.
- Portar `send:kda`, `send:kdatoken`, `send:evm` sobre ese esquema.
- Cross-chain (`send:kda-xchain`, `send:kda-smart`) con su barra de progreso.

**Hito verificable:** envío real de una cantidad mínima en mainnet, KDA y EVM.

---

## Fase 4 — UI móvil (2 días)

- Adaptar `renderer/styles.css` (438 líneas) a pantalla estrecha. El tema Sunset Ride se queda.
- Objetivos táctiles, teclado numérico en importes, scroll en las tarjetas.
- **Escáner QR con la cámara** para pegar direcciones — esto en el móvil es la mejora grande
  frente al escritorio, y es un plugin estándar de Capacitor.
- Compartir dirección con el share nativo de Android.

**Hito verificable:** uso completo de la app con una sola mano.

---

## Fase 5 — El resto de funciones (3-4 días)

Por orden de valor, y se puede cortar por donde haga falta:

1. Historial y precios (fácil, solo lectura).
2. Multi-wallet: crear, importar semilla/privada, renombrar, ocultar.
3. Copia de seguridad exportar/importar → sustituir los `dialog.showSaveDialog` de Electron
   por el selector de ficheros de Android (SAF).
4. NFT (listar, comprobar, enviar).
5. Swaps (`swap`, `ethswap`, `evmswap`) y puente Kinesis (`bridge`).

**Ledger queda fuera de la v1.** `@ledgerhq/hw-transport-node-hid` no existe en móvil; habría
que ir a BLE (`react-native-hw-transport-ble`) o USB-OTG. Es un proyecto aparte.

---

## Fase 6 — Distribución (1-2 días)

- Firma del APK con clave propia (**la clave de firma, guardada como cualquier otro secreto
  DNNS — no en el repo**).
- Publicación en descargas.dnns.es con el auto-update propio (mismo patrón que el resto).
- Comprobación de actualización dentro de la app, avisando al usuario (Android no permite
  auto-instalar sin permiso explícito).

---

## Fase 7 — Auditoría (2 días)

Protocolo de auditoría DNNS aplicado a lo específico de móvil:

- ¿Sale alguna privada del plugin en algún camino?
- ¿Queda algo sensible en logs de Android, en el portapapeles, o en la captura de la app
  al pasar a segundo plano (`FLAG_SECURE`)?
- Backup de Google Drive desactivado para los datos de la app.
- Root detection: al menos avisar, no bloquear.
- Repasar el XSS de `renderer/app.js` con datos remotos — ahora con la mitigación de que
  las claves están fuera del WebView.

---

## Resumen

| Fase | Qué | Días |
|---|---|---|
| 0 | Verificación previa + decisión de distribución | 1 |
| 1 | Esqueleto Capacitor + red | 2 |
| 2 | **Bóveda nativa Kotlin** | 3 |
| 3 | Firma y envío | 2 |
| 4 | UI móvil + QR cámara | 2 |
| 5 | Resto de funciones | 3-4 |
| 6 | Distribución | 1-2 |
| 7 | Auditoría | 2 |

**Total: 16-18 días de trabajo.** Una **v1 usable** (fases 0-4: ver saldos, enviar KDA y EVM,
QR) sale en **10 días**.

Las fases 0 a 3 son secuenciales y no se pueden saltar. De la 5 en adelante se puede cortar
por donde convenga y publicar.
