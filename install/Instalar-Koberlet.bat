@echo off
setlocal enableextensions
title Instalar Koberlet
chcp 65001 >nul

set "SRC=%~dp0"
set "DEST=%LOCALAPPDATA%\Koberlet"

echo.
echo   ==============================================
echo    Instalador de Koberlet
echo   ==============================================
echo.
echo    Se instalara en:
echo    %DEST%
echo.

if not exist "%SRC%Koberlet.exe" (
  echo   ERROR: ejecuta este instalador DENTRO de la carpeta
  echo   descomprimida de Koberlet ^(junto a Koberlet.exe^).
  echo.
  pause
  exit /b 1
)

echo   Copiando archivos... ^(puede tardar unos segundos^)
robocopy "%SRC%." "%DEST%" /E /NFL /NDL /NJH /NJS /NC /NS /NP /XF "Instalar Koberlet.bat" /XD "_update" "MonederoDNNS-datos" >nul

REM Acceso directo en el Escritorio
powershell -NoProfile -Command "$w=New-Object -ComObject WScript.Shell; $s=$w.CreateShortcut([Environment]::GetFolderPath('Desktop')+'\Koberlet.lnk'); $s.TargetPath='%DEST%\Koberlet.exe'; $s.WorkingDirectory='%DEST%'; $s.IconLocation='%DEST%\resources\app\renderer\icon.ico'; $s.Description='Koberlet - monedero multi-cadena'; $s.Save()"

REM Acceso directo en el menu Inicio
powershell -NoProfile -Command "$w=New-Object -ComObject WScript.Shell; $s=$w.CreateShortcut([Environment]::GetFolderPath('Programs')+'\Koberlet.lnk'); $s.TargetPath='%DEST%\Koberlet.exe'; $s.WorkingDirectory='%DEST%'; $s.IconLocation='%DEST%\resources\app\renderer\icon.ico'; $s.Description='Koberlet - monedero multi-cadena'; $s.Save()"

echo.
echo   Listo. Koberlet instalado y con acceso directo en el escritorio.
echo   Abriendo la aplicacion...
echo.
start "" "%DEST%\Koberlet.exe"
timeout /t 2 >nul
exit /b 0
