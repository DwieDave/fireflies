// Throwaway: evaluate an expression in a CEF page over its DevTools port
// (FIREFLIES_CHROMIUM_DEBUG_PORT), or save a screenshot of it.
//   bun cdp.ts <port> <url substring> eval '<expression>'
//   bun cdp.ts <port> <url substring> shot <file.png>
//   bun cdp.ts <port> - list
const [port, match, mode, arg] = process.argv.slice(2);
setTimeout(() => { console.log(JSON.stringify({ error: "timeout" })); process.exit(2); }, 15000);
const targets: any[] = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
if (mode === "list") {
  console.log(JSON.stringify(targets.map((t) => ({ type: t.type, url: t.url, title: t.title }))));
  process.exit(0);
}
const t = targets.find((x) => x.type === "page" && x.url.includes(match));
if (!t) { console.log(JSON.stringify({ error: "no target", urls: targets.map((x) => x.url) })); process.exit(1); }
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const send = (method: string, params: any = {}) => new Promise<any>((r) => {
  const i = ++id;
  ws.addEventListener("message", function on(e) { const m = JSON.parse(String(e.data)); if (m.id === i) { ws.removeEventListener("message", on); r(m.result ?? m.error); } });
  ws.send(JSON.stringify({ id: i, method, params }));
});
if (mode === "shot") {
  const r = await send("Page.captureScreenshot", { format: "png" });
  await Bun.write(arg, Buffer.from(r.data, "base64"));
  console.log(JSON.stringify({ saved: arg }));
} else {
  const r = await send("Runtime.evaluate", { expression: arg, awaitPromise: true, returnByValue: true, userGesture: true });
  console.log(JSON.stringify(r.result?.value ?? r));
}
ws.close();
process.exit(0);
