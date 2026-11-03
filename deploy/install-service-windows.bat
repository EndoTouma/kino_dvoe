@echo off & chcp 65001 >nul
rem Устанавливает сервер kino в автозагрузку Windows (планировщик задач, стартует при включении ПК).
net session >nul 2>nul
if not errorlevel 1 goto admin
echo.
echo   Запрашиваю права администратора...
powershell -NoProfile -Command "Start-Process '%~f0' -Verb RunAs -Wait"
exit /b
:admin
cd /d "%~dp0.."
set "APP=%CD%"
schtasks /Create /TN "Kino Server" /SC ONSTART /RU SYSTEM /RL HIGHEST /F /TR "\"wscript.exe\" \"%APP%\start-kino.vbs\"" >nul
if errorlevel 1 (
  echo.
  echo   Не вышло создать задачу. Попробуйте ещё раз от имени администратора:
  echo   правая кнопка на этом файле - ^«Запуск от имени администратора^».
  pause
  exit /b 1
)
schtasks /Run /TN "Kino Server" >nul 2>nul
echo.
echo   Готово. Сервер запущен и теперь стартует при включении компьютера,
echo   перезапускается при падении, не требуя входа в систему.
echo   Адрес:  http://localhost     (с телефона - IP компьютера в вашей сети)
echo   Лог:    data\kino.log
echo   Убрать службу:  deploy\remove-service-windows.bat
echo   Остановить сервер сейчас: stop-kino.cmd
pause
