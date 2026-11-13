// The scripts the runner finds: looking in the folder (detect.ts), merging
// what's found with what was, a flake's apps (nix eval, kept a while), the
// recent runs, running one again.

import type { AsyncContext } from "gpui-kit";
import { exec, notify, shared, setShared } from "herdr";
import { parseJson, readSharedMap, writeSharedMap } from "./guard.ts";
import { isRecord } from "./guards.ts";
import type { Script } from "./detect.ts";
import { PROBE, parseProbe, detect } from "./detect.ts";
import { FLAKE_SHOW, nixScripts, oldId } from "./nix.ts";
import { start } from "./runs.ts";
import { FOUND, short, FLAKE, FLAKE_FRESH, RECENT } from "./state.ts";
import type { default as ScriptsDeck } from "./main.ts";

/** Reads the folder's manifests (one probe) and keeps what it found. */
export function lookForScripts(v: ScriptsDeck, cx: AsyncContext) {
  const folder = v.folder;

  if (!folder) {
    v.looking = false;

    return;
  }

  cx.spawn(async (cx) => {
    try {
      const r = await exec("sh", ["-c", PROBE], { cwd: folder, on: v.on, timeout: 15000 });
      const probe = parseProbe(r.stdout);

      v.sys = probe.sys;
      v.base = detect(probe);
      v.failed = null;
      mergeFound(v);

      if (probe.ls.has("flake.nix")) evalFlake(v, cx, folder);

      runAgain(v);
    } catch (cause: unknown) {
      v.failed = cause instanceof Error ? cause.message : String(cause);
    }

    v.looking = false;
    cx.notify();
  });
}

/** nocturne.scripts-again: the last script picked here, picked again. */
export function runAgain(v: ScriptsDeck) {
  if (!v.again) return;

  v.again = false;

  const last = recent(v)[0];
  const s = v.scripts?.find((x) => x.id === last);

  if (s) goTo(v, s, false);
  else notify({ title: "nothing to run again", body: `no script picked in ${short(v.folder)} yet`, level: "info" });
}

/** The folder's scripts and its flake's (the last evaluation), each group
 *  together in the order it first shows up; kept for the next open. */
export function mergeFound(v: ScriptsDeck) {
  const show = readSharedMap(shared, FLAKE).get(v.key)?.show;
  const all = [...(v.base ?? []), ...(show ? nixScripts(show, v.sys) : [])];
  // A group holding this machine's own configuration leads.
  const groups = [...new Set(all.map((s) => s.group))];
  const mine = new Set(all.flatMap((s) => (s.here ? [s.group] : [])));
  const order = [...groups.filter((g) => mine.has(g)), ...groups.filter((g) => !mine.has(g))];
  const scripts = order.flatMap((g) => all.filter((s) => s.group === g));
  const found = new Map(readSharedMap(shared, FOUND));

  v.scripts = scripts;
  found.delete(v.key);
  // The last dozen folders, the newest last.
  writeSharedMap(setShared, FOUND, new Map([...[...found].slice(-11), [v.key, scripts]]));
}

/** `nix flake show` in the background: the picker shows the last result
 *  meanwhile, and keeps it when nix is missing or the evaluation fails. */
export function evalFlake(v: ScriptsDeck, cx: AsyncContext, folder: string) {
  const last = readSharedMap(shared, FLAKE).get(v.key);

  if (last && Date.now() - (last.at ?? 0) < FLAKE_FRESH) return;

  v.nix = "evaluating";
  cx.spawn(async (cx) => {
    try {
      const r = await exec("nix", FLAKE_SHOW, { cwd: folder, on: v.on, timeout: 180000 });
      const show = r.code === 0 ? parseJson(r.stdout, isRecord) : undefined;

      if (show) {
        const all = new Map(readSharedMap(shared, FLAKE));

        all.delete(v.key);
        writeSharedMap(setShared, FLAKE, new Map([...[...all].slice(-11), [v.key, { at: Date.now(), show }]]));
        v.nix = null;
        mergeFound(v);
      } else v.nix = "failed";
    } catch {
      v.nix = "missing";
    }

    cx.notify();
  });
}

export function recent(v: ScriptsDeck) {
  return (readSharedMap(shared, RECENT).get(v.key) ?? []).map(oldId);
}

/** Runs a script in the background; `look`: float its terminal too. The
 *  strip does the starting (runs.ts start queues it), so the deck can close
 *  at once without taking the start with it. */
export function goTo(v: ScriptsDeck, s: Script, look: boolean) {
  const ids = [s.id, ...recent(v).filter((x) => x !== s.id)].slice(0, 20);

  writeSharedMap(setShared, RECENT, new Map([...readSharedMap(shared, RECENT), [v.key, ids]]));
  start(s, v.folder, v.on, look);
  v.dismissDeck();
}
