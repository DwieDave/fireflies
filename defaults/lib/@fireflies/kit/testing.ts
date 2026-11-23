// Test layers for the kit's services: in memory, recording what was asked.
// A bun test builds the mod's runtime (or provides an effect) with these
// instead of live.ts's, so it mocks no module: the code under test asks
// for `Exec`, `Shared`, … and gets these.
//
//   const shared = sharedTest();
//   const exec = execTest((command, args) => ({ code: 0, stdout: "…", stderr: "" }));
//   await Effect.runPromise(refreshUsage("force").pipe(Effect.provide(Layer.mergeAll(shared.layer, exec.layer, …))));
//   expect(shared.store.get("usage.last")).toEqual(…);

import { Array as Arr, Effect, Layer, Option, Order, Schema, String as Str } from "effect";
import { HttpClient } from "effect/http";
import type { ExecResult, Settings, agents, focused, panes, spaces, window as appWindow } from "herdr";
import { fetchClient } from "./http.ts";
import type { Fetch } from "./http.ts";
import { Commands, Exec, Files, Hc, Notify, Shared, Workspace, execError, fileError, writeError } from "./services.ts";
import type { CommandArgs, ExecOptions, Note } from "./services.ts";

/** One program the code ran. */
export interface ExecCall {
  readonly command: string;
  readonly args: readonly string[];
  readonly options: ExecOptions | undefined;
}

/** Exec answering with `handler` (a thrown error or a rejection is an `ExecError`); `calls` records each run. */
export function execTest(handler: (command: string, args: readonly string[], options: ExecOptions | undefined) => ExecResult | Promise<ExecResult>) {
  const calls: ExecCall[] = [];

  const layer = Layer.succeed(Exec, Exec.of({
    run: (command, args, options) => Effect.tryPromise({
      try: () => {
        calls.push({ command, args, options });

        return Promise.resolve().then(() => handler(command, args, options));
      },
      catch: execError(command),
    }),
  }));

  return { layer, calls };
}

/** Hc answering with `handler` (a thrown error or a rejection is an `ExecError`); `calls` records each run's args. */
export function hcTest(handler: (args: readonly string[]) => ExecResult | Promise<ExecResult>) {
  const calls: (readonly string[])[] = [];

  const layer = Layer.succeed(Hc, Hc.of({
    run: (args) => Effect.tryPromise({
      try: () => {
        calls.push(args);

        return Promise.resolve().then(() => handler(args));
      },
      catch: execError(args.length === 0 ? "hc" : `hc ${args[0]}`),
    }),
  }));

  return { layer, calls };
}

/** Shared state in a Map of JSON values, as shared.json holds them. */
export function sharedTest(store = new Map<string, Schema.Json>()) {
  // What setShared keeps is JSON: the encoded value, proven to be JSON (as the
  // app's, a value its schema can't encode isn't written).
  const toJson = Schema.decodeUnknownOption(Schema.Json);

  const layer = Layer.succeed(Shared, Shared.of({
    get: (key) => Effect.sync(() => Schema.decodeUnknownOption(key.schema)(store.get(key.name))),
    set: (key, value) => Effect.sync(() => {
      Option.map(Option.flatMap(Schema.encodeOption(key.schema)(value), toJson), (json) => store.set(key.name, json));
    }),
  }));

  return { layer, store };
}

/** The names directly in folder `dir` among `paths` (each path's next segment), sorted; none when nothing is under it. */
const namesIn = (paths: Iterable<string>, dir: string): Option.Option<readonly string[]> => {
  const prefix = Str.endsWith("/")(dir) ? dir : `${dir}/`;
  const names = new Set<string>();

  for (const path of paths) {
    if (Str.startsWith(prefix)(path) && path.length > prefix.length) names.add(Arr.headNonEmpty(Str.split("/")(Str.slice(prefix.length)(path))));
  }

  return names.size === 0 ? Option.none() : Option.some(Arr.sort([...names], Order.String));
};

/**
 * Files in a Map by path; `write` honors `expected` as the app does. `list`
 * answers from the paths (a folder is there when a file is under it, or
 * when it is in `folders`); listing a file's path is a `FileError`.
 */
