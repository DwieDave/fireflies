// Picture in picture puts the pane away while the player plays: the tabs shown
// lately, the one to show instead, parking the pane or settling its tab, and
// bringing it back.

import { run, panes, spaces, focused, shared } from "herdr";
import type { OverlaySpec, TabInfo } from "herdr";
import { isBoolean, isString, nullable, object, readShared, sharedKey } from "./guard.ts";
import type Browser from "./main.ts";

// The picture in picture player: one window, whichever page's video it shows.
// The picture in picture player window (as pip opens it): 16:9 under its bar, resizable.
export const PLAYER = { mod: "pip", kind: "window", key: "pip", frame: "none", width: 384, height: 238,
  resizable: { min: [240, 158], aspect: 16 / 9, chrome: [2, 24] } } satisfies OverlaySpec;

// The player's snapping (pip's toggle, its s key): true or false, unset is on.
// The window then snaps to the shown tab's pane grid (OverlaySpec snap); out of
// Fireflies, to its screen. The window out of Fireflies' toggle reaches the page
// as event `pip.snapped { on }`, written here (that window's player is gone).
export const PIP_SNAP = sharedKey("pip.snap", nullable(isBoolean));

/** Whether the player snaps (pip.snap; unset: yes). */
export const snapOn = (): boolean => readShared(shared, PIP_SNAP, null) !== false;

// The pane the player put the video in (pip): { of, pane, park }.
export const PIP_PANE = sharedKey("pip.pane", nullable(object({ of: isString, pane: isString, park: isBoolean })));

/** A space's tab, with its space. */
export interface SpaceTab extends TabInfo {
  readonly space: string;
}

/** What picture in picture put away: this pane (parked) or its whole tab (settled). */
export type Hidden = { readonly pane: string } | { readonly tab: string };

export function noteShown(view: Browser) {
  const f = focused();
  const tab = f?.tab;

  if (!f || !tab || view.seen.at(-1)?.tab === tab) return;

  view.seen = [...view.seen.filter((x) => x.tab !== tab), { space: f.space, tab }].slice(-8);
}

/** Where to go when tab `away` (of space `space`) is put away: the tab shown
 *  before it, else its neighbor; the only tab of its space: the space shown
 *  before (its tab), else another space. Null: nowhere else to go. */
export function elsewhere(view: Browser, away: string, space: string): string | null {
  const all = spaces();
  const tabOf = (id: string): SpaceTab | undefined => all.flatMap((s) => s.tabs.map((c) => ({ ...c, space: s.id }))).find((c) => c.id === id);
  const open = <T extends TabInfo>(c: T | undefined): c is T => c !== undefined && c.id !== away && !c.settled;
  const here = all.find((s) => s.id === space)?.tabs ?? [];
  const before = [...view.seen].reverse().map((x) => tabOf(x.tab)).filter(open);
  const sameSpace = before.find((c) => c.space === space);

  if (sameSpace) return sameSpace.id;

  const i = here.findIndex((c) => c.id === away);
  const near = [...here.slice(i + 1), ...here.slice(0, Math.max(0, i)).reverse()].find(open);

  if (near) return near.id;

  if (before[0]) return before[0].id;

  const other = all.find((s) => s.id !== space && s.tabs.some(open));

  return other ? (other.tabs.find((c) => c.active && open(c)) ?? other.tabs.find(open))?.id ?? null : null;
}

/** While the video is in the player, this pane is out of the way: parked;
 *  the tab's only pane, its whole tab put away (settled: Nocturne lists no
 *  settled tab but the shown one, so another tab shows first). The only tab
 *  of the only space stays as it is: there's nothing else to show. */
export function hidePane(view: Browser) {
  if (view.hidden) return;

  const me = view.ownPane();

  if (!me || me.parked) return;

  const placed = panes().filter((x) => x.tab === me.tab && !x.parked);

  if (placed.length > 1) {
    view.hidden = { pane: me.pane };
    run("pane.park", { pane: me.pane });

    return;
  }

  const space = spaces().find((s) => s.tabs.some((c) => c.id === me.tab));
  const tab = space?.tabs.find((c) => c.id === me.tab);

  if (!space || !tab || tab.settled) return;

  const shown = space.active && tab.active;
  const to = shown ? elsewhere(view, me.tab, space.id) : null;

  if (shown && !to) return;

  // Show another first: settling the shown tab would keep it on the tab bar.
  if (to) run("tab.select", { id: to });

  view.hidden = { tab: me.tab };
  run("tab.settle", { id: me.tab });
}

/** Undoes `hide`, unless the person brought it back already. `show`: the
 *  tab shows again (↩, ✕), else it is only back in the tab bar (into a pane). */
export function unhide(view: Browser, show: boolean) {
  const h = view.hidden;

  view.hidden = null;

  if (!h) return;

  if ("pane" in h) {
    if (panes().find((x) => x.pane === h.pane)?.parked) run("pane.unpark", { pane: h.pane });

    return;
  }

  const tab = spaces().flatMap((s) => s.tabs).find((c) => c.id === h.tab);

  if (!tab) return;

  // tab.select shows it and takes it out of the settled ones.
  if (show) run("tab.select", { id: h.tab });
  else if (tab.settled) run("tab.unsettle", { id: h.tab });
}
