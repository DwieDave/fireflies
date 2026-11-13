// The window mods in normal panes (docs/mods-in-panes.md): git, GitHub and
// the script runner open as a pane beside the focused one, a tab of their
// own, or their window, by one command form for all:
//
//   nocturne.<mod>                       the window, toggled (as before)
//   nocturne.<mod>:pane | :tab | :window
//   nocturne.<mod>:{"as": "pane" | "tab" | "window", "folder"?, "on"?}
//
// (<mod>: git (lazygit too), github, scripts, databases.) "+ new"'s tiles and the
// palette's "… in a pane" run the same. A pane or tab gets props
// { slot, folder, on? }: slot is unique (the pane finds itself and keeps
// what it shows), folder the one a window would show now, fixed for the pane.

import { run } from "herdr";
import { isString, literal, nullable, object, parseJson } from "./guard.ts";
import type { Guarded } from "./guard.ts";
import { here } from "./panels.ts";
import { gitOpen, toggleGit } from "./git.ts";
import { githubOpen, toggleGithub } from "./github.ts";
import { deckOpen, toggleDeck } from "./scripts.ts";
import { connectArgsOf, connectDatabases, databasesOpen, openDatabases, toggleDatabases } from "./databases.ts";
import type { ConnectArgs } from "./databases.ts";

/** The mods that open in panes this way. */
export type PaneMod = "git" | "github" | "scripts" | "databases";

/** Where one opens. */
export type As = "pane" | "tab" | "window";

const isAs = literal("pane", "tab", "window");

/** A command's value: where, and optionally which folder on which machine. */
const isAsk = object({ as: isAs }, { folder: nullable(isString), on: nullable(isString) });

export type Ask = Guarded<typeof isAsk>;

/** What each mod's tab is called. */
const TAB_NAME = { git: "git", github: "github", scripts: "scripts", databases: "databases" } as const satisfies { readonly [M in PaneMod]: string };

/** The command names that reach each mod (nocturne.lazygit is git's old name). */
const NAMES: ReadonlyMap<string, PaneMod> = new Map([["git", "git"], ["lazygit", "git"], ["github", "github"], ["scripts", "scripts"], ["databases", "databases"]]);

/** A new pane's slot. */
export const newSlot = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/** `pane`, `tab`, `window`, or JSON `{as, folder?, on?}`; null for anything else. */
export function parseAsk(value: string): Ask | null {
  const v = value.trim();

  if (isAs(v)) return { as: v };

  return v.startsWith("{") ? parseJson(v, isAsk) ?? null : null;
}

/** The props a pane or tab of `mod` opens with (databases: a connection sent to it, too). */
function paneProps(ask: Ask, connect: Omit<ConnectArgs, "as"> | null = null) {
  const h = here();
  // A space attached to a folder shows that repo; otherwise the focused pane's (the windows' rule).
  const folder = ask.folder ?? ((h.space?.attached && h.space.folder) || h.folder);
  const on = ask.on === undefined ? h.on : ask.on;
  const base = { slot: newSlot(), folder };
  const placed = on ? { ...base, on } : base;

  return connect ? { ...placed, connect } : placed;
}

/** The window, opened (an open one stays). */
function openWindow(mod: PaneMod): void {
  if (mod === "git" && !gitOpen()) toggleGit();
  else if (mod === "github" && !githubOpen()) toggleGithub();
  else if (mod === "scripts" && !deckOpen()) toggleDeck({ centered: true });
  else if (mod === "databases" && !databasesOpen()) openDatabases();
}

/** Opens `mod` where `ask` says: beside the focused pane, in a tab of the shown space, or its window. */
export function openAs(mod: PaneMod, ask: Ask, connect: Omit<ConnectArgs, "as"> | null = null): void {
  if (ask.as === "window") return openWindow(mod);

  const props = paneProps(ask, connect);
  const h = here();

  if (ask.as === "tab") run("tab.new", h.space ? { space: h.space.id, name: TAB_NAME[mod], mod, props } : { name: TAB_NAME[mod], mod, props });
  else run("pane.split", h.pane ? { direction: "auto", pane: h.pane, mod, props } : { direction: "auto", mod, props });
}

/** A command `<name>:<value>` for one of these mods (the sky's loop): opened, true; else false. */
export function openAsCommand(command: string): boolean {
  const at = command.indexOf(":");

  if (at < 0) return false;

  const mod = NAMES.get(command.slice(0, at));
  const ask = mod ? parseAsk(command.slice(at + 1)) : null;

  if (!mod || !ask) return false;

  openAs(mod, ask);

  return true;
}

/** nocturne.databases (the window, toggled) and nocturne.databases:{"kind", …} (a connection another
 *  mod sends: the window, or where its "as" says); the rest (:pane, :tab, {as}) is openAsCommand's. */
export function databasesCommand(command: string): boolean {
  if (command === "databases") {
    toggleDatabases();

    return true;
  }

  if (!command.startsWith("databases:")) return false;

  const args = connectArgsOf(command.slice("databases:".length));

  if (!args) return false;

  const { as, ...connect } = args;

  if (as === "pane" || as === "tab") openAs("databases", { as }, connect);
  else connectDatabases(args);

  return true;
}