export function filesTest(files = new Map<string, string>(), folders: ReadonlySet<string> = new Set()) {
  const layer = Layer.succeed(Files, Files.of({
    list: (dir) => Effect.suspend(() => {
      if (files.has(dir)) return Effect.fail(fileError(dir)(new Error("not a directory")));

      const listed = namesIn([...files.keys(), ...folders], dir);

      return Effect.succeed(Option.isNone(listed) && folders.has(dir) ? Option.some([]) : listed);
    }),
    read: (path) => Effect.sync(() => Option.fromUndefinedOr(files.get(path))),
    write: (path, text, expected) => Effect.suspend(() => {
      if ((files.get(path) ?? null) !== expected) return Effect.fail(writeError(path)(new Error("stale: the file changed since it was read")));

      files.set(path, text);

      return Effect.void;
    }),
  }));

  return { layer, files };
}

/** What a test's window shows; each field read when the code asks. */
export interface Look {
  window?: () => ReturnType<typeof appWindow>;
  spaces?: () => ReturnType<typeof spaces>;
  panes?: () => ReturnType<typeof panes>;
  terminals?: () => readonly unknown[];
  settings?: () => Settings;
  agents?: () => ReturnType<typeof agents>;
  focused?: () => ReturnType<typeof focused>;
}

const WINDOW: ReturnType<typeof appWindow> = { platform: "macos", titlebar: "none", buttons: false, maximized: false, fullscreen: false, active: true };

export function workspaceTest(look: Look = {}) {
  const layer = Layer.succeed(Workspace, Workspace.of({
    window: Effect.sync(() => look.window?.() ?? WINDOW),
    spaces: Effect.sync(() => look.spaces?.() ?? []),
    panes: Effect.sync(() => look.panes?.() ?? []),
    terminals: Effect.sync(() => look.terminals?.() ?? []),
    settings: Effect.suspend(() => {
      const settings = look.settings;

      return settings === undefined ? Effect.die(new Error("workspaceTest: no settings given")) : Effect.sync(settings);
    }),
    agents: Effect.sync(() => look.agents?.() ?? []),
    focused: Effect.sync(() => Option.fromNullOr(look.focused?.() ?? null)),
  }));

  return { layer, look };
}

/** Commands recorded; `next` answers from `queue` (waits forever once it's empty). */
export function commandsTest(queue: string[] = []) {
  const ran: { readonly name: string; readonly args: CommandArgs | undefined }[] = [];

  const layer = Layer.succeed(Commands, Commands.of({
    run: (name, args) => Effect.sync(() => { ran.push({ name, args }); }),
    next: Effect.suspend(() => {
      const c = queue.shift();

      return c === undefined ? Effect.never : Effect.succeed(c);
    }),
  }));

  return { layer, ran, queue };
}

export function notifyTest() {
  const posted: Note[] = [];
  const layer = Layer.succeed(Notify, Notify.of({ post: (note) => Effect.sync(() => { posted.push(note); }) }));

  return { layer, posted };
}

/** An answer of the fake server. */
export interface FakeAnswer {
  readonly status: number;
  readonly body?: string;
  readonly headers?: readonly (readonly [string, string])[];
}

/** One request the fake server got. */
export interface FakeRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | undefined;
}

/**
 * Effect's HttpClient answering from `answer` (a thrown error is a
 * transport failure); `requests` records each one. No socket, no server.
 */
export function httpTest(answer: (request: FakeRequest) => FakeAnswer | Promise<FakeAnswer>) {
  const requests: FakeRequest[] = [];

  const fetch: Fetch = (url, init) => {
    const body = init.body;
    const request: FakeRequest = { method: init.method, url, headers: init.headers, body: body === undefined ? undefined : String(body) };

    requests.push(request);

    return Promise.resolve(request).then(answer).then((a) => ({ status: a.status, url, headers: a.headers ?? [], text: () => Promise.resolve(a.body ?? "") }));
  };

  return { layer: Layer.succeed(HttpClient.HttpClient, fetchClient(fetch)), requests };
}
