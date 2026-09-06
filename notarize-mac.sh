#!/bin/bash
# Notariza Koberlet.app en Apple, grapa el ticket y deja el DMG final listo
# para publicar. Requiere que build-mac.sh se haya ejecutado con DEVELOPER_ID.
#
# Credenciales (una de las dos formas):
#
#   a) Perfil guardado en el llavero (recomendado; se hace una sola vez):
#        xcrun notarytool store-credentials koberlet \
#          --apple-id CORREO --team-id TEAMID1234 --password CLAVE-ESPECIFICA
#        export NOTARY_PROFILE=koberlet
#
#   b) Variables sueltas:
#        export APPLE_ID=CORREO APPLE_TEAM_ID=TEAMID1234 APPLE_APP_PASSWORD=CLAVE
#
# La clave específica de aplicación se genera en appleid.apple.com, no es la
# contraseña normal del Apple ID.
set -e
cd "$(dirname "$0")"

APPNAME="Koberlet"
VER=$(node -p "require('./package.json').version")
DIST="dist/mac"
APP="$DIST/$APPNAME.app"
DMG="$DIST/$APPNAME-$VER.dmg"

if [ ! -d "$APP" ]; then
  echo "ERROR: falta $APP. Ejecuta primero: DEVELOPER_ID=\"...\" ./build-mac.sh"
  exit 1
fi

# Una app ad-hoc no se puede notarizar: Apple exige un Developer ID. Se
# comprueba aquí para no descubrirlo tras subir 350 MB.
if codesign -dv "$APP" 2>&1 | grep -q 'Signature=adhoc'; then
  echo "ERROR: $APP está firmada ad-hoc y Apple no la aceptará."
  echo "Vuelve a construirla con:"
  echo "  export DEVELOPER_ID=\"Developer ID Application: NOMBRE (TEAMID1234)\""
  echo "  ./build-mac.sh"
  exit 1
fi

# Argumentos de credenciales para notarytool.
if [ -n "${NOTARY_PROFILE:-}" ]; then
  CREDS=(--keychain-profile "$NOTARY_PROFILE")
elif [ -n "${APPLE_ID:-}" ] && [ -n "${APPLE_TEAM_ID:-}" ] && [ -n "${APPLE_APP_PASSWORD:-}" ]; then
  CREDS=(--apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" --password "$APPLE_APP_PASSWORD")
else
  echo "ERROR: faltan credenciales de notarización."
  echo "Define NOTARY_PROFILE, o APPLE_ID + APPLE_TEAM_ID + APPLE_APP_PASSWORD."
  echo "Ver la cabecera de este script para el detalle."
  exit 1
fi

# Sube algo a notarizar y espera el veredicto. Si Apple lo rechaza, imprime el
# log con el motivo exacto (qué binario quedó sin firmar, normalmente).
notarizar() {  # notarizar <ruta>
  local ruta="$1" salida id estado
  salida=$(xcrun notarytool submit "$ruta" "${CREDS[@]}" --wait 2>&1) || true
  echo "$salida" | sed 's/^/    /'
  id=$(echo "$salida" | awk '/id:/ {print $2; exit}')
  estado=$(echo "$salida" | awk -F': *' '/status:/ {print $2; exit}')
  if [ "$estado" != "Accepted" ]; then
    echo "ERROR: Apple rechazó $ruta (status: ${estado:-desconocido})"
    if [ -n "$id" ]; then
      echo "--- log de notarización ---"
      xcrun notarytool log "$id" "${CREDS[@]}" 2>&1 | sed 's/^/    /'
    fi
    exit 1
  fi
}

# 1) La app. Se sube comprimida con ditto, que preserva la firma; zip normal
#    la rompe.
echo "==> Notarizando $APPNAME.app (puede tardar varios minutos)"
ZIP="$DIST/$APPNAME-$VER-notarize.zip"
rm -f "$ZIP"
ditto -c -k --keepParent "$APP" "$ZIP"
notarizar "$ZIP"
rm -f "$ZIP"

echo "==> Grapando el ticket en la app"
xcrun stapler staple "$APP"

# 2) El DMG se regenera A PARTIR de la app ya grapada, para que la copia que
#    el usuario arrastra a Aplicaciones lleve el ticket dentro y funcione sin
#    conexión.
echo "==> Regenerando el DMG con la app grapada"
./package-dmg.sh >/dev/null

echo "==> Notarizando el DMG"
notarizar "$DMG"

echo "==> Grapando el ticket en el DMG"
xcrun stapler staple "$DMG"

# 3) Comprobación final: esto es lo que hará Gatekeeper en el Mac del usuario.
echo "==> Verificando"
spctl -a -vvv -t exec "$APP" 2>&1 | sed 's/^/    /'
spctl -a -vvv -t open --context context:primary-signature "$DMG" 2>&1 | sed 's/^/    /'
xcrun stapler validate "$APP" 2>&1 | sed 's/^/    /'
xcrun stapler validate "$DMG" 2>&1 | sed 's/^/    /'

echo ""
echo "OK -> $DMG  (v$VER, firmado + notarizado + grapado)"
du -sh "$DMG"
echo "Ya se puede publicar: se abre con doble clic en cualquier Mac, sin avisos."
