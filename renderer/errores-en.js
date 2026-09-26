// Koberlet - Copyright 2026 DNNS.es (Oberluss)
// SPDX-License-Identifier: Apache-2.0

// ERRORES DEL PROCESO PRINCIPAL EN INGLES.
//
// main.js y lib/*.js lanzan sus errores en espanol a pelo: no saben en que idioma esta la
// ventana. Con la app en ingles, quien creaba un DCA sin gas leia «Te faltan KDA en la
// chain 2…». En vez de tocar ~300 throw (y arriesgar el texto espanol, que es el que
// conoce la gente), aqui se traduce el mensaje YA hecho: cada fila es [patron sobre el
// espanol, plantilla inglesa con $1..$n]. Solo se usa con la ventana en ingles; en
// espanol el mensaje pasa intacto.
//
// test/errores-en.test.js saca del fuente todos los new Error(...) y falla si alguno no
// tiene fila aqui. Si anades un error nuevo en main/lib, anade su traduccion.
//
// Orden: la primera fila que encaja gana, asi que las especificas van antes que las
// genericas (p.ej. «El nodo rechazó la transacción» antes que «X rechazó la transacción»).
// Los huecos se traducen tambien si ellos mismos son un mensaje conocido (el «error
// desconocido» de relleno, «destino», «2 minutos»…).

