# Auditoría de seguridad y calidad — Koberlet

**Fecha:** 2026-08-11
**Versión auditada:** v2.7.4 (commit 11d908e)
**Auditor:** auditoría interna DNNS (protocolo de auditoría DNNS)
**Alcance:** app de escritorio Electron (main + preload + renderer), librerías `lib/*`, canal de
distribución y auto-update. Foco en lo **no cubierto** por las revisiones anteriores (externa
sobre v1.16.5/v2.0.0 y auditoría interna 2026-07-13): `lib/nft.js`, `lib/backup.js`, tokens
fungibles KDA en `lib/kda.js`, envío de piezas, mercado, el apartado nuevo de compartir
instalador y la distribución.
**Contexto:** el instalador se acaba de repartir en el grupo de Telegram de KDA → usuarios
reales con fondos reales.

> **RESOLUCIÓN (comprobada el 2026-09-10 sobre la v2.8.3).** A-1 corregido: `publicar.sh` firma
> Ed25519 el instalador completo además del paquete de auto-update, y publica los dos sha256.
> A-2 corregido (todo campo remoto pasa por `esc()`). A-3 corregido: fuera los `axios` con
> vulnerabilidades altas; `npm audit --omit=dev` solo deja 9 bajas. F-1 corregido (los botones
> se enganchan por JS, no con `onclick=` en línea). M-1 corregido (`MAX_SALTOS = 3` y se rechaza
> el salto de https a http). M-3 corregido (las comillas de la ruta se escapan antes de ir a
> PowerShell). B-1 corregido (techo `N <= 2^20`). B-2 es informativo.
>
> **Sigue abierto M-2** (sin firma de código): requiere un certificado que aún no se ha comprado.
> Es visible para cualquiera que instale la app, porque Windows lo avisa por su cuenta.

## Resumen ejecutivo

El núcleo sigue sano: las claves privadas no salen del proceso principal, el auto-update
verifica sha256 **y** firma Ed25519 y falla cerrado, el cifrado de la bóveda y de la copia
portable es correcto, y el código Pact se ensambla con los identificadores validados por
lista blanca. No he encontrado ningún camino directo a robar fondos ni claves.

Lo que sí ha cambiado es el **contexto**: el enlace del instalador ya está repartido, y ese
instalador —a diferencia de las actualizaciones— **no lleva firma ni hash publicado**. Ese es
hoy el punto más débil de todo el conjunto, y no está en el código sino en la distribución.

Además aparece un fallo **funcional** de bulto: los botones para enviar una pieza NFT no
funcionan, porque la CSP de la app bloquea los `onclick` en línea con que están escritos.

| Gravedad | Cantidad | Categorías afectadas |
|---|---|---|
| 🔴 Crítico | 0 | — |
| 🟠 Alto | 3 | Distribución, Inyección (markup), Dependencias |
| 🟡 Medio | 3 | Contenido remoto, Distribución, Robustez |
| 🟢 Bajo | 2 | Cifrado (DoS local), Privacidad |
| ⚫ Funcional | 1 | Envío de NFT inoperativo |

---

## 🟠 Findings altos

### A-1 — El instalador completo no va firmado, y el canal ya es público

- **Categoría:** 14 (operativa / distribución)
- **Dónde:** `descargas.dnns.es/kob7t2m9x4/koberlet/koberlet_v2.7.4.zip`, `main.js:966` (la firma
  Ed25519 solo cubre el paquete de auto-update, no el instalador)
- **Impacto:** el zip que se acaba de repartir por Telegram es un ejecutable **sin firma, sin
  hash publicado y sin forma de que quien lo baje compruebe nada**. Quien consiguiera escribir
  en el servidor de descargas (o interponerse antes de que el usuario lo abra) podría sustituirlo
  por una wallet troyanizada que se lleve semillas y fondos en el primer uso, y la víctima no
  tendría ni un dato con el que darse cuenta. Hasta hoy el canal era una URL discreta; desde el
  mensaje al grupo, la ruta y el token son conocidos.
- **Fix propuesto (por orden de valor):**
  1. **Publicar el sha256 del instalador** en el propio `latest.json` (campo `urlSha256`) y, sobre
     todo, **en un sitio distinto del que sirve el zip** (el mensaje de Telegram, o el repo de
     GitHub cuando se abra). Así el canal y el testigo no dependen del mismo servidor.
  2. **Firmar el instalador con la misma clave Ed25519** que ya se usa para las actualizaciones
     (`build-app-zip.sh` ya firma: aplicar lo mismo al zip grande) y publicar `.sig` junto al zip.
  3. Que la app **enseñe el sha256 esperado** en el apartado de compartir, para que quien lo pase
     lo pueda dictar junto con el enlace.
  4. Endurecer el servidor: comprobar quién puede escribir en `/opt/descargas`, y dejar los zips
     como solo-lectura salvo durante la publicación.
