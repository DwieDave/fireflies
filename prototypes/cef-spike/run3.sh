#!/bin/zsh
# Throwaway: the sandbox and item 4 (media Chromium can't play) in a scratch app
# (Chromium installed in /var/tmp/ffc). Shots in $OUT.
unset HC_TERMINAL_ID HC_TERMINAL_SOCKET HC_SCOPE __CFBundleIdentifier
W=/Volumes/data/coding/fireflies-wt/chrome-panes
S=/private/tmp/claude-501/-Volumes-data-coding-fireflies-wt-chrome-panes/89e50c62-1e48-4890-94d0-d2e18c2a1c8f/scratchpad
export HERDR_APP_HOME=/var/tmp/ffc HC_SESSION=ffc HERDR_APP_NO_SOUND=1
OUT=/Volumes/data/coding/fireflies-wt/chrome-panes-shots
APP=$W/target/debug/herdr-app
MP4=https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4
rm -rf ~/.local/state/herdr-core/ffc $HERDR_APP_HOME/mods $HERDR_APP_HOME/data
setj() { echo "{ \"layout\": \"nocturne\", \"zoom\": 0.9, \"sounds\": { \"enabled\": false }$1 }" > $HERDR_APP_HOME/settings.json; }
setj ""
# Another scratch app on this home would take the commands: refuse.
$APP do status >/dev/null 2>&1 && { echo "a scratch app already runs on $HERDR_APP_HOME: stop it first"; exit 1; }
SLOT=c$(date +%s); START=$(date +%s)
nohup $APP > /var/tmp/ffc.log 2>&1 &
PID=$!
# Whatever happens below, the app, its helpers and its core stop.
trap 'kill $PID 2>/dev/null; sleep 1; kill -9 $PID 2>/dev/null; ~/.local/bin/hc server stop >/dev/null 2>&1; pgrep -f "/var/tmp/ffc/chromium" | xargs kill 2>/dev/null; rm -rf ~/.local/state/herdr-core/ffc' EXIT
for i in $(seq 40); do [ -S $HERDR_APP_HOME/herdr-app.sock ] && break; sleep 0.5; done
do_() { $APP do "$@" 2>&1; }
shot() { do_ window.maximize >/dev/null; sleep 1.2; $APP shot $OUT/$1.png >/dev/null 2>&1 && echo "shot $1"; }
# A hidden scratch window draws no frames by itself: force one, so the mod's
# new render (a view made, a tab's engine changed) reaches the native views.
frame() { do_ window.maximize >/dev/null; sleep 1; }
kind() { frame; frame; do_ native.debug | jq -c '[.views | to_entries[] | select(.value.kind=="chromium" or .value.kind=="web") | {k: .key, kind: .value.kind, title: .value.content.title, href: .value.content.href}]'; }
nav() { local k=$(do_ native.debug | jq -r '[.views | to_entries[] | select(.value.kind=="chromium")][0].key'); do_ native.call "{\"key\":\"$k\",\"action\":\"browser.navigate\",\"args\":{\"url\":\"$1\"}}" >/dev/null; }
for i in $(seq 20); do R=$(do_ space.new "{\"name\":\"web\",\"folder\":\"$W\"}"); echo "$R" | grep -qi "unavailable\|did not answer\|error" || break; sleep 1; done
sleep 2
do_ overlay.close >/dev/null 2>&1
TP=$($APP status 2>&1 | jq -r .focused_pane)
BP=$(do_ pane.split "{\"direction\":\"right\",\"pane\":\"$TP\",\"mod\":\"browser\",\"props\":{\"slot\":\"$SLOT\",\"engine\":\"chromium\",\"url\":\"https://example.com\"}}" | jq -r .pane)
other() { do_ pane.focus "{\"pane\":\"$BP\"}" >/dev/null; sleep 0.5; do_ browser.other_engine >/dev/null; }
sleep 6
echo "--- sandboxed page loads"; kind
ps -ax -o args= | grep "Fireflies Helper (Renderer)" | grep -v grep | head -2 | grep -o -- "--type=renderer\|--seatbelt-client=[0-9]*" | sort | uniq -c
echo "--- youtube: no fallback"; nav "https://www.youtube.com/watch?v=aqz-KE-bpKQ"; for i in 1 2 3 4 5 6 7; do sleep 2; frame; done; kind
echo "--- fallback (default) on a plain H.264 mp4"; nav "$MP4"; for i in 1 2 3 4 5 6; do sleep 2; frame; done; kind; shot 20-fallback-toast
echo "--- ask"; setj ', "chromium_video": "ask"'; sleep 1; other; sleep 4; kind; nav "$MP4"; for i in 1 2 3 4 5 6; do sleep 2; frame; done; kind; shot 21-ask-toast
do_ 'browser.reopen:{"slot":"'$SLOT'","tab":"web","engine":"webkit"}' >/dev/null; sleep 3; echo "after the toast's command:"; kind
echo "--- error"; setj ', "chromium_video": "error"'; sleep 1; other; sleep 4; nav "$MP4"; for i in 1 2 3 4 5 6; do sleep 2; frame; done; kind
kill $PID; sleep 2; kill -9 $PID 2>/dev/null; ~/.local/bin/hc server stop >/dev/null 2>&1
pgrep -f "Fireflies Helper" | xargs kill 2>/dev/null
rm -rf ~/.local/state/herdr-core/ffc
echo "up $(( $(date +%s) - START )) s"
