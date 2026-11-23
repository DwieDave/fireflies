// Pinned connections (pinned.ts, store.ts) and a connection's port-forward (forward.ts, kube.ts):
// one list for the machine, every window told; a forward's facts kept, its port looked at before
// connecting, the ask with its overview, the forward started as the k8s mod starts one (the shared
// fixture), its failures. herdr, kubectl, psql, hc and the ports are stand-ins: no cluster touched.
// Its own process: it stands in for "herdr".
import { test, expect, mock } from "bun:test";
import { found, standIn } from "./databases-host.ts";

const { h, theme, el, cx, until, flush, advance, services } = standIn();
const { files, commands, opened, closed, execs, written, stores } = h;
import { Effect } from "effect";

const { default: Databases } = await import("../defaults/mods/databases/main.ts");
(await import("../defaults/mods/databases/app.ts")).useServices(services);
const { runtime: dbRuntime } = await import("../defaults/mods/databases/app.ts");
const { viewRun } = await import("./databases-host.ts");
const runView = viewRun(dbRuntime);
const { command } = await import("../defaults/mods/databases/opening.ts");

function open(p: any) {
  h.props = p;
  const v: any = new Databases();
  v.init(p, cx);
  return v;
}
function render(v: any, width = 1100) {
  v.size = { width, height: 720 };
  h.drawn = [];
  v.render();
  return h.drawn;
}
const framed = (d: [string, any[]][]) => {
  const i = d.findIndex(([m, a]) => m === "id" && a[0] === "databases");
  const j = d.findIndex(([m], n) => n > i && m === "track_focus");
  return d.slice(i, j).some(([m]) => m === "border");
};
const texts = (d: [string, any[]][]) => d.filter(([m]) => m === "child").flatMap(([, a]) => a.filter((x) => typeof x === "string"));
const tips = (d: [string, any[]][]) => d.filter(([m]) => m === "tooltip").map(([, a]) => a[0]);
const key = (k: string, mods: any = {}) => ({ key: k, key_char: k.length === 1 ? k : undefined, modifiers: mods });
const fresh = () => { files.clear(); h.shared = {}; commands.length = 0; opened.length = 0; closed.length = 0; h.panes = []; h.focused = null; stores.clear(); execs.length = 0; written.length = 0; h.reply = found; };

const { forwardProblem, forwardStartArgs, forwardCommand } = await import("../defaults/mods/databases/kube.ts");
const { connectArgsOf } = await import("../defaults/mods/nocturne/databases.ts");
const { isConnJson } = await import("../defaults/mods/databases/kinds.ts");

const HOME_FILE = "/tmp/herdr-test/data/databases/connections.json";
const PASSWORD = "moth-lantern-42";
const b64 = (s: string) => Buffer.from(s).toString("base64");
const FORWARD = { context: "nightjar-dev", namespace: "glowworm", target: "pod/glowworm-pg-1", remote: 5432, local: 25432 };
const SOURCE = { from: "kubernetes", context: "nightjar-dev", namespace: "glowworm", name: "glowworm-pg-app", key: "password", userKey: "username", databaseKey: "dbname" };
const ARGS = { kind: "postgres", name: "glowworm-pg-1 (nightjar-dev/glowworm)", host: "127.0.0.1", port: 25432, from: "port-forward pod/glowworm-pg-1 in nightjar-dev/glowworm", secret: SOURCE, forward: FORWARD };
/** The fixture both repositories pin (fireflies-k8s test/logic.test.ts: its startArgs gives the same). */
const FORWARD_FIXTURE = [
  "run", "--bg", "--no-parent", "--no-notify", "--json",
  "--label", 'k8s.forward={"context":"nightjar-dev","namespace":"glowworm","target":"pod/glowworm-pg-1","local":25432,"remote":5432,"db":"postgres","web":null,"name":"glowworm-pg-1"}',
  "--label", "nocturne.name=forward glowworm-pg-1 :25432",
  "--", "kubectl", "--context", "nightjar-dev", "-n", "glowworm", "port-forward", "pod/glowworm-pg-1", "25432:5432", "--address", "127.0.0.1",
];

