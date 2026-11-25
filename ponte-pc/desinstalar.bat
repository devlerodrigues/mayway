@echo off
rem Para a Ponte NFS-e e remove a abertura automatica com o Windows.
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Mayway Ponte NFS-e.vbs" 2>nul
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='powershell.exe'\" | Where-Object { $_.CommandLine -like '*ponte.ps1*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
echo Ponte NFS-e parada e removida da inicializacao.
pause
