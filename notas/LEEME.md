# Novedades por version

Un fichero por version, `<version>.json`, con el texto que ve el usuario en el aviso
de actualizacion. `publicar.sh` **no publica** si falta el de la version que toca.

Existe por un motivo concreto: `latest.json` arrastra las notas de la version anterior
si nadie las cambia, y entonces la app le cuenta al usuario algo que no es lo que acaba
de instalar. Peor que no tener notas.

Formato:

```json
{
  "notes": "resumen corto en espanol / short summary in English",
  "notes_i18n": {
    "es": "Que ha cambiado y, sobre todo, que nota el usuario. Varias lineas si hace falta.",
    "en": "Same, in English."
  }
}
```

`notes` es SIEMPRE un texto plano: las versiones antiguas de Koberlet lo pintan tal cual
y si les llega un objeto ensenan "[object Object]". El idioma va aparte, en `notes_i18n`.
