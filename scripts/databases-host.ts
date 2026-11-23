// The Databases window's tests, in one place (docs/effect-mods.md):
// - its services for a test that runs the mod's effects for real: programs
//   spawned (sqlite3, sh, a fake client), files on disk, herdr-core, shared
//   state, commands and the workspace from @fireflies/kit/testing;
// - `runReal`: an effect of the mod run on them, as a promise for bun's test.
// No promise is made here: a program's run is an Effect.callback over
// node's child_process, a file a synchronous fs call.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Effect, Layer, ManagedRuntime, Option } from "effect";
import type { ExecResult } from "herdr";
import { Exec, ExecError, FileError, Files, Redraw, StaleFile } from "@fireflies/kit";
import { commandsTest, hcTest, sharedTest, workspaceTest } from "@fireflies/kit/testing";

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
export const viewRun = (rt: { readonly runtime: ManagedRuntime.ManagedRuntime<any, never> }) =>
  <A, E>(effect: Effect.Effect<A, E, any>): Promise<A> => rt.runtime.runPromise(Effect.provideService(effect, Redraw, Redraw.of({ now: Effect.void })));