const ERRORES_EN = [
  // --- Boveda, wallets y contrasena ---
  [/^bloqueado$/, 'Vault is locked.'],
  [/^Bóveda vacía o corrupta\.$/, 'The vault is empty or corrupted.'],
  [/^Contrase[ñn]a incorrecta\.$/, 'Wrong password.'],
  [/^Contraseña incorrecta o archivo dañado\/manipulado\.$/, 'Wrong password or damaged/tampered file.'],
  [/^Desbloquea la bóveda antes de exportar la copia\.$/, 'Unlock the vault before exporting the backup.'],
  [/^La copia no contiene wallets\.$/, 'The backup contains no wallets.'],
  [/^Wallet no encontrada\.?$/i, 'Wallet not found.'],
  [/^No puedes borrar la última wallet\.$/, "You can't delete the last wallet."],
  [/^Indica la cuenta a buscar\.$/, 'Enter the account to search for.'],
  [/^Esa cuenta ya está añadida como "([\s\S]*)"\.$/, 'That account is already added as "$1".'],
  [/^Esta wallet es de Ledger: su clave privada vive dentro del aparato y no se puede exportar desde aquí\.$/, "This is a Ledger wallet: its private key lives inside the device and can't be exported from here."],
  [/^Esta wallet no tiene cuenta de Ethereum\.$/, 'This wallet has no Ethereum account.'],
  [/^Esta wallet no tiene cuenta (\S+)\.$/, 'This wallet has no $1 account.'],
  [/^La wallet origen no tiene cuenta (\S+)\.$/, 'The source wallet has no $1 account.'],
  [/^Esta wallet no es la dueña de esa cuenta\.$/, "This wallet doesn't own that account."],
  [/^Wallet EVM no válida\.$/, 'Invalid EVM wallet.'],
  [/^Elige una wallet de Kadena$/, 'Choose a Kadena wallet'],
  [/^Necesitas una wallet Kadena para operar en el mercado\.$/, 'You need a Kadena wallet to trade on the market.'],
  [/^No hay ninguna cuenta (KDA )?que ofrecer\.$/, 'There is no $1account to offer.'],
  [/^La privada KDA debe ser 64 caracteres hex \(32 bytes\)\.$/, 'The KDA private key must be 64 hex characters (32 bytes).'],
  [/^La semilla debe tener 12 o 24 palabras\.$/, 'The seed phrase must have 12 or 24 words.'],
  [/^Parámetros KDF de la bóveda por debajo del mínimo de seguridad\.$/, 'Vault KDF parameters are below the security minimum.'],

  // --- Copias de seguridad ---
  [/^No hay bóveda que copiar\.$/, 'There is no vault to back up.'],
  [/^El fichero no es una bóveda válida\.$/, "The file isn't a valid vault."],
  [/^El fichero no parece una bóveda de Koberlet\.$/, "The file doesn't look like a Koberlet vault."],
  [/^La contraseña no abre esa copia \(¿es la de ese backup\?\)\.$/, "The password doesn't open that backup (is it the right one for that backup?)."],
  [/^La contraseña del backup debe tener al menos (.+) caracteres\.$/, 'The backup password must be at least $1 characters long.'],
  [/^El archivo no es una copia de seguridad de Koberlet válida\.$/, "The file isn't a valid Koberlet backup."],
  [/^El archivo no es una copia de seguridad de Koberlet\.$/, "The file isn't a Koberlet backup."],
  [/^Parámetros de cifrado del backup por debajo del mínimo de seguridad\.$/, 'Backup encryption parameters are below the security minimum.'],
  [/^Parámetros de cifrado del backup fuera de rango\.$/, 'Backup encryption parameters are out of range.'],
  [/^El contenido del backup no es válido\.$/, "The backup contents aren't valid."],

  // --- Direcciones, cuentas, redes y cantidades ---
  [/^Direcci[oó]n no v[aá]lida\.$/, 'Invalid address.'],
  [/^Direcci[oó]n EVM inv[aá]lida \(0x \+ 40 hex\)\.$/, 'Invalid EVM address (0x + 40 hex).'],
  [/^Direcci[oó]n (.+?) inv[aá]lida: ([\s\S]*)$/, 'Invalid $1 address: $2'],
  [/^Cuenta Kadena destino debe ser k:<64 hex>\.$/, 'The destination Kadena account must be k:<64 hex>.'],
  [/^Cuenta Kadena (.+?) inválida o con caracteres no permitidos\.$/, 'Invalid $1 Kadena account, or it contains characters that are not allowed.'],
  [/^Cuenta Kadena (?:no válida|inválida)\.$/, 'Invalid Kadena account.'],
  [/^Cuenta no válida$/i, 'Invalid account'],
  [/^El destino debe ser una cuenta k:\.$/, 'The destination must be a k: account.'],
  [/^El destino tiene que ser una cuenta k:$/, 'The destination must be a k: account'],
  [/^Con Ledger el destino debe ser una cuenta k:… \(la app del aparato firma contra su pubkey\)\.$/, 'With Ledger the destination must be a k:… account (the device app signs against its pubkey).'],
  [/^Cadena no válida\.$/, 'Invalid chain.'],
  [/^chain no valida \(0-19\)\.$/, 'Invalid chain (0-19).'],
  [/^Red no válida\.$/, 'Invalid network.'],
  [/^Red no encontrada$/, 'Network not found'],
  [/^No hay ninguna red de Kadena activa\.$/, 'No Kadena network is active.'],
  [/^No hay redes de Kadena configuradas\.$/, 'No Kadena networks are configured.'],
  [/^Token no válido\.$/, 'Invalid token.'],
  [/^Token KDA no reconocido: ([\s\S]*)$/, 'Unrecognized KDA token: $1'],
  [/^Módulo de token no válido\.$/, 'Invalid token module.'],
  [/^Modulo +(?:(.+?) +)?no valido: ([\s\S]*)$/, 'Invalid $1 module: $2'],
  [/^Cantidad (?:no v[aá]lida|inv[aá]lida)\.$/, 'Invalid amount.'],
  [/^La cantidad tiene que ser mayor que cero\.$/, 'The amount must be greater than zero.'],
  [/^La cantidad es demasiado peque[ñn]a\.$/, 'The amount is too small.'],
  [/^Esa cantidad es demasiado pequeña para este token\.$/, 'That amount is too small for this token.'],
  [/^cantidad demasiado pequeña$/, 'amount too small'],
  [/^cantidad debe ser > 0$/, 'amount must be > 0'],
  [/^requestKey no valido\.$/, 'Invalid requestKey.'],
  [/^messageId invalido$/, 'Invalid messageId'],
  [/^config inválida$/, 'invalid config'],
  [/^Accion no valida\.$/, 'Invalid action.'],

  // --- Envios de KDA y tokens ---
  [/^La transacción falló en cadena: ([\s\S]*)$/, 'The transaction failed on chain: $1'],
  [/^La tx falló en Kadena: ([\s\S]*)$/, 'The tx failed on Kadena: $1'],
  [/^error desconocido$/, 'unknown error'],
  [/^No tienes saldo de (.+) en ninguna chain\.$/, 'You have no $1 balance on any chain.'],
  [/^En la chain (.+?) solo tienes (.+) (\S+)\. Envía como mucho eso \(el saldo no se junta entre chains todavía\)\.$/, 'On chain $1 you only have $2 $3. Send that much at most (balances are not combined across chains yet).'],
  [/^No encuentro ese envío en el historial\.$/, "I can't find that transfer in the history."],
  [/^No se ha podido preguntar al nodo de destino\. Prueba en un momento\.$/, "Couldn't reach the destination node. Try again in a moment."],
  [/^send origen falló: ([\s\S]*)$/, 'source send failed: $1'],
  [/^send destino falló: ([\s\S]*)$/, 'destination send failed: $1'],
  [/^send falló: ([\s\S]*)$/, 'send failed: $1'],
  [/^El nodo rechaz[oó] la transacci[oó]n: ([\s\S]*)$/, 'The node rejected the transaction: $1'],
  [/^(.+?) rechazó la transacción: ([\s\S]*)$/, '$1 rejected the transaction: $2'],
  [/^El nodo no devolvi[oó] requestKey: ([\s\S]*)$/, "The node didn't return a requestKey: $1"],
  [/^el nodo rechazó la tx: ([\s\S]*)$/, 'the node rejected the tx: $1'],
  [/^No se pudo confirmar la transaccion en (.+?)\. OJO: puede estar YA en la cadena\. Comprueba el hash (\S+) en un explorador ANTES de volver a enviar\.$/, "Couldn't confirm the transaction within $1. CAREFUL: it may ALREADY be on chain. Check hash $2 in an explorer BEFORE sending again."],

  // --- Ledger ---
  [/^Activa "Blind signing" en el Ledger: app Ethereum → Settings → Blind signing → Enabled\. Luego reintenta\.$/, 'Enable "Blind signing" on the Ledger: Ethereum app → Settings → Blind signing → Enabled. Then try again.'],
  [/^Operación rechazada en el Ledger\.$/, 'Operation rejected on the Ledger.'],
  [/^El Ledger está bloqueado: introduce el PIN en el aparato\.$/, 'The Ledger is locked: enter the PIN on the device.'],
  [/^Abre la app correcta en el Ledger \(Kadena para KDA, Ethereum para EVM\) y reintenta\.$/, 'Open the right app on the Ledger (Kadena for KDA, Ethereum for EVM) and try again.'],
  [/^No veo ningún Ledger\. Conéctalo por USB, desbloquéalo y cierra Ledger Live si está abierto\.$/, "No Ledger found. Connect it via USB, unlock it and close Ledger Live if it's open."],
  [/^código ([\s\S]*)$/, 'code $1'],
  [/^el aparato no devolvió la transacción firmada\.$/, "the device didn't return the signed transaction."],
  [/^El envío de tokens KDA con Ledger no está disponible todavía \(la app del aparato no muestra código de contrato\)\. Usa una wallet de semilla o clave privada\.$/, "Sending KDA tokens with Ledger isn't available yet (the device app doesn't show contract code). Use a seed-phrase or private-key wallet."],
  [/^El DCA con Ledger no esta disponible: el aparato no puede mostrar la llamada al contrato y seria firma ciega\.$/, "DCA isn't available with Ledger: the device can't display the contract call, so it would be blind signing."],
  [/^Con Ledger no se puede cambiar aqui: el aparato no sabe ensenar la llamada al AMM y seria firma ciega\.$/, "You can't swap here with Ledger: the device can't display the AMM call, so it would be blind signing."],
  [/^La compra con Ledger no esta disponible: el aparato no puede mostrar la llamada al contrato y seria firma ciega\.$/, "Buying isn't available with Ledger: the device can't display the contract call, so it would be blind signing."],
  [/^El cambio de tokens con Ledger no está disponible: el aparato no puede mostrar la llamada al contrato y seria firma ciega\.$/, "Token swaps aren't available with Ledger: the device can't display the contract call, so it would be blind signing."],
  [/^Esa cuenta es de un Ledger: firmar desde una web con Ledger llegará más adelante\.$/, 'That account belongs to a Ledger: signing from a website with Ledger will come later.'],
  [/^Los envíos entre chains con Ledger llegarán más adelante\. De momento usa la misma chain de origen y destino\.$/, 'Cross-chain transfers with Ledger will come later. For now, use the same source and destination chain.'],
  [/^El barrido multi-chain con Ledger llegará más adelante\. Envía desde una chain con saldo suficiente\.$/, 'Multi-chain sweeping with Ledger will come later. Send from a chain with enough balance.'],
  [/^El puente Kadena→EVM con Ledger llegará más adelante \(necesita firmar código Pact en el aparato\)\. El sentido Ethereum→Kadena sí funciona con Ledger\.$/, 'The Kadena→EVM bridge with Ledger will come later (it needs to sign Pact code on the device). The Ethereum→Kadena direction does work with Ledger.'],
  [/^El swap de Uniswap con wallets Ledger llegará más adelante\. Usa una wallet normal\.$/, 'Uniswap swaps with Ledger wallets will come later. Use a regular wallet.'],
  [/^El Mercado con wallets Ledger llegará más adelante \(necesita firma de código Pact arbitrario\)\. Usa una wallet normal\.$/, 'The Market with Ledger wallets will come later (it needs arbitrary Pact code signing). Use a regular wallet.'],
  [/^Con Ledger todavía no: enviar un NFT firma código Pact y el aparato lo mostraría como firma ciega\.$/, 'Not with Ledger yet: sending an NFT signs Pact code and the device would show it as blind signing.'],

  // --- Webs conectadas (WalletConnect / firma desde una pagina) ---
  [/^Esa petición ya no está\.$/, 'That request no longer exists.'],
  [/^La página pide firmar con una clave que no está en esta bóveda\.$/, "The page asks to sign with a key that isn't in this vault."],
  [/^La página manda un comando que no se entiende; no se firma\.$/, "The page sent a command that can't be understood; not signing."],
  [/^La página no dice con qué clave hay que firmar; no se firma\.$/, "The page doesn't say which key to sign with; not signing."],

  // --- DCA ---
  [/^La red del DCA no esta configurada\.$/, "The DCA network isn't configured."],
  [/^Contrato DCA desconocido\.$/, 'Unknown DCA contract.'],
  [/^Ese par no esta soportado por el DCA\.$/, "That pair isn't supported by DCA."],
  [/^Con kb-ETH, FLUX o bro, el otro lado tiene que ser KDA\.$/, 'With kb-ETH, FLUX or bro, the other side must be KDA.'],
  [/^Identificador de plan no valido\.$/, 'Invalid plan ID.'],
  [/^la cadena no respondio$/, "the chain didn't respond"],
  [/^No se pudo leer el token del plan\.$/, "Couldn't read the plan's token."],
  [/^Te faltan KDA en la chain (\S+) para pagar el gas\. Tienes (\S+) y hacen falta al menos (\S+) \(el deposito mas un poco para el gas\)\. Manda algo de KDA a esa chain y vuelve a intentarlo\.$/, "You don't have enough KDA on chain $1 to pay for gas. You have $2 and need at least $3 (the deposit plus a little for gas). Send some KDA to that chain and try again."],
  [/^Te faltan KDA en la chain (\S+) para pagar el gas\. Tienes (\S+) y hacen falta al menos (\S+) para el gas\. Manda algo de KDA a esa chain y vuelve a intentarlo\.$/, "You don't have enough KDA on chain $1 to pay for gas. You have $2 and need at least $3 for gas. Send some KDA to that chain and try again."],
  [/^El DCA solo admite cuentas k: — el contrato exige que la cuenta sea el principal de su clave\.$/, "DCA only supports k: accounts — the contract requires the account to be its key's principal."],
  [/^El token que entregas y el que compras tienen que ser distintos\.$/, 'The token you pay with and the one you buy must be different.'],
  [/^El periodo minimo es (.+) segundos \(5 minutos\)\.$/, 'The minimum period is $1 seconds (5 minutes).'],
  [/^El periodo maximo es un año\.$/, 'The maximum period is one year.'],
  [/^El deslizamiento va de 0 a 0,5 \(50%\)\.$/, 'Slippage must be between 0 and 0.5 (50%).'],
  [/^La cuota no puede superar el deposito\.$/, "The amount per buy can't exceed the deposit."],
  [/^La cuota minima por compra es (.+)\.$/, 'The minimum amount per buy is $1.'],
  [/^Ya tienes (.+) planes abiertos y el maximo es (.+)\.$/, 'You already have $1 open plans and the maximum is $2.'],
  [/^El contrato DCA esta pausado ahora mismo\.$/, 'The DCA contract is paused right now.'],
  [/^Ese plan no es de esta wallet\.$/, "That plan doesn't belong to this wallet."],
  [/^Ese plan ya esta cerrado\.$/, 'That plan is already closed.'],

  // --- Mercado (AMM de Kadena) y ordenes limite ---
  [/^Ese cambio no está soportado: (.+) → (.+)$/, "That swap isn't supported: $1 → $2"],
  [/^La red del cambio no está configurada\.$/, "The swap network isn't configured."],
  [/^La red del fork no esta activa\.$/, "The fork network isn't active."],
  [/^El token (.+) no responde: su contrato está roto o no existe\.$/, "Token $1 isn't responding: its contract is broken or doesn't exist."],
  [/^El token (.+) devuelve una precisión rara\.$/, 'Token $1 returns an unusual precision.'],
  [/^No pude leer el mercado: ([\s\S]*)$/, "Couldn't read the market: $1"],
  [/^Son el mismo token\.$/, "They're the same token."],
  [/^No hay camino entre esos dos tokens en este mercado\.$/, "There's no route between those two tokens in this market."],
  [/^En este pool no hay fondo para recibir tanto\.?$/i, "This pool doesn't have enough liquidity to receive that much."],
  [/^Cambio detenido: moverías el precio un (.+)%, y el límite está en el (.+)%\. Prueba con menos cantidad: en este pool no hay fondo para tanto\.$/, "Swap stopped: you'd move the price by $1%, and the limit is $2%. Try a smaller amount: this pool doesn't have enough liquidity for that much."],
  [/^El nodo rechazó el cambio: ([\s\S]*)$/, 'The node rejected the swap: $1'],
  [/^el nodo rechazó el swap: ([\s\S]*)$/, 'the node rejected the swap: $1'],
  [/^lote$/, 'batch'],
  [/^No pude leer la liquidez del pool\.$/, "Couldn't read the pool liquidity."],
  [/^no pude leer la liquidez del pool: ([\s\S]*)$/, "couldn't read the pool liquidity: $1"],
  [/^reservas no positivas$/, 'non-positive reserves'],
  [/^El precio objetivo tiene que ser mayor que cero\.$/, 'The target price must be greater than zero.'],
  [/^La orden minima es (.+)\.$/, 'The minimum order is $1.'],
  [/^El minimo a recibir sale a cero: el pool es demasiado fino para esta orden\.$/, 'The minimum to receive comes out as zero: the pool is too thin for this order.'],
  [/^Esta orden mueve mas del (.+)% del pool: el contrato no la dejaria ejecutarse y se quedaria abierta para siempre\. Partela en varias mas pequenas\.$/, "This order moves more than $1% of the pool: the contract wouldn't let it execute and it would stay open forever. Split it into several smaller ones."],
  [/^Ahora mismo no puedo leer la liquidez del pool, y sin eso el minimo a recibir saldria demasiado alto: la orden se quedaria sin ejecutarse\. Vuelve a intentarlo en un momento\.$/, "I can't read the pool liquidity right now, and without it the minimum to receive would come out too high: the order would never execute. Try again in a moment."],
  [/^El contrato de ordenes esta pausado ahora mismo\.$/, 'The orders contract is paused right now.'],
  [/^Esa orden no es de esta wallet\.$/, "That order doesn't belong to this wallet."],
  [/^Esa orden ya no esta abierta\.$/, 'That order is no longer open.'],

  // --- Uniswap (EVM) ---
  [/^No hay (?:ningun )?pool de Uniswap para ese par\.$/, "There's no Uniswap pool for that pair."],
  [/^La comisi[oó]n no puede pasar del 1%\.$/, "The fee can't exceed 1%."],
  [/^No tienes suficiente: hay (.+) y quieres cambiar (.+)\.$/, "You don't have enough: you have $1 and want to swap $2."],
  [/^El intercambio fallo en la red\.$/, 'The swap failed on the network.'],
  [/^sirve la cadena (.+), no la (.+)$/, 'it serves chain $1, not $2'],
  [/^sin nodos disponibles$/, 'no nodes available'],

  // --- Puente ---
  [/^no pude leer el peaje del puente: ([\s\S]*)$/, "couldn't read the bridge fee: $1"],
  [/^la cuenta del peaje del puente no es válida \(posible nodo manipulado\)\.$/, "the bridge fee account isn't valid (possibly a tampered node)."],
  [/^peaje del puente fuera de rango \((.+) KDA\); operación cancelada por seguridad\.$/, 'bridge fee out of range ($1 KDA); operation cancelled for safety.'],
  [/^respuesta ilegible del nodo$/, 'unreadable response from the node'],

  // --- Venta de tokens (launch) ---
  [/^Esa venta no existe\.$/, "That sale doesn't exist."],
  [/^La red de la venta no esta configurada\.$/, "The sale's network isn't configured."],
  [/^La compra solo admite cuentas k:: el contrato crea tu cuenta del token con tu clave\.$/, 'Buying only supports k: accounts: the contract creates your token account with your key.'],
  [/^La venta no está abierta ahora mismo\.$/, "The sale isn't open right now."],
  [/^Solo quedan (.+) en la reserva y pides (.+)\.$/, 'Only $1 left in the reserve and you are asking for $2.'],
  [/^Te faltan KDA en la chain (\S+)\. La compra cuesta (\S+) KDA más el gas, y ahí tienes (\S+)\. La venta vive en la chain (\S+) y Koberlet opera en la 2, así que manda antes el KDA a esa chain\.$/, "You don't have enough KDA on chain $1. The purchase costs $2 KDA plus gas, and you have $3 there. The sale lives on chain $4 and Koberlet works on chain 2, so send the KDA to that chain first."],
  [/^El nodo rechazo la compra: ([\s\S]*)$/, 'The node rejected the purchase: $1'],

  // --- NFT ---
  [/^Esta red no tiene NFT configurados$/, 'This network has no NFTs configured'],
  [/^Esta red no tiene ledger de NFT$/, 'This network has no NFT ledger'],
  [/^El identificador de la pieza no es válido$/, "The item ID isn't valid"],
  [/^Esa cuenta no tiene esa pieza en esta red$/, "That account doesn't hold that item on this network"],
  [/^url no válida$/, 'invalid url'],
  [/^protocolo no permitido$/, 'protocol not allowed'],
  [/^destino no permitido$/, 'destination not allowed'],
  [/^demasiadas redirecciones$/, 'too many redirects'],
  [/^redirección no válida$/, 'invalid redirect'],
  [/^redirección insegura$/, 'insecure redirect'],
  [/^respuesta demasiado grande$/, 'response too large'],
  [/^tiempo agotado$/, 'timed out'],

  // --- Cuentas observadas ---
  [/^Falta la dirección\.$/, 'The address is missing.'],
  [/^Esa cuenta de Kadena no es válida\.$/, "That Kadena account isn't valid."],
  [/^Esa dirección de Ethereum no es válida\.$/, "That Ethereum address isn't valid."],
  [/^No caben más de (.+) cuentas observadas\.$/, "You can't watch more than $1 accounts."],
  [/^Esa cuenta ya está en la lista\.$/, 'That account is already on the list.'],
  [/^Esa cuenta no está en la lista\.$/, "That account isn't on the list."],

  // --- Nodos y hora ---
  [/^sin altura en la respuesta$/, 'no block height in the response'],
  [/^no contesto en (.+) s$/, 'no answer in $1 s'],
  [/^cabecera Date ilegible$/, 'unreadable Date header'],

  // --- Actualizacion ---
  [/^En este sistema la version nueva se baja a mano desde la pagina de descargas\.$/, 'On this system the new version is downloaded manually from the downloads page.'],
  [/^Esta versión no admite auto-update in-place \(falta appUrl\)\.$/, "This version doesn't support in-place auto-update (appUrl is missing)."],
  [/^Origen del paquete no autorizado \(debe ser descargas\.dnns\.es\)\.$/, 'Unauthorized package source (it must be descargas.dnns.es).'],
  [/^El paquete no está firmado; actualización rechazada por seguridad\.$/, "The package isn't signed; update rejected for security."],
  [/^descarga falló: ([\s\S]*)$/, 'download failed: $1'],
  [/^El paquete descargado no coincide con el sha256 esperado; se descarta\.$/, "The downloaded package doesn't match the expected sha256; discarded."],
  [/^Firma del paquete inválida; actualización rechazada \(posible manipulación\)\.$/, 'Invalid package signature; update rejected (possible tampering).'],
  [/^unzip código ([\s\S]*)$/, 'unzip code $1'],
  [/^el paquete no contiene la carpeta app\.$/, "the package doesn't contain the app folder."],

  // --- Trozos que van DENTRO de otros mensajes (se traducen al rellenar los huecos) ---
  [/^(?:de )?destino$/, 'destination'],
  [/^(?:de )?origen$/, 'source'],
  [/^(?:de )?consulta$/, 'lookup'],
  [/^(\d+) minutos$/, '$1 minutes'],
  [/^(\d+) segundos$/, '$1 seconds']
];

