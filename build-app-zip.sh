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

sha256sum "/f/koberlet-app-$VER.zip"
echo "OK -> F:/koberlet-app-$VER.zip (subir + latest.json; la app se actualiza desde su panel)"
