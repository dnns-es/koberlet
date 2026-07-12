#!/bin/bash
# Ensambla el portable de MonederoDNNS SIN electron-builder (evita el bloqueo de winCodeSign/symlinks en Windows).
set -e
cd "$(dirname "$0")"

# Matar procesos abiertos (si no, rm falla por ficheros bloqueados y el build queda a medias).
taskkill //IM MonederoDNNS.exe //F 2>/dev/null || true
sleep 1

# PRESERVAR la bóveda: apartar MonederoDNNS-datos antes del rm y restaurarla luego.
DATOS="portable-build/MonederoDNNS/MonederoDNNS-datos"
TMP_DATOS=""
if [ -d "$DATOS" ]; then TMP_DATOS="$(mktemp -d)"; cp -r "$DATOS" "$TMP_DATOS/datos"; echo "Bóveda preservada."; fi

rm -rf portable-build
mkdir -p portable-build/app
cp main.js preload.js package.json portable-build/app/
cp -r lib renderer portable-build/app/
( cd portable-build/app && npm install --omit=dev --no-audit --no-fund )
cp -r node_modules/electron/dist portable-build/MonederoDNNS
cd portable-build/MonederoDNNS
mv electron.exe MonederoDNNS.exe
rm -f resources/default_app.asar
cp -r ../app resources/app
: > portable.flag
# Restaurar la bóveda preservada.
if [ -n "$TMP_DATOS" ]; then cp -r "$TMP_DATOS/datos" MonederoDNNS-datos; rm -rf "$TMP_DATOS"; echo "Bóveda restaurada."; fi
echo "OK -> portable-build/MonederoDNNS/  (copia la carpeta al M.2 y ejecuta MonederoDNNS.exe)"
