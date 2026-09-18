// Koberlet - Copyright 2026 DNNS.es (Oberluss)
// SPDX-License-Identifier: Apache-2.0

// Mercado Kadena: cambiar cualquier token del DEX del fork por cualquier otro.
//
// El `lib/swap.js` de siempre solo sabe hacer KDA <-> kb-USDC, que es el par que usa el
// resto de la app. Esto es lo mismo pero general: se lee el mercado entero de la cadena y
// el usuario elige las dos puntas.
//
// Dos cosas que conviene tener claras sobre este DEX antes de tocar nada:
//
//  1. Casi todo son charcos. De los 82 pares, 44 no llegan a 1.000 KDA de fondo. Con esa
//     liquidez, cualquier cambio de tamaño normal mueve el precio una barbaridad.
//  2. Hay precios sin ningún sentido. `cBTC` cotiza a 104 KDA la unidad cuando un bitcoin
//     de verdad son cientos de miles; `bro` a 449.547 KDA. Nadie garantiza que el precio
//     del pool tenga que ver con el del mundo real.
//
// Por eso esto NO ofrece un catálogo bonito de tokens elegidos a mano: lee lo que hay,
// enseña el fondo y el precio que sale, y FRENA en seco por encima del 10% de impacto.
// El usuario decide, pero decide viendo los números.
const nacl = require('tweetnacl');
const blake = require('blakejs');
const ktime = require('./kdatime');

const AMM = 'kaddex.exchange';
const KDA = 'coin';
const FEE = 0.003;             // comisión del pool, 0,3%
const IMPACTO_MAX = 10;        // el freno, en %
const FONDO_MIN = 1000;        // por debajo de esto no se lista: es un charco
const GAS_1 = 8000, GAS_2 = 14000, GAS_PRECIO = 1e-8, TTL = 600;

// Comisión de servicio de Koberlet: se descuenta de lo que ENTRA, antes del cambio, y
// viaja en la misma transacción. Si el cambio revierte no se cobra nada, y si la
// comisión no se puede pagar no hay cambio. La cuenta y el porcentaje, en `comision.js`.
const { FEE: FEE_DNNS, KDA_CUENTA: CUENTA_DNNS, KDA_CLAVE: CLAVE_DNNS, reparto } = require('./comision');

// --- La gasolinera de KoberluSW ---------------------------------------------
//
// `free.ksw-gasolinera` paga el gas de las operaciones de KoberluSW. Aqui la usaban
// ya el DCA y las ordenes limite (lib/dca.js); el Mercado no, asi que el mismo
// cambio salia gratis en el movil desde la 0.57.0 y de pago en el ordenador.
//
// LO QUE EL CONTRATO EXIGE (comprobado en `tests/test-ksw-gasolinera.repl` del
// proyecto de los contratos):
//
//   - `tx-type` exec, y de una a DOS llamadas de primer nivel.
//   - cada llamada EMPIEZA por un modulo permitido: los nuestros, el AMM, o un
//     `transfer` de comision. Empieza, no contiene.
//   - si se toca el AMM directamente, la comision TIENE que ir en la misma
//     transaccion.
//   - gasPrice <= 1e-8 y gasLimit <= 8000.
//
// NADA DE ESTO AVISA CUANDO SE ROMPE: el contrato no dice «te has pasado de gas»
// ni «esa llamada no me vale». La transaccion muere comprando el gas y al usuario
// le llega «Failed to buy gas», que no se parece en nada a la causa. Por eso el
// tope se comprueba antes de firmar y la forma del codigo tiene prueba propia
// (test/gasolinera-dex.test.js).
const GASO_TOPE = 8000;         // MAX-GASLIMIT del contrato
const GASO_MARGEN = 1.3;        // sobre el gas medido: el swap varia con el pool
const MIN_GRATIS_USDC = 5;      // umbral comercial, el mismo que el movil
const USDC = 'n_e595727b657fbbb3b8e362a05a7bb8d12865c1ff.kb-USDC';

