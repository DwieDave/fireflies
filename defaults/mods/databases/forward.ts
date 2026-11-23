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

import { appHome, openOverlay } from "herdr";
import { Array as Arr, Clock, Effect, Option, Schema, String as Str } from "effect";
import { Commands, Exec, Files, Hc, Workspace, causeMessage, redraw } from "@fireflies/kit";
import type { Conn, ConnDraft } from "./kinds.ts";
import type { KubeForward } from "./kube.ts";
import { FORWARD_LABEL, forwardProblem, forwardStartArgs, labelOf } from "./kube.ts";
import { changePinned } from "./pinned.ts";
import type { ForwardAsk } from "./state.ts";
import type { default as DbView } from "./main.ts";
import { runtime } from "./app.ts";
import type { DbRun } from "./app.ts";

/** Whether something listens on 127.0.0.1:<port>: nc, else bash's /dev/tcp (loopback answers at once). */
export const PORT_SCRIPT = 'p=$1; if command -v nc >/dev/null 2>&1; then exec nc -z -w 2 127.0.0.1 "$p"; fi; exec bash -c \'exec 3<>"/dev/tcp/127.0.0.1/$0"\' "$p"';

/** Whether the port answers (a check that couldn't run: it doesn't). */
export const portOpen = (port: number): Effect.Effect<boolean, never, Exec> =>
  Exec.use((x) => x.run("sh", ["-c", PORT_SCRIPT, "ff-port", String(port)], { timeout: 4000 })).pipe(
    Effect.map((r) => r.code === 0),
    Effect.orElseSucceed(() => false),
  );

/** A terminal as herdr-core lists it: the forward's label (kube.ts FORWARD_LABEL) when it has one. */
const TerminalEntrySchema = Schema.Struct({
  address: Schema.String,
  state: Schema.optionalKey(Schema.String),
  labels: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
});
const terminalEntry = Schema.decodeUnknownOption(TerminalEntrySchema);

const live = (state: string | undefined): boolean => state !== "exited" && state !== "dead";

/** The forward of `f` among herdr-core's terminals (the k8s mod's label), or null. */
export const forwardRunning = (f: KubeForward): Effect.Effect<{ readonly address: string; readonly live: boolean } | null, never, Workspace> =>
  Effect.map(Workspace.use((w) => w.terminals), (list) => Option.getOrNull(Arr.findFirst(list, (raw) => Option.flatMap(terminalEntry(raw), (t) => {
    const n = Option.flatMap(Option.fromUndefinedOr(t.labels?.[FORWARD_LABEL]), labelOf);

    return Option.isSome(n) && n.value.context === f.context && n.value.namespace === f.namespace && n.value.target === f.target && n.value.local === f.local
      ? Option.some({ address: t.address, live: live(t.state) })
      : Option.none();
  }))));

/** The forward of `f` as a render shows it (herdr-core's list as the app has it now). */
export const forwardShown = (f: KubeForward): { readonly address: string; readonly live: boolean } | null => runtime.now(forwardRunning(f));

/** Before connecting: true to go on (no forward kept, its port open, or a forward that can't be
 *  kept: said); false when the ask is shown (its port is down). */
export const forwardFirst = (v: DbView, c: Conn): Effect.Effect<boolean, never, DbRun> => Effect.gen(function* () {
  const f = c.forward;

  if (f === undefined) return true;

  const problem = forwardProblem(f, c.kind, c.host, c.port);

  if (problem !== null && Str.isNonEmpty(problem)) {
    v.say(`${c.name}: its forward isn't used: ${problem}`, "failed");

    return true;
  }

  if (yield* portOpen(f.local)) return true;

  askForward(v, c, "down");

  return false;
});

/** Shows the ask for a connection's forward. */
export function askForward(v: DbView, c: Conn, why: ForwardAsk["why"], local: number | null = null): void {
  if (c.forward === undefined) return;

  v.forwardAsk = { conn: c, why, note: null, local: local ?? c.forward.local, starting: null };
  v.run(k8sInstalled(v));
}

