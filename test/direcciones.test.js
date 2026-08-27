// Toda direccion Ethereum del codigo tiene que llevar bien el checksum EIP-55.
//
// No es cosmetico: en Ethereum el patron de mayusculas ES la suma de verificacion, y
// ethers RECHAZA una direccion mal escrita antes de llamar ("bad address checksum").
// El 27/08/2026 los routers del puente de USDT, DAI y WBTC lo tenian mal y esas tres
// rutas estaban muertas desde siempre; solo funcionaba USDC, que era la unica bien
// escrita. Un fallo invisible: no se ve leyendo, y solo aparece al mover dinero.
//
//   node test/direcciones.test.js
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

const FICHEROS = ['main.js', 'lib/bridge.js', 'lib/eth.js'];
let revisadas = 0, fallos = 0;

for (const rel of FICHEROS) {
    const abs = path.join(__dirname, '..', rel);
    if (!fs.existsSync(abs)) continue;
    const texto = fs.readFileSync(abs, 'utf8');
    texto.split('\n').forEach((linea, i) => {
        for (const m of linea.matchAll(/'(0x[0-9a-fA-F]{40})'/g)) {
            const dir = m[1];
            revisadas++;
            // Una direccion toda en minusculas o toda en mayusculas es valida por convenio
            // (significa "sin checksum"), asi que solo se exige a las mixtas.
            const sinCaja = dir === dir.toLowerCase() || dir.slice(2) === dir.slice(2).toUpperCase();
            if (sinCaja) continue;
            try {
                ethers.getAddress(dir);
            } catch (_) {
                fallos++;
                console.log(`FALLA  ${rel}:${i + 1}  ${dir}`);
                console.log(`       correcta -> ${ethers.getAddress(dir.toLowerCase())}`);
            }
        }
    });
}

console.log(fallos === 0
    ? `OK: ${revisadas} direcciones Ethereum, checksum correcto`
    : `HAY ${fallos} DIRECCIONES CON EL CHECKSUM MAL`);
process.exit(fallos === 0 ? 0 : 1);
