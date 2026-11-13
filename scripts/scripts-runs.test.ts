import { test, expect, mock } from "bun:test";

// herdr as both mods see it: one shared store, hc calls recorded.
const store = new Map<string, unknown>();
const calls: string[][] = [];
const ran: [string, unknown][] = [];
const notes: any[] = [];
let terms: any[] = [];
const overlays: any[] = [];
const closed: string[] = [];
let reply = (_a: string[]) => ({ code: 0, stdout: '{"address":"t9"}', stderr: "" });
mock.module("herdr", () => ({
  hc: async (a: string[]) => { calls.push(a); await Bun.sleep(1); return reply(a); },
  run: (name: string, args: unknown) => { ran.push([name, args]); return null; },
  shared: (k: string) => store.get(k) ?? null,
  setShared: (k: string, v: unknown) => { store.set(k, v); return null; },
  notify: (n: unknown) => { notes.push(n); return "n1"; },
  terminals: () => terms,
  openOverlay: (spec: any) => { overlays.push(spec); return `ov${overlays.length}`; },
  closeOverlay: (id: string) => { closed.push(id); return null; },
}));
const { runs, word, tone, elapsed, runArgs, LABEL, start, stop, dismiss, restart, JOBS } = await import("../defaults/mods/scripts/runs.js");
const jobs = await import("../defaults/mods/nocturne/jobs.ts");
const prompt = await import("../defaults/mods/nocturne/prompt.ts");
const reset = () => { store.clear(); calls.length = 0; ran.length = 0; notes.length = 0; terms = []; overlays.length = 0; closed.length = 0; reply = () => ({ code: 0, stdout: '{"address":"t9"}', stderr: "" }); };

const term = (address: string, labels: Record<string, string>, more: Record<string, unknown> = {}) => ({ address, labels, state: "live", created_ms: 1000, ...more });
const lab = (id: string) => ({ [LABEL]: id, [`${LABEL}.name`]: id, [`${LABEL}.runner`]: "bun", [`${LABEL}.cmd`]: `bun run ${id}`, [`${LABEL}.folder`]: "/repo" });

test("runs are the labeled terminals, running first, newest first", () => {
  const all = [
    term("t1", lab("build"), { state: "finished", exit_code: 0, reason: "exited", finished_ms: 3000 }),
    term("t2", {}),
    term("t3", lab("dev"), { created_ms: 2000 }),
    term("vps/t4", lab("watch"), { created_ms: 5000 }),
  ];
  const r = runs(all);
  expect(r.map((x: any) => x.address)).toEqual(["vps/t4", "t3", "t1"]);
  expect(r[0].on).toBe("vps");
  expect(r[1].on).toBe(null);
  expect(r[2]).toMatchObject({ name: "build", runner: "bun", cmd: "bun run build", folder: "/repo", live: false, code: 0, word: "ok" });
});

test("words and tones", () => {
  expect(word(true, null, null)).toBe("running");
  expect(word(false, 0, "exited")).toBe("ok");
  expect(word(false, 101, "exited")).toBe("exit 101");
  expect(word(false, null, "killed")).toBe("stopped");
  expect(tone({ live: false, reason: "killed", code: 137 })).toBe("stopped");
  expect(tone({ live: false, reason: "exited", code: 2 })).toBe("failed");
});

test("elapsed counts to now while running, to the end once finished", () => {
  expect(elapsed({ live: true, started: 0 }, 7000)).toBe("0:07");
  expect(elapsed({ live: true, started: 0 }, 724000)).toBe("12:04");
  expect(elapsed({ live: false, started: 0, ended: 3723000 }, 9e9)).toBe("1:02:03");
});

test("hc run gets one shell line, the folder, the machine and the labels", () => {
  const a = runArgs({ id: "justfile#test", name: "test", runner: "just", cmd: "just test" }, "/repo", "vps");
  expect(a.slice(0, 5)).toEqual(["run", "--bg", "--no-parent", "--no-notify", "--json"]);
  expect(a).toContain("--on");
  expect(a[a.indexOf("--cwd") + 1]).toBe("/repo");
  expect(a.slice(-2)).toEqual(["--", "just test"]);
  expect(a).toContain(`${LABEL}.cmd=just test`);
  expect(runArgs({ id: "x", name: "x", runner: "go", cmd: "go run ." }, null, null)).not.toContain("--cwd");
});

