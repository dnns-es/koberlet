# Política de seguridad / Security policy

*(English below)*

## Español

Koberlet custodia claves privadas. Un fallo aquí no es un error de programa: es dinero
de alguien. Los reportes de seguridad se agradecen y se atienden.

### Cómo reportar

**No abras un issue público.** Usa el aviso privado de vulnerabilidades de GitHub:
en la pestaña **Security** del repositorio → **Report a vulnerability**. Llega solo
al mantenedor.

Si no puedes usar ese canal, abre un issue diciendo únicamente que quieres reportar
algo en privado, sin detalles, y se te dará una vía de contacto.

### Qué ayuda en un reporte

- Qué versión de Koberlet y qué sistema operativo.
- Qué hace el fallo, no solo dónde está: qué consigue alguien que lo aproveche.
- Pasos para reproducirlo. Si tienes una prueba de concepto, mejor.
- Si afecta a fondos reales o solo a devnet.

### Qué puedes esperar

- Acuse de recibo en unos días.
- Se te dice si se confirma o no, y por qué.
- Se arregla y se publica una versión. Se te cita como quien lo encontró, salvo que
  prefieras el anonimato.
- Se pide un margen razonable antes de publicar los detalles, para que los usuarios
  tengan tiempo de actualizar.

### Qué NO es una vulnerabilidad aquí

- Que la aplicación no esté firmada y el sistema avise. Es conocido y está anotado.
- Que un nodo público falle o filtre peticiones. No lo controlamos.
- Que alguien con acceso físico y la contraseña pueda abrir la bóveda. Es su función.

### Auditorías

El repositorio incluye los informes de las auditorías que ha pasado el proyecto. Si
encuentras algo que una auditoría dio por resuelto y no lo está, díselo: eso interesa
más todavía.

---

## English

Koberlet holds private keys. A bug here isn't a program error: it is somebody's money.
Security reports are welcome and taken seriously.

### How to report

**Do not open a public issue.** Use GitHub's private vulnerability reporting: the
repository's **Security** tab → **Report a vulnerability**. It reaches the maintainer
only.

If you cannot use that channel, open an issue saying only that you want to report
something privately, with no details, and you'll be given a contact route.

### What helps in a report

- Koberlet version and operating system.
- What the bug does, not just where it is: what someone exploiting it achieves.
- Steps to reproduce. A proof of concept is better still.
- Whether it affects real funds or only devnet.

### What to expect

- Acknowledgement within a few days.
- You are told whether it is confirmed or not, and why.
- It gets fixed and released. You are credited as the finder unless you prefer not to be.
- A reasonable window is requested before details are published, so users can update.

### What is NOT a vulnerability here

- The app being unsigned and the OS warning about it. Known and documented.
- A public node failing or rate-limiting. Outside our control.
- Someone with physical access and the password being able to open the vault. That is
  what the password is for.

### Audits

The repository includes the reports from the audits this project has been through. If
you find something an audit called fixed and it isn't, say so — that is even more
interesting.

### Gracias / Acknowledgements

- **Alex ([@DaisukeFlowers](https://github.com/DaisukeFlowers))** — auditoría externa de julio de
  2026 (`docs/security/AUDIT-2026-07.md`), por su cuenta y sin cobrar nada. Encontró el fallo
  crítico del auto-update sin firmar. Publicada aquí con su permiso expreso.
- **01dCod3r** — el trabajo sobre los nodos EVM de la 2.8.3 y el empaquetado para macOS.

- **Alex ([@DaisukeFlowers](https://github.com/DaisukeFlowers))** — external audit, July 2026
  (`docs/security/AUDIT-2026-07.md`), unpaid and on his own initiative. He found the critical
  unsigned auto-update flaw. Published here with his express permission.
- **01dCod3r** — the EVM node work in 2.8.3 and the macOS packaging.
