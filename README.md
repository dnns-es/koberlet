# Koberlet

Monedero de escritorio **no custodial** multi-cadena (Kadena + EVM) hecho con Electron. Portable: se copia la carpeta y se ejecuta, sin instalar nada.

## Qué hace

- **Multi-wallet, una red por wallet**: Kadena (oficial y fork comunitario) o EVM (Ethereum, Arbitrum, Base, BNB Chain, Polygon). Varias wallets visibles a la vez en el dashboard, con precios de CoinGecko.
- **Crear/importar**: semilla BIP-39 (compatible eckoWallet/Chainweaver/MetaMask, con escaneo de índices) o clave privada.
- **Enviar/recibir**: firma ed25519 (KDA, tweetnacl+blakejs) y secp256k1 (EVM, ethers v6). Todo envío exige la contraseña.
- **Mercado**: swap KDA ⇄ kb-USDC no custodial contra el pool kaddex.exchange del fork (chain 2).
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
lib/bridge.js    puente Kinesis (dry-run + envío real)
renderer/        UI (HTML/CSS/JS plano, sin frameworks)
build-portable.sh    ensambla el portable en portable-build/
build-instalador.sh  el zip grande que se pasa a otra persona
build-app-zip.sh     el paquete de auto-update (solo el codigo)
publicar.sh          publica una version entera y deja el enlace al dia
notas/<version>.json novedades que ve el usuario al actualizar
```

## Desarrollo

```
npm install
npm start            # lanza la app con Electron
npm test             # validador de cuentas Kadena (42 casos, sin red)
bash build-portable.sh   # genera el portable (Windows)
```

## Publicar una version

```
bash publicar.sh
```

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
