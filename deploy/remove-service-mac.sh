#!/bin/bash
# Убирает сервер kino из автозагрузки macOS.
PLIST=~/Library/LaunchAgents/ru.kino.server.plist
launchctl unload "$PLIST" 2>/dev/null && echo "Сервис остановлен."
rm -f "$PLIST" && echo "Автозагрузка удалена."
