// Koberlet - Copyright 2026 DNNS.es (Oberluss)
// SPDX-License-Identifier: Apache-2.0

// WalletConnect v2: deja que una web de fuera (una dApp) le pida a Koberlet que firme.
//
// POR QUE ESTE FICHERO VIVE EN EL PROCESO PRINCIPAL Y NO EN EL RENDERER:
// aqui llegan peticiones de gente de fuera. El renderer es HTML; si el transporte
// estuviera alli, una pagina cargada en la ventana compartiria proceso con quien nos
// manda comandos. Aqui no toca claves ni bóveda: recibe, avisa y espera respuesta.
//
// QUE SE HABLA CON LA dAPP (KIP-017, el estandar de Kadena sobre WalletConnect):
//   - la sesion se abre sobre la cadena `kadena:mainnet01`;
//   - las cuentas viajan como `kadena:mainnet01:<clave publica hex>`, y la dApp deduce
//     de ahi la cuenta `k:<clave publica>`. Medido contra play.smartpacts.io el
//     24/09/2026: si no mandamos ese formato exacto, la web dice que el monedero
//     conecto "para otra red" y corta;
//   - `kadena_getAccounts_v1` pregunta que cuentas hay. Se responde aqui mismo: no
//     mueve dinero y son datos que el usuario ya acepto enseñar al conectar;
//   - `kadena_quicksign_v1` es "firma esto". ESO NO SE RESPONDE SOLO NUNCA: sale por
//     `alPedirFirma` para que la ventana enseñe que se firma y lo decida una persona.
//
// La regla de oro de este fichero: de aqui no sale una firma que nadie haya visto.

const { Core } = require('@walletconnect/core');
const { WalletKit } = require('@reown/walletkit');

const CADENA = 'kadena:mainnet01';
const METODOS = ['kadena_getAccounts_v1', 'kadena_quicksign_v1'];

let kit = null;
let pendientes = new Map();   // id de peticion -> { resolve, reject } de la ventana

// Datos que la dApp enseña de nosotros al conectar. El `url` es el de descargas, no
// una web cualquiera: es lo que vera el usuario en la otra pantalla.
const METADATOS = {
  name: 'Koberlet',
  description: 'Monedero Kadena de DNNS',
  url: 'https://descargas.dnns.es',
  icons: ['https://descargas.dnns.es/kob7t2m9x4/koberlet/icono.png']
};

/**
 * Arranca el transporte. `alProponer` y `alPedirFirma` son funciones que avisan a la
 * ventana; reciben lo justo para poder enseñarlo y decidir.
 */
async function arrancar({ projectId, alProponer, alPedirFirma, alCerrar }) {
  if (kit) return kit;
  if (!projectId) throw new Error('WC_SIN_PROJECTID');
  const core = new Core({ projectId });
  kit = await WalletKit.init({ core, metadata: METADATOS });

  kit.on('session_proposal', (p) => {
    const m = (p.params && p.params.proposer && p.params.proposer.metadata) || {};
    // Lo que se manda a la ventana es lo que el usuario tiene que juzgar. OJO: `nombre`
    // y `url` los declara la propia dApp, asi que son UNA PISTA, NO UNA PRUEBA. Quien
    // decide de verdad es el usuario, que ha pegado el enlace de esa pagina hace un rato.
    alProponer({
      id: p.id,
      nombre: String(m.name || '?'),
      url: String(m.url || '?'),
      metodos: metodosPedidos(p.params)
    });
  });

  kit.on('session_request', async (ev) => {
    const { topic, params, id } = ev;
    const metodo = params && params.request && params.request.method;
    const sesion = kit.getActiveSessions()[topic];
    const quien = (sesion && sesion.peer && sesion.peer.metadata) || {};

    if (metodo === 'kadena_getAccounts_v1') {
      try { await responder(topic, id, cuentasDeSesion(sesion)); }
      catch (e) { await fallar(topic, id, e.message); }
      return;
    }
    if (metodo === 'kadena_quicksign_v1') {
      const comandos = (params.request.params && params.request.params.commandSigDatas) || [];
      alPedirFirma({
        id, topic,
        nombre: String(quien.name || '?'),
        url: String(quien.url || '?'),
        comandos: comandos.map((c) => ({ cmd: String(c.cmd || ''), sigs: c.sigs || [] }))
      });
      return;
    }
    // Un metodo que no ofrecimos no se contesta a medias: se rechaza y se dice cual.
    await fallar(topic, id, 'metodo no soportado: ' + metodo);
  });

  kit.on('session_delete', (ev) => { try { alCerrar && alCerrar(ev.topic); } catch (_) {} });
  return kit;
}

