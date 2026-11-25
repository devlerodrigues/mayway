@echo off
rem Instala a Ponte NFS-e (Mayway) para abrir sozinha com o Windows e ja a inicia.
setlocal
set "PASTA=%~dp0"
set "INICIAR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Mayway Ponte NFS-e.vbs"

if not exist "%PASTA%config.json" (
  echo Falta o arquivo config.json nesta pasta.
  pause
  exit /b 1
)

> "%INICIAR%" echo CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""%PASTA%ponte.ps1""", 0, False

start "" wscript.exe "%INICIAR%"
echo.
echo Ponte NFS-e instalada e rodando em segundo plano.
echo Ela abre sozinha sempre que o Windows iniciar.
echo Registro de atividade: %LOCALAPPDATA%\MaywayPonte\ponte.log
echo.
pause
