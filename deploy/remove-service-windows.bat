@echo off & chcp 65001 >nul
rem Убирает сервер kino из автозагрузки Windows.
net session >nul 2>nul
if not errorlevel 1 goto admin
echo.
echo   Запрашиваю права администратора...
powershell -NoProfile -Command "Start-Process '%~f0' -Verb RunAs -Wait"
exit /b
:admin
schtasks /Delete /TN "Kino Server" /F
echo.
echo   Задача удалена: сервер больше не стартует при включении компьютера.
echo   Уже запущенный экземпляр остановится от stop-kino.cmd или перезагрузки.
pause
