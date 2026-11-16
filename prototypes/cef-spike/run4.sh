#!/bin/zsh
# Throwaway: Chromium's DevTools in a pane through the bridge (item 5), in a scratch app.
unset HC_TERMINAL_ID HC_TERMINAL_SOCKET HC_SCOPE __CFBundleIdentifier
W=/Volumes/data/coding/fireflies-wt/chrome-panes
S=/private/tmp/claude-501/-Volumes-data-coding-fireflies-wt-chrome-panes/89e50c62-1e48-4890-94d0-d2e18c2a1c8f/scratchpad
export HERDR_APP_HOME=/var/tmp/ffc HC_SESSION=ffc HERDR_APP_NO_SOUND=1
OUT=/Volumes/data/coding/fireflies-wt/chrome-panes-shots
APP=$W/target/debug/herdr-app
$APP do status >/dev/null 2>&1 && { echo "a scratch app already runs on $HERDR_APP_HOME: stop it first"; exit 1; }
rm -rf ~/.local/state/herdr-core/ffc
echo '{ "layout": "nocturne", "zoom": 0.9, "sounds": { "enabled": false } }' > $HERDR_APP_HOME/settings.json
SLOT=c$(date +%s); START=$(date +%s)
nohup $APP > /var/tmp/ffc.log 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null; sleep 1; kill -9 $PID 2>/dev/null; ~/.local/bin/hc server stop >/dev/null 2>&1; pgrep -f "/var/tmp/ffc/chromium" | xargs kill 2>/dev/null; rm -rf ~/.local/state/herdr-core/ffc' EXIT
for i in $(seq 40); do [ -S $HERDR_APP_HOME/herdr-app.sock ] && break; sleep 0.5; done
do_() { $APP do "$@" 2>&1; }
frame() { do_ window.maximize >/dev/null; sleep 1; }
win() { $S/winid $PID | awk '$2==0 && $NF=="Fireflies" {print $1}' | head -1; }
cap() { local w=$(win); [ -n "$w" ] && screencapture -x -o -l $w $OUT/$1.png && echo "shot $1"; }
views() { frame; frame; do_ native.debug | jq -c '[.views | to_entries[] | {k: .key, kind: .value.kind, title: .value.content.title, href: (.value.content.href // "" | .[0:70])}]'; }
for i in $(seq 20); do R=$(do_ space.new "{\"name\":\"web\",\"folder\":\"$W\"}"); echo "$R" | grep -qi "unavailable\|did not answer\|error" || break; sleep 1; done
sleep 2
do_ overlay.close >/dev/null 2>&1
TP=$($APP status 2>&1 | jq -r .focused_pane)
BP=$(do_ pane.split "{\"direction\":\"right\",\"pane\":\"$TP\",\"mod\":\"browser\",\"props\":{\"slot\":\"$SLOT\",\"engine\":\"chromium\",\"url\":\"https://example.com\"}}" | jq -r .pane)
for i in 1 2 3 4; do sleep 1; frame; done
echo "--- page"; views
do_ pane.focus "{\"pane\":\"$BP\"}" >/dev/null; sleep 0.5
echo "--- d (browser.inspect)"; do_ browser.inspect
for i in 1 2 3 4 5 6; do sleep 1; frame; done
views
echo "--- listening TCP ports of the app"; lsof -nP -a -p $PID -iTCP -sTCP:LISTEN 2>/dev/null | awk 'NR>1 {print $9}'
sleep 2; frame; cap 30-devtools-in-pane || { sleep 2; cap 30-devtools-in-pane; }
echo "--- d again closes it"; do_ pane.focus "{\"pane\":\"$BP\"}" >/dev/null; do_ browser.inspect >/dev/null; for i in 1 2 3; do sleep 1; frame; done; views
echo "up $(( $(date +%s) - START )) s"
