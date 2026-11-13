// The processes and ports manager's logic (defaults/mods/procs/logic.js):
// the probe's parsers on fixtures in this Mac's formats, the tree, the
// terminal grouping, folds and search, the cursor across refreshes, what a
// kill reaches, the kill flow against a fake exec, and the port actions.
import { test, expect } from "bun:test";
import {
  PROBE, SEP, parseEtime, parseComm, parsePs, parseLsof, parseProbe, guardOf, index, descendants, buildTree, flatten, place,
  targets, alive, signal, endGently, address, terminalOf, whereIs, openPort, uptime, memory, oneLine, count,
  wheelDelta, scrollBy,
} from "../defaults/mods/procs/logic.js";
import { COMM, PS, LSOF, TERMS, PANES, SPACES } from "./fixtures/procs.ts";

const procs = () => parsePs(PS, parseComm(COMM));
const byPid = () => index(procs()).byPid;

test("parseEtime reads mm:ss, hh:mm:ss and dd-hh:mm:ss", () => {
  expect(parseEtime("02:41")).toBe(161);
  expect(parseEtime("1:12:04")).toBe(4324);
  expect(parseEtime("03-01:40:04")).toBe(3 * 86400 + 3600 + 40 * 60 + 4);
  expect(parseEtime("nope")).toBe(null);
});

test("parsePs: fields, names from the executable (spaces kept), a login shell's -zsh, decimal commas", () => {
  const p = procs();
  expect(p.length).toBe(13);
  const app = p.find((x) => x.pid === 21416)!;
  expect(app).toMatchObject({ name: "Fireflies", args: "", cpu: 3.5, rss: 412000, user: "dev", ppid: 1 });
  expect(p.find((x) => x.pid === 1467)).toMatchObject({ name: "zsh", args: "" });
  expect(p.find((x) => x.pid === 52391)).toMatchObject({ name: "rustc", args: "--crate-name herdr_app --edition=2021 src/main.rs", cpu: 98.2, secs: 118 });
  expect(p.find((x) => x.pid === 1455)).toMatchObject({ name: "herdr-core", args: expect.stringMatching(/^hold --socket/) });
  // Without comm, the first word names it.
  expect(parsePs(" 7 1 7 dev 00:01 0.0 10 /usr/bin/python3 -m http.server\n")[0]).toMatchObject({ name: "python3", args: "-m http.server" });
});

test("parseLsof: one entry per process and port, IPv4 and IPv6 together, by port", () => {
  expect(parseLsof(LSOF)).toEqual([
    { pid: 50118, name: "node", port: 5173, hosts: ["127.0.0.1", "[::1]"] },
    { pid: 41872, name: "claude", port: 8080, hosts: ["*"] },
  ]);
  expect(parseLsof("")).toEqual([]);
});

test("parseProbe splits the probe's sections; PROBE runs ps and lsof under C decimals", () => {
  const text = `dev\n${SEP}\n${COMM}${SEP}\n${PS}${SEP}\n${LSOF}`;
  const r = parseProbe(text);
  expect(r.me).toBe("dev");
  expect(r.procs.length).toBe(13);
  expect(r.ports.map((x: any) => x.port)).toEqual([5173, 8080]);
  expect(PROBE).toContain("LC_ALL=C ps -axww");
  expect(PROBE).toContain("lsof -nP -iTCP -sTCP:LISTEN -F pcn");
  // Nothing listening: lsof prints nothing.
  expect(parseProbe(`dev\n${SEP}\n${COMM}${SEP}\n${PS}${SEP}\n`).ports).toEqual([]);
});

test("guardOf: the app, the core, its holders, launchd and other users' processes stay", () => {
  const b = byPid();
  expect(guardOf(b.get(21416), "dev")).toBe("the app itself");
  expect(guardOf(b.get(1392), "dev")).toBe("runs every terminal");
  expect(guardOf(b.get(1455), "dev")).toBe("holds terminals");
  expect(guardOf(b.get(1), "dev")).toBe("system");
  expect(guardOf(b.get(60000), "dev")).toBe("not yours");
  expect(guardOf(b.get(50118), "dev")).toBe(null);
});

const ctx = (all = false) => ({ procs: procs(), me: "dev", terminals: TERMS, panes: PANES, spaces: SPACES, all });

