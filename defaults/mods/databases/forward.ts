// A connection that came from a port-forward (kube.ts `forward`, kept with a
// pinned one): before it connects, its local port is checked. Down, the
// window asks, with the overview (the context, the namespace, the target and
// its port → localhost, the exact kubectl command), and only when told starts
// the forward the way the Kubernetes mod starts one: a terminal of its own in
// herdr-core, labelled k8s.forward (kube.ts forwardStartArgs), so the k8s
// window lists it on its shelf and stops it, whether or not that window or mod
// is there; it stays up when this window closes. Then it waits for the port
// (kubectl's own words when it fails: a pod that's gone, no access, an unknown
// context), and connects (the secret read, as at every connect). A port that
// answers but not as the database (another program holds it) is said, with
// another local port offered.

import type { Context } from "gpui-kit";
import { appHome, exec, hc, openOverlay, readTextFile, run, terminals } from "herdr";
import type { Conn, ConnDraft } from "./kinds.ts";
import type { KubeForward } from "./kube.ts";
import { FORWARD_LABEL, forwardProblem, forwardStartArgs } from "./kube.ts";
import { isNumber, isString, object, parseJson } from "./guard.ts";
import { changePinned } from "./pinned.ts";
import type { ForwardAsk } from "./state.ts";
import type { default as DbView } from "./main.ts";

/** Whether something listens on 127.0.0.1:<port>: nc, else bash's /dev/tcp (loopback answers at once). */
export const PORT_SCRIPT = 'p=$1; if command -v nc >/dev/null 2>&1; then exec nc -z -w 2 127.0.0.1 "$p"; fi; exec bash -c \'exec 3<>"/dev/tcp/127.0.0.1/$0"\' "$p"';

export async function portOpen(port: number): Promise<boolean> {
  const r = await exec("sh", ["-c", PORT_SCRIPT, "ff-port", String(port)], { timeout: 4000 }).catch(() => null);

  return r?.code === 0;
}

/** A terminal as herdr-core lists it: the forward's label (kube.ts FORWARD_LABEL) when it has one. */
const isTerminalEntry = object({ address: isString }, { state: isString, labels: object({}, { [FORWARD_LABEL]: isString }) });
const isForwardLabel = object({ context: isString, namespace: isString, target: isString, local: isNumber });

/** The forward of `f` among herdr-core's terminals (the k8s mod's label), or null. */
export function forwardRunning(f: KubeForward): { readonly address: string; readonly live: boolean } | null {
  for (const t of terminals()) {
    if (!isTerminalEntry(t)) continue;

    const raw = t.labels?.[FORWARD_LABEL];
    const n = raw === undefined ? undefined : parseJson(raw, isForwardLabel);

    if (n && n.context === f.context && n.namespace === f.namespace && n.target === f.target && n.local === f.local) {
      return { address: t.address, live: t.state !== "exited" && t.state !== "dead" };
    }
  }

  return null;
}

/** Before connecting: true to go on (no forward kept, its port open, or a forward that can't be
 *  kept: said); false when the ask is shown (its port is down). */
export async function forwardFirst(v: DbView, c: Conn, cx: Context): Promise<boolean> {
  const f = c.forward;

  if (!f) return true;

  const problem = forwardProblem(f, c.kind, c.host, c.port);

  if (problem) {
    v.say(`${c.name}: its forward isn't used: ${problem}`, "failed");

    return true;
  }

  if (await portOpen(f.local)) return true;

  askForward(v, c, "down", cx);

  return false;
}

/** Shows the ask for a connection's forward. */
export function askForward(v: DbView, c: Conn, why: ForwardAsk["why"], cx: Context, local: number | null = null): void {
  if (!c.forward) return;

  v.forwardAsk = { conn: c, why, note: null, local: local ?? c.forward.local, starting: null };
  void k8sInstalled(v);
  cx.notify();
}

/** Whether the Kubernetes mod is installed (its mod.json, as other mods find it). */
async function k8sInstalled(v: DbView): Promise<void> {
  if (v.k8s !== null) return;

  v.k8s = (await readTextFile(`${appHome()}/mods/k8s/mod.json`).catch(() => null)) !== null;
}

/** A pause of `ms` (the engine has no setTimeout). */
const pause = (cx: Context, ms: number): Promise<void> => new Promise((resolve) => {
  cx.timer.after(ms, () => resolve());
});

/** Polls while a started forward comes up (every 500 ms, 20 s). */
const TRIES = 40;

/** kubectl's words for a forward whose pod isn't there. */
const GONE = /pods? "[^"]*" not found|NotFound|unable to forward port because pod is not running|does not have a host assigned/i;

