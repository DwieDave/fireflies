#!/bin/zsh
# Throwaway: item 2 end to end in a scratch app. Chromium enabled from
# nothing (the pinned archive from a local server: FIREFLIES_CEF_URL), a
# Chromium pane on youtube.com, then removed. Shots in $OUT.
unset HC_TERMINAL_ID HC_TERMINAL_SOCKET HC_SCOPE __CFBundleIdentifier
W=/Volumes/data/coding/fireflies-wt/chrome-panes
S=/private/tmp/claude-501/-Volumes-data-coding-fireflies-wt-chrome-panes/89e50c62-1e48-4890-94d0-d2e18c2a1c8f/scratchpad
export HERDR_APP_HOME=/var/tmp/ffi HC_SESSION=ffi HERDR_APP_NO_SOUND=1 FIREFLIES_CHROMIUM_DEBUG_PORT=9334 FIREFLIES_CEF_URL=http://127.0.0.1:8765
OUT=/Volumes/data/coding/fireflies-wt/chrome-panes-shots
APP=$W/target/debug/herdr-app
CDP() { bun $W/prototypes/cef-spike/cdp.ts 9334 "$@"; }
rm -rf $HERDR_APP_HOME ~/.local/state/herdr-core/ffi; mkdir -p $HERDR_APP_HOME $OUT
echo '{ "layout": "nocturne", "zoom": 0.9, "sounds": { "enabled": false } }' > $HERDR_APP_HOME/settings.json
python3 -m http.server 8765 --bind 127.0.0.1 --directory /Volumes/data/coding/fireflies-wt/cef/156.0.30 > /var/tmp/ffi-http.log 2>&1 &
HTTP=$!
START=$(date +%s)
nohup $APP > /var/tmp/ffi.log 2>&1 &
PID=$!
for i in $(seq 40); do [ -S $HERDR_APP_HOME/herdr-app.sock ] && break; sleep 0.5; done
do_() { $APP do "$@" 2>&1; }
win() { $S/winid $PID | awk '$2==0 && $NF=="Fireflies" {print $1}' | head -1; }
cap() { local w=$(win); [ -n "$w" ] && screencapture -x -o -l $w $OUT/$1.png && echo "shot $1"; }
shot() { do_ window.maximize >/dev/null; sleep 1.2; $APP shot $OUT/$1.png >/dev/null 2>&1 && echo "shot $1"; }
st() { do_ native.debug | jq -c '.chromium.install | {installed, phase, done, error, engineBytes}'; }
for i in $(seq 20); do R=$(do_ space.new "{\"name\":\"cef\",\"folder\":\"$W\"}"); echo "$R" | grep -qi "unavailable\|did not answer\|error" || break; sleep 1; done
sleep 2
echo "--- before"; st
do_ app.settings '{"section":"web"}' >/dev/null; sleep 1; shot 10-web-settings-off
echo "--- install"; do_ chromium.install
for i in $(seq 120); do R=$(st); echo "$R" | grep -q '"phase":"downloading"' && [ $i -lt 3 ] && shot 11-web-settings-downloading; echo "$R" | grep -q '"installed":true\|"phase":"failed"' && break; sleep 0.5; done
echo "$R"; echo "took ~$((i / 2)) s"
sleep 5.5; shot 12-web-settings-installed
do_ native.debug | jq -c '.chromium | {present, started}'
do_ overlay.close '{"id":"settings"}' >/dev/null; sleep 0.5
echo "--- youtube.com in a Chromium pane"
TP=$($APP status 2>&1 | jq -r .focused_pane)
do_ pane.split "{\"direction\":\"right\",\"pane\":\"$TP\",\"mod\":\"browser\",\"props\":{\"slot\":\"yt\",\"engine\":\"chromium\",\"url\":\"https://www.youtube.com/watch?v=aqz-KE-bpKQ\"}}" >/dev/null
sleep 10
CDP - - list
CDP youtube eval '(() => { const b=[...document.querySelectorAll("button, a")].find(x=>/^(accept all|alle akzeptieren|reject all|alle ablehnen)$/i.test((x.innerText||x.getAttribute("aria-label")||"").trim())); if(b){ b.click(); return "consent: " + b.innerText.trim() } return "no consent" })()'
sleep 10
CDP youtube eval '(async () => { const v=document.querySelector("video"); if(!v) return {video:false, url:location.href}; v.muted=true; v.play().catch(()=>{}); await new Promise(r=>setTimeout(r,1500)); const t0=v.currentTime; await new Promise(r=>setTimeout(r,3000)); const q=v.getVideoPlaybackQuality(); return {t0, t1:v.currentTime, paused:v.paused, w:v.videoWidth, h:v.videoHeight, err:v.error&&v.error.code, frames:q.totalVideoFrames, dropped:q.droppedVideoFrames, codecs: (performance.getEntriesByType("resource").map(e=>e.name).find(n=>/mime=video/.test(n))||"").match(/mime=([^&]+)/)?.[1]} })()'
CDP youtube shot $OUT/13-youtube-page.png
do_ window.maximize >/dev/null; sleep 1; cap 13-youtube-in-pane
do_ app.palette >/dev/null; sleep 1.5; do_ window.maximize >/dev/null; sleep 1; cap 15-palette-over-video
do_ native.debug | jq -c '[.views[] | select(.kind=="chromium") | {masked, shadow, press: .pressAtCenter}]'
do_ overlay.close '{"id":"palette"}' >/dev/null 2>&1; do_ app.palette >/dev/null 2>&1; sleep 0.5
echo "--- remove"; do_ chromium.remove
st; do_ app.settings '{"section":"web"}' >/dev/null; sleep 1; shot 14-web-settings-removed
/bin/ls $HERDR_APP_HOME/chromium
echo "--- memory (rss MB)"; ps -o rss= -p $PID | awk '{printf "app %d\n", $1/1024}'; pgrep -f "Fireflies Helper" | while read p; do ps -o rss= -p $p; done | awk '{s+=$1; n++} END {printf "%d helpers %d MB\n", n, s/1024}'
kill $PID; sleep 2; kill -9 $PID 2>/dev/null; ~/.local/bin/hc server stop >/dev/null 2>&1
pgrep -f "Fireflies Helper" | xargs kill 2>/dev/null; kill $HTTP
rm -rf ~/.local/state/herdr-core/ffi
echo "up $(( $(date +%s) - START )) s"
