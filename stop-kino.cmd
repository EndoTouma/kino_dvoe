@echo off
rem Stops the kino server: first the watchdog script (so it does not restart node), then node itself.
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='wscript.exe'\" | Where-Object CommandLine -like '*start-kino.vbs*' | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }; Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object CommandLine -like '*server\index.js*' | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
echo kino stopped