function metodosPedidos(params) {
  const ns = Object.assign({}, params.requiredNamespaces, params.optionalNamespaces);
  const k = ns.kadena || {};
  return k.methods || [];
}

// Las cuentas tal y como las espera la dApp, sacadas de la propia sesion: lo que se
// aprobo es lo que se contesta, sin volver a mirar la boveda.
function cuentasDeSesion(sesion) {
  const lista = ((sesion && sesion.namespaces && sesion.namespaces.kadena) || {}).accounts || [];
  return {
    accounts: lista.map((caip) => {
      const pub = caip.slice(CADENA.length + 1);
      return {
        account: caip,
        publicKey: pub,
        kadenaAccounts: [{ name: 'k:' + pub, contract: 'coin', chains: [] }]
      };
    })
  };
}

async function emparejar(uri) {
  if (!kit) throw new Error('WC_SIN_ARRANCAR');
  if (!/^wc:[0-9a-f]{64}@2\?/i.test(String(uri).trim())) throw new Error('WC_URI_MALA');
  return kit.pair({ uri: String(uri).trim() });
}

/**
 * Aprueba la sesion con las claves publicas indicadas. `claves` son hex de 64, sin `k:`:
 * la cuenta se arma aqui para que la dApp reciba siempre el mismo formato.
 */
async function aprobarSesion(id, claves) {
  if (!kit) throw new Error('WC_SIN_ARRANCAR');
  const buenas = (claves || []).filter((k) => /^[0-9a-f]{64}$/i.test(k));
  if (!buenas.length) throw new Error('WC_SIN_CUENTAS');
  // No se mira antes si la propuesta sigue viva: `getPendingSessionProposals()` no la
  // lista todavia en el mismo tick en que llega el evento, y ese "freno" rechazaba
  // propuestas buenas. Si de verdad ha caducado, lo dice el propio SDK al aprobar.
  return kit.approveSession({
    id,
    namespaces: {
      kadena: {
        chains: [CADENA],
        methods: METODOS,
        events: [],
        accounts: buenas.map((k) => CADENA + ':' + k.toLowerCase())
      }
    }
  });
}

async function rechazarSesion(id) {
  if (!kit) throw new Error('WC_SIN_ARRANCAR');
  return kit.rejectSession({ id, reason: { code: 5000, message: 'rechazado en el monedero' } });
}

async function responder(topic, id, result) {
  return kit.respondSessionRequest({ topic, response: { id, jsonrpc: '2.0', result } });
}

async function fallar(topic, id, mensaje) {
  return kit.respondSessionRequest({
    topic,
    response: { id, jsonrpc: '2.0', error: { code: 5000, message: String(mensaje || 'rechazado') } }
  });
}

function sesiones() {
  if (!kit) return [];
  const act = kit.getActiveSessions();
  return Object.keys(act).map((topic) => {
    const s = act[topic];
    const m = (s.peer && s.peer.metadata) || {};
    return {
      topic,
      nombre: String(m.name || '?'),
      url: String(m.url || '?'),
      cuentas: ((s.namespaces && s.namespaces.kadena) || {}).accounts || []
    };
  });
}

async function desconectar(topic) {
  if (!kit) return;
  try { await kit.disconnectSession({ topic, reason: { code: 6000, message: 'cerrado por el usuario' } }); }
  catch (_) { /* si ya no existe, no hay nada que cerrar */ }
}

module.exports = {
  arrancar, emparejar, aprobarSesion, rechazarSesion,
  responder, fallar, sesiones, desconectar, CADENA, METODOS
};
