// Cuentas de desarrollo PÚBLICAS de Kadena — aquí no hay ningún secreto.
//
// `sender00` es la cuenta de pruebas que Kadena reparte con su entorno de desarrollo:
// su clave viene publicada en la documentación oficial de Kadena y la tiene cualquiera
// que haya levantado una devnet. NO es una cuenta de nadie, NO existe en mainnet con
// estas claves y NO custodia fondos reales. Está aquí porque la devnet la necesita para
// dos cosas y para nada más:
//
//   1. el grifo: regalar KDA de prueba a una wallet recién creada,
//   2. pagar el gas de una redención cross-chain cuando la wallet aún no tiene saldo
//      en la chain de destino.
//
// Vive en un fichero aparte, y no suelta dentro de main.js, para que quien audite el
// repositorio vea de un vistazo qué es esta clave y no tenga que deducirlo. Todo su uso
// está condicionado a `net.key === 'devnet'`: en mainnet ni se mira.
//
// Si algún día se añade otra cuenta de desarrollo, va aquí y no en otro sitio.

const SENDER00 = {
    account: 'sender00',
    publicHex: '368820f80c324bbc7c2b0610688a7da43e39f91d118732671cd9c7500ff43cca',
    secretHex: '251a920c403ae8c8f65f59142316af3c82b631fba46ddea92ee8c95035bd2898'
};

// El grifo usa los mismos datos, con los nombres de campo que espera kda.transferCreate
// más la cantidad y la chain por las que reparte.
const GRIFO = {
    from: SENDER00.account,
    pub: SENDER00.publicHex,
    sec: SENDER00.secretHex,
    cantidad: 1000,
    chain: 0
};

module.exports = { SENDER00, GRIFO };