- **Prioridad:** ⚠ hoy. Es lo único de este informe que afecta a gente que ya ha bajado el archivo.

### A-2 — Los metadatos de un NFT ajeno pueden inyectar HTML en la wallet

- **Categoría:** 3 (inyección)
- **Fichero / línea:** `renderer/app.js:646` y `renderer/app.js:666` (`<img src="${p.imagen}">`,
  el único dato de la tarjeta que **no** pasa por `esc()`), alimentado desde
  `lib/nft.js:105` (`data:${tipo};base64,…`, donde `tipo` es el `Content-Type` que devuelve el
  servidor remoto).
- **Impacto:** la `uri` de una pieza la fija quien la acuña, y `aHttp()` acepta `http(s)://`
  directo, así que un tercero puede servir los metadatos y la imagen desde su propio servidor.
  Si devuelve una imagen que `nativeImage` no sabe decodificar (un SVG, por ejemplo), el código
  cae al respaldo y mete su `Content-Type` **tal cual** dentro del atributo `src`. Con un
  `Content-Type: image/png" …` se cierra el atributo y se inyecta markup en la rejilla.
  Basta con **regalarle una pieza a la víctima** para que aparezca en su wallet.
  **Contenido, no crítico:** la CSP de la app (`default-src 'self'`, sin `unsafe-inline` para
  scripts) **impide ejecutar JavaScript** — lo he comprobado: los manejadores en línea no
  corren. Lo que sí queda en pie es inyectar markup y estilos (sí hay `unsafe-inline` para CSS):
  tapar la pantalla, imitar un diálogo de la propia wallet y pedir la contraseña o una semilla.
- **Fix propuesto:**

```js
// renderer/app.js — el src también se escapa
${p.imagen ? `<img src="${esc(p.imagen)}" alt="">` : …}

// lib/nft.js — y el tipo no se copia del servidor: lista blanca
const TIPOS_OK = { 'image/png': 1, 'image/jpeg': 1, 'image/webp': 1, 'image/gif': 1 };
if (!TIPOS_OK[tipo]) return null;              // lo que no sepamos pintar, no se pinta
if (!data) data = `data:${tipo};base64,${datos.toString('base64')}`;
```

- **Prioridad:** esta semana. Con las dos líneas de arriba el vector desaparece de raíz.

### A-3 — `axios` con vulnerabilidades altas, arrastrado por la librería de Ledger

- **Categoría:** 12 (dependencias)
- **Dónde:** `@ledgerhq/hw-app-eth@7.8.10` → `axios@1.13.5` (también vía `@ledgerhq/domain-service`
  y `@ledgerhq/evm-tools`). `npm audit --omit=dev`: **11 vulnerabilidades, 4 altas**.
- **Impacto:** `axios` solo entra en juego al firmar con Ledger un envío EVM, cuando
  `lib/ledger.js:109` llama a `ledgerService.resolveTransaction` (consulta el catálogo de tokens
  de Ledger para enseñar el ERC-20 en la pantalla del aparato). Los avisos son de contaminación
  de prototipo y manipulación de respuesta: para explotarlos hace falta controlar esa respuesta
  remota, así que el riesgo real es moderado — pero es código que corre en el proceso principal,
  el mismo que custodia las claves.
- **Fix propuesto:** forzar la versión parcheada sin esperar a Ledger (hay 1.19.0 publicada):

```json
// package.json
"overrides": { "axios": "^1.19.0" }
```

  Luego `npm install`, `npm audit --omit=dev` (debe quedar en 0 altas) y **probar un envío EVM
  con el Ledger** antes de publicar, que es el único camino que toca esa librería.
- **Prioridad:** esta semana.

---

## ⚫ Finding funcional (no es seguridad, pero es gordo)

### F-1 — El botón de enviar una pieza NFT no hace nada

- **Fichero / línea:** `renderer/app.js:649` y `renderer/app.js:652`
  (`onclick="nftAbrirEnvio(${i})"` / `onclick="nftEnviarPieza(${i})"`).
- **Qué pasa:** son los **dos únicos** manejadores en línea de toda la app, y la CSP declarada en
  `renderer/index.html:5` no permite scripts en línea. El navegador los descarta: pulsar no
  hace nada. Comprobado ejecutando la misma CSP contra un botón igual.
  Es decir, la función estrella de la v2.7.0 («enviar NFT desde la wallet») está muerta desde que
  se publicó. Las funciones `window.nftAbrirEnvio` / `window.nftEnviarPieza` existen y son
  correctas: solo falta engancharlas como se engancha todo lo demás.
