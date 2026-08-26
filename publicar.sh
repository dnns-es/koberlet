#!/bin/bash
# Publica una version de Koberlet ENTERA, de una sola pasada:
#   1. paquete de auto-update  (koberlet-app-<VER>.zip)  -> el que aplican los ya instalados
#   2. instalador completo     (koberlet_v<VER>.zip)     -> el enlace que se pasa a un companero
#   3. latest.json con los dos, sus sha256 y sus firmas
#
#   bash publicar.sh              publica la version que diga package.json
#   bash publicar.sh --solo-app   solo el paquete de auto-update (NO toca el enlace del instalador)
#
# POR QUE existe: hasta 2026-08-26 el instalador se rehacia a mano y era facil olvidarlo,
# asi que el enlace de "Pasar Koberlet a un companero" se quedo clavado en la 2.7.4
# mientras la app iba por la 2.7.7. Aqui o se publican los dos, o no se publica.
set -e
cd "$(dirname "$0")"

VER=$(node -p "require('./package.json').version")
LLAVE=~/.ssh/vpsfran
SRV=root@vpsfran.dnns.es
DIR=/opt/descargas/kob7t2m9x4/koberlet
BASE=https://descargas.dnns.es/kob7t2m9x4/koberlet
SOLO_APP=0
[ "$1" = "--solo-app" ] && SOLO_APP=1

# node y el shell no entienden /tmp igual en Git Bash (node lo resolveria como F:/tmp),
# asi que los ficheros de paso van a una carpeta propia dentro del proyecto.
mkdir -p .publicar-tmp

sh_remoto() { ssh -i "$LLAVE" -o ConnectTimeout=20 "$SRV" "$@"; }

echo "===== Publicando Koberlet $VER ====="

# --- 0. Frenos ANTES de construir nada ---
PUBLICADA=$(curl -s --max-time 15 "$BASE/latest.json" | node -p "JSON.parse(require('fs').readFileSync(0,'utf8')).version" 2>/dev/null || echo "?")
echo "en el servidor hay ahora: $PUBLICADA"
if [ "$PUBLICADA" = "$VER" ]; then
  echo "ERROR: la $VER ya esta publicada. Sube la version en package.json antes de publicar."
  echo "       (una version publicada NO se reescribe: quien la tenga ya no volveria a bajarla)"
  exit 1
fi

NOTAS="notas/$VER.json"
if [ ! -f "$NOTAS" ]; then
  echo "ERROR: falta $NOTAS con las novedades de esta version."
  echo "       Sin esto se publicarian las notas de la version ANTERIOR, que es peor que no tener."
  echo "       Plantilla:"
  echo '       { "notes": "resumen corto ES / short summary EN",'
  echo '         "notes_i18n": { "es": "que ha cambiado y que nota el usuario", "en": "..." } }'
  exit 1
fi
node -e "
const fallos=[];
let n;
try { n=JSON.parse(require('fs').readFileSync('$NOTAS','utf8')); }
catch(e){ console.error('ERROR: $NOTAS no es un JSON valido -> '+e.message); process.exit(1); }
if(typeof n.notes!=='string'||!n.notes.trim()) fallos.push('falta \'notes\' (texto corto, ES / EN en una linea)');
for(const k of ['es','en']) if(typeof (n.notes_i18n||{})[k]!=='string'||!n.notes_i18n[k].trim()) fallos.push('falta \'notes_i18n.'+k+'\'');
if(fallos.length){ console.error('ERROR en $NOTAS:'); for(const f of fallos) console.error('  - '+f); process.exit(1); }
console.log('notas de la $VER OK');
"

echo "--- pruebas ---"
npm test --silent

# --- 1. Construir ---
echo "--- paquete de auto-update ---"
bash build-app-zip.sh >/dev/null
APPZIP="F:/koberlet-app-$VER.zip"
[ -f "$APPZIP" ] || { echo "ERROR: no se genero $APPZIP"; exit 1; }

if [ "$SOLO_APP" = "0" ]; then
  echo "--- instalador completo (tarda unos minutos) ---"
  bash build-instalador.sh >/dev/null
  FULLZIP="F:/koberlet_v$VER.zip"
  [ -f "$FULLZIP" ] || { echo "ERROR: no se genero $FULLZIP"; exit 1; }
fi

# --- 2. Copia de seguridad del latest.json ANTES de tocar produccion ---
TS=$(date -u +%Y%m%d-%H%M%S)
sh_remoto "cp -a $DIR/latest.json $DIR/latest.json.bak-$TS"
echo "backup en servidor: latest.json.bak-$TS"

