#!/bin/zsh
# Throwaway: shoots the two engine-mark concepts in a scratch app (Chromium installed in /var/tmp/ffc).
unset HC_TERMINAL_ID HC_TERMINAL_SOCKET HC_SCOPE __CFBundleIdentifier
W=/Volumes/data/coding/fireflies-wt/chrome-panes
export HERDR_APP_HOME=/var/tmp/ffc HC_SESSION=ffc HERDR_APP_NO_SOUND=1
OUT=/Volumes/data/coding/fireflies-wt/chrome-panes-concepts
APP=$W/target/debug/herdr-app
rm -rf ~/.local/state/herdr-core/ffc $HERDR_APP_HOME/mods $HERDR_APP_HOME/data
echo '{ "layout": "nocturne", "zoom": 0.9, "sounds": { "enabled": false } }' > $HERDR_APP_HOME/settings.json
START=$(date +%s)
nohup $APP > /var/tmp/ffc.log 2>&1 &
PID=$!
for i in $(seq 40); do [ -S $HERDR_APP_HOME/herdr-app.sock ] && break; sleep 0.5; done
do_() { $APP do "$@" 2>&1; }
shot() { do_ window.maximize >/dev/null; sleep 1.2; $APP shot $OUT/$1.png >/dev/null 2>&1 && echo "shot $1"; }
for i in $(seq 20); do R=$(do_ space.new "{\"name\":\"web\",\"folder\":\"$W\"}"); echo "$R" | grep -qi "unavailable\|did not answer\|error" || break; sleep 1; done
sleep 2
do_ app.welcome >/dev/null 2>&1; do_ overlay.close >/dev/null 2>&1
TP=$($APP status 2>&1 | jq -r .focused_pane)
do_ pane.split "{\"direction\":\"right\",\"pane\":\"$TP\",\"mod\":\"browser\",\"props\":{\"slot\":\"c1\",\"engine\":\"chromium\",\"url\":\"https://example.com\"}}" >/dev/null
sleep 4
do_ 'browser.open:{"url":"https://www.wikipedia.org","slot":"c1"}' >/dev/null
sleep 4
shot concept-0-plain
python3 $W/prototypes/cef-spike/concept.py $HERDR_APP_HOME/mods A; sleep 3; shot concept-A-chip
# B on fresh copies: undo A first.
cp $W/defaults/mods/browser/bar.ts $HERDR_APP_HOME/mods/browser/bar.ts
python3 $W/prototypes/cef-spike/concept.py $HERDR_APP_HOME/mods B; sleep 3; shot concept-B-rail
kill $PID; sleep 2; kill -9 $PID 2>/dev/null; ~/.local/bin/hc server stop >/dev/null 2>&1
pgrep -f "Fireflies Helper" | xargs kill 2>/dev/null
rm -rf ~/.local/state/herdr-core/ffc
echo "up $(( $(date +%s) - START )) s"
