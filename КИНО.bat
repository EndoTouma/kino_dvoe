@echo off & chcp 65001 >nul
cd /d "%~dp0"
title Кино на двоих

rem --- Node.js ---
where node >nul 2>nul
if not errorlevel 1 goto have_node
echo.
echo   Node.js не найден, ставлю через winget...
winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
set "PATH=%PATH%;C:\Program Files\nodejs"
where node >nul 2>nul
if not errorlevel 1 goto have_node
echo.
echo   Не вышло автоматически. Установите Node.js с https://nodejs.org ^(кнопка LTS^)
start https://nodejs.org
pause
exit /b 1
:have_node

if not exist data mkdir data

rem --- ключ TMDB ---
if exist data\tmdb.key goto posters_q
echo.
echo   Нужен ключ TMDB. Получить: https://www.themoviedb.org/settings/api ^(раздел API Key^)
echo   Подойдёт v3 key или v4 read token.
set /p "KEY=   Вставьте ключ сюда и нажмите Enter: "
if not defined KEY (echo   Ключ не введён - выход. & exit /b 1)
(echo(%KEY%)>data\tmdb.key
echo   Ключ сохранён в data\tmdb.key
:posters_q

rem --- постеры (необязательно, ~1 ГБ) ---
echo.
set /p "DL=   Скачать постеры (~1 ГБ, надолго)? [д/Н]: "
if /i "%DL%"=="д" call npm run tmdb

rem --- запуск ---
echo.
echo   Запускаю сервер на http://localhost:3000
echo   Это окно - сам сервер: сверните, но не закрывайте, пока пользуетесь.
echo   С телефона в той же Wi-Fi сети открывайте адрес из списка ниже.
start "" http://localhost:3000
set PORT=3000
node server\index.js
