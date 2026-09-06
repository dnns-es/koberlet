// Ordenes limite de KoberluSW sobre el contrato free.ksw2 (fork comunitario,
// mainnet01, chain 2). Mismo contrato y mismas cuentas que usa la web: una orden
// creada aqui y otra creada en koberlusw.dnns.es son indistinguibles.
//
// Reparto de papeles, igual que en el DCA:
//   - el CONTRATO custodia el deposito y hace el swap cuando el precio llega
//   - un VIGILANTE externo despierta la ejecucion y paga SU PROPIO gas
//   - Koberlet solo CREA y CANCELA: aqui no se ejecuta ninguna orden
//
// El contrato vuelve a leer el precio y calcula su propio minimo antes de ejecutar,
// asi que el vigilante no puede ejecutar a mal precio ni desviar fondos. Por eso se
// puede depender de un vigilante ajeno sin darle ningun poder sobre el dinero.
//
// La transaccion se arma aqui y la firma el usuario: no se le pide a ningun servidor
// que nos prepare lo que vamos a firmar.
const dca = require('./dca');

// Comision del pool de kaddex. Vive en el contrato (FEE) y no la fija Koberlet.
const FEE_POOL = 0.003;
// El mismo que usa KoberluSW en produccion para ordenes. Es holgado a proposito: el
// disparo ocurre horas o dias despues de firmar, y para entonces el pool se ha movido.
const SLIPPAGE_DEFECTO = 0.05;

// Valores del contrato. Se leen de la cadena y esto es solo el suelo por si el nodo
// no responde: si el contrato los cambia, manda el contrato, no esta tabla.
const SUELO = { fee: 0.005, ttlMax: 3153600000, poolFrac: 0.1, minKda: 100, minUsdc: 1 };

const num = (v) => {
  const n = Number(typeof v === 'object' && v ? (v.decimal != null ? v.decimal : v.int) : v);
  return isFinite(n) ? n : 0;
};

// Decimal en notacion fija y SIEMPRE truncando hacia abajo. Truncar importa: si el
// minimo a recibir se redondea hacia arriba, aunque sea en el ultimo decimal, la
// ejecucion revierte y el vigilante la reintenta sin fin.
function fijo(n, precision) {
  const p = Math.max(1, Math.min(12, precision | 0));
  const f = Math.pow(10, p);
  const t = Math.floor(Number(n) * f) / f;
  return t.toFixed(p);
}

let _cache = null;
/**
 * Limites que exige el contrato, leidos de la cadena (se cachean 5 minutos).
 * Se piden para poder avisar al usuario ANTES de firmar y gastar gas, no para
 * sustituir al contrato: el que decide sigue siendo el.
 */
async function limites(cfg) {
  const mod = dca.modOk(cfg.moduloOrdenes, 'de ordenes');
  if (_cache && _cache.mod === mod && Date.now() - _cache.ts < 300000) return _cache.v;
  const pide = async (nombre, suelo) => {
    try {
      const n = num(await dca.leer(cfg, mod + '.' + nombre));
      return n > 0 ? n : suelo;
    } catch (_) { return suelo; }
  };
  const [fee, ttlMax, poolFrac, minKda, minUsdc] = await Promise.all([
    pide('DNNS-FEE', SUELO.fee), pide('MAX-TTL-SECONDS', SUELO.ttlMax),
    pide('MAX-POOL-FRACTION', SUELO.poolFrac), pide('MIN-IN-KDA', SUELO.minKda),
    pide('MIN-IN-USDC', SUELO.minUsdc)
  ]);
  const v = { fee, ttlMax, poolFrac, minKda, minUsdc, slippageDefecto: SLIPPAGE_DEFECTO };
  _cache = { mod, ts: Date.now(), v };
  return v;
}

const modOrd = (cfg) => dca.modOk(cfg.moduloOrdenes, 'de ordenes');
const pausado = (cfg) => dca.leer(cfg, '(' + modOrd(cfg) + '.paused)');
const custodia = (cfg) => dca.leer(cfg, '(' + modOrd(cfg) + '.custody-account)');

/**
 * Reservas del par en el AMM. El modulo del AMM va fijo porque el contrato de ordenes
 * tambien lo lleva fijo (kaddex.exchange): apuntar a otro sitio solo serviria para
 * calcular el minimo contra un pool que no es el que va a ejecutar la orden.
 */
async function reservas(cfg, par) {
  const tk = dca.modOk(par.kda.modulo, 'KDA'), tu = dca.modOk(par.usdc.modulo, 'kb-USDC');
  const code = '(let ((p (kaddex.exchange.get-pair-by-key "' + tk + ':' + tu + '"))) '
    + '[(kaddex.exchange.reserve-for p ' + tk + ') (kaddex.exchange.reserve-for p ' + tu + ')])';
  const l = await dca.leer(cfg, code);
  const rk = num(l && l[0]), ru = num(l && l[1]);
  if (!(rk > 0) || !(ru > 0)) throw new Error('No pude leer la liquidez del pool.');
  return { rk, ru, precio: ru / rk };
}

