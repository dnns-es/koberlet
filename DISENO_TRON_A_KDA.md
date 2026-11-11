# Diseño: "USDT de Tron → KDA" en una sola pantalla (Koberlet)

Fecha: 11-11-2026 · Estado: **diseño, sin código** · Autor: Antonio (DNNS) + Claude

## 1. Objetivo

Mucha gente tiene su dinero en **USDT de Tron (TRC20)**, casi siempre en **Trust Wallet**.
Queremos que con **una pantalla y un botón** puedan acabar con **KDA en Kadena**, sin
saber qué es un puente, sin tener ETH y sin meter su frase semilla en Koberlet.

## 2. Lo que ya está comprobado (no son suposiciones)

| Qué | Resultado | Cómo se comprobó |
|---|---|---|
| Trust Wallet conecta por WalletConnect en Tron | ✅ comparte la dirección y aprueba `tron_signTransaction` + `tron_signMessage` | prueba real 11-11 (`koberlsw/prueba-tron-wc/`) |
| Trust Wallet firma con la cuenta vacía | ✅ `tron_signMessage` devuelve la firma | misma prueba |
| Legacy Mesh (Tether/USDT0) va **directo** de Tron a Ethereum | ✅ `quoteOFT` con `dstEid 30101`: 1.000 USDT → **999,70 USDT** | lectura on-chain del contrato Tron |
| Comisión de Legacy Mesh | **0,03 %** (`feeBps = 3`) | on-chain |
| Tope por envío | ~27,6 M USDT (sin problema) | on-chain (`quoteOFT`) |
| Tasa LayerZero (se paga en TRX) | **~5 TRX** sin gas en destino · **~18,6 TRX** con 0,002 ETH de gas en destino | on-chain (`quoteSend`) |
| Token del contrato Tron | `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t` (el USDT oficial) | on-chain (`token()`) |
| Puente Hyperlane Ethereum → Kadena | gas del relé = **0 ETH** | on-chain (`quoteGasPayment(626)`) |
| Gas de Ethereum hoy | ~0,1 gwei → los pasos en Ethereum cuestan céntimos | `eth_gasPrice` |

Contratos:
- Legacy Mesh Tron (UsdtOFT): `TFG4wBaDQ8sHWWP1ACeSGnoNR6RRzevLPt` (LayerZero EID 30420)
- Legacy Mesh Ethereum (UsdtOFT): `0x1F748c76dE468e9D11bd340fA9D5CBADf315dFB0` (EID 30101)
- Fuente: https://docs.usdt0.to/api/deployments

## 3. La ruta

```
Trust Wallet (Tron)                Koberlet (Ethereum)                      Koberlet (Kadena)
───────────────────                ───────────────────                      ─────────────────
USDT ──① Legacy Mesh──►  USDT ──② Uniswap──► USDC ──③ Hyperlane──►  kb-USDC ──④ Mercatus──► KDA
       (firma Trust)     + gas ETH       (firma Koberlet)     (firma Koberlet)       (firma Koberlet)
```

- **Solo el paso ① lo firma Trust Wallet.** El destino es la dirección de Ethereum **del propio
  usuario en Koberlet**, así que los pasos ②③④ los firma Koberlet con sus claves, como hoy.
- En el paso ① se pide a LayerZero que entregue también **un poco de ETH** (opción `nativeDrop`)
  en esa dirección. Así **el usuario no necesita tener ETH nunca**. Lo paga en TRX en Tron.
- Los pasos ②③④ ya existen en Koberlet: `evmswap:enviar`, `bridge:send` (dir evm2kda) y `dex:cambiar`.
  Lo nuevo es el paso ① y el "director" que los encadena.

## 4. La pantalla

Una pestaña nueva **"Desde Tron"**:

```
┌───────────────────────────────────────────────┐
│  Trae tu USDT de Tron a KDA                   │
│                                               │
│  [ Conectar Trust Wallet ]  → QR              │
│  Tron: TQLJv7…D8t87   USDT 250,00 · TRX 41,3  │
│                                               │
│  Envías      [ 100      ] USDT  (máx)         │
│  Recibes     ≈ 15.180 KDA                     │
│  ───────────────────────────────────────────  │
│  Comisión Tether (0,03 %)        0,03 USDT    │
│  Tasa LayerZero + gas ETH        ~9 TRX       │
│  Energía Tron (estimada)         ~25 TRX      │
│  Cambio USDT→USDC (Uniswap)      ~0,05 USDT   │
│  Impacto en Mercatus             1,8 %  ⚠     │
│  Tiempo estimado                 3–10 min     │
│                                               │
│  [ Convertir a KDA ]                          │
│                                               │
│  ① Tron → Ethereum     ✔                      │
│  ② USDT → USDC         ⏳                      │
│  ③ Ethereum → Kadena   ·                      │
│  ④ kb-USDC → KDA       ·                      │
└───────────────────────────────────────────────┘
```