/**
 * Lo que vale la operacion en kb-USDC, si se puede saber SIN preguntar un precio.
 *
 * Se mira la pata que ya esta en kb-USDC: si se compra, lo que entra; si se vende,
 * el MINIMO garantizado que sale, no lo esperado. El minimo es lo prudente: es la
 * unica cifra que la cadena promete, y de las dos es la que no puede caerse entre
 * la cotizacion y el bloque.
 *
 * Sin ninguna pata en kb-USDC devuelve 0 y no se subvenciona: no hay forma de
 * valorarla aqui sin meter un precio de mercado en una decision que debe ser
 * simple y comprobable.
 *
 * Copia exacta de `valorEnUsdc` del movil (src/lib/dex.js).
 */
function valorEnUsdc({ de, a, cantidad, minimo }) {
  if (de === USDC) return Number(cantidad) || 0;
  if (a === USDC) return Number(minimo) || 0;
  return 0;
}

/**
 * El codigo de la transaccion, segun quien pague el gas.
 *
 * Con gasolinera, las dos llamadas van SUELTAS al nivel de arriba; sin ella, el
 * cambio va envuelto en un `let` para devolver su resultado. La diferencia no es
 * de estilo: el contrato mira que cada llamada de primer nivel empiece por un
 * modulo permitido, y `(let` no empieza por ninguno.
 */
function codigoCambio(cambio, cobro, gratis) {
  if (!cobro) return cambio;
  return gratis ? cambio + ' ' + cobro : '(let ((r ' + cambio + ')) ' + cobro + ' r)';
}

/**
 * El `envData` con lo que el gas-payer necesita leer.
 *
 * Al comprar el gas, Chainweb no le pasa al contrato el resto del mensaje: solo
 * `tx-type` y `exec-code`. Van tambien aqui porque es lo que hace el DCA de este
 * mismo proyecto (lib/dca.js) desde que funciona en produccion.
 */
function dataGasolinera(envData, code) {
  return Object.assign({}, envData, { 'tx-type': 'exec', 'exec-code': [code] });
}

/**
 * (cuenta, modulo) de la gasolinera, o null si no puede pagar.
 *
 * Se lee de la CADENA, no se escribe aqui: la cuenta sale de `(<mod>.cuenta)` y el
 * saldo de `(<mod>.saldo)`. Si no contesta o esta seca, se devuelve null y paga el
 * usuario. Misma logica que `gasolinera()` de lib/dca.js, que lleva en produccion
 * desde agosto; no se reutiliza aquella para no atar el Mercado al modulo del DCA.
 */
const GASO_MIN = 0.05;          // por debajo se da por vacia
async function gasolineraDe(cfg) {
  if (!cfg.gasolinera) return null;
  if (!/^[a-zA-Z0-9._-]{3,64}$/.test(String(cfg.gasolinera))) return null;
  try {
    const [c, s] = await Promise.all([
      local(cfg, '(' + cfg.gasolinera + '.cuenta)'),
      local(cfg, '(' + cfg.gasolinera + '.saldo)')
    ]);
    if (c.status !== 'success' || s.status !== 'success') return null;
    const saldo = num(s.data);
    if (!c.data || !isFinite(saldo) || saldo < GASO_MIN) return null;
    return { cuenta: String(c.data), saldo, modulo: String(cfg.gasolinera) };
  } catch (_) { return null; }
}

const num = (v) => (v && typeof v === 'object') ? Number(v.decimal != null ? v.decimal : v.int) : Number(v);
const hashCmd = (s) => {
  const h = blake.blake2b(Buffer.from(s, 'utf8'), null, 32);
  return { bytes: h, b64url: Buffer.from(h).toString('base64url') };
};

async function local(cfg, code) {
  const cmd = {
    networkId: cfg.networkId, payload: { exec: { code, data: {} } }, signers: [],
    meta: { chainId: String(cfg.chain), sender: '', gasLimit: 150000, gasPrice: 1e-8, ttl: 60, creationTime: Math.floor(Date.now() / 1000) - 90 },
    nonce: String(Date.now())
  };
  const s = JSON.stringify(cmd);
  const r = await fetch(cfg.node + '/chainweb/0.0/' + cfg.networkId + '/chain/' + cfg.chain + '/pact/api/v1/local?signatureVerification=false&preflight=false',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cmd: s, hash: hashCmd(s).b64url, sigs: [] }) });
  const j = await r.json();
  return j.result || {};
}