- **Fix propuesto:** cambiar los dos botones a `data-*` y engancharlos con `addEventListener`,
  como ya se hace con `.nft-portada` y `.nft-quitar` unas líneas más abajo:

```js
<button class="ghost nft-env-btn" data-env="${i}">…</button>
…
grid.querySelectorAll('[data-env]').forEach(b => b.onclick = () => nftAbrirEnvio(Number(b.dataset.env)));
```

- **Nota:** conviene confirmarlo en la app abierta antes del fix (yo lo he verificado con la CSP
  de `index.html` en un navegador, no dentro del Electron empaquetado).

---

## 🟡 Findings medios

### M-1 — Descarga de contenido remoto sin tope de redirecciones ni control de destino

- **Fichero / línea:** `lib/nft.js:51-60` (`pedir()`)
- **Impacto:** tres cosas en la misma función: (1) las redirecciones se siguen **sin contador**,
  así que un servidor que se redirige a sí mismo deja la carga de NFT dando vueltas para siempre;
  (2) se acepta el salto de `https:` a `http:`; (3) se acepta que redirija a `127.0.0.1` o a la
  red local del usuario, con lo que la wallet hace de sonda ciega contra su propia LAN (el router,
  un panel interno) a instancias de quien acuñó la pieza.
- **Fix propuesto:** contador de saltos (máx. 3), prohibir el degradado a `http` cuando se
  empezó en `https`, y rechazar destinos privados (`127.0.0.0/8`, `10/8`, `192.168/16`,
  `172.16/12`, `169.254/16`, `::1`, `fc00::/7`).

### M-2 — Sin firma de código (SmartScreen)

- **Categoría:** 14 (operativa) — hallazgo #9 de Alex, sigue abierto a la espera del certificado.
- **Impacto:** Windows avisa de «editor desconocido» al abrir el instalador. Efecto doble: los
  usuarios se acostumbran a saltarse el aviso (justo lo contrario de lo que queremos ahora que se
  reparte por Telegram), y no hay nada que ate el binario a DNNS.
- **Fix:** certificado de firma de código (OV ≈ 200-400 €/año; EV quita el aviso desde el día uno).
  Mientras llega, A-1 (hash publicado aparte) es el sustituto razonable.

### M-3 — Comilla simple en la ruta rompe (o abusa de) el comando de actualización

- **Fichero / línea:** `main.js:1030` — `Expand-Archive -LiteralPath '${zipPath}'`
- **Impacto:** la ruta se mete entre comillas simples de PowerShell sin escapar. `zipPath` cuelga
  de `userData`, que contiene el nombre de usuario de Windows: un usuario llamado `O'Brien` haría
  fallar la actualización, y en el peor caso permitiría cerrar la cadena y añadir comandos. No lo
  controla un atacante remoto, pero es una mina para el día que aparezca.
- **Fix:** duplicar la comilla (`zipPath.replace(/'/g, "''")`) o pasar la ruta por argumento en
  vez de interpolarla en el `-Command`.

---

## 🟢 Findings bajos

### B-1 — La copia de seguridad no pone techo al coste de derivación

- **Fichero / línea:** `lib/backup.js:48` — hay suelo anti-degradación (`N >= 2^14`) pero no techo.
  Un `.kbk` manipulado con `N` enorme hace que abrirlo consuma memoria hasta que `maxmem` (512 MB)
  corta con error. Molestia local sobre un archivo propio; nada más. **Fix:** `N <= 2^20`.

### B-2 — Privacidad: a quién se le cuentan tus direcciones

- Al usar la app se consultan nodos de Kadena/EVM, CoinGecko y el catálogo de la tienda, y en esas
  peticiones viajan las direcciones y la IP del usuario. Es inevitable en una wallet ligera y no es
  un fallo, pero conviene decirlo en la sección Info: quien vaya a mover cantidades serias debe
  saber que el nodo ve su IP junto a sus cuentas.

---

## Categorías revisadas sin findings

- **Custodia de claves y límite renderer↔main:** `contextIsolation: true`, `nodeIntegration: false`
  (`main.js:235`), preload acotado, claves solo en el proceso principal. Sigue limpio.
- **Auto-update:** sha256 + firma Ed25519 verificados antes de tocar nada y **rechazo cerrado** si
  la firma falla (`main.js:1023-1026`); origen fijado a `descargas.dnns.es`; `open:external`
  restringido al canal oficial. El apartado nuevo de compartir reutiliza esa `url` ya validada, así
  que no añade superficie.
- **Cifrado:** bóveda AES-256-GCM + scrypt; copia portable `.kbk` AES-256-GCM + scrypt N=2^17 con
  etiqueta GCM comprobada, suelo anti-degradación y borrado de buffers. Correcto.