/** Whether the Kubernetes mod is installed (its mod.json, as other mods find it). */
const k8sInstalled = (v: DbView): Effect.Effect<void, never, Files> => Effect.suspend(() => {
  if (v.k8s !== null) return Effect.void;

  return Files.use((f) => f.read(`${appHome()}/mods/k8s/mod.json`)).pipe(
    Effect.map(Option.isSome),
    Effect.orElseSucceed(() => false),
    Effect.map((there) => {
      v.k8s = there;
    }),
  );
});

/** Polls while a started forward comes up (every 500 ms, 20 s). */
const TRIES = 40;

/** kubectl's words for a forward whose pod isn't there. */
const GONE = /pods? "[^"]*" not found|NotFound|unable to forward port because pod is not running|does not have a host assigned/i;

const AddressSchema = Schema.fromJsonString(Schema.Struct({ address: Schema.String }));

/** Starts the ask's forward (on `ask.local`), waits for its port, then connects with `connectNow`. */
export const startForward = (v: DbView, ask: ForwardAsk, connectNow: (c: Conn) => void): Effect.Effect<void, never, DbRun> => Effect.gen(function* () {
  const c = ask.conn;
  const kept = c.forward;
  const kind = c.kind;

  if (kept === undefined || (kind !== "postgres" && kind !== "mysql")) return;

  const f: KubeForward = { ...kept, local: ask.local };

  ask.starting = yield* Clock.currentTimeMillis;
  ask.note = null;
  yield* redraw;

  const r = yield* Hc.use((h) => h.run(forwardStartArgs(f, kind))).pipe(Effect.catch((error) => Effect.succeed({ code: -1, stdout: "", stderr: error.message })));

  if (v.forwardAsk !== ask) return;

  if (r.code !== 0) {
    const said = lastLine(Str.isNonEmpty(r.stderr) ? r.stderr : r.stdout);

    ask.starting = null;
    ask.note = `couldn't start it: ${Str.isNonEmpty(said) ? said : `hc exited with ${r.code}`}`;

    return;
  }

  const address = Option.getOrNull(Option.map(Schema.decodeUnknownOption(AddressSchema)(Str.trim(r.stdout)), (x) => x.address));
  const output = address !== null && Str.isNonEmpty(address) ? outputOf(address) : Effect.succeed("");
  let seen = false;

  for (let i = 0; i < TRIES; i++) {
    if (v.forwardAsk !== ask) return;

    if (yield* portOpen(f.local)) {
      v.forwardAsk = null;
      v.say(`forward started: ${f.target} :${f.remote} → localhost:${f.local} (the Kubernetes window lists it)`, "done");
      connectNow(yield* placedOn(v, c, f));

      return;
    }

    // Ended: listed as exited, or gone from the list (herdr-core hides a finished terminal) after
    // it was there or after 2 s.
    const t = address !== null && Str.isNonEmpty(address) ? yield* terminalOf(address) : null;

    seen ||= t !== null;

    if (t?.live === false || (address !== null && Str.isNonEmpty(address) && t === null && (seen || i >= 4))) {
      failed(v, ask, yield* output);

      return;
    }

    yield* Effect.sleep(500);
  }

  failed(v, ask, yield* output, `no forward on localhost:${f.local} after ${(TRIES * 500) / 1000} s`);
}).pipe(Effect.catchDefect((d) => Effect.sync(() => {
  ask.starting = null;
  ask.note = causeMessage(d);
})));

