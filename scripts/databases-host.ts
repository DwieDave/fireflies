// The Databases window's tests, in one place (docs/effect-mods.md):
// - its services for a test that runs the mod's effects for real: programs
//   spawned (sqlite3, sh, a fake client), files on disk, herdr-core, shared
//   state, commands and the workspace from @fireflies/kit/testing;
// - `runReal`: an effect of the mod run on them, as a promise for bun's test.
// No promise is made here: a program's run is an Effect.callback over
// node's child_process, a file a synchronous fs call.

import { mock, setSystemTime } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Effect, Layer, ManagedRuntime, Option, Schema } from "effect";
import type { ExecResult } from "herdr";
import { Commands, Exec, ExecError, FileError, Files, Redraw, Shared, StaleFile } from "@fireflies/kit";
import { commandsTest, hcTest, sharedTest, workspaceTest } from "@fireflies/kit/testing";
import { Libsql, Pickers } from "../defaults/mods/databases/fx.ts";
import type { LibsqlAnswer } from "../defaults/mods/databases/fx.ts";

/** Exec on real programs (`seen`: each run's argv); `timeout` kills the program, as the app's exec does. */
export function realExec(seen: string[][] = []) {
  const layer = Layer.succeed(Exec, Exec.of({
    run: (command, args, options) => Effect.callback<ExecResult, ExecError>((resume) => {
      seen.push([command, ...args]);

      const p = spawn(command, [...args], { cwd: options?.cwd, stdio: ["ignore", "pipe", "pipe"], timeout: options?.timeout ?? 30000, killSignal: "SIGKILL" });
      let stdout = "";
      let stderr = "";

      p.stdout.on("data", (d) => { stdout += String(d); });
      p.stderr.on("data", (d) => { stderr += String(d); });
      p.on("error", (e) => {
        resume(Effect.fail(ExecError.make({ command, message: e.message })));
      });
      p.on("close", (code) => {
        resume(Effect.succeed({ code: code ?? -1, stdout, stderr }));
      });

      return Effect.sync(() => p.kill());
    }),
  }));

  return { layer, seen };
}

/** Files on disk: a write that expects a file as it was read is refused when it changed (or is there unexpectedly). */
export const diskFiles = Layer.succeed(Files, Files.of({
  read: (path) => Effect.try({ try: () => (existsSync(path) ? Option.some(readFileSync(path, "utf8")) : Option.none()), catch: (e) => FileError.make({ path, message: String(e) }) }),
  write: (path, text, expected) => Effect.gen(function* () {
    const now = existsSync(path) ? readFileSync(path, "utf8") : null;

    if (now !== expected) return yield* StaleFile.make({ path, message: `${path} changed since it was read` });

    yield* Effect.try({
      try: () => {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, text);
      },
      catch: (e) => FileError.make({ path, message: String(e) }),
    });
  }),
  list: (dir) => Effect.try({ try: () => (existsSync(dir) ? Option.some(readdirSync(dir).sort()) : Option.none()), catch: (e) => FileError.make({ path: dir, message: String(e) }) }),
}));

/** The services an effect of the mod runs on for real (no Libsql: hrana's tests give their own). */
export function realServices(seen: string[][] = []) {
  const exec = realExec(seen);

  return Layer.mergeAll(exec.layer, diskFiles, hcTest(() => ({ code: 1, stdout: "", stderr: "" })).layer, sharedTest().layer, commandsTest().layer, workspaceTest().layer);
}

const real = ManagedRuntime.make(realServices());

/** Runs `effect` on real programs and files: its value, for bun's test. */
export const runReal = <A, E>(effect: Effect.Effect<A, E, Exec | Files>): Promise<A> => real.runPromise(effect);

/** As runReal, recording each program's argv in `seen`. */
export const runSeen = <A, E>(seen: string[][], effect: Effect.Effect<A, E, Exec | Files>): Promise<A> => Effect.runPromise(Effect.provide(effect, realServices(seen)));

/** Runs an effect of the window on the mod's runtime `rt` (app.ts `runtime`, over the herdr
 *  stand-in), as a copy runs it but with no copy to redraw: its value, for bun's test. */
export const viewRun = (rt: { readonly managed: () => ManagedRuntime.ManagedRuntime<any, never> }) =>
  <A, E>(effect: Effect.Effect<A, E, any>): Promise<A> => rt.managed().runPromise(Effect.provideService(effect, Redraw, Redraw.of({ now: Effect.void })));

// ---- the window's stand-in: one for every view test (mock.module is process-wide: one per file's process)