// Salida esperada y minima del swap (AMM x*y=k con la comision del pool).
function salida(direccion, entrada, rk, ru, slippage) {
  const [rin, rout] = direccion === 'compra' ? [ru, rk] : [rk, ru];
  const ef = entrada * (1 - FEE_POOL);
  const esperada = ef * rout / (rin + ef);
  return { esperada, minimo: esperada * (1 - slippage) };
}

/**
 * Cuentas de una orden antes de firmarla.
 *
 * El minimo a recibir tiene que contar el empujon que el propio swap le da al pool,
 * no el precio "de pizarra": en un pool fino, cantidad x precio sobreestima la salida,
 * la ejecucion revierte por "insufficient output amount" y el vigilante la reintenta
 * sin fin — la orden no entra nunca. Se estiman las reservas en el momento del disparo
 * (k = rk*ru constante, spot = precio objetivo) y se usa la misma formula que el swap.
 *
 * Y se calcula sobre el NETO: el contrato se queda su comision del token de entrada
 * ANTES de swapear, asi que el minimo tiene que mirar lo que de verdad entra al pool.
 */
async function cotizar(cfg, o) {
  const par = o.par;
  const direccion = o.direccion;
  if (direccion !== 'compra' && direccion !== 'venta') throw new Error('Direccion no valida.');
  const precio = Number(o.precio);
  if (!(precio > 0)) throw new Error('El precio objetivo tiene que ser mayor que cero.');
  const L = await limites(cfg);
  const slip = o.slippage == null ? L.slippageDefecto : Number(o.slippage);
  if (!(slip >= 0 && slip <= 0.5)) throw new Error('El deslizamiento va de 0 a 0,5 (50%).');

  // En venta se entrega KDA y se recibe kb-USDC; en compra, al reves.
  const tIn = direccion === 'venta' ? par.kda : par.usdc;
  const tOut = direccion === 'venta' ? par.usdc : par.kda;
  const cantidad = fijo(o.cantidad, tIn.precision);
  if (!(Number(cantidad) > 0)) throw new Error('La cantidad es demasiado pequena.');

  // Minimo del contrato (enforce-min-in): por debajo, create-order revierte.
  const minIn = direccion === 'venta' ? L.minKda : L.minUsdc;
  if (Number(cantidad) < minIn) {
    throw new Error('La orden minima es ' + minIn + ' ' + tIn.simbolo + '.');
  }

  // El precio objetivo se pide SIEMPRE en kb-USDC por KDA, que es como lo piensa
  // cualquiera. El contrato compara token-in -> token-out, asi que al comprar KDA hay
  // que darle la vuelta: 1 kb-USDC vale 1/precio KDA.
  const trigger = fijo(direccion === 'venta' ? precio : 1 / precio, 12);

  const comision = Number(fijo(Number(cantidad) * L.fee, tIn.precision));
  const neta = Number(cantidad) - comision;

  let esperada = null, minimo = null, impacto = null, avisoPool = null, conPool = true;
  try {
    const { rk, ru } = await reservas(cfg, par);
    const k = rk * ru;
    const rkT = Math.sqrt(k / precio);        // reserva KDA estimada al disparar
    const ruT = Math.sqrt(k * precio);        // reserva kb-USDC estimada al disparar
    const s = salida(direccion, neta, rkT, ruT, slip);
    esperada = s.esperada; minimo = s.minimo;
    // El contrato exige que lo que entra al pool no pase de MAX-POOL-FRACTION de la
    // reserva. Una orden mas gorda se queda abierta para siempre sin salir nunca lista.
    const rin = direccion === 'compra' ? ruT : rkT;
    impacto = neta / (rin + neta) * 100;
    if (neta > rin * L.poolFrac) {
      avisoPool = 'Esta orden mueve mas del ' + Math.round(L.poolFrac * 100) + '% del pool: el contrato '
        + 'no la dejaria ejecutarse y se quedaria abierta para siempre. Partela en varias mas pequenas.';
    }
  } catch (e) {
    // Sin liquidez legible no se bloquea al usuario: se cae al minimo conservador de
    // toda la vida (precio de pizarra menos el deslizamiento).
    if (/pool|liquidez/i.test(String(e && e.message))) {
      minimo = (direccion === 'venta' ? neta * precio : neta / precio) * (1 - slip);
      conPool = false;
    } else throw e;
  }
  const minOut = fijo(minimo, tOut.precision);
  if (!(Number(minOut) > 0)) throw new Error('El minimo a recibir sale a cero: el pool es demasiado fino para esta orden.');

  return {
    direccion, cantidad, trigger, minOut, comision, neta, precio, slippage: slip,
    esperada, impacto, avisoPool, conPool, ttl: L.ttlMax, limites: L,
    tokenIn: tIn, tokenOut: tOut
  };
}

/**
 * Crear una orden. Se firman EXACTAMENTE dos capabilities y ninguna mas:
 *   coin.GAS  y  <token-in>.TRANSFER dueño -> custodia por el deposito.
 * El deposito sale en la MISMA transaccion: no hay ningun momento en que el contrato
 * tenga la orden apuntada sin el dinero detras.
 */
