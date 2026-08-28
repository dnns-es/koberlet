#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Genera versiones.json: el indice de TODO lo publicado de Koberlet.

Existe porque `latest.json` solo dice cual es la ultima, y el auto-update de la app
NO va hacia atras (solo aplica si la version del servidor es mayor que la instalada).
Asi que el dia que haya que volver a una version anterior hay que ir al fichero de esa
version a mano, y para eso hace falta saber cuales existen y cual es su huella.

Se ejecuta en el servidor, desde publicar.sh, despues de subir los zip:

    python3 generar-versiones.py /opt/descargas/<token>/koberlet https://descargas.dnns.es/<token>/koberlet

Calcula el sha256 solo de los ficheros nuevos: los que ya estaban en el indice con el
mismo tamano se reaprovechan. Con 5,8 GB de historico, volver a leerlo todo en cada
publicacion seria tirar el tiempo.
"""
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone

PATRONES = [
    ("instalador", re.compile(r"^koberlet_v(\d+\.\d+\.\d+)\.zip$")),
    ("app", re.compile(r"^koberlet-app-(\d+\.\d+\.\d+)\.zip$")),
]


def sha256(ruta):
    h = hashlib.sha256()
    with open(ruta, "rb") as f:
        for trozo in iter(lambda: f.read(1024 * 1024), b""):
            h.update(trozo)
    return h.hexdigest()


def clave_orden(v):
    return tuple(int(x) for x in v.split("."))


def main():
    if len(sys.argv) < 3:
        print("uso: generar-versiones.py <directorio> <url-base>")
        return 2
    directorio, base = sys.argv[1], sys.argv[2].rstrip("/")
    destino = os.path.join(directorio, "versiones.json")

    # Cache: sha ya calculados, indexados por fichero+tamano. Si el tamano cambia, se
    # recalcula (no deberia pasar nunca: una version publicada no se reescribe).
    cache = {}
    if os.path.exists(destino):
        try:
            with open(destino, encoding="utf-8") as f:
                previo = json.load(f)
            for v in previo.get("versiones", []):
                for parte in ("instalador", "app"):
                    d = v.get(parte)
                    if d and d.get("fichero") and d.get("sha256") and d.get("bytes"):
                        cache[(d["fichero"], d["bytes"])] = d["sha256"]
        except Exception as e:
            print("aviso: no se pudo leer el indice anterior (%s); se recalcula todo" % e)

    versiones = {}
    nuevos = 0
    for nombre in sorted(os.listdir(directorio)):
        ruta = os.path.join(directorio, nombre)
        if not os.path.isfile(ruta):
            continue
        for parte, patron in PATRONES:
            m = patron.match(nombre)
            if not m:
                continue
            ver = m.group(1)
            tam = os.path.getsize(ruta)
            h = cache.get((nombre, tam))
            if not h:
                h = sha256(ruta)
                nuevos += 1
            versiones.setdefault(ver, {"version": ver})[parte] = {
                "fichero": nombre,
                "url": base + "/" + nombre,
                "bytes": tam,
                "sha256": h,
                "fecha": datetime.fromtimestamp(os.path.getmtime(ruta), timezone.utc)
                .isoformat(timespec="seconds")
                .replace("+00:00", "Z"),
            }
            break

    lista = sorted(versiones.values(), key=lambda v: clave_orden(v["version"]), reverse=True)

    actual = None
    try:
        with open(os.path.join(directorio, "latest.json"), encoding="utf-8") as f:
            actual = json.load(f).get("version")
    except Exception:
        pass

    salida = {
        "generado": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "actual": actual,
        "total": len(lista),
        "nota": (
            "Historico completo. El auto-update de la app solo avanza: para volver a una "
            "version anterior hay que instalarla a mano desde su fichero, comprobando el sha256."
        ),
        "versiones": lista,
    }
    tmp = destino + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(salida, f, indent=2, ensure_ascii=False)
        f.write("\n")
    os.replace(tmp, destino)  # atomico: nadie lee un fichero a medio escribir
    con_inst = sum(1 for v in lista if "instalador" in v)
    print("versiones.json: %d versiones (%d con instalador completo), %d sha256 nuevos"
          % (len(lista), con_inst, nuevos))
    return 0


if __name__ == "__main__":
    sys.exit(main())