- El "Recibes" sale encadenando las cotizaciones reales de cada paso. Es el mismo número
  que se usa para fijar los mínimos (`minAmountLD`, `amountOutMinimum`, slippage de Mercatus).
- Si el TRX no llega para la tasa más la energía: aviso claro **antes** de firmar
  ("Te faltan ~12 TRX en Trust Wallet"), no un error a mitad.
- El impacto en Mercatus se muestra **en grande** porque el pool es fino. Si pasa del 3 %,
  se pide confirmación expresa.

## 5. Piezas técnicas

### 5.1 WalletConnect en el proceso principal (main), no en el renderer
El renderer tiene una CSP `connect-src 'self'` (sin red) y debe seguir así. El `SignClient`
de WalletConnect funciona en Node: va en **main** (`lib/tronwc.js`), y el renderer solo
recibe el URI para pintar el QR (con `qrcode`, que ya es dependencia).

- Namespace: `tron`, cadena `tron:0x2b6653dc`, métodos `tron_signTransaction` y `tron_signMessage`.
- `sessionProperties: { tron_method_version: "v1" }`, que da un formato de respuesta más limpio.
- **Un solo `SignClient.init()`**: si se inicializa dos veces, la sesión se cuelga (lección de KoberluSW).
- projectId: crear uno **propio de Koberlet** en WalletConnect Cloud, sin reutilizar el de KoberluSW.

### 5.2 Construir la transacción de Tron SIN fiarse del nodo
Regla de Koberlet: **no se firma nada que no hayamos construido nosotros**. En Tron, la
transacción la monta el nodo (`/wallet/triggersmartcontract`). Solución:

1. Construimos nosotros el `data` del contrato (ABI de `approve` y `send` con ethers, igual que en EVM).
2. Le pedimos al nodo que la envuelva y nos devuelva `raw_data_hex`.
3. **Decodificamos `raw_data_hex` en local** (protobuf `TriggerSmartContract`) y comprobamos
   byte a byte: el contrato es el de Legacy Mesh o el de USDT, el `data` es exactamente el nuestro,
   `call_value` es exactamente la tasa cotizada, `owner` es la dirección conectada, `fee_limit`
   está dentro de un tope y la expiración es corta.
4. `txID == sha256(raw_data)`: comprobado en local.
5. Si algo no cuadra, **no se manda a firmar**.

Se hará una prueba (`test/tron-tx.test.js`) con transacciones reales decodificadas, incluidas
las manipuladas (otro contrato, otra cantidad, otro destino), que deben rechazarse.

### 5.3 Paso ①: dos firmas en Trust Wallet
1. `approve(UsdtOFT, cantidad)` sobre USDT, solo si el permiso no llega. Permiso **exacto**, nunca infinito.
2. `send(SendParam, {nativeFee, 0}, refund)` con `call_value = nativeFee` (en TRX):
   - `dstEid = 30101`, `to` = dirección Ethereum del usuario en Koberlet (bytes32),
   - `minAmountLD` = cotización de `quoteOFT` menos un margen mínimo,
   - `extraOptions` = `nativeDrop` de ~0,0005 ETH (con 0,1 gwei sobra para los pasos ②③),
   - `refundAddress` = la propia dirección de Tron.