/** Which local ports answer; what the client says. */
let open_ = new Set<number>();
let clientSays: { code: number; stdout: string; stderr: string } = { code: 0, stdout: "", stderr: "" };
const ok = (stdout: string) => ({ code: 0, stdout, stderr: "" });
const reset = () => {
  fresh(); files.clear(); h.terminals = []; h.hcCalls.length = 0; open_ = new Set(); clientSays = { code: 0, stdout: "", stderr: "" };
  h.hcReply = () => ok('{"address":"t9"}');
  h.reply = (cmd: string, args: string[]): any => {
    if (cmd === "kubectl") return ok(`${b64(PASSWORD)}\n${b64("glowworm")}\n${b64("app")}\n`);
    if (cmd === "sh" && args[2] === "ff-dir") return ok("/tmp/fireflies-db.abc\n");
    if (cmd === "sh" && args[2] === "lookup") return args[4] === "psql" ? ok("/usr/bin/psql\n") : { code: 1, stdout: "", stderr: "" };
    if (cmd === "sh" && args[2] === "ff-port") return { code: open_.has(Number(args[3])) ? 0 : 1, stdout: "", stderr: "" };
    if (cmd === "sh" && args[2] === "ff-db") return clientSays;
    return { code: 1, stdout: "", stderr: "" };
  };
};
const runs = () => execs.filter((a) => a[0] === "sh" && a[3] === "ff-db");
const portChecks = () => execs.filter((a) => a[0] === "sh" && a[3] === "ff-port").map((a) => Number(a[4]));
async function win(p: any = { folder: "/w", overlay: "w1" }) {
  const v = open(p);
  for (let i = 0; i < 4; i++) await flush();
  return v;
}
const drawnText = (v: any) => texts(render(v)).join(" | ");

test("the contract's forward: checked as a secret's names are, local the connection's port, only on this machine; nocturne's copy takes it", () => {
  expect(forwardProblem(FORWARD as any, "postgres", "127.0.0.1", 25432)).toBeNull();
  expect(forwardProblem(FORWARD as any, "postgres", "db.example.com", 25432)).toContain("on this machine");
  expect(forwardProblem(FORWARD as any, "sqlite", "127.0.0.1", 25432)).toContain("Postgres and MySQL");
  expect(forwardProblem({ ...FORWARD, target: "pods/x" } as any, "postgres", "127.0.0.1", 25432)).toContain("target");
  expect(forwardProblem({ ...FORWARD, target: "pod/--kubeconfig=/x" } as any, "postgres", "127.0.0.1", 25432)).toContain("target");
  expect(forwardProblem({ ...FORWARD, namespace: "Glow" } as any, "postgres", "127.0.0.1", 25432)).toContain("namespace");
  expect(forwardProblem({ ...FORWARD, context: "a\nb" } as any, "postgres", "127.0.0.1", 25432)).toContain("context");
  expect(forwardProblem({ ...FORWARD, remote: 70000 } as any, "postgres", "127.0.0.1", 25432)).toContain("ports");
  expect(forwardProblem(FORWARD as any, "postgres", "127.0.0.1", 25433)).toContain("local port");
  expect(forwardProblem({ ...FORWARD, kubectl: "/bin/sh" } as any, "postgres", "127.0.0.1", 25432)).toContain("kubectl");
  expect(connectArgsOf(JSON.stringify(ARGS))).toEqual(ARGS as any);
  expect(connectArgsOf(JSON.stringify({ ...ARGS, forward: { ...FORWARD, local: "25432" } }))).toBeNull();
  expect(isConnJson({ id: "pg-x", name: "x", kind: "postgres", forward: FORWARD })).toBe(true);
});

test("the start: the k8s mod's own arguments for the shared fixture, and the command the ask shows", () => {
  expect(Effect.runSync(forwardStartArgs(FORWARD as any, "postgres"))).toEqual(FORWARD_FIXTURE);
  expect(forwardCommand(FORWARD as any)).toBe("kubectl --context nightjar-dev -n glowworm port-forward pod/glowworm-pg-1 25432:5432 --address 127.0.0.1");
  expect(Effect.runSync(forwardStartArgs({ ...FORWARD, kubectl: "/nix/store/x-kubectl/bin/kubectl" } as any, "postgres"))).toContain("/nix/store/x-kubectl/bin/kubectl");
});

