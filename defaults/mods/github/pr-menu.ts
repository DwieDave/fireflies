// The pull requests' right-click menu: on a row, that pull request's (it's
// selected first), elsewhere on the list the selected one's; at the press
// (menu-place.ts, the window's picker), in the middle when a key asked.

import type { Context } from "gpui-kit";
import type { Pt } from "@fireflies/menu-place";
import type { PickRow } from "./host.ts";
import type { default as Prs } from "./prs.ts";

/** The menu of the selected pull request (and a new one), at the press `e` (none: the middle). */
export function prMenu(v: Prs, e: { readonly position: Pt } | null = null): void {
  const p = v.current();
  const rows: PickRow[] = [{ label: "New pull request…", sub: "n", go: (cx) => v.newPr(cx) }];

  if (p) {
    rows.push({ label: `Diff of #${p.number}`, sub: "d", go: () => v.app.openDiff(p.number) },
      { label: `Comment on #${p.number}`, sub: "c", go: (cx) => v.startComment(cx) },
      { label: `#${p.number} in the browser`, sub: "o", go: (cx) => v.app.openUrl(v.urlOf(p), cx) });
  }

  v.app.picker = { title: "PULL REQUESTS", at: 0, rows, near: e ? v.app.pressAt(e) : null };
}

/** A right press on the row of pull request `key`: it's selected, its menu at the press. */
export function prRowMenu(v: Prs, key: string, e: { readonly position: Pt }, cx: Context): void {
  cx.stop_propagation();
  v.focus = "list";
  v.select((v.list ?? []).findIndex((p) => String(p.number) === key), cx);
  prMenu(v, e);
  cx.notify();
}
