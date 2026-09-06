#!/bin/bash
# Empaqueta dist/mac/Koberlet.app en un .dmg de distribución (drag-to-Applications)
# usando hdiutil (nativo de macOS, sin dependencias extra).
set -e
cd "$(dirname "$0")"

APPNAME="Koberlet"
VER=$(node -p "require('./package.json').version")
DIST="dist/mac"
APP="$DIST/$APPNAME.app"
DMG="$DIST/$APPNAME-$VER.dmg"

if [ ! -d "$APP" ]; then
  echo "ERROR: falta $APP. Ejecuta primero ./build-mac.sh"
  exit 1
fi

echo "==> Preparando contenido del DMG"
STAGE="$DIST/dmg-stage"
rm -rf "$STAGE" "$DMG"
mkdir -p "$STAGE"
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"

echo "==> Creando $DMG (comprimido UDZO)"
hdiutil create \
  -volname "$APPNAME $VER" \
  -srcfolder "$STAGE" \
  -fs HFS+ \
  -format UDZO \
  -ov \
  "$DMG" >/dev/null

# El DMG se firma con la misma identidad que la app: con Developer ID queda
# listo para notarizar, y sin ella se mantiene la firma ad-hoc de siempre.
if [ -n "${DEVELOPER_ID:-}" ]; then
  echo "==> Firmando el DMG con Developer ID"
  codesign --force --timestamp --sign "$DEVELOPER_ID" "$DMG"
else
  echo "==> Firmando el DMG ad-hoc"
  codesign --force --sign - "$DMG" 2>/dev/null || true
fi

rm -rf "$STAGE"

echo ""
echo "OK -> $DMG"
du -sh "$DMG"
echo "Verifica con: hdiutil verify \"$DMG\""
echo "Ábrelo con:   open \"$DMG\"  (arrastra Koberlet.app a Applications)"
