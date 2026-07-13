# Instalación de Koberlet (Windows)

Koberlet es **portable**: no necesita instalación real. Hay dos formas de usarlo.

## Opción A — con el instalador (recomendada)
1. Descarga y descomprime `koberlet_vX.Y.Z.zip`.
2. Entra en la carpeta `Koberlet` y haz doble clic en **`Instalar Koberlet.bat`**.
3. El instalador copia la app a `%LOCALAPPDATA%\Koberlet` (tu perfil, sin permisos de administrador), crea el **acceso directo en el escritorio** y en el menú Inicio, y abre la app.

El instalador **no toca ninguna bóveda existente** (`MonederoDNNS-datos`): si reinstalas encima, tus wallets se conservan.

## Opción B — portable directo
Descomprime el zip y ejecuta `Koberlet.exe` desde donde quieras (M.2, USB…). La app crea el acceso directo en el escritorio en el primer arranque. La bóveda cifrada vive junto al ejecutable.

## Notas
- Las actualizaciones de código llegan solas por el aviso dentro de la app (auto-update **firmado**); no hace falta reinstalar salvo saltos del motor Electron.
- La bóveda (`MonederoDNNS-datos`) es tu monedero cifrado: cópiala si mueves la instalación y no la borres.