/**
 * Simula el comando DE VERDAD y devuelve cuanto gas gastaria.
 *
 * `local()` de aqui arriba va con `preflight=false`, que sirve para LEER el
 * mercado pero NO devuelve gas: por eso hasta la 2.9.1 el Mercado declaraba topes
 * fijos (8000 un salto, 14000 dos) sin medir nada. Esos topes son techo de sobra
 * -medido en cadena, el gas real de un swap va de 668 a 2312- pero no caben en el
 * limite de la gasolinera, asi que para que pague ella hay que medir.
 *
 * `preflight=true` hace que el nodo compruebe lo que comprobaria de verdad: que
 * las capabilities declaradas cubren lo que el codigo hace, y cuanto costaria.
 * `signatureVerification` sigue apagado: esto NO mueve nada y NO usa la clave.
 */
async function simular(cfg, code, data, firmantes, remitente, gasLimit) {
  const cmd = {
    networkId: cfg.networkId,
    payload: { exec: { code, data } },
    signers: firmantes || [],
    meta: {
      chainId: String(cfg.chain), sender: remitente || '', gasLimit, gasPrice: GAS_PRECIO, ttl: TTL,
      creationTime: Math.floor(Date.now() / 1000) - 90
    },
    nonce: String(Date.now())
  };
  const s = JSON.stringify(cmd);
  const r = await fetch(cfg.node + '/chainweb/0.0/' + cfg.networkId + '/chain/' + cfg.chain + '/pact/api/v1/local?signatureVerification=false&preflight=true',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cmd: s, hash: hashCmd(s).b64url, sigs: [] }) });
  const j = await r.json();
  const pf = j.preflightResult;
  return { resultado: pf ? pf.result : j.result, gas: pf ? pf.gas : j.gas };
}

// Todo el mercado en UNA sola llamada: el objeto del par ya trae las reservas dentro de
// leg0/leg1, así que los 82 pares caben en una petición en vez de 164.
//
// El `try` no es adorno: hay pares rotos en el DEX cuyo módulo ni siquiera carga, y sin
// él se caería la lectura entera por culpa de uno solo. Salen con r0 = -1 y se descartan.
//
// Aquí NO se pide la precisión de los tokens, aunque el modref del leg la sabría dar:
// `lago.USD2` está tan roto que preguntársela no da un error normal, da un «Execution
// Invariant error» del intérprete que ni `try` atrapa y que tumba la petición completa.
// La precisión se pide suelta, y solo del token que se vaya a usar.
const CODE_MERCADO = '(map (lambda (k)'
  + ' (try { "k": k, "cuenta": "", "r0": -1.0, "r1": -1.0 }'
  + '   (let ((p (' + AMM + '.get-pair-by-key k)))'
  + '     { "k": k, "cuenta": (at \'account p),'
  + '       "r0": (at \'reserve (at \'leg0 p)), "r1": (at \'reserve (at \'leg1 p)) })))'
  + ' (' + AMM + '.get-pairs))';

// Precisión por token, cacheada: la misma pregunta no se repite en toda la sesión.
const PREC = new Map();
async function precisionDe(cfg, modulo) {
  if (modulo === KDA) return 12;
  if (PREC.has(modulo)) return PREC.get(modulo);
  const r = await local(cfg, '(' + modulo + '.precision)');
  if (r.status !== 'success') {
    throw new Error('El token ' + modulo.split('.').pop() + ' no responde: su contrato está roto o no existe.');
  }
  const p = Number(num(r.data));
  if (!(p >= 0 && p <= 30)) throw new Error('El token ' + modulo.split('.').pop() + ' devuelve una precisión rara.');
  PREC.set(modulo, p);
  return p;
}

/**
 * El mercado tal y como está ahora mismo: qué se puede cambiar por qué, con cuánto fondo.
 * Solo se listan los pares contra KDA, que son los que permiten enrutar cualquier cosa
 * con cualquier cosa pasando por el medio.
 */
