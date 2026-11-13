// Mods Nocturne doesn't ship, in "+ new" and the palette: a mod installed in
// mods/ (an optional one, in its own repository) declares a `launcher` in its
// mod.json, and Nocturne lists it beside its own panels without knowing it by
// name:
//
//   "launcher": { "title": "Kubernetes", "icon": "icon.svg", "words": "k8s pods",
//                 "window": true, "pane": true }
//
//   title    the tile's and the palette's name
//   icon     an svg in the mod's folder (tinted as the tiles are), else a stock one
//   words    what the palette also finds it by
//   window   it opens as its mod.json overlay (`mod.open`): the tile's pick and
//            the palette's plain entry toggle it
//   pane     it opens as a normal pane (`pane.split {mod, props: {slot}}`) or a
//            tab of its own: "+ new" lands it by its landing switch, the
//            palette lists "… in a pane" and "… in a new tab"
//
// The list is read from mods/*/mod.json when Nocturne starts and each time
// "+ new" or the palette opens, and kept in shared `nocturne.launchers`.

// herdr as a namespace (as scratchpad.ts): the tests that stand in for it without its files
// calls still load Nocturne; a read that can't run leaves the list as it was.
import * as herdr from "herdr";
import { run, shared, setShared } from "herdr";
import * as fs from "fs/promises";
import { arrayOf, isBoolean, isString, object, parseJson, readShared, sharedKey, writeShared } from "./guard.ts";
import type { Guarded } from "./guard.ts";
import type { Panel } from "./panels.ts";

const isLauncher = object({ title: isString }, { icon: isString, words: isString, window: isBoolean, pane: isBoolean });

const isModJson = object({}, { launcher: isLauncher });

/** A launcher as Nocturne keeps it: the mod's folder name and what its mod.json says. */
const isKept = object({ mod: isString, title: isString }, { icon: isString, words: isString, window: isBoolean, pane: isBoolean });

export type Launcher = Guarded<typeof isKept>;

export const LAUNCHERS = sharedKey("nocturne.launchers", arrayOf(isKept));

/** The launchers last read. */
export function launchers(): readonly Launcher[] {
  return readShared(shared, LAUNCHERS, []);
}

/** A mod folder's name as Fireflies takes it (no hidden ones, no paths). */
const plainName = (n: string): boolean => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(n);

/** Reads every mod's mod.json for a launcher and keeps the list (written only when it changed). */
export async function readLaunchers(): Promise<void> {
  const dir = `${herdr.appHome()}/mods`;
  const names = await fs.readdir(dir).catch(() => []);
  const found: Launcher[] = [];

  for (const mod of names.filter(plainName).sort()) {
    const text = await herdr.readTextFile(`${dir}/${mod}/mod.json`).catch(() => null);
    const l = text ? parseJson(text, isModJson)?.launcher : undefined;

    if (!l || (!l.window && !l.pane)) continue;

    found.push({ ...l, mod });
  }

  if (JSON.stringify(found) !== JSON.stringify(launchers())) writeShared(setShared, LAUNCHERS, found);
}

/** A new pane's or tab's slot (the mod finds its own pane by it). */
const slot = (): string => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/** The launchers as panels (panels.ts lists them after Nocturne's own). */
export function launcherPanels(): Panel[] {
  return launchers().map((l): Panel => {
    const icon = l.icon && plainName(l.icon) ? `mods/${l.mod}/${l.icon}` : "layers";
    const inPane = () => run("pane.split", { direction: "auto", mod: l.mod, props: { slot: slot() } });
    const inTab = () => run("tab.new", { name: l.title.toLowerCase(), mod: l.mod, props: { slot: slot() } });
    const words = `${l.words ?? ""} ${l.mod}`.trim();

    const asWindow = () => run("mod.open", { name: l.mod });
    const id = `mod:${l.mod}`;

    // Both: a window over the tab (the tile's and the palette's plain pick), a pane or tab beside (as Git's).
    if (l.window && l.pane) return { id, name: l.title, icon, key: "", words, fixed: "float", pane: asWindow, beside: inPane, tab: inTab };

    // One of them: every pick opens it that way.
    return l.window ? { id, name: l.title, icon, key: "", words, pane: asWindow, tab: asWindow } : { id, name: l.title, icon, key: "", words, pane: inPane, tab: inTab };
  });
}
