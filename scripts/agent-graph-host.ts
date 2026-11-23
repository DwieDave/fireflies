// The agent graph's tests, in one place:
// - its services from @fireflies/kit/testing: sh from a handler the test
//   gives (or a real shell over a scratch ~/.claude: `shellExec`), hc sends
//   recorded, the workflow scripts from a Map, shared state in a Map, the
//   spaces, panes, terminals and focus a test sets;
// - a copy's handle on them (`testFx`), as `fx.ts` attach gives a view;
// - the one stand-in for herdr, for what the views still read from the app
//   directly in a render or a key (theme, props, settings, layout, shared
//   state, the shown space's panes): plain values the test sets, no app
//   calls that wait.

import { spawnSync } from "node:child_process";
import { Effect, Layer } from "effect";
import type { Schema } from "effect";
import { Redraw } from "@fireflies/kit";
import type { ViewFx } from "@fireflies/kit";
import { commandsTest, execTest, filesTest, hcTest, sharedTest, workspaceTest } from "@fireflies/kit/testing";

interface Result {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** What the herdr stand-in answers, each field read when a view asks: a test sets the ones it needs. */
export interface Host {
  shared: Record<string, unknown>;
  props: unknown;
  theme: unknown;
  settings: Record<string, unknown>;
  layout: unknown;
  layoutName: string | null;
  platform: string;
  spaces: unknown[];
  panes: unknown[];
  terminals: unknown[];
  focused: unknown;
  /** Every run(name, args). */
  readonly commands: [string, unknown][];
}

/** A host with nothing in it, on Nocturne's look, zoom 1. */
export const newHost = (theme: unknown): Host => ({
  shared: {}, props: null, theme, settings: { zoom: 1, ui_font_family: "Departure Mono" },
  layout: { scrim: { dither: true }, corners: "square" }, layoutName: "nocturne", platform: "macos",
  spaces: [], panes: [], terminals: [], focused: null, commands: [],
});

/** The herdr stand-in over `host` (mock.module("herdr", () => agentsHerdr(host))). */
export function agentsHerdr(host: Host): Record<string, (...a: any[]) => unknown> {
  return {
    theme: () => host.theme,
    props: () => host.props,
    settings: () => host.settings,
    layout: () => host.layout,
    window: () => ({ platform: host.platform }),
    shared: (k: string) => (k === "layout" ? host.layoutName : host.shared[k] ?? null),
    setShared: (k: string, v: unknown) => { host.shared[k] = v; return null; },
    spaces: () => host.spaces, panes: () => host.panes, terminals: () => host.terminals, focused: () => host.focused,
    run: (name: string, args: unknown) => { host.commands.push([name, args]); return null; },
    keys: () => [], notify: () => null, agents: () => [],
  };
}

/** What the mod's services answer in a test; each field read when the code asks. */
export interface World {
  /** `sh …` (the snapshot, a feed, the tokens, a session file): none answers exit 1. */
  exec?: (command: string, args: readonly string[]) => Result;
  /** `hc args` (an ask): none answers exit 0. */
  hc?: (args: readonly string[]) => Result;
  /** Files the mod reads (the workflow scripts), by path. */
  files?: Map<string, string>;
}

const NONE: Result = { code: 1, stdout: "", stderr: "" };

/** The mod's services for a test over `world` and `host` (the spaces, panes, terminals and focus it shows),
 *  with the calls each recorded and the shared store. */
export function agentsServices(world: World, host: Host, store = new Map<string, Schema.Json>()) {
  const exec = execTest((command, args) => world.exec?.(command, args) ?? NONE);
  const hc = hcTest((args) => world.hc?.(args) ?? { code: 0, stdout: "", stderr: "" });
  const shared = sharedTest(store);
  const commands = commandsTest();
  const workspace = workspaceTest({
    spaces: () => host.spaces as any, panes: () => host.panes as any, terminals: () => host.terminals, focused: () => host.focused as any,
  }).layer;
  const redraws = { n: 0 };
  const redraw = Layer.succeed(Redraw, Redraw.of({ now: Effect.sync(() => { redraws.n += 1; }) }));
  const layer = Layer.mergeAll(exec.layer, hc.layer, shared.layer, workspace, commands.layer, filesTest(world.files ?? new Map()).layer, redraw);

  return { layer, exec, hc, shared, commands, redraws };
}

/** A copy's handle on `layer` (what fx.ts attach gives a view): its runs forked there, `now` run at once. */
export function testFx<R>(layer: Layer.Layer<R>): ViewFx<any> {
  return {
    run: (effect) => { Effect.runFork(Effect.provide(effect as Effect.Effect<unknown, unknown, R>, layer)); },
    now: (effect) => Effect.runSync(Effect.provide(effect as Effect.Effect<any, never, R>, layer)),
    close: () => Effect.runPromise(Effect.void),
    running: () => 0,
  };
}

/** A program run for real (a local shell), with `env`. */
export const shellExec = (env: () => Record<string, string | undefined>) => (command: string, args: readonly string[]): Result => {
  const r = spawnSync(command, [...args], { env: env(), encoding: "utf8" });

  return { code: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
};

/** Runs `effect` on `layer`, for a test to return (bun waits for it). */
export const runOn = <A, E, R>(layer: Layer.Layer<R>, effect: Effect.Effect<A, E, R>): Promise<A> => Effect.runPromise(Effect.provide(effect, layer));
