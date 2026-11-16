// The mods' small pictures as the layout asks: Nocturne's 1-bit art
// (mods/nocturne/art, tinted by text_color) where the layout is dithered,
// upstream's line icons (Lucide, as herdr-app's own Settings draws them; ISC,
// mods/nocturne/plain) elsewhere. Every mod may name these app paths.
//
//   icon(art, plain)   the svg path for this layout, or null (none in it)
//
// Art without a plain counterpart (the moon on an empty page, the sky, the
// hills, the fireflies' glow, the sheep) passes `null` as `plain`: a plain
// layout draws no picture there.

import { dithered } from "@fireflies/layout-look";

/** Nocturne's art folder. */
export const ART = "mods/nocturne/art";

/** The plain line icons (Lucide). */
export const PLAIN = "mods/nocturne/plain";

/** The line icons shipped in PLAIN. */
export type PlainIcon =
  | "app-window" | "arrow-left" | "bell" | "chevron-down" | "chevron-right" | "chevron-up" | "circle-dot" | "cpu" | "database" | "ellipsis"
  | "file-code" | "folder" | "git-branch" | "git-pull-request" | "hourglass" | "inbox" | "keyboard" | "list-checks" | "list-tree" | "loader-circle"
  | "lock" | "maximize-2" | "minimize-2" | "notebook-pen" | "panel-left" | "pin" | "play" | "plug" | "refresh-cw" | "search" | "shield"
  | "sparkles" | "x";

/** The svg to draw: `art` (a name in ART, no extension) in a dithered layout,
 *  `plain` in a plain one; null where this layout has none. */
export function icon(art: string, plain: PlainIcon): string;
export function icon(art: string, plain: PlainIcon | null): string | null;
export function icon(art: string, plain: PlainIcon | null): string | null {
  if (dithered()) return `${ART}/${art}.svg`;

  return plain === null ? null : `${PLAIN}/${plain}.svg`;
}