async function mercado(cfg) {
  const r = await local(cfg, CODE_MERCADO);
  if (r.status !== 'success') {
    throw new Error('No pude leer el mercado: ' + String((r.error && r.error.message) || '').slice(0, 160));
  }
  const pares = [];
  for (const x of (r.data || [])) {
    const [a, b] = String(x.k).split(':');
    if (!a || !b) continue;
    const ra = num(x.r0), rb = num(x.r1);
    if (!(ra > 0) || !(rb > 0)) continue;
    pares.push({
      clave: x.k, cuenta: String(x.cuenta), t0: a, t1: b, r0: ra, r1: rb
    });
  }
  // Un token por cada par contra KDA. Los pares entre dos tokens sin KDA en medio se
  // ignoran: enrutar por ellos complicaría el camino sin ganar nada.
  const tokens = [];
  for (const p of pares) {
    const conKda = p.t0 === KDA ? 1 : (p.t1 === KDA ? 0 : -1);
    if (conKda < 0) continue;
    const modulo = conKda === 1 ? p.t1 : p.t0;
    const reservaKda = conKda === 1 ? p.r0 : p.r1;
    const reservaTok = conKda === 1 ? p.r1 : p.r0;
    if (reservaKda < FONDO_MIN) continue;
    tokens.push({
      modulo, simbolo: modulo.split('.').pop(),
      fondoKda: reservaKda, reservaTok, precioKda: reservaKda / reservaTok,
      par: p.clave, cuentaPar: p.cuenta
    });
  }
  tokens.sort((x, y) => y.fondoKda - x.fondoKda);
  return { tokens, pares, kda: { modulo: KDA, simbolo: 'KDA', precision: 12 } };
}

// AMM x*y=k con la comisión del pool ya descontada.
function salidaHop(entrada, rin, rout) {
  const ef = entrada * (1 - FEE);
  return ef * rout / (rin + ef);
}

// La misma formula despejada al reves: cuanto hay que METER en un salto para que
// salga `salida`. De `salida = ef*rout/(rin+ef)` sale `ef = salida*rin/(rout-salida)`,
// y de ahi la entrada bruta deshaciendo la comision del pool.
//
// No es una aproximacion ni un tanteo: es la misma cuenta leida del otro lado. Si
// se pide mas de lo que hay en el pool no hay respuesta posible -no existe cantidad
// que lo consiga-, y eso se dice en vez de devolver un numero enorme.
function entradaHop(salida, rin, rout) {
  if (!(salida > 0)) return 0;
  if (salida >= rout) return null;             // el pool entero no da para tanto
  const ef = salida * rin / (rout - salida);
  return ef / (1 - FEE);
}

/**
 * Cuanto hay que ENTREGAR para recibir aproximadamente `salida`.
 *
 * Es una calculadora, no una forma distinta de cambiar: rellena la casilla de la
 * cantidad y a partir de ahi manda la cotizacion de siempre. La operacion que se
 * firma sigue siendo `swap-exact-in`, que es la que garantiza un minimo de salida;
 * un `swap-exact-out` dejaria abierto cuanto se entrega, que es justo lo que no
 * conviene dejar abierto.
 *
 * Por eso el numero que sale de aqui es orientativo y se dice: al escribirlo en la
 * casilla, la cotizacion normal lo recalcula hacia delante y esa es la que vale.
 */