# --- 3. Subir y COMPROBAR la huella en destino (una subida cortada no se ve a ojo) ---
subir() {
  local zip="$1" esperado
  esperado=$(sha256sum "$zip" | cut -d' ' -f1)
  echo "subiendo $(basename "$zip") ..."
  scp -i "$LLAVE" -o ConnectTimeout=20 "$zip" "$SRV:$DIR/"
  local alla
  alla=$(sh_remoto "sha256sum $DIR/$(basename "$zip") | cut -d' ' -f1")
  [ "$alla" = "$esperado" ] || { echo "ERROR: el sha256 en el servidor no coincide para $(basename "$zip")"; exit 1; }
  echo "  sha256 correcto en destino"
}
subir "$APPZIP"
[ "$SOLO_APP" = "0" ] && subir "$FULLZIP"

# --- 4. latest.json ---
scp -i "$LLAVE" -q "$SRV:$DIR/latest.json" .publicar-tmp/latest_actual.json
node -e "
const fs=require('fs');
const j=JSON.parse(fs.readFileSync('.publicar-tmp/latest_actual.json','utf8'));
const n=require('./$NOTAS');
const app=JSON.parse(fs.readFileSync('$APPZIP.meta.json','utf8'));
j.version='$VER';
j.appUrl='$BASE/koberlet-app-$VER.zip';
j.sha256=app.sha256; j.sig=app.sig;
if ('$SOLO_APP'==='0') {
  const full=JSON.parse(fs.readFileSync('F:/koberlet_v$VER.zip.meta.json','utf8'));
  j.url='$BASE/koberlet_v$VER.zip';
  j.urlSha256=full.sha256; j.urlSig=full.sig;
}
j.notes=n.notes; j.notes_i18n=n.notes_i18n;
fs.writeFileSync('.publicar-tmp/latest_nuevo.json', JSON.stringify(j,null,2)+'\n','utf8');
"
scp -i "$LLAVE" -q .publicar-tmp/latest_nuevo.json "$SRV:$DIR/latest.json"

# --- 5. Verificar DESDE FUERA, que es lo que ve la gente ---
echo "--- verificacion final por HTTPS ---"
curl -s --max-time 20 "$BASE/latest.json" > .publicar-tmp/latest_servido.json
node -e "
const j=JSON.parse(require('fs').readFileSync('.publicar-tmp/latest_servido.json','utf8'));
const fs=require('fs'), nacl=require('tweetnacl');
const PUB='57e9f4fae9fcfa361e58b702cf83ff9b8b806d606a2e741b40b77ed2866bb4e4';
let mal=0;
const ok=(c,t)=>{ console.log((c?'  ok   ':'  MAL  ')+t); if(!c) mal++; };
ok(j.version==='$VER', 'version = $VER');
ok(j.appUrl==='$BASE/koberlet-app-$VER.zip', 'appUrl apunta a la $VER');
if ('$SOLO_APP'==='0') ok(j.url==='$BASE/koberlet_v$VER.zip', 'enlace del instalador apunta a la $VER');
const firma=(sha,sig)=>{ try { return nacl.sign.detached.verify(Buffer.from(sha,'utf8'),Buffer.from(sig,'hex'),Buffer.from(PUB,'hex')); } catch(e){ return false; } };
ok(firma(j.sha256,j.sig), 'firma del paquete de auto-update');
if ('$SOLO_APP'==='0') ok(firma(j.urlSha256,j.urlSig), 'firma del instalador completo');
ok(typeof j.notes==='string' && !!j.notes.trim(), 'notas presentes');
if (mal) { console.error('HAY '+mal+' COMPROBACIONES MAL'); process.exit(1); }
"
echo "--- descarga real del paquete de auto-update ---"
BAJADO=$(curl -s --max-time 300 "$BASE/koberlet-app-$VER.zip" | sha256sum | cut -d' ' -f1)
ESPERADO=$(node -p "require('$APPZIP.meta.json').sha256")
[ "$BAJADO" = "$ESPERADO" ] || { echo "ERROR: lo que sirve HTTPS no cuadra con lo firmado"; exit 1; }
echo "  sha256 correcto"

echo
echo "===== Koberlet $VER publicada ====="
if [ "$SOLO_APP" = "0" ]; then
  echo "Enlace para pasar a un companero:"
  echo "  $BASE/koberlet_v$VER.zip"
  echo "Huella (mandala en el MISMO mensaje):"
  node -p "require('F:/koberlet_v$VER.zip.meta.json').sha256"
else
  echo "(--solo-app: el enlace del instalador sigue en la version anterior)"
fi