test("ended runs the strip kept come back when the core no longer lists them", async () => {
  const { withEnded } = await import("../defaults/mods/scripts/runs.js");
  const kept = { t1: term("t1", lab("build"), { state: "finished", exit_code: 2, reason: "exited" }), t3: term("t3", lab("old"), { state: "finished" }) };
  const all = [term("t3", lab("dev"))];
  expect(withEnded(all, kept).map((t: any) => t.address)).toEqual(["t3", "t1"]);
  expect(runs(withEnded(all, kept)).find((r: any) => r.address === "t1").word).toBe("exit 2");
});

test("an admin run cancelled at its password prompt reads cancelled; elsewhere 130 is just an exit", () => {
  expect(word(false, 130, "exited", "sudo")).toBe("cancelled");
  expect(word(false, 130, "exited", "osascript")).toBe("cancelled");
  expect(word(false, 130, "exited", null)).toBe("exit 130");
  const a = runArgs({ id: "nix-darwin#switch h", name: "switch h", runner: "nix", cmd: "darwin-rebuild switch --flake '.#h'", admin: "sudo", plan: "darwin-rebuild:h" }, "/etc/nix-darwin", null);
  expect(a).toContain(`${LABEL}.admin=sudo`);
  expect(a).toContain(`${LABEL}.plan=darwin-rebuild:h`);
  expect(a).toContain(`${LABEL}.cmd=darwin-rebuild switch --flake '.#h'`);
  expect(a[a.length - 1]).toContain("sudo -p");
  expect(a[a.length - 1]).not.toContain("osascript");
});

// The bug: the deck closes right after a pick, and work in its own tasks went
// with it, so `hc run` was never called. Now the deck only queues; the strip runs.
test("a pick runs hc run even though the deck is gone", async () => {
  reset();
  const s = { id: "justfile#test", name: "test", runner: "just", cmd: "just test" };
  start(s, "/repo", null);          // the deck's go()
  // ...the deck closes here; nothing of it runs any more.
  expect(calls).toEqual([]);
  expect((store.get(JOBS) as any[]).length).toBe(1);
  await jobs.runJobs();             // the strip, on its next render
  expect(calls).toEqual([runArgs(s, "/repo", null)]);
  expect(store.get(JOBS)).toEqual([]);
  expect(Object.keys(store.get("scripts.track") as object)).toEqual(["t9"]);
  expect(ran).toEqual([]);
});

test("shift-enter also floats the new run", async () => {
  reset();
  start({ id: "x", name: "dev", runner: "bun", cmd: "bun run dev" }, "/repo", null, true);
  await jobs.runJobs();
  expect(ran).toEqual([["terminal.peek", { terminal: "t9", float: true }]]);
});

test("restart, stop and dismiss go through the strip too, in order", async () => {
  reset();
  const r = { address: "t3", id: "x", name: "dev", runner: "bun", cmd: "bun run dev", folder: "/repo", on: null, live: true, admin: null };
  store.set("scripts.ended", { t4: { address: "t4" } });
  store.set("scripts.track", { t3: 1, t4: 1 });
  restart(r);
  stop({ ...r, address: "t5" });
  dismiss({ ...r, address: "t4", live: false });
  // Dismissing forgets what the strip kept at once.
  expect(store.get("scripts.ended")).toEqual({});
  expect(calls).toEqual([]);
  await jobs.runJobs();
  expect(calls.map((a) => a.slice(0, 2))).toEqual([["kill", "t3"], ["rm", "t3"], ["run", "--bg"], ["kill", "t5"], ["rm", "t4"]]);
});

test("a start that fails says why in a toast", async () => {
  reset();
  reply = (a) => (a[0] === "run" ? { code: 1, stdout: "", stderr: "error: no such folder\n" } : { code: 0, stdout: "", stderr: "" });
  start({ id: "x", name: "build", runner: "cargo", cmd: "cargo build" }, "/gone", null);
  await jobs.runJobs();
  expect(notes).toEqual([{ title: "couldn't start build", body: "error: no such folder", level: "error" }]);
});

test("jobs run once, even asked twice at once; stale ones are dropped", async () => {
  reset();
  start({ id: "x", name: "a", runner: "just", cmd: "just a" }, "/repo", null);
  await Promise.all([jobs.runJobs(), jobs.runJobs()]);
  expect(calls.length).toBe(1);
  store.set(JOBS, [{ at: Date.now() - 3600000, name: "old", steps: [{ hc: ["run", "old"], start: true }] }]);
  await jobs.runJobs();
  expect(calls.length).toBe(1);
  expect(jobs.pendingJobs()).toBe(false);
});

