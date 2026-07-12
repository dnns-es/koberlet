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
build-portable.sh  ensambla el portable en portable-build/
```

## Desarrollo

```
npm install
npm start            # lanza la app con Electron
bash build-portable.sh   # genera el portable (Windows)
```

Node 20 / Electron. Sin backend propio: habla directo con los nodos Chainweb, RPCs EVM públicos, CoinGecko y el indexador.

> Este repo no contiene ninguna clave ni dato de wallet; ver `.gitignore`.
