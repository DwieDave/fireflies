// Throwaway: how fast does CDP's screencast deliver frames of a busy page,
// and how long from an input event to a frame that shows its effect?
// Run: bun prototypes/cdp-screencast/measure.ts <chromium binary> <width> <height> <scale>
// Headless (no window on screen), fresh profile in a temp dir.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [bin, W = "1280", H = "800", S = "2"] = process.argv.slice(2);
const w = Number(W), h = Number(H), scale = Number(S);
const dir = mkdtempSync(join(tmpdir(), "cdp-"));
const proc = Bun.spawn([bin, "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${dir}`, "--no-first-run", `--window-size=${w},${h}`, `--force-device-scale-factor=${scale}`, "about:blank"], { stderr: "pipe" });

// The DevTools URL Chromium prints on stderr.
let wsUrl = "";
const dec = new TextDecoder();
for await (const chunk of proc.stderr) {
  const m = dec.decode(chunk).match(/DevTools listening on (ws:\/\/\S+)/);
  if (m) { wsUrl = m[1]; break; }
}
const port = new URL(wsUrl).port;
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = targets.find((t: any) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map<number, (v: any) => void>();
const listeners: ((m: any) => void)[] = [];
ws.onmessage = (e) => {
  const m = JSON.parse(String(e.data));
  if (m.id && pending.has(m.id)) { pending.get(m.id)!(m.result ?? m.error); pending.delete(m.id); }
  else listeners.forEach((f) => f(m));
};
const send = (method: string, params: any = {}) => new Promise<any>((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });

// A page that animates every frame (moving bars, like a video) and, on a
// press, switches between a flat colour and noise: the JPEG's size tells which.
const html = `<body style="margin:0;background:#000"><canvas id=c></canvas><script>
const c=document.getElementById('c');c.width=innerWidth*devicePixelRatio;c.height=innerHeight*devicePixelRatio;c.style.width='100vw';c.style.height='100vh';
const g=c.getContext('2d');let noise=false,t=0;const img=g.createImageData(c.width,c.height);for(let i=0;i<img.data.length;i++)img.data[i]=Math.random()*255;
addEventListener('mousedown',()=>{noise=!noise});
function f(){t++;if(noise)g.putImageData(img,0,0);else{g.fillStyle='#123';g.fillRect(0,0,c.width,c.height);g.fillStyle='#fff';g.fillRect((t*7)%c.width,0,40,c.height);}requestAnimationFrame(f)}f();
</script></body>`;
await send("Page.enable");
console.error("nav", JSON.stringify(await send("Page.navigate", { url: "data:text/html," + encodeURIComponent(html) })).slice(0,200));
await Bun.sleep(800);

type Frame = { at: number; size: number };
const frames: Frame[] = [];
listeners.push((m) => {
  if (m.method !== "Page.screencastFrame") return;
  frames.push({ at: performance.now(), size: m.params.data.length });
  send("Page.screencastFrameAck", { sessionId: m.params.sessionId });
});
console.error("start", JSON.stringify(await send("Page.startScreencast", { format: "jpeg", quality: 70, maxWidth: w * scale, maxHeight: h * scale })));

// 1. Frame rate of the animating page over 3 s (after the first frame: headless
// sometimes takes a few seconds to start sending).
for (let i = 0; i < 100 && frames.length === 0; i++) await Bun.sleep(100);
if (frames.length === 0) { console.log(JSON.stringify({ size: `${w}x${h}@${scale}x`, error: "no frames in 10 s" })); proc.kill(); process.exit(0); }
await Bun.sleep(500);
const n0 = frames.length, t0 = performance.now();
await Bun.sleep(3000);
const fps = ((frames.length - n0) * 1000) / (performance.now() - t0);
const avgKB = frames.slice(n0).reduce((a, f) => a + f.size, 0) / Math.max(1, frames.length - n0) * 0.75 / 1024;

// 2. Press → first frame whose size crosses between flat and noise, 20 times.
const lat: number[] = [];
for (let i = 0; i < 20; i++) {
  const before = frames.at(-1)!.size;
  const start = performance.now();
  const from = frames.length;
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: 100, y: 100, button: "left", clickCount: 1 });
  send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 100, y: 100, button: "left", clickCount: 1 });
  for (;;) {
    const hit = frames.slice(from).find((f) => Math.abs(f.size - before) > before * 0.5);
    if (hit) { lat.push(hit.at - start); break; }
    if (performance.now() - start > 2000) { lat.push(NaN); break; }
    await Bun.sleep(1);
  }
  await Bun.sleep(150);
}
lat.sort((a, b) => a - b);
console.log(JSON.stringify({ bin: bin.split("/").at(-1), size: `${w}x${h}@${scale}x`, fps: +fps.toFixed(1), avgFrameKB: +avgKB.toFixed(0), pressToFrameMs: { min: +lat[0].toFixed(1), median: +lat[10].toFixed(1), p90: +lat[18].toFixed(1), max: +lat[19].toFixed(1) } }));
await send("Page.stopScreencast");
ws.close();
proc.kill();
await proc.exited;
rmSync(dir, { recursive: true, force: true });