test("hc run's argv never holds a NUL or a newline (hc refuses a NUL)", async () => {
  const { detect, parseProbe } = await import("../defaults/mods/scripts/detect.js");
  const found = detect(parseProbe("\u001els\njustfile\n\u001efile justfile\ntest:\n  x\n"));
  const a = runArgs({ ...found[0], id: "old\u0000id", cmd: "a\nb" }, "/repo", null);
  for (const w of a.slice(0, -1)) expect(/[\u0000\n]/.test(w)).toBe(false);
  expect(found[0].id).toBe("justfile#test");
});

// ---- a switch's sudo prompt in a small window (../nocturne/prompt.js)

const P = prompt.SUDO_PROMPT;
const sw = (address: string, more: Record<string, unknown> = {}) =>
  term(address, { ...lab("switch homelab"), [`${LABEL}.name`]: "switch homelab", [`${LABEL}.plan`]: "darwin-rebuild:homelab", [`${LABEL}.admin`]: "sudo" }, { floating: false, ...more });
const screens = (by: Record<string, string>) => { reply = (a) => (a[0] === "read" ? { code: 0, stdout: by[a[1]] ?? "", stderr: "" } : { code: 0, stdout: "", stderr: "" }); };

test("the prompt is its screen's last line, or sudo's try-again before it asks again", () => {
  expect(prompt.asking(`building...\nbuilt /nix/store/x\n${P}\n\n\n`)).toBe(true);
  expect(prompt.asking(`${P}\nSorry, try again.\n`)).toBe(true);
  expect(prompt.asking(`${P}\nsetting up /etc...\n`)).toBe(false);
  expect(prompt.asking("building...\n")).toBe(false);
  // Touch ID asks in its own dialog: no prompt line, no window.
  expect(prompt.asking("built /nix/store/x\n")).toBe(false);
  expect(prompt.asking(null)).toBe(false);
});

test("a prompt opens one small window over the run's terminal, and output past it closes it", async () => {
  reset();
  terms = [sw("t5")];
  screens({ t5: `built /nix/store/x\n${P}` });
  await prompt.watchPrompts();
  expect(overlays.length).toBe(1);
  const spec = overlays[0];
  expect(spec).toMatchObject({ kind: "dialog", modal: true, width: prompt.PROMPT_W, height: prompt.PROMPT_H });
  expect(spec.layout.children[0].content).toEqual({ mod: "scripts", props: { password: "t5", name: "switch homelab" } });
  expect(spec.layout.children[1].content).toEqual({ terminal: "t5" });
  expect(store.get(prompt.PROMPTS)).toEqual({ t5: { id: "ov1" } });
  // Still asking (a wrong password, asked again): no second window, none closed.
  screens({ t5: `${P}\nSorry, try again.` });
  await prompt.watchPrompts();
  screens({ t5: `${P}\nSorry, try again.\n${P}` });
  await prompt.watchPrompts();
  expect(overlays.length).toBe(1);
  expect(closed).toEqual([]);
  // The password was taken: the window goes, the run carries on.
  screens({ t5: `${P}\nsetting up /etc...` });
  await prompt.watchPrompts();
  expect(closed).toEqual(["ov1"]);
  expect(store.get(prompt.PROMPTS)).toEqual({});
});

test("a run already floating gets no window, and nothing closes it", async () => {
  reset();
  terms = [sw("t5", { floating: true })];
  screens({ t5: P });
  await prompt.watchPrompts();
  screens({ t5: "setting up /etc..." });
  await prompt.watchPrompts();
  expect(overlays).toEqual([]);
  expect(closed).toEqual([]);
});

test("a run that ends takes its window; a cancelled one doesn't come back", async () => {
  reset();
  terms = [sw("t5")];
  screens({ t5: P });
  await prompt.watchPrompts();
  terms = [];
  await prompt.watchPrompts();
  expect(closed).toEqual(["ov1"]);
  expect(store.get(prompt.PROMPTS)).toEqual({});
  // The bar's cancel marks it closed: the prompt still showing until ctrl-c lands opens nothing.
  reset();
  terms = [sw("t6")];
  store.set(prompt.PROMPTS, { t6: { closed: true } });
  screens({ t6: P });
  await prompt.watchPrompts();
  expect(overlays).toEqual([]);
});

test("only switch runs are read, and nothing at all while none runs", async () => {
  reset();
  terms = [term("t1", lab("dev")), term("t2", {})];
  await prompt.watchPrompts();
  expect(calls).toEqual([]);
});
