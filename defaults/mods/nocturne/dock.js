// The dock: one space of this app's own, tied to no folder, for panes that
// belong to no project (a web page you keep open, a docs pane, a shell in ~).
// Its panes are pinned to the jar's shelf (pins.js), so a tile goes to them
// from any space.
//   made     on first use (the pane menu's "Dock", "New web pane in the dock"
//            from the palette or the shelf's + tile), with
//            space.new {name: "dock", folder: ~}: its terminals start in ~,
//            and kit.js spaceFolder answers null for it, so the git and GitHub
//            windows never see a repo there, wherever its shells cd to
//   kept     its id in shared DOCK_KEY; the core keeps the space across restarts.
//            Closed (`herdr-app do space.close`), the next use makes a new one.
//   guarded  its menu has no Change folder, New worktree or Delete, and the
//            sidebar's f / w / d skip it (spaces.js)
// Space ids come back from space.new only through spaces(): the record holds
// { making: { at, before, then } } until the sky sees a new space named
// "dock" that wasn't there before (adopt()), then { id }; `then` is what to
// do once it's there (move a pane in, open a web page).
import { spaces, run, shared, setShared, home } from "herdr";

/** shared() key: { id } once made; { making: { at, before: [ids], then } } while it's made. */
export const DOCK_KEY = "nocturne.dock-space";
export const DOCK_NAME = "dock";
/** How long a making waits for its space before it's given up (ms). */
export const MAKING = 10000;

/** The dock's id from a record (DOCK_KEY), or null. */
export const recordId = (rec) => (rec && typeof rec.id === "string" && rec.id) || null;

/** The dock space among `all` (spaces()), or null: never made, or closed. Local spaces only. */
export function findDock(rec, all) {
  const id = recordId(rec);
  return (id && all.find((s) => s.id === id && !s.machine)) || null;
}

/**
 * What a record becomes once spaces() shows the space it's making: { id, then }
 * (then: what to do now), or null (nothing yet). A making that waited past
 * MAKING ms is dropped ({ id: null }) so the next use tries again.
 */
export function adopt(rec, all, now) {
  const m = rec?.making;
  if (!m) return null;
  const before = new Set(m.before ?? []);
  const made = all.find((s) => !before.has(s.id) && !s.machine && s.named && s.name === DOCK_NAME);
  if (made) return { id: made.id, then: m.then ?? null };
  if (now - (m.at ?? 0) > MAKING) return { id: null, then: null };
  return null;
}

/** The dock space now, or null. */
export const dock = () => findDock(shared(DOCK_KEY), spaces());

/** This space is the dock. */
export const isDock = (s) => Boolean(s) && !s.machine && s.id === recordId(shared(DOCK_KEY));

/** Does `then` ({ kind: "move", pane } | { kind: "web", url? }) in the dock space `id`. */
export function act(id, then) {
  if (!id || !then) return;
  if (then.kind === "move" && then.pane) run("pane.move", { pane: then.pane, space: id });
  else if (then.kind === "web") {
    run("tab.new", { space: id, mod: "browser", props: { slot: then.slot ?? newSlot(), ...(then.url ? { url: then.url } : {}) } });
  }
}

/** A fresh slot for a web pane (browser keeps its page by slot). */
export const newSlot = () => `dock-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Into the dock: there now, at once; else the dock is made first and `then`
 *  follows once the sky sees it (adoptDock). False: not taken (the dock is
 *  still being made for an earlier ask; a second quick one is dropped). */
export function toDock(then) {
  const d = dock();
  if (d) { act(d.id, then); return true; }
  const rec = shared(DOCK_KEY);
  if (rec?.making && Date.now() - (rec.making.at ?? 0) <= MAKING) return false;
  setShared(DOCK_KEY, { making: { at: Date.now(), before: spaces().map((s) => s.id), then } });
  run("space.new", { name: DOCK_NAME, folder: home(), machine: "" });
  return true;
}

/** The sky calls this from a task after drawing: a dock being made that has
 *  appeared gets its id, and what was asked of it is done. */
export function adoptDock() {
  const rec = shared(DOCK_KEY);
  const r = adopt(rec, spaces(), Date.now());
  if (!r) return false;
  setShared(DOCK_KEY, r.id ? { id: r.id } : null);
  act(r.id, r.then);
  return true;
}
