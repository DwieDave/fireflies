// A Projects card's right-click menu: the card is selected and its actions
// (the same as its keys: enter, e, m, i, o, x) open at the press, in the
// window's picker (window-chrome.ts pickerPanel, placed by menu-place.ts).

import { Array as Arr, Option, String as Str } from "effect";
import type { Context } from "gpui-kit";
import type { Pt } from "@fireflies/menu-place";
import type { PickRow } from "./host.ts";
import type { Layout } from "./board-layout.ts";
import { boardKey } from "./projects-keys.ts";
import { label } from "./board-cards.ts";
import type { default as Projects } from "./projects.ts";

/** A card's actions in its menu: the words, and the key that does it. */
const ACTIONS: readonly (readonly [string, string])[] = [
  ["Open its detail", "enter"], ["Edit its fields…", "e"], ["Carry it", "m"], ["Make it an issue…", "i"], ["Open it on GitHub", "o"], ["Archive it…", "x"],
];

/** A right press on the card `key` in column `ci`: it's selected, its menu at the press `e`. */
export function cardMenu(proj: Projects, lay: Layout, ci: number, key: string, e: { readonly position: Pt }, cx: Context): void {
  cx.stop_propagation();

  const b = proj.board();

  if (b === null || proj.carrying !== null || Str.startsWith("pad-")(key) || Str.startsWith("lane-")(key)) return;

  const item = Option.getOrUndefined(Arr.findFirst(b.items, (i) => i.id === key));

  if (item === undefined) return;

  proj.sel = key;
  proj.selCol = ci;
  proj.focus = "board";

  // A draft can be made an issue; the others can't.
  const actions = Arr.filter(ACTIONS, ([, k]) => k !== "i" || item.content.kind === "draft");

  const rows: PickRow[] = Arr.map(actions, ([words, k]) => ({ label: words, sub: k, go: (cx2: Context) => {
    boardKey(proj, b, lay, k, cx2);
  } }));

  proj.app.picker = { title: `CARD · ${label(item)}`, at: 0, rows, near: proj.app.pressAt(e) };
  proj.app.focusSelf();
  cx.notify();
}