test("a request with a bad forward is refused: nothing listed, nothing checked", async () => {
  reset();
  const v = await win();
  command(v, `databases.connect:${JSON.stringify({ ...ARGS, forward: { ...FORWARD, local: 1 } })}`, cx);
  await flush();
  expect(v.note.text).toBe("databases.connect: its forward's local port isn't the connection's port");
  expect(v.sent).toEqual([]);
  expect(portChecks()).toEqual([]);
});

test("pinned in one window: every other window lists it at its next tick, a restart too; the file holds the places, never a password", async () => {
  reset();
  open_.add(25432);
  const a = await win({ folder: "/w", overlay: "w1" });
  const b = await win({ folder: "/elsewhere", slot: "s2" });
  command(a, `databases.connect:${JSON.stringify(ARGS)}`, cx);
  await until(() => runs().length > 0 && !a.catalog.busy);
  a.panel = "conns";
  a.connAt = 0;
  await advance(1000); // the pin comes after the other windows opened
  a.key(key("P"), cx);
  await until(() => a.saved.length === 1);
  const file = files.get(HOME_FILE) ?? "";
  const doc = JSON.parse(file);
  expect(doc.connections[0]).toMatchObject({ kind: "postgres", host: "127.0.0.1", port: 25432, secret: "kubernetes", source: SOURCE, forward: FORWARD });
  expect(file).not.toContain(PASSWORD);
  expect(file).not.toContain(b64(PASSWORD));
  expect(a.sent).toEqual([]);
  expect(a.note.text).toContain("pinned glowworm-pg-1 (nightjar-dev/glowworm): every Databases window lists it");
  expect(drawnText(a)).toContain("pinned · every window");
  // The other window: its tick reads the file again.
  expect(b.saved).toEqual([]);
  await runView(b.tick());
  await until(() => b.saved.length === 1);
  expect(b.saved[0]).toMatchObject({ name: "glowworm-pg-1 (nightjar-dev/glowworm)", source: SOURCE, forward: FORWARD, origin: "saved" });
  expect(drawnText(b)).toContain("pinned · every window");
  // A restart: a new window reads it from the file; connecting reads the secret again.
  const c = await win({ folder: "/w", overlay: "w3" });
  expect(c.saved.map((x: any) => x.id)).toEqual([a.saved[0].id]);
  const reads = execs.filter((x) => x[0] === "kubectl").length;
  c.connectTo(c.saved[0], cx);
  await until(() => execs.filter((x) => x[0] === "kubectl").length > reads);
  await until(() => !c.catalog.busy);
  expect(c.secrets.get(c.saved[0].id)).toBe(PASSWORD);
  // Unpinned in the restarted window (asked first): the others drop it.
  c.panel = "conns";
  c.connAt = 0;
  c.key(key("P"), cx);
  expect(c.ask.text).toBe("Unpin glowworm-pg-1 (nightjar-dev/glowworm)? Every Databases window drops it; its password stays in the cluster's secret; its history goes.");
  c.key(key("y"), cx);
  await until(() => c.saved.length === 0);
  await runView(a.tick());
  await until(() => a.saved.length === 0);
  expect(JSON.parse(files.get(HOME_FILE) ?? "{}").connections).toEqual([]);
});

test("two windows pin at once from stale lists: both are kept (each change is made on the file as it is)", async () => {
  reset();
  const a = await win({ folder: "/w", overlay: "w1" });
  const b = await win({ folder: "/w", slot: "s2" });
  const { saveFound, receive } = await import("../defaults/mods/databases/conns.ts");
  receive(a, { kind: "sqlite", path: "/w/moths.db", name: "moths.db" }, cx);
  receive(b, { kind: "sqlite", path: "/w/lanterns.db", name: "lanterns.db" }, cx);
  await flush(); await flush();
  await Promise.all([runView(saveFound(a, a.sent[0])), runView(saveFound(b, b.sent[0]))]);
  expect(JSON.parse(files.get(HOME_FILE) ?? "{}").connections.map((x: any) => x.name).sort()).toEqual(["lanterns.db", "moths.db"]);
});

