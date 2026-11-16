// What the app gives a mod, as Effect services: each one a small interface
// with a live layer (live.ts, over the `herdr` module) and a test layer
// (testing.ts, in memory). Code that runs a program, reads a file or a
// shared key asks for the service (`yield* Exec`) instead of importing
// `herdr`, so a bun test provides the test layer instead of mocking the
// module, and the type of an effect lists what it touches.
//
// This file imports `herdr` for types only: it loads in any test.

import { Array as Arr, Context, Effect, Option } from "effect";
import type { PaneInfo, Settings, agents, focused, panes, spaces, terminals, window as appWindow, ExecResult, exec as herdrExec, hc as herdrHc, readTextFile as herdrRead, writeTextFile as herdrWrite } from "herdr";
import { ExecError, ExitError, FileError, StaleFile, causeMessage, lastLine } from "./errors.ts";
import type { DecodeError } from "./errors.ts";
import { decodeJson } from "./schema.ts";
import type { Codec, SharedKey } from "./schema.ts";

// ---- programs

/** `exec`'s options: the folder, the machine (a space's `machine`), the timeout in ms (30 s by default, 10 min at most). */
export interface ExecOptions {
  readonly cwd?: string;
  readonly on?: string | null;
  readonly timeout?: number;
}

/** Runs programs with the person's environment (`herdr` `exec`). */
export class Exec extends Context.Service<Exec, {
  /** Runs `command`: its exit code and output, whatever the code; `ExecError` when it couldn't run. */
  readonly run: (command: string, args: readonly string[], options?: ExecOptions) => Effect.Effect<ExecResult, ExecError>;
}>()("@fireflies/kit/services/Exec") {}

/** `r`'s stdout when it exited 0, else an `ExitError` saying its stderr's last line. */
const exitedOk = (command: string, r: ExecResult): Effect.Effect<string, ExitError> => {
  if (r.code === 0) return Effect.succeed(r.stdout);

  const said = lastLine(r.stderr);

  return Effect.fail(ExitError.make({ command, code: r.code, stderr: r.stderr, message: said === "" ? `${command} exited ${r.code}` : said }));
};

/** Runs `command` and asks for exit 0: its stdout, or an `ExitError` with its stderr. */
export const execOk = Effect.fnUntraced(function* (command: string, args: readonly string[], options?: ExecOptions) {
  const exec = yield* Exec;
  const r = yield* exec.run(command, args, options);

  return yield* exitedOk(command, r);
});

/** Runs `command`, asks for exit 0 and decodes its stdout as JSON with `schema`. */
export const execJson = <A, I>(schema: Codec<A, I>, what: string) => {
  const read = decodeJson(schema, what);

  return (command: string, args: readonly string[], options?: ExecOptions): Effect.Effect<A, ExecError | ExitError | DecodeError, Exec> =>
    Effect.flatMap(execOk(command, args, options), read);
};

// ---- herdr-core

/**
 * herdr-core (`herdr` `hc`): the terminals' labels, keys, screens, sends and
 * waits. Its own service, not `Exec`: the app finds `hc` itself (it isn't on
 * every PATH), and an effect's type says it talks to the core.
 */
export class Hc extends Context.Service<Hc, {
  /** Runs `hc args` ("--json" for machine output): its exit code and output, whatever the code; `ExecError` when it couldn't run. */
  readonly run: (args: readonly string[]) => Effect.Effect<ExecResult, ExecError>;
}>()("@fireflies/kit/services/Hc") {}

/** Runs `hc args` and asks for exit 0: its stdout, or an `ExitError` (command `hc <first arg>`) with its stderr. */
export const hcOk = Effect.fnUntraced(function* (args: readonly string[]) {
  const hc = yield* Hc;
  const r = yield* hc.run(args);

  return yield* exitedOk(hcCommand(args), r);
});

/** Runs `hc args`, asks for exit 0 and decodes its stdout as JSON with `schema` (pass "--json" in `args`). */
export const hcJson = <A, I>(schema: Codec<A, I>, what: string) => {
  const read = decodeJson(schema, what);

  return (args: readonly string[]): Effect.Effect<A, ExecError | ExitError | DecodeError, Hc> => Effect.flatMap(hcOk(args), read);
};

/** How an error names an `hc` run: `hc read`, `hc label`. */
const hcCommand = (args: readonly string[]): string => (args.length === 0 ? "hc" : `hc ${args[0]}`);

// ---- files