/** Starts the ask's forward (on `ask.local`), waits for its port, then connects with `connectNow`. */
export async function startForward(v: DbView, ask: ForwardAsk, cx: Context, connectNow: (c: Conn) => void): Promise<void> {
  const c = ask.conn;
  const kept = c.forward;

  if (!kept || (c.kind !== "postgres" && c.kind !== "mysql")) return;

  const f: KubeForward = { ...kept, local: ask.local };

  ask.starting = Date.now();
  ask.note = null;
  cx.notify();

  const r = await hc(forwardStartArgs(f, c.kind)).catch((error: Error) => ({ code: -1, stdout: "", stderr: error.message }));

  if (v.forwardAsk !== ask) return;

  if (r.code !== 0) {
    ask.starting = null;
    ask.note = `couldn't start it: ${lastLine(r.stderr || r.stdout) || `hc exited with ${r.code}`}`;
    cx.notify();

    return;
  }

  const address = parseJson(r.stdout.trim(), object({ address: isString }))?.address ?? null;
  let seen = false;

  for (let i = 0; i < TRIES; i++) {
    if (v.forwardAsk !== ask) return;

    if (await portOpen(f.local)) {
      v.forwardAsk = null;
      v.say(`forward started: ${f.target} :${f.remote} → localhost:${f.local} (the Kubernetes window lists it)`, "done");
      connectNow(await placedOn(v, c, f, cx));

      return;
    }

    // Ended: listed as exited, or gone from the list (herdr-core hides a finished terminal) after
    // it was there or after 2 s.
    const t = address ? terminalOf(address) : null;

    seen ||= t !== null;

    if ((t && !t.live) || (address && !t && (seen || i >= 4))) {
      failed(v, ask, address ? await outputOf(address) : "", cx);

      return;
    }

    await pause(cx, 500);
  }

  failed(v, ask, address ? await outputOf(address) : "", cx, `no forward on localhost:${f.local} after ${(TRIES * 500) / 1000} s`);
}

/** The ask after a failed start: kubectl's words, a pod that's gone said plainly. */
function failed(v: DbView, ask: ForwardAsk, output: string, cx: Context, head: string | null = null): void {
  if (v.forwardAsk !== ask) return;

  const pod = ask.conn.forward?.target.replace(/^[a-z]+\//, "") ?? "";

  ask.starting = null;

  if (GONE.test(output)) {
    ask.why = "gone";
    ask.note = `${ask.conn.forward?.target.startsWith("pod/") ? `the pod ${pod}` : ask.conn.forward?.target ?? "its target"} isn't there any more (a deployment's pods change names): ${lastLine(output)}`;
  } else {
    ask.note = [head, lastLine(output)].filter(Boolean).join(": ") || "the forward ended";
  }

  cx.notify();
}

/** The terminal's state (herdr-core's list), or null when it's gone from it. */
function terminalOf(address: string): { readonly live: boolean } | null {
  const t = terminals().find((x) => isTerminalEntry(x) && x.address === address);

  return t && isTerminalEntry(t) ? { live: t.state !== "exited" && t.state !== "dead" } : null;
}

/** What the forward's terminal said (its last lines). */
async function outputOf(address: string): Promise<string> {
  const r = await hc(["read", "--lines", "40", address]).catch(() => null);

  return r?.stdout ?? "";
}

/** The last line that says something. */
const lastLine = (s: string): string => s.split("\n").map((l) => l.trim()).filter(Boolean).at(-1) ?? "";

/** The connection on the forward's port (another one when its own was taken): the pinned record
 *  or the sent list follows. */
async function placedOn(v: DbView, c: Conn, f: KubeForward, cx: Context): Promise<Conn> {
  if (c.port === f.local) return c;

  const next: ConnDraft = { ...c, port: f.local, forward: f };

  if (c.origin === "saved") await changePinned(v, (list) => list.map((x) => (x.id === c.id ? next : x)), cx);
  else v.sent = v.sent.map((x) => (x.id === c.id ? next : x));

  return next;
}

/** A free local port after `from` (nothing listens there, no forward of ours holds it). */
export async function freePort(from: number): Promise<number> {
  for (let p = from + 1; p < Math.min(65535, from + 60); p++) if (!(await portOpen(p))) return p;

  return from + 1;
}

/** A connect error that says something other than the database answers on the port. */
const NOT_THE_DATABASE = /invalid response to SSL|unsupported frontend protocol|expected authentication request|received invalid response|Got packets out of order|Bad handshake|is not allowed to connect to this MySQL server/i;

/** After a failed connect: another program on the forward's port (no forward of ours there)
 *  is said, with another local port offered. True when the ask is shown. */
export async function takenAfter(v: DbView, c: Conn, error: string, cx: Context): Promise<boolean> {
  const f = c.forward;

  if (!f || !NOT_THE_DATABASE.test(error) || forwardRunning(f)?.live) return false;

  askForward(v, c, "taken", cx, await freePort(f.local));

  return true;
}

/** Stops the connection's forward (its terminal ends: the k8s window's shelf drops it too). */
export function stopForward(v: DbView, c: Conn, cx: Context): void {
  const t = c.forward ? forwardRunning(c.forward) : null;

  if (!t) return;

  run("terminal.kill", { terminal: t.address });
  v.say(`stopped the forward on localhost:${c.forward?.local ?? ""}`, "done");
  cx.notify();
}

/** Opens the Kubernetes window on the forward's namespace (its pods), to pick the target again. */
export function openKubernetes(v: DbView, c: Conn): void {
  const f = c.forward;

  if (!f) return;

  openOverlay({ mod: "k8s", kind: "window", key: "k8s", frame: "none", scrim: true, width: 0.88, height: 0.88, props: { context: f.context, namespace: f.namespace, kind: "pods" } });
  v.forwardAsk = null;
}
