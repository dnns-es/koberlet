# Koberlet

[![Licencia: Apache 2.0](https://img.shields.io/badge/licencia-Apache%202.0-blue.svg)](LICENSE)

Monedero de escritorio **no custodial** multi-cadena (Kadena + EVM) hecho con Electron. Portable: se copia la carpeta y se ejecuta, sin instalar nada.

Es la misma app que [Koberlet para Android y iPhone](https://github.com/dnns-es/koberlet-android),
con el mismo formato de bóveda: una copia de seguridad hecha en el móvil se restaura en el
ordenador y al revés.

## Por qué este repositorio está abierto

Un monedero le pide a alguien que meta dentro la frase que da acceso a su dinero. Pedir eso y
no dejar mirar el código es pedir un acto de fe. Aquí está todo lo que se ejecuta en la
máquina: cómo se deriva la semilla, cómo se cifra la bóveda, qué se firma y qué se envía por
la red. Cualquiera puede comprobar que la frase no sale de ahí.

Lo que se publica es **el código**, no la infraestructura. En DNNS.es lo normal es lo
contrario —los repositorios son privados—, y los dos monederos son la excepción, a propósito.

## Lo que NO está aquí, y no va a estar

- La clave que firma las actualizaciones (`koberlet-update.sec`). Sin ella, nadie puede hacer
  un paquete que el actualizador de Koberlet acepte como nuestro.
- El servidor y las rutas de publicación: van en `.publicar.conf`, que no se sube. Lo que sí
  está es la plantilla `.publicar.conf.ejemplo`, para que el proceso de publicación se pueda
  auditar sin enseñar la infraestructura de nadie.
- Los certificados de Apple y la clave que firma los APK, que son del repositorio de móvil y
  tampoco están allí.
- Datos de ninguna cartera: ni bóvedas, ni direcciones, ni saldos.

Todo eso vive fuera del repositorio (ver [`.gitignore`](.gitignore)) y existe en un solo
sitio. Poder leer este código no permite firmar nada en nombre de DNNS.es.

## Qué hace

- **Multi-wallet, una red por wallet**: Kadena (oficial y fork comunitario) o EVM (Ethereum, Arbitrum, Base, BNB Chain, Polygon). Varias wallets visibles a la vez en el dashboard, con precios de CoinGecko.
- **Crear/importar**: semilla BIP-39 (compatible eckoWallet/Chainweaver/MetaMask, con escaneo de índices) o clave privada.
- **Enviar/recibir**: firma ed25519 (KDA, tweetnacl+blakejs) y secp256k1 (EVM, ethers v6). Todo envío exige la contraseña.
- **Mercado**: swap KDA ⇄ kb-USDC no custodial contra el pool kaddex.exchange del fork (chain 2).
- **Órdenes límite**: depósito en el contrato `free.ksw2` del fork; se ejecuta solo cuando el precio llega al objetivo. Las dispara el vigilante de KoberluSW pagando su propio gas — Koberlet solo crea y cancela. Cancelar devuelve el depósito entero.
- **DCA**: planes de compra periódica sobre `free.ksw-dca2`, mismo reparto de papeles.
- **Puente Kinesis** (experimental): Kadena ⇄ EVM en ambos sentidos, con dry-run sin firmar antes de ejecutar.
- **Historial** on-chain (indexador kdaindex.dnns.es con caché incremental) + registro local EVM/puente.
- **Auto-update in-place**: descarga solo el código (`resources/app`), lo aplica con respaldo y se reinicia; la bóveda no se toca.
- Idioma ES/EN, sección Info con manuales.

## Seguridad (lo que interesa revisar)

- Las privadas viven **solo en el proceso principal** (`main.js`); el renderer no las ve nunca (contextIsolation + `preload.js` con API acotada, CSP estricta).
- **Bóveda cifrada** `lib/vault.js`: AES-256-GCM + scrypt (N=2^15). La passphrase no se persiste.
- Exportar una privada o firmar cualquier envío exige reintroducir la passphrase.
- En modo portable (`portable.flag` junto al exe) los datos van en `MonederoDNNS-datos/` al lado del ejecutable.

## Estructura

```
main.js          proceso principal: IPC, config, firma, auto-update, historial
preload.js       puente acotado renderer↔main
lib/vault.js     bóveda cifrada
lib/wallets.js   derivación BIP-39 / import-export
lib/kda.js       saldos + envío Kadena (20 chains)
lib/eth.js       saldos + envío EVM multi-red
lib/swap.js      swap AMM kaddex (fork chain 2)
lib/dca.js       planes DCA + fontaneria de firma que comparten DCA y ordenes
lib/ordenes.js   ordenes limite free.ksw2 (cotizar, crear, cancelar, libro)
lib/bridge.js    puente Kinesis (dry-run + envío real)
renderer/        UI (HTML/CSS/JS plano, sin frameworks)
build-portable.sh    ensambla el portable en portable-build/
build-instalador.sh  el zip grande que se pasa a otra persona
build-app-zip.sh     el paquete de auto-update (solo el codigo)
publicar.sh          publica una version entera y deja el enlace al dia
notas/<version>.json novedades que ve el usuario al actualizar
```

## Órdenes límite — qué está comprobado y qué no

Contrastado contra la cadena el **05/09/2026** (`free.ksw2`, chain 2 del fork, mainnet01):

- Constantes vivas del contrato: comisión 0,5 %, mínimos 100 KDA / 1 kb-USDC,
  `MAX-POOL-FRACTION` 10 %, sin caducidad práctica (100 años), `paused` = false.
- Cuenta de custodia `c:aTPrDBF5HQWwLBXmMwNc3JF83cA5cBywkYbQdac5XaY`.
- Las cotizaciones salen igual que las de KoberluSW: reservas proyectadas al precio de
  disparo (k = rk·ru constante) y cálculo sobre el **neto** tras la comisión. Comprobado
  a mano contra el pool real en los dos sentidos.
- `test/ordenes.test.js` fija el truncado hacia abajo y la inversión del trigger en las
  compras. Son los dos fallos que no darían la cara hasta tener dinero puesto.

**Sin comprobar todavía:** no se ha creado ninguna orden real en mainnet desde Koberlet
(hace falta la contraseña de la bóveda y dinero de verdad), ni se ha visto la pantalla
con la bóveda abierta. La primera orden conviene hacerla por el mínimo (100 KDA).

**Una diferencia a propósito con KoberluSW:** si no se puede leer la liquidez del pool,
la web cae al precio "de pizarra" y firma igual; Koberlet se niega a firmar. Un mínimo
calculado sin pool sale demasiado alto y deja la orden abierta sin ejecutarse nunca.

## Desarrollo

```
npm install
npm start            # lanza la app con Electron
npm test             # 78 casos sin red: cuentas Kadena, direcciones EVM y ordenes
bash build-portable.sh   # genera el portable (Windows)
```

**Antes de tocar nada, lee `PARIDAD.md`** (vive en el repo del movil,
`koberlet-android`, porque ese aloja dos de los tres codigos: Android e iOS).
Koberlet es un producto en dos codigos (este y el del movil) repartido en cuatro
sistemas publicados: Windows, Mac, Android e iPhone. Cualquier cambio que se haga
aqui hay que apuntarlo alli para nivelarlo en los otros. Hoy la misma operacion no
se comporta igual en todos —un cambio en el Mercado de 5 USDC o mas sale gratis de
gas en Android y lo paga el usuario aqui—, y la numeracion unificada (3.0.0)
promete que si.

## Publicar una version

Esto es para quien publica las compilaciones oficiales; si has hecho un fork, tendras que
apuntarlo a tu propio servidor.

```
cp .publicar.conf.ejemplo .publicar.conf   # una vez por maquina: servidor y rutas
bash publicar.sh
```

`.publicar.conf` no va en el repositorio: lleva el servidor y las rutas reales de quien
publica, y a nadie mas le sirven. El script se niega a arrancar si falta.

Un solo comando. Sube la version en `package.json`, escribe `notas/<version>.json` con
las novedades y lanza eso: construye el paquete de auto-update **y** el instalador
completo, los firma, los sube y deja `latest.json` apuntando a los dos.

Se niega a seguir si la version ya esta publicada, si faltan las notas de esa version o
si alguna huella no cuadra en destino. Al terminar comprueba por HTTPS lo que ve la
gente y escupe el enlace del instalador con su SHA-256, listo para repartir.

**Los dos paquetes hay que publicarlos juntos**, y por eso son un solo comando: el
paquete de auto-update actualiza a quien ya tiene la app, y el instalador completo es
el enlace de «Pasar Koberlet a un companero». Hasta el 26/08/2026 el segundo se rehacia
a mano, se olvidaba, y el enlace se quedo repartiendo la 2.7.4 mientras la app iba por
la 2.7.7. `bash publicar.sh --solo-app` salta el instalador, pero entonces el enlace se
queda en la version anterior a proposito y el script lo avisa.

Node 20 / Electron. Sin backend propio: habla directo con los nodos Chainweb, RPCs EVM públicos, CoinGecko y el indexador.

> Este repo no contiene ninguna clave ni dato de wallet; ver `.gitignore`.

## Licencia y nombre

El **codigo** es libre, bajo [Apache 2.0](LICENSE). El **nombre** no: "Koberlet" y "DNNS"
son marcas de DNNS.es y no se licencian con el software. Puedes hacer un fork y
distribuirlo, con otro nombre. El porque y los limites, en [TRADEMARK.md](TRADEMARK.md).

**Las unicas compilaciones oficiales son las publicadas por DNNS.es.** Nadie mas firma
Koberlet. Si te llega una copia firmada por otro, no es nuestra.

## Colaborar

- Fallos, ideas y PRs: [CONTRIBUTING.md](CONTRIBUTING.md).
- **Fallos de seguridad: no abras un issue.** Lee [SECURITY.md](SECURITY.md) primero.
- El proyecto ha pasado auditorias propias y una externa; los informes estan en el repo.

## Aviso

Esto custodia claves privadas y firma transacciones con dinero real. Se publica **tal
cual**, sin garantia de ningun tipo, como dice la licencia. Prueba con cantidades
pequenas, guarda tu frase de recuperacion fuera del ordenador y no confies en ningun
monedero -este incluido- mas de lo que estes dispuesto a perder.