test("its port open: connected, no ask; closed: the ask with the overview, nothing started, nothing read", async () => {
  reset();
  open_.add(25432);
  const v = await win();
  command(v, `databases.connect:${JSON.stringify(ARGS)}`, cx);
  await until(() => runs().length > 0);
  expect(portChecks()).toEqual([25432]);
  expect(v.forwardAsk).toBeNull();
  expect(h.hcCalls).toEqual([]);
  reset();
  const w = await win();
  command(w, `databases.connect:${JSON.stringify(ARGS)}`, cx);
  await until(() => w.forwardAsk !== null);
  expect(w.forwardAsk.why).toBe("down");
  expect(execs.filter((a) => a[0] === "kubectl" || a[3] === "ff-db")).toEqual([]);
  expect(h.hcCalls).toEqual([]);
  const d = drawnText(w);
  for (const s of ["No forward on localhost:25432", "came from a port-forward; nothing is started unless you say so", "context", "nightjar-dev", "namespace", "glowworm", "pod/glowworm-pg-1 :5432  →  localhost:25432", "runs",
    "enter  start the forward and connect", "c  connect anyway", "esc  cancel"]) expect(d).toContain(s);
  // The command: one piece per argument (a line breaks only between them).
  expect(texts(render(w))).toEqual(expect.arrayContaining(["kubectl", "--context", "nightjar-dev", "-n", "glowworm", "port-forward", "pod/glowworm-pg-1", "25432:5432", "--address", "127.0.0.1"]));
  // A click on it copies it.
  render(w);
  const i = h.drawn.findIndex(([m, a]) => m === "id" && a[0] === "db-fwd-command");
  h.drawn.slice(i).find(([m]) => m === "on_click")?.[1][0]({}, cx);
  expect(h.clipboard).toBe("kubectl --context nightjar-dev -n glowworm port-forward pod/glowworm-pg-1 25432:5432 --address 127.0.0.1");
  // Its buttons by command too (databases.forward-anyway is c's).
  const asked = w.forwardAsk;
  command(w, "databases.forward-nothing", cx);
  expect(w.forwardAsk).toBe(asked);
  // esc: nothing started; c: connects anyway.
  w.key(key("escape"), cx);
  expect(w.forwardAsk).toBeNull();
  expect(h.hcCalls).toEqual([]);
  w.connectTo(w.sent[0], cx);
  await until(() => w.forwardAsk !== null);
  command(w, "databases.forward-anyway", cx);
  await until(() => runs().length > 0);
  expect(h.hcCalls).toEqual([]);
});

test("enter: the forward starts as the k8s mod starts it, the window waits for its port, then reads the secret and connects", async () => {
  reset();
  h.hcReply = (args: string[]) => {
    if (args[0] === "run") { open_.add(25432); h.terminals = [{ address: "t9", state: "live", labels: { "k8s.forward": JSON.parse(`"${args[6]!.slice("k8s.forward=".length).replace(/"/g, '\\"')}"`) } }]; }
    return ok('{"address":"t9"}');
  };
  const v = await win();
  command(v, `databases.connect:${JSON.stringify(ARGS)}`, cx);
  await until(() => v.forwardAsk !== null);
  v.key(key("enter"), cx);
  await until(() => runs().length > 0 && !v.catalog.busy);
  expect(h.hcCalls[0]).toEqual(FORWARD_FIXTURE);
  expect(v.forwardAsk).toBeNull();
  expect(execs.some((a) => a[0] === "kubectl")).toBe(true);
  expect(v.note === null || !/failed/.test(v.note.tone)).toBe(true);
  // The row says it runs; its menu stops it (the terminal ends: the k8s shelf drops it too).
  const d = drawnText(v);
  expect(d).toContain("↔ :25432");
  v.panel = "conns"; v.connAt = 0;
  v.key(key("m"), cx);
  const stop = v.menu.rows.find((r: any) => r.label === "Stop its forward (localhost:25432)");
  expect(stop).toBeTruthy();
  stop.go();
  expect(commands).toContainEqual(["terminal.kill", { terminal: "t9" }]);
});