/** The ask after a failed start: kubectl's words, a pod that's gone said plainly. */
function failed(v: DbView, ask: ForwardAsk, output: string, head: string | null = null): void {
  if (v.forwardAsk !== ask) return;

  const target = ask.conn.forward?.target;
  const pod = Str.replace(/^[a-z]+\//, "")(target ?? "");

  ask.starting = null;

  if (GONE.test(output)) {
    ask.why = "gone";
    ask.note = `${target !== undefined && Str.startsWith("pod/")(target) ? `the pod ${pod}` : target ?? "its target"} isn't there any more (a deployment's pods change names): ${lastLine(output)}`;
  } else {
    const said = Arr.join(Arr.filter([head ?? "", lastLine(output)], Str.isNonEmpty), ": ");

    ask.note = Str.isNonEmpty(said) ? said : "the forward ended";
  }
}

/** The terminal's state (herdr-core's list), or null when it's gone from it. */
const terminalOf = (address: string): Effect.Effect<{ readonly live: boolean } | null, never, Workspace> =>
  Effect.map(Workspace.use((w) => w.terminals), (list) => Option.getOrNull(Arr.findFirst(list, (raw) => Option.flatMap(terminalEntry(raw), (t) =>
    (t.address === address ? Option.some({ live: live(t.state) }) : Option.none())))));

/** What the forward's terminal said (its last lines; none when it can't be read). */
const outputOf = (address: string): Effect.Effect<string, never, Hc> =>
  Hc.use((h) => h.run(["read", "--lines", "40", address])).pipe(Effect.map((r) => r.stdout), Effect.orElseSucceed(() => ""));

/** The last line that says something. */
const lastLine = (s: string): string => Option.getOrElse(Arr.last(Arr.filter(Arr.map(Str.split(s, "\n"), Str.trim), Str.isNonEmpty)), () => "");

/** The connection on the forward's port (another one when its own was taken): the pinned record
 *  or the sent list follows. */
const placedOn = (v: DbView, c: Conn, f: KubeForward): Effect.Effect<Conn, never, DbRun> => Effect.gen(function* () {
  if (c.port === f.local) return c;

  const next: ConnDraft = { ...c, port: f.local, forward: f };

  if (c.origin === "saved") yield* changePinned(v, (list) => Arr.map(list, (x) => (x.id === c.id ? next : x)));
  else v.sent = Arr.map(v.sent, (x) => (x.id === c.id ? next : x));

  return next;
});

/** A free local port after `from` (nothing listens there, no forward of ours holds it). */
export const freePort = (from: number): Effect.Effect<number, never, Exec> => Effect.gen(function* () {
  for (let p = from + 1; p < Math.min(65535, from + 60); p++) if (!(yield* portOpen(p))) return p;

  return from + 1;
});

/** A connect error that says something other than the database answers on the port. */
const NOT_THE_DATABASE = /invalid response to SSL|unsupported frontend protocol|expected authentication request|received invalid response|Got packets out of order|Bad handshake|is not allowed to connect to this MySQL server/i;

/** After a failed connect: another program on the forward's port (no forward of ours there)
 *  is said, with another local port offered. True when the ask is shown. */
export const takenAfter = (v: DbView, c: Conn, error: string): Effect.Effect<boolean, never, DbRun> => Effect.gen(function* () {
  const f = c.forward;

  if (f === undefined || !NOT_THE_DATABASE.test(error) || (yield* forwardRunning(f))?.live === true) return false;

  askForward(v, c, "taken", yield* freePort(f.local));

  return true;
});

/** Stops the connection's forward (its terminal ends: the k8s window's shelf drops it too). */
export const stopForward = (v: DbView, c: Conn): Effect.Effect<void, never, DbRun> => Effect.gen(function* () {
  const t = c.forward !== undefined ? yield* forwardRunning(c.forward) : null;

  if (t === null) return;

  yield* Commands.use((x) => x.run("terminal.kill", { terminal: t.address }));
  v.say(`stopped the forward on localhost:${c.forward?.local ?? ""}`, "done");
});

/** Opens the Kubernetes window on the forward's namespace (its pods), to pick the target again. */
export function openKubernetes(v: DbView, c: Conn): void {
  const f = c.forward;

  if (f === undefined) return;

  openOverlay({ mod: "k8s", kind: "window", key: "k8s", frame: "none", scrim: true, width: 0.88, height: 0.88, props: { context: f.context, namespace: f.namespace, kind: "pods" } });
  v.forwardAsk = null;
}