⚠ **Trust Wallet emite la transacción al firmarla** (wallet-core #4875). Por eso Koberlet
**no la vuelve a emitir**: con el `txID` (que ya conocemos) solo consulta si entró.

### 5.4 El "director" (máquina de estados que se puede reanudar)
`lib/tron2kda.js`. Cada operación es un fichero cifrado como los de órdenes, con estado:

`cotizado → aprobado_tron → enviado_tron(txID) → llegado_eth → cambiado_usdc → enviado_puente(msgId) → llegado_kda → cambiado_kda (fin)`

- Cada paso guarda su hash **antes** de pasar al siguiente. Si se cierra la app, al abrirla
  retoma donde estaba. Nunca repite un paso que ya se ha emitido.
- La llegada a Ethereum se detecta por el **saldo de USDT** de la dirección (más el evento
  `OFTReceived` si se puede). Se espera con un tope de tiempo y, si se pasa, se avisa sin perder nada:
  el dinero está en la dirección del usuario.
- Si un paso intermedio falla, el dinero **queda en la cuenta del usuario** (USDT o USDC en
  Ethereum, o kb-USDC en Kadena). Se le muestra dónde está y un botón "Continuar".

### 5.5 Nodo de Tron
TronGrid público limita a **3 peticiones por segundo** (se ha visto en las pruebas). Opciones:
- poner una clave de API gratuita de TronGrid en Ajustes (como el nodo EVM), y/o
- espaciar las lecturas y cachear (saldo cada 15 s, cotización al cambiar la cantidad).

## 6. Costes para el usuario (ejemplo: 100 USDT)

| Concepto | Coste | Seguro / estimado |
|---|---|---|
| Comisión Tether Legacy Mesh | 0,03 USDT | on-chain |
| Tasa LayerZero + 0,0005 ETH de gas en destino | ~8–9 TRX | on-chain (falta afinar el drop) |
| Energía Tron (approve + send) | ~15–35 TRX si no tiene energía | **estimado**: se medirá en la prueba de 1 USDT |
| Uniswap USDT→USDC (pool 0,01 %) | ~0,01 USDT + gas en céntimos | estimado |
| Hyperlane → Kadena | 0 (más gas de Ethereum en céntimos) | on-chain |
| Mercatus kb-USDC→KDA | 0,3 % + **impacto** | el impacto depende de la liquidez y es lo que más pesa |

**El coste real lo marcan la energía de Tron y el impacto en Mercatus**, no los puentes.
Para importes pequeños (<20 USDT) la energía en TRX pesa mucho: hay que avisarlo en pantalla.

## 7. Riesgos y cómo se cubren

| Riesgo | Cobertura |
|---|---|
| Firmar una transacción de Tron manipulada por el nodo | decodificación local y comprobación (5.2) + test con casos manipulados |
| Tether cambia o migra los contratos de Legacy Mesh | dirección y bytecode fijados; si cambian, la pantalla se desactiva sola (como el hash de Sushi en KoberluSW) |
| El envío se queda a medio camino | máquina de estados que se puede reanudar; el dinero siempre en cuentas del usuario |
| Trust Wallet cambia su comportamiento de `tron_signTransaction` (emitir o no) | tras firmar, mirar si el `txID` está en la red; si no está, emitirlo nosotros con la transacción firmada que devuelve |
| Pool de Mercatus muy fino | impacto visible, confirmación por encima del 3 % y opción de quedarse en kb-USDC |
| Phishing ("conecta tu wallet") | nada de enlaces: Koberlet muestra el QR y la wallet enseña "Koberlet" con nuestro icono |
| Tres sistemas en serie (LayerZero, Uniswap, Hyperlane) | avisar del tiempo; cada paso con su enlace al explorador (Tronscan, LayerZero Scan, Etherscan, explorador Kadena) |

## 8. Fuera de alcance (por ahora)

- Kadena → Tron (la vuelta). Es el mismo camino al revés; se hará después si hay demanda.
- Otras wallets de Tron (TronLink): WalletConnect debería servir igual, pero solo está probado Trust Wallet.
- Android de Koberlet: primero escritorio.
- Pool kb-USDT/kb-USDC en Kadena (ahorraría el paso ②): es tarea de la comunidad, no de Koberlet.

## 9. Plan por fases

1. **Prueba de 1 USDT a mano** (necesita ~30 TRX + 1 USDT en la Trust Wallet de pruebas):
   `approve` + `send` por Legacy Mesh hacia la dirección Ethereum de Koberlet, desde la página
   de prueba. Mide la energía real y el tiempo, y confirma la llegada y el `nativeDrop`.
2. `lib/tronwc.js` + `lib/trontx.js` (construir y verificar) + tests.
3. `lib/tron2kda.js` (director) usando las piezas ②③④ que ya existen.
4. Pantalla "Desde Tron" + textos + avisos.
5. Auditoría (protocolo DNNS) antes de publicar la versión.
