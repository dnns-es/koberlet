# Contribuir a Koberlet / Contributing

*(English below)*

## Español

Las contribuciones son bienvenidas. Esto es un monedero, así que hay algunas cosas que
conviene decir antes.

### Antes de ponerte

- Para algo pequeño (un fallo, un texto, una traducción), manda el PR directamente.
- Para algo grande o que cambie cómo se firma, se guardan las claves o se habla con la
  cadena, **abre antes un issue**. Puede que ya esté decidido de otra forma, y prefiero
  decírtelo antes de que gastes una tarde.
- ¿Es un fallo de seguridad? No abras un issue: lee [SECURITY.md](SECURITY.md).

### Cómo se escribe aquí

- **Español** para el código: nombres, comentarios y mensajes de commit. Los textos de
  la interfaz van en los diccionarios `es`/`en` de `renderer/app.js`, los dos.
- Los comentarios explican **por qué**, no qué. El qué ya se lee en el código; el porqué
  se pierde.
- 4 espacios, sin tabuladores.
- Sin dependencias nuevas si se puede evitar. Cada una es superficie de ataque, y aquí
  hay claves privadas de por medio.

### Antes de mandar el PR

    npm test
    node comprobar-paquete.js .

Los dos tienen que pasar. Si tocas algo de red o de firma, cuenta en el PR **qué
probaste y contra qué**: devnet, mainnet, con qué wallet, con qué nodo.

### Qué se mira en la revisión

- Que no se filtre una clave privada al proceso del renderer. Nunca.
- Que nada que venga de fuera (nodo, token, NFT, indexador) llegue a `innerHTML` sin
  escapar.
- Que un fallo se vea y diga por qué, en vez de tragarse la excepción.
- Que lo que la pantalla promete lo compruebe también la cadena antes de firmar.

### Licencia y autoría

Mandar un PR significa que aceptas las condiciones de [CLA.md](CLA.md). En resumen:
**conservas tu copyright** y puedes seguir usando tu código donde quieras, y a cambio das a
DNNS.es permiso perpetuo para distribuirlo, incluida la licencia que el proyecto decida en
cada momento. Se firma una sola vez, con una línea en el cuerpo del primer PR.

Conservas tu autoría: quedas en el historial de git y, si el cambio es de peso, en las
notas de la versión y en [SECURITY.md](SECURITY.md). El nombre "Koberlet" no entra en la
licencia — ver [TRADEMARK.md](TRADEMARK.md).

---

## English

Contributions are welcome. This is a wallet, so a few things are worth saying up front.

### Before you start

- Small things (a bug, a string, a translation): send the PR directly.
- Anything large, or that changes how signing, key storage or chain calls work: **open
  an issue first**. It may already be settled another way, and I'd rather tell you before
  you spend an evening on it.
- Security bug? Don't open an issue: read [SECURITY.md](SECURITY.md).

### House style

- **Spanish** for code: names, comments and commit messages. UI strings go in both the
  `es` and `en` dictionaries in `renderer/app.js`.
- Comments explain **why**, not what. The what is already in the code; the why is what
  gets lost.
- 4 spaces, no tabs.
- No new dependencies if avoidable. Each one is attack surface, and there are private
  keys here.

### Before sending the PR

    npm test
    node comprobar-paquete.js .

Both must pass. If you touch networking or signing, say in the PR **what you tested and
against what**: devnet, mainnet, which wallet, which node.

### What review looks for

- No private key ever reaching the renderer process. Ever.
- Nothing from outside (node, token, NFT, indexer) reaching `innerHTML` unescaped.
- Failures that are visible and say why, instead of a swallowed exception.
- Whatever the screen promises being re-checked against the chain before signing.

### Licence and authorship

Sending a PR means you accept the terms of [CLA.md](CLA.md). In short: **you keep your
copyright** and may go on using your code anywhere you like, and in exchange you give
DNNS.es perpetual permission to distribute it, including under whatever licence the project
chooses at any given time. You sign once, with one line in the body of your first PR.

You keep your authorship: you stay in the git history and, for significant changes, in the
release notes and in [SECURITY.md](SECURITY.md). The name "Koberlet" is not part of the
licence — see [TRADEMARK.md](TRADEMARK.md).
