#!/bin/bash
# Ensambla Koberlet.app para macOS SIN electron-builder (mismo enfoque que
# build-portable.sh en Windows): se inyecta el código en el Electron.app
# prebuilt y se renombra/re-firma. Genera dist/mac/Koberlet.app.
set -e
cd "$(dirname "$0")"

APPNAME="Koberlet"
VER=$(node -p "require('./package.json').version")
DIST="dist/mac"
STAGE="$DIST/stage/app"
ELECTRON_APP="node_modules/electron/dist/Electron.app"

if [ ! -d "$ELECTRON_APP" ]; then
  echo "ERROR: falta $ELECTRON_APP. Ejecuta: node node_modules/electron/install.js"
  exit 1
fi

echo "==> Limpiando dist/mac"
rm -rf "$DIST"
mkdir -p "$STAGE"

echo "==> Preparando código de la app (solo runtime)"
cp main.js preload.js package.json "$STAGE/"
cp -r lib renderer "$STAGE/"
( cd "$STAGE" && npm install --omit=dev --no-audit --no-fund >/dev/null 2>&1 )

echo "==> Copiando Electron.app -> $APPNAME.app"
TARGET="$DIST/$APPNAME.app"
cp -R "$ELECTRON_APP" "$TARGET"

echo "==> Inyectando app en Resources"
rm -f "$TARGET/Contents/Resources/default_app.asar"
rm -rf "$TARGET/Contents/Resources/app"
cp -R "$STAGE" "$TARGET/Contents/Resources/app"

echo "==> Renombrando ejecutable y ajustando Info.plist"
mv "$TARGET/Contents/MacOS/Electron" "$TARGET/Contents/MacOS/$APPNAME"
PLIST="$TARGET/Contents/Info.plist"
PB=/usr/libexec/PlistBuddy
$PB -c "Set :CFBundleExecutable $APPNAME" "$PLIST"
$PB -c "Set :CFBundleName $APPNAME" "$PLIST"
$PB -c "Set :CFBundleDisplayName $APPNAME" 2>/dev/null "$PLIST" || $PB -c "Add :CFBundleDisplayName string $APPNAME" "$PLIST"
$PB -c "Set :CFBundleIdentifier es.dnns.koberlet" "$PLIST"
$PB -c "Set :CFBundleShortVersionString $VER" "$PLIST"
$PB -c "Set :CFBundleVersion $VER" "$PLIST"

# Icono: convertir renderer/icon.ico -> icns si se puede (opcional).
if [ -f renderer/icon.ico ]; then
  echo "==> Intentando generar icono .icns"
  ICONSET="$DIST/koberlet.iconset"
  mkdir -p "$ICONSET"
  if sips -s format png renderer/icon.ico --out "$DIST/icon-src.png" >/dev/null 2>&1; then
    for sz in 16 32 128 256 512; do
      sips -z $sz $sz "$DIST/icon-src.png" --out "$ICONSET/icon_${sz}x${sz}.png" >/dev/null 2>&1 || true
      d=$((sz*2))
      sips -z $d $d "$DIST/icon-src.png" --out "$ICONSET/icon_${sz}x${sz}@2x.png" >/dev/null 2>&1 || true
    done
    if iconutil -c icns "$ICONSET" -o "$TARGET/Contents/Resources/electron.icns" >/dev/null 2>&1; then
      $PB -c "Set :CFBundleIconFile electron" "$PLIST" 2>/dev/null || true
      echo "    icono aplicado"
    else
      echo "    iconutil falló; se mantiene el icono por defecto"
    fi
  else
    echo "    sips no pudo leer el .ico; se mantiene el icono por defecto"
  fi
  rm -rf "$ICONSET" "$DIST/icon-src.png"
fi

echo "==> Re-firmando ad-hoc (obligatorio en Apple Silicon tras modificar el bundle)"
codesign --remove-signature "$TARGET" 2>/dev/null || true
codesign --force --deep --sign - "$TARGET"
codesign --verify --deep --strict "$TARGET" && echo "    firma ad-hoc OK"

echo "==> Limpiando staging"
rm -rf "$DIST/stage"

echo ""
echo "OK -> $TARGET  (v$VER)"
echo "Ábrelo con: open \"$TARGET\""
echo "Nota: firma ad-hoc (sin cuenta de desarrollador Apple). En otro Mac,"
echo "la primera vez: clic derecho -> Abrir, o 'xattr -dr com.apple.quarantine' sobre la app."
