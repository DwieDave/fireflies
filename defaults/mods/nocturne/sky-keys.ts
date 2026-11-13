// The sidebar's keyboard (sky.ts draws the sky): the cursor's place among the
// controls (nav.ts), the keys it takes, and what each row's keys do: a firefly's,
// a tile's on the shelf, a space's on the rail.

import type { Context, KeyEvent } from "gpui-kit";
import { spaces, run, focused } from "herdr";
import type { AgentInfo, SpaceInfo } from "herdr";
import { pin, movePin, goToPin, unpin } from "./kit.ts";
import type { JarItem } from "./pins.ts";
import { paneMenu } from "./header.ts";
import { isDock } from "./dock.ts";
import { openKeys, newWorktree } from "./menu.ts";
import { SIDEBAR_KEYS, SIDEBAR_HELP, keyVerb, move, moveSection, keep } from "./nav.ts";
import type { NavActs } from "./nav.ts";
import { openSpacePicker } from "./newspace.ts";
import { isActVerb, paneOf } from "./sky-plan.ts";
import type Sky from "./sky.ts";

/** A cursor on a live control: where it was, else its neighbor (a space closed), else the shown space. */
export function placeCursor(sky: Sky): boolean {
  if (sky.navList.some((x) => x.id === sky.cursor)) return false;

  const shown = spaces().find((s) => s.active);

  sky.cursor = sky.cursor == null
    ? (sky.navList.find((x) => x.id === `space:${shown?.id ?? ""}`)?.id ?? keep(sky.navList, null))
    : keep(sky.navList, sky.cursor, sky.navAt);

  return true;
}

/** nocturne.sidebar: into the sidebar, or back out to the pane. */
export function toggleKeys(sky: Sky): void {
  if (sky.navOn) {
    back();

    return;
  }

  const b = sky.block;

  if (b) run("layout.focus", { id: b });
}

/** Back to the pane the keyboard came from (pane.focus clears the block). */
export function back(): void {
  const pane = focused()?.pane;

  if (pane) run("pane.focus", { pane });
  else run("pane.go", { direction: "right" });
}

/** A key while the sidebar has the keyboard. */
export function sidebarKey(sky: Sky, e: KeyEvent, cx: Context): void {
  if (sky.spaces.confirmKey(e, cx)) {
    cx.stop_propagation();
    cx.notify();

    return;
  }

  // A field inside (a name, a folder) has the keyboard: its keys are its own.
  if (sky.naming || sky.spaces.mode) return;

  const verb = keyVerb(e, SIDEBAR_KEYS);

  if (!verb) return;

  cx.stop_propagation();

  const items = sky.navList;
  const item = items.find((x) => x.id === sky.cursor);

  switch (verb) {
    case "down":
    case "up":
      sky.cursor = move(items, sky.cursor, verb === "down" ? 1 : -1);
      break;
    case "first":
      sky.cursor = items[0]?.id ?? null;
      break;
    case "last":
      sky.cursor = items.at(-1)?.id ?? null;
      break;
    case "next":
    case "prev":
      sky.cursor = moveSection(items, sky.cursor, verb === "next" ? 1 : -1);
      break;
    case "right":
      run("pane.go", { direction: "right" });

      return;
    case "back":
      back();

      return;
    case "help":
      openKeys("sidebar keys", SIDEBAR_HELP);

      return;
    case "new":
      openSpacePicker();
      break;
    default:
      if (item && isActVerb(verb)) item[verb]?.(cx);
  }

  sky.navAt = Math.max(0, items.findIndex((x) => x.id === sky.cursor));
  cx.notify();
}

/** The verbs on a firefly. */
export function flyActs(sky: Sky, a: AgentInfo): NavActs {
  return {
    go: () => run("agent.focus", { terminal: a.address }),
    menu: () => sky.flyMenu(a, true),
    rename: (cx) => {
      if (!sky.folded) sky.startNaming(a, cx);
    },
    pin: () => pin(a.address),
    "pin-up": () => movePin(a.address, -1),
    "pin-down": () => movePin(a.address, 1),
  };
}

/** The verbs on a pinned pane that isn't an agent's (pinLane, railPin). */
export function pinActs(it: JarItem): NavActs {
  const p = paneOf(it);

  return {
    go: () => goToPin(it),
    menu: () => {
      if (p) paneMenu(p, true);
    },
    pin: () => unpin(it),
    "pin-up": () => movePin(it.key, -1),
    "pin-down": () => movePin(it.key, 1),
  };
}

/** The verbs on a space's rail row: Fireflies' own dialogs, as the folded menu uses. */
export function railActs(sky: Sky, s: SpaceInfo): NavActs {
  const acts: NavActs = {
    go: () => run("space.select", { id: s.id }),
    menu: () => sky.spaces.menu(s, true),
    rename: () => run("space.rename", { id: s.id }),
    tab: () => run("tab.new", { space: s.id }),
  };

  // The dock (dock.ts) keeps no folder and isn't deleted by a key.
  return isDock(s) ? acts : { ...acts, folder: () => sky.spaces.folder(s), delete: () => run("space.close", { id: s.id }), worktree: () => newWorktree(s.id) };
}