/** UTF-8 text files (`herdr` `readTextFile` / `writeTextFile`). */
export class Files extends Context.Service<Files, {
  /** The file's text, `Option.none()` when there is none. */
  readonly read: (path: string) => Effect.Effect<Option.Option<string>, FileError>;
  /**
   * Writes `text` only if the file still holds `expected` (`null`: only if
   * there is none yet); `StaleFile` when someone changed it since.
   */
  readonly write: (path: string, text: string, expected: string | null) => Effect.Effect<void, FileError | StaleFile>;
  /**
   * The names in folder `dir` (files and folders, no `.` or `..`), sorted;
   * `Option.none()` when there is no `dir`. A file at `dir`, or a path the
   * mod may not read, is a `FileError`.
   */
  readonly list: (dir: string) => Effect.Effect<Option.Option<readonly string[]>, FileError>;
}>()("@fireflies/kit/services/Files") {}

// ---- shared state

/** `shared()` keys, read and written through their schemas (schema.ts `sharedKey`). */
export class Shared extends Context.Service<Shared, {
  /** The key's value; `Option.none()` when absent or written in another shape. */
  readonly get: <A, I>(key: SharedKey<A, I>) => Effect.Effect<Option.Option<A>>;
  /** Sets the key's value (every mod redraws). */
  readonly set: <A, I>(key: SharedKey<A, I>, value: A) => Effect.Effect<void>;
}>()("@fireflies/kit/services/Shared") {}

/** The key's value, or `fallback`. */
export const sharedOr = <A, I>(key: SharedKey<A, I>, fallback: A) =>
  Effect.map(Shared.use((s) => s.get(key)), Option.getOrElse(() => fallback));

// ---- the app

/** A command's arguments (`run(name, args)`): a type-literal alias, as `run` takes. */
export type CommandArgs = { readonly [name: string]: string | number | boolean | null | undefined };

/** The app's commands, and this mod's own (`nextCommand`). */
export class Commands extends Context.Service<Commands, {
  /** Runs an app or mod command (`herdr` `run`). */
  readonly run: (name: string, args?: CommandArgs) => Effect.Effect<void>;
  /** The next key command for this mod ("usage.refresh"), waiting for it. */
  readonly next: Effect.Effect<string>;
}>()("@fireflies/kit/services/Commands") {}

/** What the window shows: read when asked, never kept (each read is the current state). */
export class Workspace extends Context.Service<Workspace, {
  readonly window: Effect.Effect<ReturnType<typeof appWindow>>;
  readonly spaces: Effect.Effect<ReturnType<typeof spaces>>;
  readonly panes: Effect.Effect<ReturnType<typeof panes>>;
  /** herdr-core's listing: decode the fields you read (it isn't typed). */
  readonly terminals: Effect.Effect<ReturnType<typeof terminals>>;
  readonly settings: Effect.Effect<Settings>;
  /** The agents in the window's terminals (`herdr` `agents`). */
  readonly agents: Effect.Effect<ReturnType<typeof agents>>;
  /** What has the keyboard: space, tab, pane, terminal and its folder (`herdr` `focused`); none before the window has a space. */
  readonly focused: Effect.Effect<Option.Option<NonNullable<ReturnType<typeof focused>>>>;
}>()("@fireflies/kit/services/Workspace") {}

/** Where something opened without a folder works: a folder and its machine (null: this one). */
export interface Here {
  readonly folder: Option.Option<string>;
  readonly on: string | null;
}

/** What `hereOf` reads: the window's spaces, panes and focus as herdr gives them. */
export interface Shown {
  readonly spaces: ReturnType<typeof spaces>;
  readonly panes: ReturnType<typeof panes>;
  readonly focused: ReturnType<typeof focused>;
}

/** A pane's live folder (a terminal's); none for a mod's pane. */
const cwdOf = (p: PaneInfo): Option.Option<string> => (p.terminal === null ? Option.none() : Option.fromNullOr(p.cwd));

/**
 * The folder for a pane opened without one (`mod.open`, `pane.split {mod}`):
 * the shown space's own folder (one chosen for it), else the focused
 * terminal's, else a terminal's in the shown tab, else the space's folder.
 * With no space yet: the focused folder, on this machine. For a render;
 * `here` is the same in an effect.
 */