- **Inyección en código Pact:** identificadores (`ID_OK`), módulos (`MODULO_OK`) y cuentas
  (`CUENTA_OK` / `assertKdaAccount`) validados por lista blanca antes de entrar en el `code`;
  los contratos salen del catálogo del código, nunca del renderer (modelo Alex #4). Verificado
  también en `transferToken` (`lib/kda.js:101-115`) y en el envío de piezas (`lib/nft.js:_tx`).
- **Autorización de operaciones:** todo lo que firma exige la contraseña de la bóveda
  (`passOk`, comparación en tiempo constante), salvo con Ledger, donde la sustituye la confirmación
  física; el envío de NFT bloquea Ledger a propósito (firma ciega de código Pact).
- **XSS en el resto del renderer:** el texto de las piezas (nombre, colección, atributos), el
  historial, las wallets y los destinatarios pasan por `esc()`. El único hueco es A-2.
- **CSP:** `default-src 'self'; img-src 'self' data'; connect-src 'self'; form-action 'none';
  base-uri 'none'; frame-ancestors 'none'`. Bien puesta, y **comprobada en funcionamiento**
  (bloquea la ejecución de scripts en línea — de hecho, es lo que destapa F-1).
- **Copias:** la copia cifrada portable está probada de verdad (restauración desde cero en otro PC).

## Categorías no aplicables

No hay servidor propio en esta app: se saltan autenticación multiusuario, autorización por roles
(IDOR), SQL, subida de ficheros, límites de peticiones, WebDAV, IMAP y cabeceras HTTP de servidor.
RGPD queda reducido a B-2: la app no recoge datos, todo vive en el equipo del usuario.

## Plan de implementación sugerido

1. **Hoy** — A-1: publicar el sha256 del instalador (en `latest.json` y en el propio mensaje de
   Telegram) y firmar el zip grande.
2. **Hoy / mañana** — F-1: los botones de enviar NFT (es lo que más se va a notar) y A-2, que son
   dos líneas y quitan el vector de raíz.
3. **Esta semana** — A-3 (`overrides` de axios + prueba con Ledger) y M-1 (redirecciones).
4. **Cuando toque** — M-3, B-1, B-2 y el certificado de firma (M-2).

## Nota para Antonio (en cristiano)

Lo importante primero: **no he encontrado nada por donde se puedan llevar las claves ni el dinero
de nadie**. El corazón de la wallet aguanta bien, y las actualizaciones van firmadas y se rechazan
si la firma no cuadra.

Lo que sí me preocupa ahora que has soltado el enlace en el grupo:

1. **El instalador no lleva firma ni huella publicada.** Las actualizaciones sí; el zip gordo no.
   Si alguien lograra cambiar ese archivo en el servidor, quien lo baje se instala una wallet
   falsa y no tiene forma de notarlo. Se arregla hoy: publicamos el sha256 (la «huella») del
   archivo y lo pegas también en el mensaje de Telegram, para que la huella no venga del mismo
   sitio que el archivo. Y firmamos el zip con la clave que ya usamos.
2. **El botón de enviar una pieza NFT no funciona.** No es seguridad, es un fallo: está escrito de
   una forma que la propia protección de la app bloquea. Lleva así desde que lo publicamos, o sea
   que nadie lo ha podido usar todavía. Se arregla en cinco minutos.
3. **Si alguien te regala un NFT preparado con mala idea, puede colar dibujitos en tu pantalla de
   NFT.** No puede ejecutar código —eso lo para la protección que ya lleva la app— pero sí pintar
   algo encima que imite a Koberlet y te pida la contraseña. Dos líneas y desaparece.
4. **Una librería de Ledger arrastra otra con fallos conocidos.** Solo se usa al firmar envíos EVM
   con el aparato. Se fuerza la versión buena y se prueba un envío antes de publicar.

Y la de siempre: **el certificado de firma de código**. Mientras no lo tengamos, Windows dirá
«editor desconocido» a todo el que instale, y estamos enseñando a la gente a ignorar ese aviso
justo cuando más queremos que desconfíen de lo que no venga de nosotros.

## Apéndice: comprobaciones ejecutadas

```bash
grep -n "Content-Security-Policy" renderer/index.html      # CSP declarada
# CSP probada de verdad: un onclick en línea NO se ejecuta (destapa F-1)
grep -n 'onclick="' renderer/app.js                        # solo 2, ambos en NFT
npm audit --omit=dev --json                                # 11 vulns, 4 altas (axios)
npm ls axios --omit=dev                                    # entra por @ledgerhq/hw-app-eth
grep -n "sign.detached.verify|UPDATE_PUBKEY" main.js       # updater fail-closed
curl -sI https://descargas.dnns.es/kob7t2m9x4/koberlet/koberlet_v2.7.4.zip
```