async function cantidadPara(cfg, m, de, a, salida) {
  const objetivo = Number(salida);
  if (!(objetivo > 0)) throw new Error('La cantidad tiene que ser mayor que cero.');
  if (de === a) throw new Error('Son el mismo token.');

  let hops;
  const directo = buscaPar(m, de, a);
  if (directo) hops = [directo];
  else {
    const h1 = buscaPar(m, de, KDA), h2 = buscaPar(m, KDA, a);
    if (!h1 || !h2) throw new Error('No hay camino entre esos dos tokens en este mercado.');
    hops = [h1, h2];
  }

  // De atras hacia delante: lo que hay que meter en el ultimo salto es lo que tiene
  // que salir del anterior.
  let x = objetivo;
  for (let i = hops.length - 1; i >= 0; i--) {
    x = entradaHop(x, hops[i].rin, hops[i].rout);
    if (x === null) throw new Error('En este pool no hay fondo para recibir tanto.');
  }
  // `x` es lo que entra AL POOL; al usuario se le pide eso mas la comision, que se
  // aparta antes del cambio.
  const bruto = x / (1 - FEE_DNNS);
  const decIn = await precisionDe(cfg, de);
  // Hacia ARRIBA en el ultimo decimal: redondear hacia abajo dejaria la salida
  // sistematicamente por debajo de lo pedido, que es lo contrario de lo que espera
  // quien escribe una cifra en la casilla de la derecha.
  const f = Math.pow(10, decIn);
  const cantidad = Math.ceil(bruto * f) / f;
  return { cantidad, cantidadStr: cantidad.toFixed(decIn), decIn, saltos: hops.length };
}

function buscaPar(m, a, b) {
  const p = m.pares.find(x => (x.t0 === a && x.t1 === b) || (x.t0 === b && x.t1 === a));
  if (!p) return null;
  const dir = p.t0 === a;
  return { par: p, rin: dir ? p.r0 : p.r1, rout: dir ? p.r1 : p.r0 };
}

/**
 * Cotización. Si hay par directo se va por él; si no, se pasa por KDA en dos saltos,
 * que el `swap-exact-in` del AMM admite un camino entero en una sola transacción.
 *
 * El impacto se mide contra el precio que tendría el pool si el cambio fuese infinitamente
 * pequeño: es lo que de verdad se paga de más por mover el precio, comisión aparte.
 */
async function cotizar(cfg, m, de, a, cantidad, slippage) {
  const cant = Number(cantidad);
  if (!(cant > 0)) throw new Error('La cantidad tiene que ser mayor que cero.');
  if (de === a) throw new Error('Son el mismo token.');
  const slip = slippage == null ? 0.005 : Number(slippage);

  let camino, hops;
  const directo = buscaPar(m, de, a);
  if (directo) {
    camino = [de, a];
    hops = [directo];
  } else {
    const h1 = buscaPar(m, de, KDA), h2 = buscaPar(m, KDA, a);
    if (!h1 || !h2) throw new Error('No hay camino entre esos dos tokens en este mercado.');
    camino = [de, KDA, a];
    hops = [h1, h2];
  }

  // La comisión de Koberlet se aparta ANTES: al pool entra lo que queda. Si el mínimo
  // se calculase sobre el bruto quedaría por encima de lo que el pool puede dar con el
  // neto, y el cambio revertiría siempre.
  const decIn = await precisionDe(cfg, de);
  const { comision, alPool, comisionStr, alPoolStr } = reparto(cant, decIn);
  if (!(alPool > 0)) throw new Error('Esa cantidad es demasiado pequeña para este token.');

  // Precio si el cambio fuese infinitamente pequeño, encadenando los saltos.
  let spot = 1;
  for (const h of hops) spot *= h.rout / h.rin;
  // Salida de verdad: cada salto es su propio pool y come de lo que salió del anterior.
  let x = alPool;
  for (const h of hops) x = salidaHop(x, h.rin, h.rout);

  // El impacto se mide sobre lo que de verdad entra en el pool: la comisión se enseña
  // aparte y contarla aquí la contaría dos veces, además de acercar el freno del 10%.
  const ideal = alPool * spot;
  const impacto = ideal > 0 ? Math.max(0, (1 - x / ideal) * 100) : 100;
  // El minimo de salida tiene que caber en la precision del token, o el contrato lo
  // rechaza por `enforce-unit`. Doce decimales para un token de seis no valen.
  const decOut = await precisionDe(cfg, a);
  const minimo = x * (1 - slip);
  return {
    camino, esperada: x, minimo, minimoStr: minimo.toFixed(decOut), decOut,
    impacto, impactoMax: IMPACTO_MAX, frenado: impacto > IMPACTO_MAX,
    comision, alPool, comisionStr, alPoolStr, decIn, comisionPct: FEE_DNNS * 100,
    precioEfectivo: x / cant, precioSpot: spot, slippagePct: slip * 100,
    cuentaPrimerPar: hops[0].par.cuenta, saltos: hops.length,
    fondoEntrada: hops[0].rin
  };
}

