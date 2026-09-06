# Nodos EVM: lo comprobado el 2026-09-06

Sale de perseguir un "sin conexión" en la Ethereum de un colaborador. Se apunta porque
media jornada se fue en trampas que no se ven a simple vista.

## La trampa principal: responder NO es servir

Un RPC puede contestar `eth_chainId` y aun así ser inútil. **Comprobar un nodo pidiéndole
el chainId no vale para nada**: hay que pedirle un `eth_getBalance` de verdad.

| Endpoint | `eth_chainId` | `eth_getBalance` |
|---|---|---|
| `cloudflare-eth.com` | responde `0x1` | **falla**, `-32603 Internal error` |
| `rpc.flashbots.net` | responde `0x1` | **falla**, 504 — solo acepta envío de transacciones, no es nodo de consulta |

Por eso `elegirRpc` de `lib/eth.js` sondea con un saldo real y no con el chainId. Sin esa
comprobación, el recambio automático habría elegido tan contento un nodo que deja la
cartera igual de ciega.

## Reservas que SÍ sirven (probadas con consulta de saldo, chainId verificado)

| Red | Reservas | Notas |
|---|---|---|
| Ethereum (1) | `eth.drpc.org` · `rpc.mevblocker.io` · `gateway.tenderly.co/public/mainnet` | tenderly va por envoy, es la única que no está en Cloudflare |
| Arbitrum (42161) | `arb1.arbitrum.io/rpc` · `arbitrum.drpc.org` | |
| Base (8453) | `mainnet.base.org` · `base.drpc.org` | |
| BNB (56) | `bsc-dataseed.bnbchain.org` · `bsc.drpc.org` | drpc tardó 5,2 s: va la última |
| Polygon (137) | `polygon.drpc.org` | la única encontrada que sirve sin clave |

## Descartados y por qué

- `polygon-rpc.com` → "API key disabled, tenant disabled"
- `rpc.ankr.com/polygon` → exige autenticación
- `eth-mainnet.public.blastapi.io` sirve en Ethereum, pero el de Polygon está retirado
- `eth.llamarpc.com`, `ethereum.blockpi.network` → 521
- `polygon.llamarpc.com`, `binance.llamarpc.com`, `polygon.meowrpc.com`, `api.securerpc.com`,
  `rpc.payload.de` → el dominio ya ni resuelve
- `eth.merkle.io` → 403

**Casi todos están detrás de Cloudflare**, `registry.npmjs.org` incluido. Así que "cambiar de
RPC" no esquiva un bloqueo de Cloudflare; para eso solo sirve tenderly.

## Límites de esta comprobación

Probado el 2026-09-06 desde la oficina, en una sola pasada y con una dirección de sonda.
Un endpoint puede caerse, empezar a pedir clave o meter límites cualquier día: la lista
merece repasarse si alguien reporta problemas de saldos.
