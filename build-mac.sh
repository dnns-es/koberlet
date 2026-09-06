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

# --- Renombrado de los helpers -------------------------------------------
# Los procesos auxiliares vienen como "com.github.Electron.helper"; se
# reidentifican bajo el bundle id de la app para no colisionar con otras apps
# Electron instaladas y para que la firma sea coherente en todo el paquete.
echo "==> Reidentificando helpers"
for H in "$TARGET/Contents/Frameworks/"*.app; do
  [ -e "$H" ] || continue
  $PB -c "Set :CFBundleIdentifier es.dnns.koberlet.helper" "$H/Contents/Info.plist" 2>/dev/null || true
done

# --- Firma ----------------------------------------------------------------
# Sin configurar: firma ad-hoc, como hasta ahora. La app funciona en este Mac
# pero Gatekeeper la rechaza en cualquier otro.
#
# Con DEVELOPER_ID: firma de distribución con runtime endurecido, lista para
# notarizar (./notarize-mac.sh). Ejemplo:
#
#   export DEVELOPER_ID="Developer ID Application: NOMBRE (TEAMID1234)"
#   ./build-mac.sh && ./notarize-mac.sh
#
# Identidades disponibles: security find-identity -v -p codesigning
SIGN_ID="${DEVELOPER_ID:-}"
ENT_APP="entitlements.mac.plist"
ENT_HELPER="entitlements.mac.helper.plist"

if [ -n "$SIGN_ID" ]; then
  echo "==> Firmando con Developer ID: $SIGN_ID"
  for f in "$ENT_APP" "$ENT_HELPER"; do
    [ -f "$f" ] || { echo "ERROR: falta $f"; exit 1; }
  done
else
  echo "==> Firmando ad-hoc (sin DEVELOPER_ID; obligatorio en Apple Silicon tras modificar el bundle)"
  codesign --remove-signature "$TARGET" 2>/dev/null || true
fi

# Firma un elemento; en silencio si va bien, con el error completo si falla.
# Una firma rota que pase desapercibida produce una app que Apple rechaza al
# notarizar, así que aquí cualquier fallo aborta el build.
firmar() {  # firmar <ruta> [entitlements]
  local ruta="$1" ent="${2:-}" out
  local args=(--force)
  if [ -n "$SIGN_ID" ]; then
    # --options runtime y --timestamp son obligatorios para notarizar.
    args+=(--options runtime --timestamp --sign "$SIGN_ID")
    [ -n "$ent" ] && args+=(--entitlements "$ent")
  else
    args+=(--sign -)
  fi
  if ! out=$(codesign "${args[@]}" "$ruta" 2>&1); then
    echo "ERROR al firmar: $ruta"
    echo "$out"
    exit 1
  fi
}

# La firma va de dentro afuera. No se usa --deep: Apple lo desaconseja para
# distribución y no aplica los entitlements a los helpers.
EFW="$TARGET/Contents/Frameworks/Electron Framework.framework/Versions/A"

echo "    módulos nativos (.node)"
# keccak trae prebuilds de Windows y Linux que no son Mach-O; se saltan.
while IFS= read -r -d '' f; do
  if file -b "$f" | grep -q '^Mach-O'; then firmar "$f"; fi
done < <(find "$TARGET/Contents/Resources/app" -name '*.node' -type f -print0)

echo "    librerías y ejecutables auxiliares"
for lib in "$EFW/Libraries/"*.dylib; do
  if [ -e "$lib" ]; then firmar "$lib"; fi
done
CRASHPAD="$EFW/Helpers/chrome_crashpad_handler"
if [ -e "$CRASHPAD" ]; then firmar "$CRASHPAD"; fi
SHIPIT="$TARGET/Contents/Frameworks/Squirrel.framework/Versions/A/Resources/ShipIt"
if [ -e "$SHIPIT" ]; then firmar "$SHIPIT"; fi

echo "    helpers"
for H in "$TARGET/Contents/Frameworks/"*.app; do
  if [ -e "$H" ]; then firmar "$H" "$ENT_HELPER"; fi
done

echo "    frameworks"
for F in "$TARGET/Contents/Frameworks/"*.framework; do
  if [ -e "$F/Versions/A" ]; then firmar "$F/Versions/A"; fi
done

echo "    app"
firmar "$TARGET" "$ENT_APP"

codesign --verify --deep --strict "$TARGET" && echo "    firma verificada OK"

echo "==> Limpiando staging"
rm -rf "$DIST/stage"

echo ""
echo "OK -> $TARGET  (v$VER)"
echo "Ábrelo con: open \"$TARGET\""
if [ -n "$SIGN_ID" ]; then
  echo "Firmado con Developer ID y runtime endurecido."
  echo "Siguiente paso: ./notarize-mac.sh  (notariza, grapa y genera el DMG final)"
else
  echo "Nota: firma ad-hoc (sin cuenta de desarrollador Apple). En otro Mac,"
  echo "la primera vez: clic derecho -> Abrir, o 'xattr -dr com.apple.quarantine' sobre la app."
fi
