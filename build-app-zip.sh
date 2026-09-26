#!/bin/bash
# Empaqueta SOLO el código (resources/app) para publicarlo por auto-update.
# NO toca portable-build ni cierra ninguna app en ejecución: la app abierta
# detecta la versión nueva por latest.json y se actualiza sola desde su panel.
set -e
cd "$(dirname "$0")"

VER=$(node -p "require('./package.json').version")
STAGE="build-app/app"
. ./salida-builds.sh

mkdir -p "$STAGE"
cp main.js preload.js package.json "$STAGE/"
rm -rf "$STAGE/lib" "$STAGE/renderer"
cp -r lib renderer "$STAGE/"
( cd "$STAGE" && npm install --omit=dev --no-audit --no-fund )
# Fuera el codigo de PRUEBAS de las dependencias. Nada lo importa (comprobado), no se
# ejecuta jamas y viaja en el instalador por inercia. Ademas, el 28/08/2026 Windows
# Defender marco uno de ellos -@kadena/hd-wallet/.../kadenaEncryption.test.js- como
# Trojan:Script/ObfusScript.A!ml, una deteccion heuristica (!ml) sobre vectores de test
# que parecen cadenas ofuscadas. Lo ponia en cuarentena y reventaba el build. No se
# toca el antivirus: simplemente no se empaqueta lo que no hace falta.
# OJO: se borran SOLO los ficheros *.test.js/*.spec.js, NUNCA carpetas "tests" enteras.
# El 28/08/2026 se probo a podar tambien las carpetas y se rompio la 2.7.17: resulta que
# @kadena/cryptography-utils requiere lib/tests/mockdata/Pact EN TIEMPO DE EJECUCION, asi
# que crear o importar una wallet por semilla dejaba de funcionar. Una carpeta llamada
# "tests" no garantiza que sea codigo de pruebas.
find "$STAGE/node_modules" -type f \( -name "*.test.js" -o -name "*.spec.js" -o -name "*.test.mjs" \) -delete 2>/dev/null || true


# Zip REAL con el tar de Windows (bsdtar). El de Git Bash crea un TAR con nombre .zip.
( cd build-app && /c/Windows/System32/tar.exe -a -cf "koberlet-app-$VER.zip" app )
mv -f "build-app/koberlet-app-$VER.zip" "$SALIDA/koberlet-app-$VER.zip"

# Firma Ed25519 del sha256 (auditoría Alex #1). La privada NO está en el repo (.keys/, gitignored).
if [ ! -f .keys/koberlet-update.sec ]; then echo "ERROR: falta .keys/koberlet-update.sec para firmar"; exit 1; fi
node -e '
const fs=require("fs"),crypto=require("crypto"),nacl=require("tweetnacl");
const zipPath=process.argv[1], metaPath=process.argv[2], ver=process.argv[3];
const zip=fs.readFileSync(zipPath);
const sha=crypto.createHash("sha256").update(zip).digest("hex");
const sec=Buffer.from(fs.readFileSync(".keys/koberlet-update.sec","utf8").trim(),"hex");
const sig=Buffer.from(nacl.sign.detached(Buffer.from(sha,"utf8"),sec)).toString("hex");
fs.writeFileSync(metaPath, JSON.stringify({version:ver,sha256:sha,sig},null,2));
console.log("sha256:",sha);
console.log("sig:   ",sig);
' "$SALIDA/koberlet-app-$VER.zip" "$SALIDA/koberlet-app-$VER.meta.json" "$VER"
echo "OK -> $SALIDA/koberlet-app-$VER.zip + .meta.json (subir + latest.json con sha256 y sig; la app verifica firma antes de aplicar)"