async function crearOrden(cfg, o) {
  dca.exigirDueno(o.owner, o.publicHex);
  const mod = modOrd(cfg);
  const q = await cotizar(cfg, o);
  if (q.avisoPool) throw new Error(q.avisoPool);
  // Sin poder leer el pool, el minimo sale del precio "de pizarra" y queda MAS ALTO
  // que lo que el swap daria de verdad: la orden se crearia para no ejecutarse nunca.
  // Antes que dejar el deposito atrapado esperando una cancelacion, no se firma.
  if (!q.conPool) throw new Error('Ahora mismo no puedo leer la liquidez del pool, y sin eso el minimo a recibir saldria demasiado alto: la orden se quedaria sin ejecutarse. Vuelve a intentarlo en un momento.');
  if (await pausado(cfg)) throw new Error('El contrato de ordenes esta pausado ahora mismo.');

  const cust = await custodia(cfg);
  await dca.avisarGas(cfg, {
    owner: o.owner, tokenIn: q.tokenIn.modulo, deposito: q.cantidad,
    hayGasolinera: !!(await dca.gasolinera(cfg))
  });

  // El contrato exige que el id empiece por los 10 primeros caracteres del dueño
  // (enforce-safe-id). Misma convencion que KoberluSW.
  const id = dca.nuevoId(o.owner);
  const code = '(' + mod + '.create-order "' + id + '" "' + o.owner + '" (read-keyset "ks") '
    + q.tokenIn.modulo + ' ' + q.tokenOut.modulo + ' ' + q.cantidad + ' ' + q.trigger + ' '
    + q.minOut + ' ' + fijo(q.ttl, 1) + ')';
  const r = await dca.firmarYEnviar(cfg, {
    code: code,
    data: { ks: { keys: [o.publicHex], pred: 'keys-all' } },
    clist: [
      { name: 'coin.GAS', args: [] },
      { name: q.tokenIn.modulo + '.TRANSFER', args: [o.owner, cust, { decimal: q.cantidad }] }
    ],
    from: o.owner, secretHex: o.secretHex, publicHex: o.publicHex,
    gasLimit: 12000, nonce: 'koberlet-orden'
  });
  return Object.assign({}, r, { id: id, resumen: q });
}

// Cancelar: solo la firma del dueño (el contrato hace enforce-guard). Devuelve el
// deposito entero, sin comision, y funciona aunque el servicio este en pausa.
async function cancelarOrden(cfg, o) {
  dca.exigirDueno(o.owner, o.publicHex);
  const mod = modOrd(cfg);
  const id = dca.idOk(o.id);
  const orden = await dca.leer(cfg, '(' + mod + '.get-order "' + id + '")');
  if (String(orden.owner) !== String(o.owner)) throw new Error('Esa orden no es de esta wallet.');
  if (String(orden.status) !== 'open') throw new Error('Esa orden ya no esta abierta.');
  return dca.firmarYEnviar(cfg, {
    code: '(' + mod + '.cancel-order "' + id + '")',
    clist: [{ name: 'coin.GAS', args: [] }],
    from: o.owner, secretHex: o.secretHex, publicHex: o.publicHex,
    gasLimit: 10000, nonce: 'koberlet-orden-cancelar'
  });
}

/**
 * Da la vuelta a una orden de la cadena para poder enseñarla.
 * El precio se muestra SIEMPRE en kb-USDC por KDA: en las compras hay que invertir el
 * trigger, porque el contrato lo guarda como kb-USDC -> KDA y ese numero no le dice
 * nada a nadie.
 */
function normalizar(o, par) {
  const tin = dca.refMod(o['token-in']);
  const lado = tin === par.kda.modulo ? 'venta' : 'compra';
  const trig = num(o['trigger-price']);
  const exp = o['expires-at'];
  return {
    id: o.id, lado: lado, owner: o.owner,
    cantidad: num(o['amount-in']),
    precio: lado === 'venta' ? trig : (trig > 0 ? 1 / trig : 0),
    minimo: num(o['min-out']),
    simIn: lado === 'venta' ? par.kda.simbolo : par.usdc.simbolo,
    simOut: lado === 'venta' ? par.usdc.simbolo : par.kda.simbolo,
    caduca: (exp && typeof exp === 'object') ? (exp.timep || exp.time || null) : (exp || null)
  };
}

/**
 * Todas las ordenes abiertas, ya normalizadas.
 * OJO: el contrato no tiene lectura por dueño, solo `list-open`, que devuelve las de
 * TODO el mundo. Se pide UNA vez y se reparte aqui. Hoy son dos docenas y no duele,
 * pero si el libro crece habra que pedirle al contrato una lectura por dueño.
 */
async function todas(cfg, par) {
  const abiertas = await dca.todasLasOrdenes(cfg);
  return (abiertas || []).map((o) => normalizar(o, par));
}

module.exports = { limites, pausado, custodia, reservas, cotizar, crearOrden, cancelarOrden, todas, normalizar, fijo, SLIPPAGE_DEFECTO };