test("buildTree (here): space › tab › terminal › its process tree; no-pane terminals; other machines a note", () => {
  const tree = buildTree(ctx());
  expect(tree.map((n: any) => n.key)).toEqual(["s:s1", "s:s2", "s:~"]);
  const [ff, lab, loose] = tree as any[];
  expect(ff.kids.map((n: any) => n.key)).toEqual(["t:tA", "t:tB"]);
  const t4 = ff.kids[0].kids[0];
  expect(t4).toMatchObject({ kind: "term", address: "t4", name: "claude", cwd: "/w", status: "working" });
  // zsh › claude › zsh › cargo › rustc
  const chain: number[] = [];
  for (let n = t4.kids[0]; n; n = n.kids[0]) chain.push(n.pid);
  expect(chain).toEqual([1467, 41872, 52210, 52214, 52391]);
  // The named terminal goes by its name; bun › node(vite) › esbuild.
  const t7 = ff.kids[1].kids[0];
  expect(t7.name).toBe("web");
  expect(count(t7)).toBe(3);
  expect(lab).toMatchObject({ kind: "space", machine: "box", kids: [] });
  expect(loose.kids.map((n: any) => [n.address, n.kids.length])).toEqual([["t9", 0]]);
});

test("buildTree (all): every process of his, each whose parent isn't his a root, by name", () => {
  const tree = buildTree(ctx(true)) as any[];
  expect(tree.map((n) => n.pid)).toEqual([21416, 1392]); // Fireflies, herdr-core (launchd and cupsd are root's)
  const holder = tree[1].kids[0];
  expect(holder.pid).toBe(1455);
  expect(holder.kids.map((n: any) => n.pid)).toEqual([1467, 50112]);
  expect(descendants(1455, index(procs()).kids)).toEqual([1467, 41872, 52210, 52214, 52391, 50112, 50118, 50121]);
});

test("flatten: folds hide what's under a node; a search keeps the matches and what's above them", () => {
  const tree = buildTree(ctx());
  const rows = flatten(tree, {});
  expect(rows[0]).toMatchObject({ key: "s:s1", depth: 0, open: true });
  expect(rows.find((r: any) => r.key === "p:52391")).toMatchObject({ depth: 7, open: null });
  const folded = flatten(tree, { folds: { "t:tA": true } });
  expect(folded.some((r: any) => r.key === "p:41872")).toBe(false);
  expect(folded.find((r: any) => r.key === "t:tA").open).toBe(false);
  const found = flatten(tree, { query: "vite", folds: { "t:tB": true }, byPid: byPid() });
  expect(found.map((r: any) => r.key)).toEqual(["s:s1", "t:tB", "x:t7", "p:50112", "p:50118"]);
  expect(flatten(tree, { query: "50112", byPid: byPid() }).map((r: any) => r.key)).toEqual(["s:s1", "t:tB", "x:t7", "p:50112"]);
});

test("place: the cursor stays on its pid across refreshes, else where it was", () => {
  const rows = [{ key: "a" }, { key: "p:5" }, { key: "c" }];
  expect(place(rows, "p:5", 0)).toBe(1);
  expect(place([{ key: "x" }, { key: "y" }, { key: "c" }, { key: "p:5" }], "p:5", 1)).toBe(3);
  expect(place([{ key: "a" }, { key: "c" }], "p:5", 1)).toBe(1);
  expect(place([{ key: "a" }], "p:5", 4)).toBe(0);
  expect(place([], "p:5", 2)).toBe(-1);
});

test("targets: one process, or its subtree; never a guarded one or what's under it", () => {
  const ix = index(procs());
  const o = { ...ix, me: "dev" };
  expect(targets(52214, o)).toEqual([52214]);
  expect(targets(50112, { ...o, tree: true })).toEqual([50112, 50118, 50121]);
  expect(targets(1455, { ...o, tree: true })).toEqual([]);
  expect(targets(21416, o)).toEqual([]);
  expect(targets(424242, o)).toEqual([]);
});

/** A fake exec: kill records signals; ps -p lists who's still alive. */
function fakeExec(stubborn: number[] = [], zombies: number[] = []) {
  const calls: string[][] = [];
  const dead = new Set<number>();
  const exec = async (cmd: string, args: string[]) => {
    calls.push([cmd, ...args]);
    if (cmd === "kill") {
      const sig = args[0], pids = args.slice(1).map(Number);
      for (const p of pids) if (sig === "-KILL" || !stubborn.includes(p)) dead.add(p);
      return { code: 0, stdout: "", stderr: "" };
    }
    if (cmd === "ps") {
      const pids = args[args.length - 1].split(",").map(Number);
      const out = pids.filter((p) => !dead.has(p) || zombies.includes(p)).map((p) => `${p} ${zombies.includes(p) ? "Z" : "S"}`).join("\n");
      return { code: out ? 0 : 1, stdout: out, stderr: "" };
    }
    return { code: 1, stdout: "", stderr: "" };
  };
  return { exec, calls };
}