/**
 * Firma y envía el cambio. Se relee el mercado justo antes: entre que se cotiza y se firma
 * el pool ha podido moverse, y el mínimo de salida tiene que salir de reservas frescas.
 *
 * El freno del 10% se vuelve a comprobar aquí, no solo en la pantalla: el renderer puede
 * mentir, la cadena no.
 */
async function cambiar(cfg, o) {
  if (!/^k:[0-9a-fA-F]{64}$/.test(String(o.cuenta))) throw new Error('Cuenta Kadena no válida.');
  if (String(o.cuenta).slice(2).toLowerCase() !== String(o.publicHex).toLowerCase()) {
    throw new Error('Esta wallet no es la dueña de esa cuenta.');
  }
  const m = await mercado(cfg);
  const q = await cotizar(cfg, m, o.de, o.a, o.cantidad, o.slippage);
  if (q.frenado) {
    throw new Error('Cambio detenido: moverías el precio un ' + q.impacto.toFixed(1) +
      '%, y el límite está en el ' + IMPACTO_MAX + '%. Prueba con menos cantidad: en este pool no hay fondo para tanto.');
  }

  const camino = q.camino.join(' ');
  const cambio = '(' + AMM + '.swap-exact-in (read-decimal "amountIn") (read-decimal "amountOutMin") ['
    + camino + '] "' + o.cuenta + '" "' + o.cuenta + '" (read-keyset "ks"))';
  // El cambio y el cobro, atados en una sola transacción: o pasan las dos cosas o no
  // pasa ninguna. `transfer-create` porque la cuenta que cobra puede no existir aún en
  // el token que entra.
  const cobro = q.comision > 0
    ? '(' + o.de + '.transfer-create "' + o.cuenta + '" "' + CUENTA_DNNS
      + '" (read-keyset "ks-koberlet") (read-decimal "comision"))'
    : null;
  const envData = {
    amountIn: { decimal: q.alPoolStr },
    amountOutMin: { decimal: q.minimoStr },
    ks: { keys: [o.publicHex], pred: 'keys-all' }
  };
  const transfers = [
    // La primera pata sale de la cuenta del usuario y entra en el pool del primer salto.
    { name: o.de + '.TRANSFER', args: [o.cuenta, q.cuentaPrimerPar, { decimal: q.alPoolStr }] }
  ];
  if (q.comision > 0) {
    envData.comision = { decimal: q.comisionStr };
    envData['ks-koberlet'] = { keys: [CLAVE_DNNS], pred: 'keys-all' };
    // La firma acota el cobro: esa cuenta y esa cifra exacta, ni un céntimo más.
    transfers.push({ name: o.de + '.TRANSFER', args: [o.cuenta, CUENTA_DNNS, { decimal: q.comisionStr }] });
  }

  // ¿Puede pagar la gasolinera?
  //
  // Por IMPORTE se sabe ya. Por GAS, solo simulando: el tope del contrato mira el
  // gas que se FIRMA, no el que se gasta, y los topes fijos de siempre (8000/14000,
  // +4000 con comisión) no caben. Así que se mide con el comando que se firmaría si
  // pagara ella —las dos llamadas sueltas— para que el gas medido sea el bueno.
  //
  // Si algo de esto falla se sigue adelante pagando el usuario. Un cambio nunca se
  // queda sin hacer porque la gasolinera no esté: peor que pagar el gas es no poder
  // operar.
  let gratis = false, gasGratis = 0, gaso = null;
  const usdc = valorEnUsdc({ de: o.de, a: o.a, cantidad: o.cantidad, minimo: q.minimoStr });
  if (q.comision > 0 && usdc >= MIN_GRATIS_USDC) {
    gaso = await gasolineraDe(cfg);
    if (gaso) {
      const codeGratis = codigoCambio(cambio, cobro, true);
      const clistSim = [{ name: gaso.modulo + '.GAS_PAYER', args: [o.cuenta, GASO_TOPE, GAS_PRECIO] }].concat(transfers);
      try {
        const sim = await simular(cfg, codeGratis, dataGasolinera(envData, codeGratis),
          [{ pubKey: o.publicHex, clist: clistSim }], gaso.cuenta, GASO_TOPE);
        const bien = !!sim.resultado && sim.resultado.status === 'success';
        gasGratis = Math.ceil((sim.gas || 0) * GASO_MARGEN);
        // Un gas medido sobre un cambio que falla no dice nada, y con él se firmaría
        // un límite inventado.
        gratis = bien && gasGratis > 0 && gasGratis <= GASO_TOPE;
      } catch (_) { gratis = false; }
    }
  }

  const code = codigoCambio(cambio, cobro, gratis);
  const clist = gratis
    // La GAS_PAYER va la PRIMERA, como en KoberluSW, y en lugar de `coin.GAS`: el gas
    // no sale de la cuenta del usuario, así que no tiene nada que acotar ahí.
    ? [{ name: gaso.modulo + '.GAS_PAYER', args: [o.cuenta, gasGratis, GAS_PRECIO] }].concat(transfers)
    : [{ name: 'coin.GAS', args: [] }].concat(transfers);
  const data = gratis ? dataGasolinera(envData, code) : envData;
  const cmd = {
    networkId: cfg.networkId,
    payload: { exec: { code, data } },
    signers: [{ pubKey: o.publicHex, clist }],
    meta: {
      chainId: String(cfg.chain),
      sender: gratis ? gaso.cuenta : o.cuenta,
      // Pagando el usuario se declara el techo de siempre, que sobra y no molesta.
      // Pagando la gasolinera va el medido con margen, porque ahí el techo se mira.
      // Con la comisión la transacción lleva una transferencia más: el gas sube con ella.
      gasLimit: gratis ? gasGratis : (q.saltos === 1 ? GAS_1 : GAS_2) + (q.comision > 0 ? 4000 : 0),
      gasPrice: GAS_PRECIO, ttl: TTL,
      creationTime: await ktime.creationTime(cfg.node, cfg.networkId, cfg.chain)
    },
    nonce: 'koberlet-dex:' + Date.now()
  };
  const cmdStr = JSON.stringify(cmd);
  const { bytes, b64url } = hashCmd(cmdStr);
  const kp = nacl.sign.keyPair.fromSeed(Buffer.from(o.secretHex, 'hex'));
  const sig = Buffer.from(nacl.sign.detached(bytes, kp.secretKey)).toString('hex');
  const res = await fetch(cfg.node + '/chainweb/0.0/' + cfg.networkId + '/chain/' + cfg.chain + '/pact/api/v1/send',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cmds: [{ hash: b64url, sigs: [{ sig }], cmd: cmdStr }] }) });
  const txt = await res.text();
  let j;
  try { j = JSON.parse(txt); }
  catch (_) { throw new Error('El nodo rechazó el cambio: ' + txt.replace(/\s+/g, ' ').slice(0, 200)); }
  if (!j.requestKeys || !j.requestKeys[0]) {
    throw new Error('El nodo no devolvió requestKey: ' + JSON.stringify(j).slice(0, 200));
  }
  return {
    requestKey: j.requestKeys[0], chain: String(cfg.chain), minimo: q.minimoStr,
    camino: q.camino, impacto: q.impacto, comision: q.comisionStr, alPool: q.alPoolStr,
    // Para que la pantalla pueda decirlo: quien ha pagado el gas y cuanto se firmo.
    gratis, gasFirmado: gratis ? gasGratis : null, usdc
  };
}

module.exports = {
  mercado, cotizar, cambiar, cantidadPara, precisionDe, reparto,
  IMPACTO_MAX, FONDO_MIN, FEE_DNNS, CUENTA_DNNS, CLAVE_DNNS,
  // Para las pruebas: las dos piezas que fallan en silencio si se tocan.
  valorEnUsdc, codigoCambio, MIN_GRATIS_USDC, GASO_TOPE, GASO_MARGEN
};
