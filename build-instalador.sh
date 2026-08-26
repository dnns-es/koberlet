#!/bin/bash
# Instalador COMPLETO de Koberlet (el zip grande que se pasa a otra persona).
# Sale de build-portable.sh y lo deja con el nombre y la forma que espera
# "Instalar Koberlet.bat": carpeta Koberlet/ con Koberlet.exe dentro.
#
#   bash build-instalador.sh
#
# Deja F:/koberlet_v<VER>.zip y su .meta.json firmado.
set -e
cd "$(dirname "$0")"

VER=$(node -p "require('./package.json').version")
STAGE=dist-installer

echo "== Instalador completo de Koberlet $VER =="
bash build-portable.sh

rm -rf "$STAGE"
mkdir -p "$STAGE"
cp -r portable-build/MonederoDNNS "$STAGE/Koberlet"

# LA BOVEDA NO VIAJA. build-portable.sh la conserva para poder trabajar en local, pero
# aqui dentro seria repartir el monedero de quien construye. Se borra y se comprueba.
rm -rf "$STAGE/Koberlet/MonederoDNNS-datos"

mv "$STAGE/Koberlet/MonederoDNNS.exe" "$STAGE/Koberlet/Koberlet.exe"
cp install/Instalar-Koberlet.bat "$STAGE/Koberlet/Instalar Koberlet.bat"

# --- Frenos antes de comprimir 160 MB ---
DENTRO=$(node -p "require('./$STAGE/Koberlet/resources/app/package.json').version")
[ "$DENTRO" = "$VER" ] || { echo "ERROR: el instalador lleva $DENTRO y el proyecto va por $VER"; exit 1; }
[ -e "$STAGE/Koberlet/resources/app/app" ] && { echo "ERROR: resources/app/app anidado"; exit 1; }
[ -e "$STAGE/Koberlet/Koberlet.exe" ] || { echo "ERROR: falta Koberlet.exe"; exit 1; }
[ -e "$STAGE/Koberlet/Instalar Koberlet.bat" ] || { echo "ERROR: falta el .bat de instalacion"; exit 1; }
SOBRA=$(find "$STAGE" \( -name vault.json -o -name MonederoDNNS-datos \) | wc -l)
[ "$SOBRA" -eq 0 ] || { echo "ERROR: hay una boveda dentro del instalador, abortado"; exit 1; }

# Zip REAL con el tar de Windows (bsdtar). El de Git Bash crea un TAR con nombre .zip.
rm -f "F:/koberlet_v$VER.zip"
( cd "$STAGE" && /c/Windows/System32/tar.exe -a -cf "F:/koberlet_v$VER.zip" Koberlet )

# El nombre del fichero sale de la version REAL empaquetada: asi no se puede repetir
# lo de 2026-08 (koberlet_v2.7.4.zip llevaba dentro la 2.7.5).
bash firmar-zip.sh "F:/koberlet_v$VER.zip"
echo "OK -> F:/koberlet_v$VER.zip (version dentro: $DENTRO)"
