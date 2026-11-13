// A run is a script started in a terminal of its own with no pane
// (`hc run --bg`), labeled so every copy of every mod can find it in
// terminals(): the core is the record, so runs outlive the deck, the window
// and an app restart. The labels:
//
//   nocturne.script         the script's id (detect.ts)
//   nocturne.script.name    its name, runner, shell line and folder
//   nocturne.script.runner
//   nocturne.script.cmd
//   nocturne.script.folder
//   nocturne.script.admin   "sudo" when it runs as root, asking for the password
//                           in its terminal ("osascript" from before: sudo too)
//   nocturne.script.plan    a nix switch: "darwin-rebuild:<name>" / "nixos-rebuild:<name>",
//                           built as the person, activated as root (nix.ts switchPlan)
//
// A finished run keeps its terminal (and its output) until it's dismissed
// (`hc rm`) or restarted. Watching floats the terminal over the tab
// (terminal.peek {float: true}); its bar's ✕ hides it again, still running.
// ../nocturne/scripts.ts reads the same labels for the tab strip (a mod can't
// import another mod's files).

import { run, shared, setShared, terminals } from "herdr";
import type { Guarded } from "./guard.ts";
import { arrayOf, isBoolean, isNumber, isString, nullable, object, readSharedList, readSharedMap, sharedListKey, sharedMapKey, writeShared, writeSharedMap, sharedKey } from "./guard.ts";
import { shellLine, CANCELLED } from "./nix.ts";

export const LABEL = "nocturne.script";

/** The labels a run's terminal carries (see the top); its others are left alone. */
const isLabels = object({}, {
  "nocturne.script": isString,
  "nocturne.script.name": isString,
  "nocturne.script.runner": isString,
  "nocturne.script.cmd": isString,
  "nocturne.script.folder": isString,
  "nocturne.script.admin": isString,
  "nocturne.script.plan": isString,
});

/** A terminal as terminals() lists it (and ../nocturne/scripts.ts keeps an
 *  ended one in ENDED), the fields read here. */
export const isTerminal = object({ address: isString, labels: isLabels }, {
  state: isString,
  exit_code: nullable(isNumber),
  reason: nullable(isString),
  created_ms: nullable(isNumber),
  finished_ms: nullable(isNumber),
  cwd: nullable(isString),
  argv: nullable(arrayOf(isString)),
});

export type Terminal = Guarded<typeof isTerminal>;

// Ended runs' records, kept by the tab strip (../nocturne/scripts.ts ENDED),
// and the runs it follows until they end (TRACK, when it first saw each):
// terminals() lists only live terminals, so a run that ends is read back with `hc get`.
export const ENDED = "scripts.ended";

const ENDED_KEY = sharedMapKey(ENDED, isTerminal);

const TRACK_KEY = sharedMapKey("scripts.track", isNumber);

/** terminals() plus the ended runs the strip kept that the core no longer lists. */
export function withEnded(all: readonly Terminal[], ended: ReadonlyMap<string, Terminal>): Terminal[] {
  const here = new Set(all.map((t) => t.address));

  return [...all, ...[...ended.values()].filter((t) => !here.has(t.address))];
}

/** A run's state in the color it's drawn in. */
export type Tone = "running" | "ok" | "failed" | "stopped";

/** One run (a script started in a terminal of its own; see the top). */
export interface Run {
  readonly address: string;
  /** The script's id (detect.ts). */
  readonly id: string;
  readonly name: string;
  readonly runner: string;
  readonly cmd: string;
  readonly folder: string | null;
  /** The machine it runs on; null: this one. */
  readonly on: string | null;
  readonly live: boolean;
  readonly code: number | null;
  readonly reason: string | null;
  readonly started: number | null;
  readonly ended: number | null;
  readonly admin: string | null;
  readonly plan: string | null;
  /** Its state in words (word). */
  readonly word: string;
}

/** A label's text, or null when it's missing or empty. */
const text = (v: string | undefined) => (v === undefined || v === "" ? null : v);

/** Every run among `all` (the terminals with a script label), the running ones first, newest first. */
export function runs(all: readonly Terminal[]): Run[] {
  return all
    .flatMap((t) => {
      const l = t.labels;
      const id = text(l["nocturne.script"]);

      if (id === null) return [];

      const live = t.state !== "finished";
      const code = live ? null : (t.exit_code ?? null);
      const at = t.address.lastIndexOf("/");
      const admin = text(l["nocturne.script.admin"]);
      const reason = t.reason ?? null;

      return [{
        address: t.address, id, name: text(l["nocturne.script.name"]) ?? id, runner: l["nocturne.script.runner"] ?? "",
        cmd: text(l["nocturne.script.cmd"]) ?? (t.argv ?? []).join(" "), folder: text(l["nocturne.script.folder"]) ?? text(t.cwd ?? undefined),
        on: at > 0 ? t.address.slice(0, at) : null,
        live, code, reason,
        started: t.created_ms ?? null, ended: t.finished_ms ?? null,
        admin,
        plan: text(l["nocturne.script.plan"]),
        word: word(live, code, reason, admin),
      }];
    })
    .sort((a, b) => Number(b.live) - Number(a.live) || (b.started ?? 0) - (a.started ?? 0));
}

/** Every run now: terminals() and the ended ones the strip kept. */
export const allRuns = () => runs(withEnded(terminals().filter(isTerminal), readSharedMap(shared, ENDED_KEY)));

