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
# OJO: si resources/app YA existe, `cp -r ../app resources/app` copia DENTRO y deja
# resources/app/app, con la app vieja arrancando por fuera. Paso el 26/08/2026: el dist
# de electron en node_modules estaba contaminado con una copia de la 2.2.2 y cada
# portable la arrastraba. Se borra antes de copiar, siempre.
rm -rf resources/app
cp -r ../app resources/app
# Red de seguridad: si aun asi quedara anidado, parar en vez de publicar un portable roto.
[ -e resources/app/app ] && { echo "ERROR: resources/app/app anidado, build abortado"; exit 1; }
node -e "const v=require('./resources/app/package.json').version; const w=require('../../package.json').version; if(v!==w){console.error('ERROR: el portable lleva '+v+' y el proyecto va por '+w); process.exit(1)} console.log('portable con la version '+v)"
: > portable.flag
# Restaurar la bóveda preservada.
if [ -n "$TMP_DATOS" ]; then cp -r "$TMP_DATOS/datos" MonederoDNNS-datos; rm -rf "$TMP_DATOS"; echo "Bóveda restaurada."; fi
echo "OK -> portable-build/MonederoDNNS/  (copia la carpeta al M.2 y ejecuta MonederoDNNS.exe)"
