# Fecha: 2026-09-26
# Ruta: F:/APP/koberlet/salida-builds.sh
# Donde dejan sus zips build-app-zip.sh, build-instalador.sh y publicar.sh.
# Se incluye con ". ./salida-builds.sh" DESPUES de fijar VER.
#
# Una carpeta por version, fuera del repositorio. Hasta el 26/09/2026 todo caia
# suelto en la raiz de F: y se habian juntado decenas de zips de todas las versiones.
# Se puede cambiar el sitio sin tocar los scripts: KOBERLET_SALIDA=D:/otra bash publicar.sh
SALIDA="${KOBERLET_SALIDA:-F:/Koberlet-publicaciones}/$VER"
mkdir -p "$SALIDA"
