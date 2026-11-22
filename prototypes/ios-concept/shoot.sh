#!/bin/sh
# Shoot the concept pages with Playwright's headless Chromium (already on this
# Mac, nothing installed): ./shoot.sh concept-a a-panes … → shots/<name>.png
H=~/Library/Caches/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-mac-arm64/chrome-headless-shell
cd "$(dirname "$0")" && mkdir -p shots
for n in "$@"; do
  "$H" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --window-size=1810,${HEIGHT:-1180} \
    --virtual-time-budget=3000 --screenshot="$PWD/shots/$n.png" "file://$PWD/$n.html" 2>&1 | grep written
done
