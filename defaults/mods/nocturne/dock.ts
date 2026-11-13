// The dock: one space of this app's own, tied to no folder, for panes that
// belong to no project (a web page you keep open, a docs pane, a shell in ~).
// Its panes are pinned to the jar's shelf (pins.ts), so a tile goes to them
// from any space.
//   made     on first use (the pane menu's "Dock", "New web pane in the dock"
//            from the palette or the shelf's + tile), with
//            space.new {name: "dock", folder: ~}: its terminals start in ~,
//            and kit.ts spaceFolder answers null for it, so the git and GitHub
//            windows never see a repo there, wherever its shells cd to
//   kept     its id in shared DOCK_KEY; the core keeps the space across restarts.
//            Closed (`herdr-app do space.close`), the next use makes a new one.
//   guarded  its menu has no Change folder, New worktree or Delete, and the
//            sidebar's f / w / d skip it (spaces.ts)
// Space ids come back from space.new only through spaces(): the record holds
// { making: { at, before, next } } until the sky sees a new space named
// "dock" that wasn't there before (adopt()), then { id }; `next` is what to
// do once it's there (move a pane in, open a web page).
import { spaces, run, shared, setShared, home } from "herdr";
import type { SpaceInfo } from "herdr";
import { arrayOf, isNumber, isString, literal, nullable, object, oneOf, readShared, sharedKey, writeShared } from "./guard.ts";
import type { Guarded } from "./guard.ts";

/** What to do in the dock once it's there: move a pane in, or open a web page there. */
const isDockThen = oneOf(object({ kind: literal("move"), pane: isString }), object({ kind: literal("web") }, { slot: isString, url: isString }));

export type DockThen = Guarded<typeof isDockThen>;

/** The dock's record: { id } once made; { making: { at, before: [ids], next } } while it's made
 *  (next: what to do there once it's made; not `then`, which would make the record a thenable). */
const isDockRecord = object({}, { id: nullable(isString), making: object({}, { at: isNumber, before: arrayOf(isString), next: nullable(isDockThen) }) });

export type DockRecord = Guarded<typeof isDockRecord>;

/** shared() key: the dock's record (DockRecord). */
export const DOCK_KEY = "nocturne.dock-space";
const DOCK = sharedKey(DOCK_KEY, nullable(isDockRecord));

export const DOCK_NAME = "dock";

/** How long a making waits for its space before it's given up (ms). */
export const MAKING = 10000;

/** The dock's record now, or null. */
const record = (): DockRecord | null => readShared(shared, DOCK, null);

/** The dock's id from a record (DOCK_KEY), or null. */
export const recordId = (rec: DockRecord | null): string | null => rec?.id || null;

/** The space a space list's entry needs to be for the dock: its id, machine, name. */
type DockSpace = Pick<SpaceInfo, "id" | "machine" | "name" | "named">;

/** The dock space among `all` (spaces()), or null: never made, or closed. Local spaces only. */
export function findDock<S extends Pick<SpaceInfo, "id" | "machine">>(rec: DockRecord | null, all: readonly S[]): S | null {
  const id = recordId(rec);

  return (id && all.find((s) => s.id === id && !s.machine)) || null;
}

/** A record adopted: the dock's id (null: given up) and what to do there now. */
export interface Adopted {
  readonly id: string | null;
  readonly next: DockThen | null;
}

/**
 * What a record becomes once spaces() shows the space it's making: { id, next }
 * (next: what to do now), or null (nothing yet). A making that waited past
 * MAKING ms is dropped ({ id: null }) so the next use tries again.
 */
export function adopt(rec: DockRecord | null, all: readonly DockSpace[], now: number): Adopted | null {
  const m = rec?.making;

  if (!m) return null;

  const before = new Set(m.before ?? []);
  const made = all.find((s) => !before.has(s.id) && !s.machine && s.named && s.name === DOCK_NAME);

  if (made) return { id: made.id, next: m.next ?? null };

  if (now - (m.at ?? 0) > MAKING) return { id: null, next: null };

  return null;
}

/** A dock is being made (the sky adopts it once spaces() shows it). */
export const dockMaking = (): boolean => Boolean(record()?.making);

/** The dock space now, or null. */
export const dock = (): SpaceInfo | null => findDock(record(), spaces());

/** This space is the dock. */
export const isDock = (s: Pick<SpaceInfo, "id" | "machine"> | null | undefined): boolean => Boolean(s) && !s?.machine && s?.id === recordId(record());

/** Does `next` in the dock space `id`. */
export function act(id: string | null, next: DockThen | null): void {
  if (!id || !next) return;

  if (next.kind === "move") {
    if (next.pane) run("pane.move", { pane: next.pane, space: id });

    return;
  }

  const slot = next.slot ?? newSlot();

  run("tab.new", { space: id, mod: "browser", props: next.url ? { slot, url: next.url } : { slot } });
}

/** A fresh slot for a web pane (browser keeps its page by slot). */
export const newSlot = (): string => `dock-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Into the dock: there now, at once; else the dock is made first and `next`
 *  follows once the sky sees it (adoptDock). False: not taken (the dock is
 *  still being made for an earlier ask; a second quick one is dropped). */
export function toDock(next: DockThen): boolean {
  const d = dock();

  if (d) {
    act(d.id, next);

    return true;
  }

  const making = record()?.making;

  if (making && Date.now() - (making.at ?? 0) <= MAKING) return false;

  writeShared(setShared, DOCK, { making: { at: Date.now(), before: spaces().map((s) => s.id), next } });
  run("space.new", { name: DOCK_NAME, folder: home(), machine: "" });

  return true;
}

/** The sky calls this from a task after drawing: a dock being made that has
 *  appeared gets its id, and what was asked of it is done. */
export function adoptDock(): boolean {
  const r = adopt(record(), spaces(), Date.now());

  if (!r) return false;

  writeShared(setShared, DOCK, r.id ? { id: r.id } : null);
  act(r.id, r.next);

  return true;
}
