#!/bin/zsh
# Throwaway: one scratch run of the CEF spike. Start, open a Chromium pane,
# check it (native.debug, CDP, window captures), stop. Prints a log; shots in $OUT.
unset HC_TERMINAL_ID HC_TERMINAL_SOCKET HC_SCOPE __CFBundleIdentifier
W=/Volumes/data/coding/fireflies-wt/chrome-panes
S=/private/tmp/claude-501/-Volumes-data-coding-fireflies-wt-chrome-panes/89e50c62-1e48-4890-94d0-d2e18c2a1c8f/scratchpad
export HERDR_APP_HOME=/var/tmp/ffc HC_SESSION=ffc HERDR_APP_NO_SOUND=1 FIREFLIES_CHROMIUM_DEBUG_PORT=9333 FIREFLIES_SPIKE=1
OUT=/Volumes/data/coding/fireflies-wt/chrome-panes-shots
APP=$W/target/debug/herdr-app
CDP() { bun $W/prototypes/cef-spike/cdp.ts 9333 "$@"; }
mkdir -p $HERDR_APP_HOME $OUT
rm -rf ~/.local/state/herdr-core/ffc
echo '{ "layout": "nocturne", "zoom": 0.9, "sounds": { "enabled": false } }' > $HERDR_APP_HOME/settings.json
START=$(date +%s)
nohup $APP > /var/tmp/ffc.log 2>&1 &
PID=$!
for i in $(seq 40); do [ -S $HERDR_APP_HOME/herdr-app.sock ] && break; sleep 0.5; done
do_() { $APP do "$@" 2>&1; }
win() { $S/winid $PID | awk '$2==0 && $NF=="Fireflies" {print $1}' | head -1; }
cap() { local w=$(win); [ -n "$w" ] && screencapture -x -o -l $w $OUT/$1.png && echo "shot $1 (window $w)"; }
for i in $(seq 20); do R=$(do_ space.new "{\"name\":\"cef\",\"folder\":\"$W\"}"); echo "$R" | grep -qi "unavailable\|did not answer\|error" || break; sleep 1; done
echo "space.new: $R"
sleep 2
TP=$($APP status 2>&1 | jq -r .focused_pane)
echo "terminal pane: $TP"
do_ pane.split "{\"direction\":\"right\",\"pane\":\"$TP\",\"mod\":\"browser\",\"props\":{\"slot\":\"cr1\",\"engine\":\"chromium\",\"url\":\"https://example.com\"}}"
sleep 6
echo "--- debug after open"; do_ native.debug | jq -c '{chromium, views: (.views | to_entries | map({key, kind: .value.kind, hidden: .value.hidden, frame: .value.frame, inner: .value.innerFrame, masked: .value.masked, first: .value.firstResponderInside, press: .value.pressAtCenter, content: .value.content}))}'
do_ window.maximize >/dev/null; sleep 1.5; cap 01-chromium-pane
KEY=$(do_ native.debug | jq -r '.views | to_entries | map(select(.value.kind=="chromium")) | .[0].key')
echo "chromium key: $KEY"
echo "--- events"; do_ native.debug | jq -c '[.events[] | select(.key=="'$KEY'") | .event] | group_by(.) | map({(.[0]): length}) | add'
echo "--- media support"; CDP example eval '(async () => { const v=document.createElement("video"); const c=t=>v.canPlayType(t); const ms=t=>window.MediaSource?MediaSource.isTypeSupported(t):null; let wv=null; try { await navigator.requestMediaKeySystemAccess("com.widevine.alpha",[{initDataTypes:["cenc"],videoCapabilities:[{contentType:"video/mp4; codecs=\"avc1.42E01E\""}]}]); wv="yes" } catch(e){ wv=e.name+": "+e.message } return {h264:c("video/mp4; codecs=\"avc1.42E01E\""), aac:c("audio/mp4; codecs=\"mp4a.40.2\""), vp9:c("video/webm; codecs=\"vp9\""), av1:c("video/mp4; codecs=\"av01.0.05M.08\""), opus:c("audio/webm; codecs=\"opus\""), msH264:ms("video/mp4; codecs=\"avc1.42E01E\""), msVp9:ms("video/webm; codecs=\"vp9\""), widevine:wv, ua:navigator.userAgent} })()'
# Holes and dim: the palette (a dialog) over the page.
do_ app.palette >/dev/null; sleep 1.5
echo "--- debug under the palette"; do_ native.debug | jq -c '.views["'$KEY'"] | {hidden, masked, holes, shadow, press: .pressAtCenter, holeClicks: .holeClicksReachHerdr}'
do_ window.maximize >/dev/null; sleep 1; cap 02-palette-over-chromium
do_ app.palette >/dev/null 2>&1; sleep 0.5
do_ overlay.close >/dev/null 2>&1; sleep 1
# Focus: the page takes the keyboard, then gives it back.
echo "--- focus"; do_ native.call "{\"key\":\"$KEY\",\"action\":\"focus\"}"; sleep 0.5
do_ native.debug | jq -c '.views["'$KEY'"] | {first: .firstResponderInside}'
do_ native.call "{\"key\":\"$KEY\",\"action\":\"blur\"}"; sleep 0.5
do_ native.debug | jq -c '.views["'$KEY'"] | {first: .firstResponderInside}'
# DevTools: the frontend as a page in a second Chromium pane (CEF's debug port).
echo "--- devtools"
ID=$(curl -s http://127.0.0.1:9333/json/list | jq -r '[.[] | select(.type=="page" and (.url|test("example")))][0].id')
echo "target $ID"
BP=$($APP status 2>&1 | jq -r '.focused_pane')
do_ pane.split "{\"direction\":\"down\",\"mod\":\"browser\",\"props\":{\"slot\":\"dt\",\"engine\":\"chromium\",\"url\":\"http://127.0.0.1:9333/devtools/inspector.html?ws=127.0.0.1:9333/devtools/page/$ID\"}}"
sleep 7
CDP inspector.html eval '(() => ({ title: document.title, panels: document.querySelectorAll(".tabbed-pane-header-tab").length, body: document.body.innerText.slice(0, 120) }))()'
do_ window.maximize >/dev/null; sleep 1; cap 03-devtools-pane
echo "--- devtools from devtools://"
CDP inspector.html eval '(() => { location.href = "devtools://devtools/bundled/inspector.html?ws=127.0.0.1:9333/devtools/page/'"$ID"'"; return true })()'
sleep 4; CDP - - list
CDP devtools:// eval '(() => ({ title: document.title, panels: document.querySelectorAll(".tabbed-pane-header-tab").length }))()'
do_ window.maximize >/dev/null; sleep 1; cap 03b-devtools-scheme
# Video: a YouTube embed (VP9/AV1), then a plain H.264 MP4.
echo "--- youtube"; do_ native.call "{\"key\":\"$KEY\",\"action\":\"browser.navigate\",\"args\":{\"url\":\"https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ?autoplay=1&mute=1\"}}"; sleep 10
CDP youtube eval '(async () => { const v=document.querySelector("video"); if(!v) return {video:false}; v.muted=true; v.play().catch(()=>{}); await new Promise(r=>setTimeout(r,1500)); const t0=v.currentTime; await new Promise(r=>setTimeout(r,3000)); const q=v.getVideoPlaybackQuality?v.getVideoPlaybackQuality():null; return {t0, t1:v.currentTime, paused:v.paused, w:v.videoWidth, h:v.videoHeight, err:v.error&&v.error.code, frames:q&&q.totalVideoFrames, dropped:q&&q.droppedVideoFrames} })()'
CDP youtube shot $OUT/04b-youtube-page.png
do_ window.maximize >/dev/null; sleep 1; cap 04-youtube
echo "--- pip-style move"; do_ native.call "{\"key\":\"$KEY\",\"action\":\"spike.reparent\",\"args\":{\"secs\":4}}"; sleep 1.5
$S/winid $PID
P=$($S/winid $PID | awk '$3==640 {print $1}' | head -1); [ -n "$P" ] && screencapture -x -o -l $P $OUT/05-moved-into-panel.png && echo "shot panel $P"
CDP youtube eval '(async () => { const v=document.querySelector("video"); const t0=v.currentTime; await new Promise(r=>setTimeout(r,1500)); return {t0, t1:v.currentTime, paused:v.paused} })()'
sleep 3; do_ window.maximize >/dev/null; sleep 1; cap 06-moved-back
echo "--- vp9 webm"; do_ native.call "{\"key\":\"$KEY\",\"action\":\"browser.navigate\",\"args\":{\"url\":\"https://upload.wikimedia.org/wikipedia/commons/transcoded/c/c0/Big_Buck_Bunny_4K.webm/Big_Buck_Bunny_4K.webm.480p.vp9.webm\"}}"; sleep 6
CDP Big_Buck eval '(async () => { const v=document.querySelector("video"); if(!v) return {video:false}; v.muted=true; v.play().catch(()=>{}); await new Promise(r=>setTimeout(r,1000)); const t0=v.currentTime; await new Promise(r=>setTimeout(r,2500)); return {t0, t1:v.currentTime, w:v.videoWidth, err:v.error&&v.error.code} })()'
do_ window.maximize >/dev/null; sleep 1; cap 04c-vp9
echo "--- h264 mp4"; do_ native.call "{\"key\":\"$KEY\",\"action\":\"browser.navigate\",\"args\":{\"url\":\"https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4\"}}"; sleep 6
CDP Big_Buck_Bunny_360 eval '(() => { const v=document.querySelector("video"); return v ? {err:v.error&&v.error.code, msg:v.error&&v.error.message, net:v.networkState, ready:v.readyState} : {video:false} })()'
echo "--- memory (rss MB)"; ps -o rss=,command= -p $PID | awk '{printf "app %d\n", $1/1024}'; pgrep -f "Fireflies Helper" | while read p; do ps -o rss=,command= -p $p | awk '{n=$0; sub(/^ *[0-9]+ /,"",n); printf "%d %s\n", $1/1024, substr(n, index(n,"Fireflies Helper"), 40)}'; done
echo "--- log"; grep -i -E "chrom|cef|panic|error" /var/tmp/ffc.log | head -20; tail -5 $HERDR_APP_HOME/chromium/profile/chromium.log 2>/dev/null
kill $PID; sleep 2; kill -9 $PID 2>/dev/null; ~/.local/bin/hc server stop >/dev/null 2>&1
pgrep -f "Fireflies Helper" | xargs kill 2>/dev/null
rm -rf ~/.local/state/herdr-core/ffc
echo "up $(( $(date +%s) - START )) s"
