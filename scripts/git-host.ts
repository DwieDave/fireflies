// The git window's tests, in one place:
// - its services from @fireflies/kit/testing (git runs for real through
//   execTest, settings.json from filesTest, commands that never come from
//   commandsTest, a folder that never changes), given to the mod with
//   useServices (git/fx.ts);
// - the one stand-in for herdr, for what the view still reads from the app
//   directly in a render or a key (theme, settings, layout, shared state,
//   props, spaces, panes, focus, agents, run, overlays, highlight): plain
//   values the test sets, no app calls that wait;
// - a stand-in for gpui's AsyncContext (the kit's testing layers give
//   services, not a view's context) whose timers run on a clock the test
//   moves, never the wall clock;
// - how a test waits for the view's work: its two lanes drained.

import { spawnSync } from "node:child_process";
import { Effect, Layer } from "effect";
import { commandsTest, execTest, filesTest, workspaceTest } from "@fireflies/kit/testing";
import type { Lane } from "../defaults/mods/git/queue.ts";
import type { FolderWatch } from "../defaults/mods/git/watch.ts";

/** What the herdr stand-in answers, each field read when the view asks: a test sets the ones it needs. */
export interface Host {
  shared: Record<string, unknown>;
  props: unknown;
  spaces: unknown[];
  panes: unknown[];
  focused: unknown;
  agents: unknown[];
  home: string;
  zoom: number;
  platform: string;
  /** The shown layout (null: none, nocturne's look by default) and its name (shared("layout")). */
  layout: unknown;
  layoutName: string | null;
  /** herdr.highlight's answer (null: none, plain text). */
  highlight: ((text: string, path: string) => [number, number, string][]) | null;
  /** Every run(name, args), overlay opened and closed. */
  readonly commands: [string, any][];
  readonly opened: any[];
  readonly closed: string[];
  /** How often the view asked each herdr function (git-large counts a draw's). */
  readonly calls: Record<string, number>;
}

/** The herdr stand-in over `host` (mock.module("herdr", () => gitHerdr(host, theme))). */
export function gitHerdr(host: Host, theme: unknown): Record<string, (...a: any[]) => unknown> {
  const fns: Record<string, (...a: any[]) => unknown> = {
    settings: () => ({ zoom: host.zoom, font_family: "Mono", ui_font_family: "Departure Mono" }),
    window: () => ({ platform: host.platform }),
    theme: () => theme,
    layout: () => host.layout,
    shared: (k: string) => (k === "layout" && host.layoutName !== null ? host.layoutName : host.shared[k] ?? null),
    setShared: (k: string, v: unknown) => { host.shared[k] = v; },
    props: () => host.props,
    spaces: () => host.spaces, panes: () => host.panes, focused: () => host.focused, agents: () => host.agents,
    home: () => host.home, appHome: () => "/app-home",
    run: (name: string, args: unknown) => { host.commands.push([name, args]); return null; },
    openOverlay: (spec: unknown) => { host.opened.push(spec); return `o${host.opened.length}`; },
    closeOverlay: (id: string) => { host.closed.push(id); },
    notify: () => {},
    highlight: (text: string, path: string) => (host.highlight === null ? [] : host.highlight(text, path)),
  };

  return Object.fromEntries(Object.entries(fns).map(([k, f]) => [k, (...a: any[]) => { host.calls[k] = (host.calls[k] ?? 0) + 1; return f(...a); }]));
}

/** A host with nothing in it: no spaces, no panes, at home in /home/u, zoom 1. */
export const newHost = (): Host => ({
  shared: {}, props: null, spaces: [], panes: [], focused: null, agents: [], home: "/home/u", zoom: 1, platform: "linux",
  layout: null, layoutName: null, highlight: null, commands: [], opened: [], closed: [], calls: {},
});

/** The window's services for a test: git (and sh) run for real with `env`, files from `files` (settings.json and the like),
 *  `watch` the folder watch (watch.ts FolderWatchStill: imported after the herdr stand-in, as it reads herdr). */
export function gitServices(env: Record<string, string | undefined>, watch: Layer.Layer<FolderWatch>, files = new Map<string, string>()) {
  const exec = execTest((command, args, options) => {
    const r = spawnSync(command, [...args], { cwd: options?.cwd, env, encoding: "utf8" });

    return { code: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  });

  const layer = Layer.mergeAll(exec.layer, commandsTest().layer, filesTest(files).layer, workspaceTest().layer, watch);

  return { layer, exec, files };
}

interface Timer {
  readonly at: number;
  readonly fire: (cx: unknown) => void;
  live: boolean;
}

/** A view's context, and `advance(ms)`: moves its clock, firing every timer due by then. */
export function hostContext(extra: Record<string, unknown> = {}) {
  let now = 0;
  const timers: Timer[] = [];
  const cx: any = {
    notify() {}, stop_propagation() {}, focus_handle: () => ({ focus() {} }),
    write_to_clipboard(t: string) { cx.clip = t; },
    timer: {
      every() {},
      after(ms: number, fire: (cx: unknown) => void) {
        const t: Timer = { at: now + ms, fire, live: true };

        timers.push(t);

        return { cancel() { t.live = false; } };
      },
    },
    ...extra,
  };

  /** The earliest live timer due by now. */
  const due = (): Timer | undefined => timers.filter((t) => t.live && t.at <= now).sort((a, b) => a.at - b.at)[0];

  const advance = (ms: number): Effect.Effect<void> => Effect.gen(function* () {
    now += ms;

    for (let t = due(); t !== undefined; t = due()) {
      t.live = false;
      t.fire(cx);
      // The fiber that slept wakes on its own turn.
      yield* Effect.yieldNow;
    }
  });

  return { cx, advance };
}

/** Until neither lane has a job waiting or running (a job may queue another: a read's loadMain). */
export const drained = (v: { readonly acts: Lane; readonly reads: Lane }): Effect.Effect<void> => Effect.gen(function* () {
  yield* Effect.yieldNow;

  while (v.acts.pending > 0 || v.reads.pending > 0) {
    yield* v.acts.serial(Effect.void);
    yield* v.reads.serial(Effect.void);
    yield* Effect.yieldNow;
  }
});