// Traduce un mensaje de error espanol de main/lib. Lo que no conoce lo deja tal cual.
// Respeta el prefijo de Electron («Error invoking remote method…») para los sitios que
// ensenan e.message sin pasar por cleanErr: asi el espanol sale igual que siempre.
function traducirError(m, prof) {
  const s = String(m == null ? '' : m);
  const partes = /^(Error invoking remote method '[^']+':\s*(?:Error:\s*)?)?([\s\S]*)$/.exec(s);
  const cabeza = partes[1] || '', cuerpo = partes[2];
  const nivel = prof || 0;
  for (const [re, en] of ERRORES_EN) {
    const r = re.exec(cuerpo);
    if (!r) continue;
    const hecho = en.replace(/\$(\d)/g, (_, n) => {
      const hueco = r[Number(n)];
      if (hueco == null) return '';
      return nivel < 2 ? traducirError(hueco, nivel + 1) : hueco;
    });
    // Un hueco vacio (p.ej. el rol de «Modulo  no valido») deja dos espacios seguidos.
    return cabeza + hecho.replace(/ {2,}/g, ' ');
  }
  return s;
}

// Para las pruebas en node (en la ventana no hay module y esto no hace nada).
if (typeof module !== 'undefined' && module.exports) module.exports = { ERRORES_EN, traducirError };
