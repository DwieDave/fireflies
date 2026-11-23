// The notifications mod's tests, in one place:
// - its services from @fireflies/kit/testing: hc and sh from handlers the
//   test gives (or a real shell: `shellExec`), shared state in a Map, the
//   terminals and agents a test sets;
// - the one stand-in for herdr, for what the views still read from the app
//   directly in a render or a key (theme, props, settings, layout, shared
//   state, overlays, run): plain values the test sets, no app calls that wait.

import { spawnSync } from "node:child_process";
import { Effect, Layer } from "effect";
import type { Schema } from "effect";
import { commandsTest, execTest, filesTest, hcTest, notifyTest, sharedTest, workspaceTest } from "@fireflies/kit/testing";

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
  /** Every overlay opened, closed, and run(name, args). */
  readonly opened: any[];
  readonly closed: string[];
  readonly commands: [string, unknown][];
}

/** A host with nothing in it, on Nocturne's look, zoom 0.9. */
export const newHost = (theme: unknown): Host => ({
  shared: {}, props: null, theme, settings: { zoom: 0.9, ui_font_family: "Departure Mono" },
  layout: { scrim: { dither: true }, corners: "square" }, layoutName: "nocturne", platform: "macos",
  opened: [], closed: [], commands: [],
});

/** The herdr stand-in over `host` (mock.module("herdr", () => notificationsHerdr(host))). */
export function notificationsHerdr(host: Host): Record<string, (...a: any[]) => unknown> {
  return {
    theme: () => host.theme,
    props: () => host.props,
    settings: () => host.settings,
    layout: () => host.layout,
    window: () => ({ platform: host.platform }),
    shared: (k: string) => (k === "layout" ? host.layoutName : host.shared[k] ?? null),
    setShared: (k: string, v: unknown) => { host.shared[k] = v; return null; },
    openOverlay: (spec: unknown) => { host.opened.push(spec); return `o${host.opened.length + 8}`; },
    closeOverlay: (id: string) => { host.closed.push(id); return null; },
    run: (name: string, args: unknown) => { host.commands.push([name, args]); return null; },
    keys: () => [], notify: () => null, terminals: () => [], agents: () => [],
  };
}

/** What the mod's services answer in a test; each field read when the code asks. */
export interface World {
  /** `hc args` (read, keys, send): none answers exit 1. */
  hc?: (args: readonly string[]) => Result;
  /** A program on a machine (the hook records' sh): none answers exit 1. */
  exec?: (command: string, args: readonly string[], on: string | null) => Result;
  terminals?: () => readonly unknown[];
  agents?: () => readonly unknown[];
}

const NONE: Result = { code: 1, stdout: "", stderr: "" };

/** The mod's services for a test over `world`, with the calls each recorded and the shared store. */
export function notificationsServices(world: World, store = new Map<string, Schema.Json>()) {
  const hc = hcTest((args) => world.hc?.(args) ?? NONE);
  const exec = execTest((command, args, options) => world.exec?.(command, args, options?.on ?? null) ?? NONE);
  const shared = sharedTest(store);
  const look = { terminals: () => world.terminals?.() ?? [], agents: () => (world.agents?.() ?? []) as any };
  const layer = Layer.mergeAll(hc.layer, exec.layer, shared.layer, workspaceTest(look).layer, commandsTest().layer, filesTest().layer, notifyTest().layer);

  return { layer, hc, exec, shared };
}

/** A program run for real (a local shell), with `env`. */
export const shellExec = (env: () => Record<string, string | undefined>) => (command: string, args: readonly string[]): Result => {
  const r = spawnSync(command, [...args], { env: env(), encoding: "utf8" });

  return { code: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
};

/** Runs `effect` on `layer`, for a test to return (bun waits for it). */
export const runOn = <A, E, R>(layer: Layer.Layer<R>, effect: Effect.Effect<A, E, R>): Promise<A> => Effect.runPromise(Effect.provide(effect, layer));
