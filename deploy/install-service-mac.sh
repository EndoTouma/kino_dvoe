#!/bin/bash
# Устанавливает сервер kino в автозагрузку текущего пользователя (macOS).
# Запуск: bash deploy/install-service-mac.sh
cd "$(dirname "$0")/.." || exit 1
APP="$PWD"

NODE="$(command -v node || true)"
[ -z "$NODE" ] && [ -x /opt/homebrew/bin/node ] && NODE=/opt/homebrew/bin/node
[ -z "$NODE" ] && [ -x /usr/local/bin/node ] && NODE=/usr/local/bin/node
if [ -z "$NODE" ]; then
  echo "Node.js не найден. Установите его:  brew install node"
  echo "(Homebrew ставится командой с https://brew.sh)"
  exit 1
fi

PLIST=~/Library/LaunchAgents/ru.kino.server.plist
mkdir -p ~/Library/LaunchAgents "$APP/data"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>ru.kino.server</string>
  <key>WorkingDirectory</key>
  <string>$APP</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>server/index.js</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PORT</key>
    <string>3000</string>
    <key>KINO_WATCHDOG</key>
    <string>1</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$APP/data/kino.log</string>
  <key>StandardErrorPath</key>
  <string>$APP/data/kino.err.log</string>
</dict>
</plist>
EOF

launchctl unload "$PLIST" 2>/dev/null
launchctl load "$PLIST"
echo "Готово: сервер работает, стартует при входе и перезапускается при падении."
echo "Адрес на этом Mac: http://localhost:3000"
IP="$(ipconfig getifaddr en0 2>/dev/null)"
[ -n "$IP" ] && echo "С телефона в этой Wi-Fi сети: http://$IP:3000"
echo "Логи: data/kino.log и data/kino.err.log"
echo "Убрать службу: bash deploy/remove-service-mac.sh"