test("a pod that's gone: kubectl's words, said plainly; Kubernetes offered (k) when it's installed", async () => {
  reset();
  files.set("/tmp/herdr-test/mods/k8s/mod.json", "{}");
  h.hcReply = (args: string[]) => {
    if (args[0] === "run") { h.terminals = [{ address: "t9", state: "exited" }]; return ok('{"address":"t9"}'); }
    if (args[0] === "read") return ok('Error from server (NotFound): pods "glowworm-pg-1" not found\n');
    return ok("");
  };
  const v = await win();
  command(v, `databases.connect:${JSON.stringify(ARGS)}`, cx);
  await until(() => v.forwardAsk !== null);
  v.key(key("enter"), cx);
  await until(() => v.forwardAsk?.why === "gone");
  expect(v.forwardAsk.note).toBe('the pod glowworm-pg-1 isn\'t there any more (a deployment\'s pods change names): Error from server (NotFound): pods "glowworm-pg-1" not found');
  const d = drawnText(v);
  expect(d).toContain("pod/glowworm-pg-1 isn't there any more");
  expect(d).toContain("k  open Kubernetes to pick it again");
  expect(runs()).toEqual([]);
  v.key(key("k"), cx);
  expect(opened.at(-1)).toMatchObject({ mod: "k8s", kind: "window", props: { context: "nightjar-dev", namespace: "glowworm", kind: "pods" } });
  expect(v.forwardAsk).toBeNull();
});

test("a forward whose terminal is gone from herdr-core's list (it hides a finished one): ended, its words read", async () => {
  reset();
  h.hcReply = (args: string[]) => (args[0] === "read" ? ok('error: error upgrading connection: pods "glowworm-pg-1" is forbidden: User "ada" cannot create resource "pods/portforward"\n') : ok('{"address":"t9"}'));
  const v = await win();
  command(v, `databases.connect:${JSON.stringify(ARGS)}`, cx);
  await until(() => v.forwardAsk !== null);
  v.key(key("enter"), cx);
  await until(() => v.forwardAsk?.note !== null && v.forwardAsk?.starting === null);
  expect(v.forwardAsk.why).toBe("down");
  expect(v.forwardAsk.note).toBe('error: error upgrading connection: pods "glowworm-pg-1" is forbidden: User "ada" cannot create resource "pods/portforward"');
  expect(h.hcCalls.map((a) => a[0])).toEqual(["run", "read"]);
});

test("its port held by another program (it answers, not as the database): said, the forward offered on another local port, the connection follows", async () => {
  reset();
  open_ = new Set([25432, 25433]);
  clientSays = { code: 2, stdout: "", stderr: 'psql: error: connection to server at "127.0.0.1", port 25432 failed: received invalid response to SSL negotiation: H\n' };
  h.hcReply = (args: string[]) => { if (args[0] === "run") open_.add(25434); return ok('{"address":"t10"}'); };
  const v = await win();
  command(v, `databases.connect:${JSON.stringify(ARGS)}`, cx);
  await until(() => v.forwardAsk !== null);
  expect(v.forwardAsk).toMatchObject({ why: "taken", local: 25434 });
  const d = drawnText(v);
  expect(d).toContain("localhost:25432 answers, but not as glowworm-pg-1 (nightjar-dev/glowworm)'s database");
  expect(d).toContain("enter  start the forward on localhost:25434 and connect");
  expect(d).not.toContain("connect anyway");
  clientSays = ok("");
  v.key(key("enter"), cx);
  await until(() => v.forwardAsk === null && runs().length > 1);
  expect(h.hcCalls[0]).toContain("25434:5432");
  expect(v.sent[0]).toMatchObject({ port: 25434, forward: { ...FORWARD, local: 25434 } });
});
