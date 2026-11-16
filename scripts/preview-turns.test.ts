// The viewer's reads under the engine's turn budget (@fireflies/viewer,
// viewer-load.ts): a turn that overruns it (500 ms for a task) is stopped
// uncatchably and nothing after it runs. So a read asks only the first bytes
// its kind needs, parses a picture's long head a slice a turn, and a read
// that was cut off ends in a message instead of "Reading…" for ever.
// herdr and gpui stand-ins (mock.module is process-wide: this file runs alone).
import { test, expect, mock } from "bun:test";
import { Effect } from "effect";

class El {
  constructor() {
    return new Proxy(this, { get: (t, k: string, proxy) => (k in t ? (t as any)[k] : k === "then" ? undefined : () => proxy) });
  }
}

/** The programs the viewer ran: [command, args]. */
const ran: [string, string[]][] = [];
/** What `sh -c <script>` answers, by a word of the script. */
let answer: (script: string, args: string[]) => { code: number; stdout: string; stderr: string } = () => ({ code: 1, stdout: "", stderr: "" });

const herdr: Record<string, any> = {
  exec: async (cmd: string, args: string[]) => {
    ran.push([cmd, args]);
    return cmd === "sh" ? answer(args[1] ?? "", args.slice(3)) : { code: 1, stdout: "", stderr: "" };
  },
  appHome: () => "/app", home: () => "/home/me", settings: () => ({ zoom: 1 }), window: () => ({ platform: "macos" }),
  shared: () => null, setShared: () => null, panes: () => [], props: () => ({}), theme: () => new Proxy({}, { get: () => "#808080" }),
  nativeViewCapabilities: () => ({ available: false }), nextCommand: () => new Promise(() => {}), watchFolder: () => new Promise(() => {}),
  readTextFile: async () => null, writeTextFile: async () => null, run: () => null, notify: () => null,
  highlight: () => [], languageOf: () => null, nativeViewCall: () => null, nextNativeViewEvent: () => new Promise(() => {}), openOverlay: () => null,
};
mock.module("herdr", () => herdr);
mock.module("gpui-kit", () => ({ View: class {}, div: () => new El(), svg: () => new El(), image: () => new El(), PathBuilder: { fill: () => new El() }, Background: { checkerboard: () => ({}) } }));
mock.module("gpui-base", () => ({ h_flex: () => new El(), v_flex: () => new El(), TextView: { markdown: () => new El() } }));

const { default: Viewer } = await import("../defaults/lib/@fireflies/viewer/viewer.ts");
const { runRead, hexBytesIn } = await import("../defaults/lib/@fireflies/viewer/viewer-load.ts");
const { waiting } = await import("../defaults/lib/@fireflies/viewer/viewer-state.ts");
const { hexBytes } = await import("../defaults/lib/@fireflies/viewer/image.ts");

/** A context whose timers fire on the next turn (counted): each is a turn of its own, as the app's are. */
function context() {
  const turns = { n: 0 };
  const cx: any = {
    notify() {}, focus_handle: () => ({ focus() {}, is_focused: () => false }),
    timer: { after: (_ms: number, f: (cx: any) => void) => { turns.n++; const t = setImmediate(() => f(cx)); return { cancel: () => clearImmediate(t) }; } },
  };
  return { cx, turns };
}

/** A viewer on its runtime, as init attaches it. */
function viewer() {
  const { cx, turns } = context();
  const v: any = new Viewer();
  v.attach(cx);
  v.port = { width: 800, height: 600 };
  return { v, turns };
}

const settle = async (until: () => boolean) => {
  for (let i = 0; i < 2000 && !until(); i++) await new Promise((r) => setImmediate(r));
};

/** `bytes` as `od -An -v -tx1` writes them: 16 a line. */
const od = (bytes: number[]) => {
  const lines: string[] = [];
  for (let i = 0; i < bytes.length; i += 16) lines.push(" " + bytes.slice(i, i + 16).map((b) => b.toString(16).padStart(2, "0")).join(" "));
  return lines.join("\n") + "\n";
};

/** A PNG's first bytes (480 × 320), then zeros up to `size`. */
const png = (size: number) => {
  const head = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 1, 0xe0, 0, 0, 1, 0x40, 8, 6, 0, 0, 0];
  return [...head, ...Array(Math.max(0, size - head.length)).fill(0)];
};

test("a read asks only the first bytes its kind needs: 16 for a PDF or a font, 4 KB for a PNG, 64 for a WebP, the most for a JPEG", async () => {
  const heads: Record<string, string> = {};
  answer = (script, args) => {
    if (script.includes("cksum")) heads[args[0] ?? ""] = args[3] ?? "";
    return { code: 3, stdout: "", stderr: "" };
  };
  for (const path of ["/r/a.pdf", "/r/a.ttf", "/r/a.png", "/r/a.webp", "/r/a.jpg"]) {
    const { v } = viewer();
    v.open(path);
    await settle(() => v.busy === null);
  }
  expect(heads).toEqual({ "/r/a.pdf": "16", "/r/a.ttf": "16", "/r/a.png": "4096", "/r/a.webp": "64", "/r/a.jpg": "262144" });
});

test("a picture's 256 KB head is read into bytes over several turns, not in one, and the picture shows", async () => {
  const text = od(png(262144));
  const { cx, turns } = context();
  const bytes = await Effect.runPromise(Effect.provideService(hexBytesIn(text), (await import("effect")).Clock.Clock, (await import("@fireflies/kit")).hostClock(cx)));
  // 800 KB of od text, 64 KB of it a turn: a timer between slices.
  expect(text.length).toBeGreaterThan(800_000);
  expect(turns.n).toBeGreaterThanOrEqual(12);
  expect(bytes).toEqual(hexBytes(text));

  // Through the viewer: a JPEG-named file (the longest head) whose bytes are a PNG.
  answer = (script) => (script.includes("cksum") ? { code: 0, stdout: `9-262144.jpg\n262144\n${text}`, stderr: "" } : { code: 1, stdout: "", stderr: "" });
  const { v, turns: viewTurns } = viewer();
  v.open("/r/shot.jpg");
  await settle(() => v.busy === null && v.src !== null);
  expect([v.error, v.busy, v.info?.width, v.info?.height, v.src]).toEqual([null, null, 480, 320, "cache/preview/9-262144.jpg"]);
  expect(viewTurns.n).toBeGreaterThanOrEqual(12);
});

test("a read the engine cut off (no wait under way, no step since) ends in a message; a long wait on a program doesn't", async () => {
  // A cut read: its fiber never runs again (no end, no wait, no move).
  const cut = viewer().v;
  cut.path = "/r/a.png";
  cut.busy = "Reading…";
  runRead(cut, cut.gen, Effect.never);
  await settle(() => cut.error !== null);
  expect([cut.error, cut.busy]).toEqual(["Can't show it: reading it was cut off before it finished (it took the app too long in one go)", null]);

  // A slow program: waiting all the while, never called cut off.
  const { v: slow, turns } = viewer();
  slow.busy = "Reading…";
  runRead(slow, slow.gen, waiting(Effect.never));
  await settle(() => turns.n > 20);
  expect([slow.error, slow.busy]).toEqual([null, "Reading…"]);

  // A newer file took the read's place: its watchdog says nothing.
  const moved = viewer().v;
  runRead(moved, moved.gen, Effect.never);
  moved.gen += 1;
  for (let i = 0; i < 200; i++) await new Promise((r) => setImmediate(r));
  expect(moved.error).toBe(null);
});