export function hereOf(shown: Shown): Here {
  const space = Arr.findFirst(shown.spaces, (s) => s.active);
  const f = Option.fromNullOr(shown.focused);
  const focusedCwd = Option.flatMap(f, (x) => Option.fromNullOr(x.cwd));

  if (Option.isNone(space)) return { folder: Option.filter(focusedCwd, (c) => c !== ""), on: null };

  const { machine: on, attached, folder, tabs } = space.value;

  if (attached && folder !== "") return { folder: Option.some(folder), on };

  const tab = Option.map(Arr.findFirst(tabs, (c) => c.active), (c) => c.id);
  const inTab = Arr.filter(shown.panes, (p) => Option.contains(tab, p.tab));
  const focusedPane = Option.flatMap(f, (x) => Option.flatMap(Arr.findFirst(inTab, (p) => p.pane === x.pane), cwdOf));
  const candidates = [focusedPane, focusedCwd, ...Arr.map(inTab, cwdOf), Option.some(folder)];

  return { folder: Option.firstSomeOf(Arr.map(candidates, (c) => Option.filter(c, (path) => path !== ""))), on };
}

/** `hereOf` over the `Workspace`: the folder for a pane opened without one. */
export const here: Effect.Effect<Here, never, Workspace> = Effect.gen(function* () {
  const ws = yield* Workspace;

  const spaces = yield* ws.spaces;
  const panes = yield* ws.panes;
  const focused = yield* ws.focused;

  return hereOf({ spaces, panes, focused: Option.getOrNull(focused) });
});

/** A notification (the toast mod; the system's notification centre while the window is behind). */
export interface Note {
  readonly title: string;
  readonly body?: string;
  readonly level?: "info" | "success" | "warning" | "error";
}

export class Notify extends Context.Service<Notify, {
  readonly post: (note: Note) => Effect.Effect<void>;
}>()("@fireflies/kit/services/Notify") {}

/** Failures a live layer builds from a rejected promise. */
export const execError = (command: string) => (cause: unknown) => ExecError.make({ command, message: causeMessage(cause) });

export const fileError = (path: string) => (cause: unknown) => FileError.make({ path, message: causeMessage(cause) });

/**
 * `Exec` over a function shaped like herdr's `exec` (herdr's own: live.ts; a
 * caller's or a test's): a rejection is an `ExecError`. For a library whose
 * callers hand it `exec` (`Effect.provideService(effect, Exec, execService(exec))`).
 */
export const execService = (run: typeof herdrExec): Exec["Service"] => Exec.of({
  run: (command, args, options) => Effect.tryPromise({ try: () => run(command, [...args], options), catch: execError(command) }),
});

/** `Hc` over a function shaped like herdr's `hc` (see execService): a rejection is an `ExecError`. */
export const hcService = (run: typeof herdrHc): Hc["Service"] => Hc.of({
  run: (args) => Effect.tryPromise({ try: () => run([...args]), catch: execError(hcCommand(args)) }),
});

/** A folder's listing as `Files.list` needs it: whether `dir` is there, and its names (fs/promises `exists`, `readdir`). */
export interface Listing {
  readonly exists: (dir: string) => Promise<boolean>;
  readonly names: (dir: string) => Promise<readonly string[]>;
}

/** No listing: `Files.list` fails with a `FileError` saying so (for a library whose callers hand it only read and write). */
const NO_LISTING: Listing = {
  exists: () => Promise.reject(new Error("filesService: no listing given")),
  names: () => Promise.reject(new Error("filesService: no listing given")),
};

/** `Files` over functions shaped like herdr's `readTextFile` and `writeTextFile`, and a folder listing (see execService). */
export const filesService = (read: typeof herdrRead, write: typeof herdrWrite, listing: Listing = NO_LISTING): Files["Service"] => Files.of({
  read: (path) => Effect.map(Effect.tryPromise({ try: () => read(path), catch: fileError(path) }), Option.fromNullOr),
  write: (path, text, expected) => Effect.asVoid(Effect.tryPromise({ try: () => write(path, text, expected), catch: writeError(path) })),
  list: (dir) => Effect.tryPromise({
    try: () => listing.exists(dir).then((there) => (there ? listing.names(dir).then((names) => Option.some([...names].sort())) : Option.none<readonly string[]>())),
    catch: fileError(dir),
  }),
});

/** A write's rejection: the app refuses a stale snapshot with a message that says so. */
export const writeError = (path: string) => (cause: unknown) => {
  const message = causeMessage(cause);

  return /stale|changed|expected/i.test(message) ? StaleFile.make({ path, message }) : FileError.make({ path, message });
};
