#!/bin/bash
# Empaqueta SOLO el código (resources/app) para publicarlo por auto-update.
# NO toca portable-build ni cierra ninguna app en ejecución: la app abierta
# detecta la versión nueva por latest.json y se actualiza sola desde su panel.
set -e
cd "$(dirname "$0")"

VER=$(node -p "require('./package.json').version")
STAGE="build-app/app"

mkdir -p "$STAGE"
cp main.js preload.js package.json "$STAGE/"
rm -rf "$STAGE/lib" "$STAGE/renderer"
cp -r lib renderer "$STAGE/"
( cd "$STAGE" && npm install --omit=dev --no-audit --no-fund )

# Zip REAL con el tar de Windows (bsdtar). El de Git Bash crea un TAR con nombre .zip.
( cd build-app && /c/Windows/System32/tar.exe -a -cf "koberlet-app-$VER.zip" app )
mv -f "build-app/koberlet-app-$VER.zip" "/f/koberlet-app-$VER.zip"

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
' "F:/koberlet-app-$VER.zip" "F:/koberlet-app-$VER.meta.json" "$VER"
echo "OK -> F:/koberlet-app-$VER.zip + .meta.json (subir + latest.json con sha256 y sig; la app verifica firma antes de aplicar)"