/** An answer a stand-in program gives: at once, or an effect (a run held open on a Deferred, a stop that never comes). */
export type Reply = ExecResult | Effect.Effect<ExecResult>;

/** The default answers: the clients are found (envrc.ts lookup), anything else fails quietly. */
export const found = (cmd: string, args: readonly string[]): ExecResult => (cmd === "sh" && args[2] === "lookup" ? { code: 0, stdout: `/usr/bin/${args[4]}\n`, stderr: "" } : { code: 1, stdout: "", stderr: "" });

/** A real program's run, to its end (the test's process waits: no promise, no clock). */
export const spawnReply = (cmd: string, args: readonly string[], options?: { readonly cwd?: string; readonly timeout?: number }): ExecResult => {
  const r = spawnSync(cmd, [...args], { cwd: options?.cwd, encoding: "utf8", timeout: options?.timeout ?? 30000, killSignal: "SIGKILL" });

  return r.error !== undefined && r.status === null && r.signal === null ? { code: 127, stdout: "", stderr: String(r.error.message) } : { code: r.status ?? 137, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
};

/** What the window sees of the app, and what it did there: a test sets and reads these. */
export interface DbHost {
  shared: Record<string, unknown>;
  props: any;
  panes: any[];
  spaces: any[];
  terminals: any[];
  focused: any;
  platform: string;
  appHome: string;
  /** Each program run's answer (execs records the argv). */
  reply: (cmd: string, args: readonly string[], options?: any) => Reply;
  /** Each hc run's answer (hcCalls records the args). */
  hcReply: (args: readonly string[]) => ExecResult;
  /** A libSQL server's answer to a pipeline request. */
  libsql: (url: string, token: unknown, body: string) => LibsqlAnswer;
  /** What the pickers give. */
  picked: { file: string | null; folder: string | null };
  /** Key commands the window reads next (databases.stop …). */
  readonly queue: string[];
  readonly files: Map<string, string>;
  readonly written: [string, string][];
  readonly execs: string[][];
  readonly hcCalls: string[][];
  readonly commands: [string, any][];
  readonly opened: any[];
  readonly closed: string[];
  readonly stores: Map<string, Map<string, string>>;
  overlayN: number;
  clipboard: string;
  /** What the last render drew: each builder call (`div`, `child`, `when` …) and its arguments. */
  drawn: [string, any[]][];
}

export interface StandInOptions {
  /** Files on disk (written for real, under the test's temp folder) instead of in `files`. */
  readonly disk?: boolean;
  /** The inputs' and editors' stand-ins, where a test needs more of them (typing, focus). */
  readonly Input?: new (o: any) => unknown;
  readonly Editor?: new (o: any) => unknown;
  /** The view's focus handle, where a test follows the keyboard. */
  readonly focusHandle?: () => unknown;
  /** The settings' zoom and the drawn element's extra builders. */
  readonly zoom?: () => number;
}

/** A text input: its text, its handlers, whether it's masked. */
export class StandInput {
  v = ""; masked = false; handlers: Record<string, Function> = {};
  constructor(o: any = {}) { this.v = o.value ?? ""; }
  on(ev: string, f: Function) { this.handlers[ev] = f; return true; }
  value() { return this.v; } set_value(v: string) { this.v = v; } focus() {} release() { return true; } set_masked(m: boolean) { this.masked = m; }
}

/** The SQL editor: its text, caret and selection; what the window asks of it. */
export class StandEditor {
  text: string; caret = { line: 0, col: 0 }; sel: any = null; diags: any[] = []; keys: any = null; focusedNow = false;
  constructor(o: any) { this.text = o.value ?? ""; }
  value() { return this.text; } set_value(v: string) { this.text = v; }
  on(ev: string, f: any) { if (ev === "key") this.keys = f; return true; }
  cursor() { return this.caret; } set_cursor(line: number, col: number) { this.caret = { line, col }; }
  selection() { return this.sel ?? { start: this.caret, end: this.caret, text: "" }; }
  set_diagnostics(d: any[]) { this.diags = d; } edit(e: any[]) { for (const x of e) this.text = this.text.slice(0, x.start.col) + x.text + this.text.slice(x.end.col); }
  focus() { this.focusedNow = true; } focused() { return this.focusedNow; } release() { return true; }
}

interface Timer { at: number; fire: (cx: unknown) => void; live: boolean }

/**
 * The window's stand-in: herdr (what a render or a key reads of the app), gpui-kit and gpui-base
 * (an element that records what it's asked to draw), the copy's context (its timers on a clock the
 * test moves), localStorage per pane, and the mod's services from the kit's test layers (useServices).
 * Call it before the mod is imported.
 */
export function standIn(options: StandInOptions = {}) {
  const h: DbHost = {
    shared: {}, props: null, panes: [], spaces: [], terminals: [], focused: null, platform: "linux", appHome: "/tmp/herdr-test",
    reply: found, libsql: () => ({ status: 500, text: "no server" }), hcReply: () => ({ code: 1, stdout: "", stderr: "" }), picked: { file: null, folder: null }, queue: [],
    files: new Map(), written: [], execs: [], hcCalls: [], commands: [], opened: [], closed: [], stores: new Map(),
    overlayN: 0, clipboard: "", drawn: [],
  };
  const theme: any = new Proxy({}, { get: (_t, k) => (String(k).startsWith("ansi") ? "#808080" : "#c0c0c0") });

  mock.module("herdr", () => ({
    agents: () => [], appHome: () => h.appHome, home: () => "/home/me",
    closeOverlay: (id: string) => { h.closed.push(id); return null; },
    openOverlay: (spec: any) => { h.opened.push(spec); return `o${++h.overlayN}`; },
    focused: () => h.focused, keys: () => [], layout: () => null, notify: () => null, panes: () => h.panes, props: () => h.props,
    run: (name: string, args: any) => { h.commands.push([name, args]); return null; },
    settings: () => ({ zoom: options.zoom?.() ?? 1, font_family: "Mono", ui_font_family: "Departure Mono" }),
    shared: (k: string) => h.shared[k] ?? null, setShared: (k: string, v: unknown) => { h.shared[k] = v; },
    spaces: () => h.spaces, terminals: () => h.terminals, theme: () => theme, window: () => ({ platform: h.platform }),
  }));

  const el: any = new Proxy(function () {}, {
    get: (_t, k) => (k === "then" ? undefined
      : k === "when" ? (on: unknown, add: (e: unknown) => unknown) => { h.drawn.push(["when", []]); return on === true || (on !== false && on !== null && on !== undefined && on !== 0 && on !== "") ? add(el) : el; }
      : k === "map" ? (f: (e: unknown) => unknown) => f(el)
      : (...args: any[]) => { h.drawn.push([String(k), args]); return el; }),
    apply: () => el,
  });

  class View {}
  mock.module("gpui-kit", () => ({ View, div: () => el, svg: () => el, image: () => el, PathBuilder: { fill: () => el }, Background: { checkerboard: () => el } }));

  const InputClass = options.Input ?? StandInput;
  const EditorClass = options.Editor ?? StandEditor;
  const scroll = () => ({ scroll_to_item() {}, offset: () => ({ x: 0, y: 0 }), release: () => true });

  mock.module("gpui-base", () => ({
    h_flex: () => el, v_flex: () => el, ScrollHandle: { new: scroll },
    InputState: { new: (o: any) => new InputClass(o) }, Input: { new: () => el },
    EditorState: { new: (o: any) => new EditorClass(o) }, Editor: { new: () => el },
  }));
  (globalThis as any).window = { paint_path: () => el };
  (globalThis as any).localStorage = {
    getItem: (k: string) => h.stores.get(JSON.stringify(h.props))?.get(k) ?? null,
    setItem: (k: string, v: string) => {
      const key = JSON.stringify(h.props);

      if (!h.stores.has(key)) h.stores.set(key, new Map());

      h.stores.get(key)?.set(k, v);
    },
  };

  // The copy's context: its timers wait for the test's clock, which starts at the wall clock's now.
  const start = Date.now();
  let now = 0;
  const timers: Timer[] = [];
  const cx: any = {
    spawn() { throw new Error("the window runs its work on its runtime, not cx.spawn"); },
    notify() {}, stop_propagation() {}, bind_keys() {},
    focus_handle: options.focusHandle ?? (() => ({ focus() {}, is_focused: () => false, release: () => true })),
    write_to_clipboard: (t: string) => { h.clipboard = t; },
    timer: {
      every() {},
      after(ms: number, fire: (cx: unknown) => void) {
        const t: Timer = { at: now + ms, fire, live: true };

        timers.push(t);

        return { cancel() { t.live = false; } };
      },
    },
  };

  setSystemTime(new Date(start));

  const next = (): Timer | undefined => timers.filter((t) => t.live).sort((a, b) => a.at - b.at)[0];

  /** Fires `t`, the clock moved to it (Date.now too, the kit's clock reads it). */
  const fire = (t: Timer): void => {
    now = Math.max(now, t.at);
    setSystemTime(new Date(start + now));
    t.live = false;
    t.fire(cx);
  };

  /** Moves the clock by `ms`, firing each timer due on the way. */
  const advance = (ms: number): Effect.Effect<void> => Effect.gen(function* () {
    const to = now + ms;

    for (let t = next(); t !== undefined && t.at <= to; t = next()) {
      fire(t);
      yield* turns(4);
    }

    now = to;
    setSystemTime(new Date(start + now));
    yield* turns(4);
  });

  /**
   * The window's work run until `ok` holds: every fiber's turn taken, then the next timer fired
   * (the clock moved to it) while `ok` is still false. `within` caps how far the clock may move.
   */
  const until = (ok: () => boolean, within = 60_000): Promise<void> => Effect.runPromise(Effect.gen(function* () {
    const end = now + within;

    for (;;) {
      yield* turns(8);

      if (ok()) return;

      const t = next();

      if (t === undefined || t.at > end) {
        yield* turns(40);

        if (ok()) return;

        return yield* Effect.die(new Error(`still waiting at +${now} ms (the window is idle)`));
      }

      fire(t);
    }
  }));

  /** The window's work run as far as it goes now, the timers due within a second fired (a frame's wait, a retry's). */
  const flush = (): Promise<void> => Effect.runPromise(Effect.gen(function* () {
    yield* turns(8);

    for (let t = next(); t !== undefined && t.at <= now + 999; t = next()) {
      fire(t);
      yield* turns(8);
    }
  }));

  const files = options.disk === true ? diskFiles : filesOn(h);
  const exec = Layer.succeed(Exec, Exec.of({
    run: (command, args, opts) => Effect.suspend(() => {
      h.execs.push([command, ...args]);

      const r = h.reply(command, args, opts);

      return Effect.isEffect(r) ? r : Effect.succeed(r);
    }),
  }));
  const hc = hcTest((args) => {
    h.hcCalls.push([...args]);

    return h.hcReply(args);
  });
  const commands = Layer.succeed(Commands, Commands.of({
    run: (name, args) => Effect.sync(() => { h.commands.push([name, args]); }),
    next: Effect.suspend(() => {
      const c = h.queue.shift();

      return c === undefined ? Effect.never : Effect.succeed(c);
    }),
  }));
  const shared = Layer.succeed(Shared, Shared.of({
    get: (key) => Effect.sync(() => Schema.decodeUnknownOption(key.schema)(h.shared[key.name] ?? null)),
    set: (key, value) => Effect.sync(() => {
      Option.map(Schema.encodeOption(key.schema)(value), (json) => { h.shared[key.name] = json; });
    }),
  }));
  const workspace = workspaceTest({
    window: () => ({ platform: h.platform } as any), spaces: () => h.spaces, panes: () => h.panes, terminals: () => h.terminals,
    focused: () => h.focused, settings: () => ({ zoom: 1 } as any),
  });

  const pickers = Layer.succeed(Pickers, Pickers.of({
    file: () => Effect.sync(() => Option.fromNullOr(h.picked.file)),
    folder: () => Effect.sync(() => Option.fromNullOr(h.picked.folder)),
  }));
  const libsql = Layer.succeed(Libsql, Libsql.of({ pipeline: (url, token, body) => Effect.sync(() => h.libsql(url, token, body)) }));

  /** The window's services: the stand-ins above (give them to app.ts useServices before a copy opens). */
  const services = Layer.mergeAll(files, exec, hc.layer, commands, shared, workspace.layer, pickers, libsql);

  return { h, theme, el, cx, now: () => now, advance: (ms: number) => Effect.runPromise(advance(ms)), until, flush, services };
}

/** Takes `n` turns: every fiber ready to go runs meanwhile. */
const turns = (n: number): Effect.Effect<void> => Effect.repeat(Effect.yieldNow, { times: n - 1 });

/** Files in `h.files`, each write recorded in `h.written`; a write expecting another text is refused (StaleFile). */
const filesOn = (h: DbHost) => Layer.succeed(Files, Files.of({
  read: (path) => Effect.sync(() => Option.fromUndefinedOr(h.files.get(path))),
  write: (path, text, expected) => Effect.suspend(() => {
    if ((h.files.get(path) ?? null) !== expected) return Effect.fail(StaleFile.make({ path, message: `${path} changed since it was read` }));

    h.files.set(path, text);
    h.written.push([path, text]);

    return Effect.void;
  }),
  list: (dir) => Effect.sync(() => Option.none<readonly string[]>()),
}));
