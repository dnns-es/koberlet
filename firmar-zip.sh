#!/bin/bash
# Huella + firma Ed25519 de un archivo publicable (pensado para el INSTALADOR completo,
# que no se verifica a sí mismo: el auto-update sí, pero el zip grande no).
#
#   bash firmar-zip.sh F:/koberlet_v2.7.5.zip
#
# Imprime el sha256 y la firma, y deja un .meta.json al lado. El sha256 va a `urlSha256`
# de latest.json y, sobre todo, SE DICTA APARTE (mensaje de Telegram, repo público):
# si la huella viaja por el mismo sitio que el archivo, no demuestra nada.
set -e
cd "$(dirname "$0")"

ZIP="$1"
if [ -z "$ZIP" ] || [ ! -f "$ZIP" ]; then echo "uso: bash firmar-zip.sh <ruta del zip>"; exit 1; fi
if [ ! -f .keys/koberlet-update.sec ]; then echo "ERROR: falta .keys/koberlet-update.sec para firmar"; exit 1; fi

node -e '
const fs=require("fs"),crypto=require("crypto"),nacl=require("tweetnacl");
const zipPath=process.argv[1];
const zip=fs.readFileSync(zipPath);
const sha=crypto.createHash("sha256").update(zip).digest("hex");
const sec=Buffer.from(fs.readFileSync(".keys/koberlet-update.sec","utf8").trim(),"hex");
const sig=Buffer.from(nacl.sign.detached(Buffer.from(sha,"utf8"),sec)).toString("hex");
fs.writeFileSync(zipPath+".meta.json", JSON.stringify({archivo:zipPath.split(/[\\/]/).pop(),sha256:sha,sig},null,2));
console.log("sha256:",sha);
console.log("sig:   ",sig);
' "$ZIP"
echo "OK -> $ZIP.meta.json (sha256 a urlSha256 de latest.json Y al mensaje donde repartas el enlace)"