test("the kill flow: TERM, a moment, the ones still there; KILL ends those", async () => {
  const { exec, calls } = fakeExec([50118]);
  const waits: number[] = [];
  const left = await endGently([50112, 50118, 50121], { exec, wait: async (ms: number) => { waits.push(ms); }, grace: 2000 });
  expect(calls[0]).toEqual(["kill", "-TERM", "50112", "50118", "50121"]);
  expect(waits).toEqual([2000]);
  expect(left).toEqual([50118]);
  await signal(left, "KILL", exec);
  expect(calls.at(-1)).toEqual(["kill", "-KILL", "50118"]);
  expect(await alive([50118], exec)).toEqual([]);
});

test("the kill flow: all gone on TERM leaves nothing; a zombie counts as ended; nothing to end sends nothing", async () => {
  const { exec, calls } = fakeExec([], [7]);
  expect(await endGently([7, 8], { exec, wait: async () => {} })).toEqual([]);
  // No setTimeout in the engine: without the caller's timer it refuses before signalling anything.
  await expect(endGently([7, 8], { exec } as any)).rejects.toThrow("endGently needs wait(ms)");
  const n = calls.length;
  await signal([], "TERM", exec);
  expect(await alive([], exec)).toEqual([]);
  expect(calls.length).toBe(n);
});

test("ports: the address, the terminal behind a process, where that terminal is", () => {
  expect(address(5173)).toBe("http://localhost:5173");
  const termPids = new Map([[1467, "t4"], [50112, "t7"]]);
  expect(terminalOf(50121, byPid(), termPids)).toBe("t7");
  expect(terminalOf(52391, byPid(), termPids)).toBe("t4");
  expect(terminalOf(21416, byPid(), termPids)).toBe(null);
  expect(whereIs("t7", { panes: PANES, spaces: SPACES })).toBe("fireflies › 2 api › t7");
  expect(whereIs("t7", { panes: PANES, spaces: [SPACES[0]] })).toBe("2 api › t7");
  expect(whereIs("t9", { panes: PANES, spaces: SPACES })).toBe("no pane · t9");
});

test("openPort: a new tab in the focused tab's web pane, else a web pane beside the focused one", () => {
  const ran: any[] = [];
  const run = (...a: any[]) => { ran.push(a); return null; };
  openPort(5173, { panes: PANES, focused: { tab: "tB" }, run });
  expect(ran[0]).toEqual([`browser.open:${JSON.stringify({ url: "http://localhost:5173", slot: "s9" })}`]);
  openPort(8080, { panes: PANES, focused: { tab: "tA" }, run });
  expect(ran[1]).toEqual(["app.open_url", { url: "http://localhost:8080", in: "app" }]);
});

test("the row words: uptime, memory, one line", () => {
  expect(uptime(161)).toBe("2:41");
  expect(uptime(4324)).toBe("1:12:04");
  expect(uptime(3 * 86400 + 7200)).toBe("3d 2h");
  expect(uptime(null)).toBe("");
  expect(memory(421888)).toBe("412M");
  expect(memory(1992294)).toBe("1.9G");
  expect(memory(88)).toBe("88K");
  expect(oneLine("claude # brief\\012\\012## Item 1")).toBe("claude # brief ⏎ ⏎ ## Item 1");
});

test("the wheel: a mouse's lines move whole rows, a trackpad's pixels move as far as the fingers, unzoomed", () => {
  expect(wheelDelta({ delta: { x: 0, y: -54 }, delta_lines: { x: 0, y: -3 } }, 24, 0.9)).toBe(72);
  expect(wheelDelta({ delta: { x: 0, y: 2 }, delta_lines: { x: 0, y: 1 } }, 24, 0.9)).toBe(-24);
  expect(wheelDelta({ delta: { x: 0, y: -45 } }, 24, 0.9)).toBe(50);
  expect(wheelDelta({ delta: { x: 0, y: 12 } }, 24, 1)).toBe(-12);
  // A sideways swipe moves nothing.
  expect(wheelDelta({ delta: { x: 30, y: 0 }, delta_lines: { x: 1, y: 0 } }, 24, 1) + 0).toBe(0);
  expect(scrollBy(10, -50, 100)).toBe(0);
  expect(scrollBy(90, 50, 100)).toBe(100);
  expect(scrollBy(0, 20, -5)).toBe(0);
});