/** The state in words: running, ok, exit N, stopped, cancelled (an admin run's ctrl-c). */
export function word(live: boolean, code: number | null, reason: string | null, admin?: string | null) {
  if (live) return "running";

  if (reason === "killed") return "stopped";

  if (admin && code === CANCELLED) return "cancelled";

  if (code === 0) return "ok";

  return code === null ? "ended" : `exit ${code}`;
}

/** running, ok, failed or stopped: the color a run is drawn in. */
export const tone = (r: Pick<Run, "live" | "reason" | "code">): Tone => (r.live ? "running" : r.reason === "killed" ? "stopped" : r.code === 0 ? "ok" : "failed");

/** How long it ran or has been running: 0:07, 12:04, 1:02:03. */
export function elapsed(r: Pick<Run, "live" | "started" | "ended">, now = Date.now()) {
  if (r.started === null) return "";

  const s = Math.max(0, Math.floor(((r.live ? now : r.ended ?? now) - r.started) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = String(s % 60).padStart(2, "0");

  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** A control character (C0 or DEL): nothing a label or the filter takes. */
export const isControl = (ch: string) => {
  const n = ch.charCodeAt(0);

  return n < 0x20 || n === 0x7f;
};

/** What starting a script takes: a script (detect.ts), or a run started again. */
export interface Startable {
  readonly id: string;
  readonly name: string;
  readonly runner: string;
  readonly cmd: string;
  readonly admin?: string | null;
  readonly plan?: string | null;
}

/** The arguments to `hc run` for a script in a folder (on a machine). One
 *  shell line, as `hc run "cd app && bun test"` takes it. */
export function runArgs(s: Startable, folder: string | null, on: string | null) {
  // A label is one argv word: hc can't take a NUL in one, nor should a newline sit in it.
  const label = (k: string, v: string) => ["--label", `${k}=${[...v].map((c) => (isControl(c) ? " " : c)).join("")}`];

  return [
    "run", "--bg", "--no-parent", "--no-notify", "--json",
    ...(on ? ["--on", on] : []),
    ...(folder ? ["--cwd", folder] : []),
    ...label(LABEL, s.id), ...label(`${LABEL}.name`, s.name), ...label(`${LABEL}.runner`, s.runner),
    ...label(`${LABEL}.cmd`, s.cmd), ...(folder ? label(`${LABEL}.folder`, folder) : []),
    // Nocturne's name for a terminal: the float's bar says "dev", not "sh".
    ...label("nocturne.name", s.name),
    ...(s.admin ? label(`${LABEL}.admin`, s.admin) : []),
    ...(s.plan ? label(`${LABEL}.plan`, s.plan) : []),
    "--", shellLine(s.cmd, s.admin, s.plan),
  ];
}

// The deck doesn't run `hc` itself: it closes as soon as a script is picked,
// and a closed overlay's tasks go with it. It queues jobs in shared(JOBS)
// for the tab strip, which outlives it (../nocturne/jobs.ts runs them).
export const JOBS = "scripts.jobs";

/** One `hc` call of a job; `start`: it starts a run (the strip follows it). */
const isStep = object({ hc: arrayOf(isString) }, { start: isBoolean });

const isJob = object({ at: isNumber, name: isString, steps: arrayOf(isStep) }, { watch: isBoolean });

export type Job = Guarded<typeof isJob>;

const JOBS_LIST = sharedListKey(JOBS, isJob);

const JOBS_KEY = sharedKey(JOBS, arrayOf(isJob));

/** Queues a job: { name, watch?, steps: [{ hc, start? }] }. */
export function enqueue(job: Omit<Job, "at">) {
  writeShared(setShared, JOBS_KEY, [...readSharedList(shared, JOBS_LIST), { at: Date.now(), ...job }]);
}

/** Starts a script (in the background; `look`: floated to watch). */
export function start(s: Startable, folder: string | null, on: string | null, look = false) {
  enqueue({ name: s.name, watch: look, steps: [{ hc: runArgs(s, folder, on), start: true }] });
}

/** Floats its terminal over the tab, to watch it or type into it. */
export const watch = (r: Run) => run("terminal.peek", { terminal: r.address, float: true });

/** Ends a running script (its terminal shows "stopped"). */
export const stop = (r: Run) => enqueue({ name: r.name, steps: [{ hc: ["kill", r.address] }] });

/** Forgets what the strip kept about a run (and any entry kept in another shape). */
function forget(r: Run) {
  const ended = new Map(readSharedMap(shared, ENDED_KEY));
  const tracked = new Map(readSharedMap(shared, TRACK_KEY));

  ended.delete(r.address);
  tracked.delete(r.address);
  writeSharedMap(setShared, ENDED_KEY, ended);
  writeSharedMap(setShared, TRACK_KEY, tracked);
}

/** Forgets a finished run (its terminal goes with it). */
export function dismiss(r: Run) {
  forget(r);
  enqueue({ name: r.name, steps: [{ hc: ["rm", r.address] }] });
}

/** Runs it again in the same folder: the old run goes, a new one starts. */
export function restart(r: Run) {
  forget(r);

  const s = { id: r.id, name: r.name, runner: r.runner, cmd: r.cmd, admin: r.admin, plan: r.plan };

  enqueue({ name: r.name, steps: [
    ...(r.live ? [{ hc: ["kill", r.address] }] : []),
    { hc: ["rm", r.address] },
    { hc: runArgs(s, r.folder, r.on), start: true },
  ] });
}
