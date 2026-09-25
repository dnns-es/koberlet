// Koberlet - Copyright 2026 DNNS.es (Oberluss)
// SPDX-License-Identifier: Apache-2.0

// WalletConnect con lo que pide mercatusdex.fun de verdad (25/09/2026). En el movil hizo
// falta arreglar tres cosas, una detras de otra, y el escritorio tenia las tres:
//   1. la web pide TRES redes y se aprobaba una ("Non conforming namespaces");
//   2. exige kadena_sign_v1 y solo se sabia quicksign;
//   3. exige el aviso kadena_transaction_updated y se rechazaba cualquier aviso.
//
//   node test/wc-mercatus.test.js
const assert = require('assert');
const { loQuePide, namespacesParaAprobar } = require('../lib/wc-namespaces');
const { comandoDeFirma, respuestaFirmada } = require('../lib/wc-comando');
const { METODOS, CADENA } = require('../lib/walletconnect');

const CLAVE = 'd0439ab37b47745f2a7a172ce73cd03097ae2dc661f3505ceb73f3c835d1fc4f';
const OTRA = 'e5b947889c87fc5057ed35fa31302f57a248c33d0bbdb20a9c81500e2f3748df';

// Lo que manda Mercatus al conectar.
const pedido = {
  obliga: loQuePide({ kadena: {
    chains: ['kadena:mainnet01', 'kadena:testnet04', 'kadena:development'],
    methods: ['kadena_sign_v1', 'kadena_quicksign_v1'],
    events: ['kadena_transaction_updated'] } }),
  suelta: loQuePide({})
};
const ns = namespacesParaAprobar(pedido, [CLAVE, OTRA], { cadena: CADENA, metodos: METODOS });
assert.deepStrictEqual(ns.kadena.chains, ['kadena:mainnet01', 'kadena:testnet04', 'kadena:development'], '1: las tres redes, mainnet primero');
assert.ok(ns.kadena.methods.includes('kadena_sign_v1'), '2: sign_v1 aprobado');
assert.deepStrictEqual(ns.kadena.events, ['kadena_transaction_updated'], '3: el aviso aprobado');
assert.strictEqual(ns.kadena.accounts[0], 'kadena:mainnet01:' + CLAVE, 'la elegida la primera');

// Un metodo que no sabemos hacer sigue sin prometerse.
assert.throws(() => namespacesParaAprobar({ obliga: loQuePide({ kadena: { chains: [CADENA], methods: ['kadena_inventado_v9'] } }) },
  [CLAVE], { cadena: CADENA, metodos: METODOS }), /WC_METODO_RARO/);

// sign_v1: la web manda las piezas y el comando se monta aqui.
const cmd = JSON.parse(comandoDeFirma({
  code: '(coin.transfer "k:' + CLAVE + '" "k:' + OTRA + '" 1.0)',
  caps: [{ cap: { name: 'coin.TRANSFER', args: ['k:' + CLAVE, 'k:' + OTRA, 1.0] } }, { cap: { name: 'coin.GAS', args: [] } }],
  sender: 'k:' + CLAVE, chainId: '2', gasLimit: 2500
}, 'mainnet01', CLAVE));
assert.strictEqual(cmd.networkId, 'mainnet01');
assert.strictEqual(cmd.meta.chainId, '2');
assert.deepStrictEqual(cmd.signers[0].clist.map((c) => c.name), ['coin.TRANSFER', 'coin.GAS'], 'permisos tal cual');
const r = respuestaFirmada('kadena_sign_v1', [{ cmd: 'x', hash: 'h', sig: 's', pubKey: CLAVE }]);
assert.deepStrictEqual(r, { body: { cmd: 'x', hash: 'h', sigs: [{ sig: 's' }] } }, 'forma de respuesta de sign_v1');

console.log('wc-mercatus: OK');
