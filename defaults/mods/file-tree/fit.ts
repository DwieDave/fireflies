// The files pane's header in any width: the keys list, the filter line's
// stops (tab) and what fits on it (labels full, short or icons; one row or
// two), and the toolbar's parts by priority.

import type { KeyRow } from "./keyhelp.ts";

/** About how wide a character is at the header's size 11 (logical px). */
export const CH = 7;

const chipW = (label: string, cut: number): number => 8 + 11 + (label ? 4 + label.length * CH : 0) + (cut > 0 ? 4 + String(cut).length * CH : 0);

/** What ? lists under the filter line, ? keys last. */
export const KEYS: readonly KeyRow[] = [["j k  ↑ ↓", "move"], ["h l  ← →", "fold / open"], ["enter", "open"], ["e", "edit"], ["E", "$EDITOR"], ["p", "viewer"],
  ["space", "preview on / off"], ["J K", "scroll the preview"], ["< >", "preview smaller / bigger"],
  ["t", "mark · unmark"], ["V", "mark a range (V ends)"], ["⇧↑ ⇧↓", "mark while moving"],
  ["v", "Neovim"], ["w", "HTML: in a web pane"], ["o", "new pane"], ["y", "copy path"], ["a A", "new file / folder"], ["R", "rename · move"], ["x P", "cut / paste"],
  ["d", "delete"], ["m", "menu"], ["/", "filter"], ["↑↓ ctrl-n ctrl-p", "filter: pick"], ["tab ⇧tab", "filter: to list"], ["H I", "dotfiles / ignored"],
  ["tab ⇧tab", "switches, + file"],
  ["- .", "root up / here"], ["[ ]  ⌫", "back / forward"], ["alt-← alt-→", "back / forward"], ["ctrl-o ctrl-i", "back / forward"], ["gg G", "top / bottom"],
  ["r", "refresh"], ["esc", "unmark · clear filter · leave"], ["q", "close"], ["?", "keys"]];

/** Which new-item chips show: "+ file" and "+ folder", "+ file" alone, or "+". */
export type Adds = "both" | "file" | "plus";

/** What a new-item chip makes. */
export type NewKind = "file" | "folder";

/** A stop of the filter line that tab rings. */
export type Stop = "hidden" | "ignored" | "add-file" | "add-folder" | "keys";

/** The new-item chips by `fit.add`: "+ file" and "+ folder", "+ file" alone, or "+". */
export const ADDS = {
  both: [["file", "+ file"], ["folder", "+ folder"]],
  file: [["file", "+ file"]],
  plus: [["file", "+"]],
} as const satisfies { readonly [A in Adds]: readonly (readonly [NewKind, string])[] };

/** The filter line's stops for tab / shift-tab (`add`: lensFit's): its two
 *  switches, the new-item chips drawn, the keys chip. */
export function lensStops(add: Adds = "both"): Stop[] {
  const adds: readonly (readonly [NewKind, string])[] = ADDS[add];

  return ["hidden", "ignored", ...adds.map(([kind]): Stop => (kind === "file" ? "add-file" : "add-folder")), "keys"];
}

/** tab (+1) / shift-tab (-1) from stop `at` (null: the list) over `stops`;
 *  past either end it's the list again (null). */
export function lensStep(stops: readonly Stop[], at: Stop | null, dir: number): Stop | null {
  const i = at === null ? (dir > 0 ? -1 : stops.length) : stops.indexOf(at);

  return stops[i + dir] ?? null;
}

/** "? keys" on the filter line (keyhelp.ts), px: 4 + "?" + 4 + "keys" + 4 at 7 px a character. */
const KEYS_CHIP = 47;

/** A new-item chip's width (px 4 each side). */
export const addW = (label: string): number => 8 + label.length * CH;

/** How the switches are labelled: whole words, short, or the eye alone. */
export type ChipLabels = "full" | "short" | "icon";

const LABELS = { full: ["dotfiles", "ignored"], short: [".*", "ign"], icon: ["", ""] } as const satisfies { readonly [L in ChipLabels]: readonly [string, string] };

/** How many each switch leaves out. */
export interface Cut {
  readonly hidden: number;
  readonly ignored: number;
}

/** The filter line's parts that fit a width. */
export interface LensFit {
  readonly find: string;
  readonly chips: ChipLabels;
  readonly cuts: boolean;
  readonly add: Adds;
  readonly count: boolean;
  readonly labels: readonly [string, string];
}

/** What the filter line counts: what each switch leaves out, the hits shown (null: no search). */
export interface LensCounts {
  readonly cut?: Cut;
  readonly count?: number | null;
}

/** The filter line's parts that fit `w`, richest first: the input's
 *  placeholder ("filter files", "filter" or only the /), the two switches'
 *  labels ("full": dotfiles / ignored, "short": .* / ign, "icon": the eye
 *  alone) and the new-item chips (`add`, ADDS: "+ folder" goes first, then
 *  "+ file" shortens to "+"). `cut`: how many each switch leaves out;
 *  `count`: the hits shown. */
export function lensFit(w: number, { cut = { hidden: 0, ignored: 0 }, count = null }: LensCounts = {}): LensFit {
  const variants: readonly (readonly [string, ChipLabels, boolean, Adds])[] = [
    ["filter files", "full", true, "both"], ["filter files", "full", true, "file"], ["filter files", "short", true, "both"], ["filter files", "short", true, "file"],
    ["filter", "short", true, "file"], ["", "short", true, "file"], ["", "short", true, "plus"],
    ["", "icon", true, "plus"], ["", "icon", false, "plus"],
  ];

  for (const [find, chips, cuts, add] of variants) {
    const fit = { find, chips, cuts, add, count: count !== null, labels: LABELS[chips] };

    if (lensWidth(fit, cut, count) <= w) return fit;
  }

  return { find: "", chips: "icon", cuts: false, add: "plus", count: false, labels: LABELS.icon };
}

/** The filter line in one row or two. */
export interface LensLayout extends LensFit {
  readonly rows: 1 | 2;
}

/** The filter line as it fits `w`: one line while the filter keeps its whole
 *  placeholder ("filter files") beside the switches; narrower (the docked
 *  panel, about 280 px), two rows, so there's room to type and to read what
 *  was typed: the filter at full width (with its hit count), and under it
 *  the switches, the new-item chips and ? keys, as they fit (chipsFit). */
export function lensLayout(w: number, { cut = { hidden: 0, ignored: 0 }, count = null }: LensCounts = {}): LensLayout {
  const one = lensFit(w, { cut, count });

  if (one.find === "filter files") return { rows: 1, ...one };

  return { rows: 2, find: "filter files", count: count !== null, ...chipsFit(w, cut) };
}

/** The second row's parts that fit a width. */
export interface ChipsFit {
  readonly chips: ChipLabels;
  readonly cuts: boolean;
  readonly add: Adds;
  readonly labels: readonly [string, string];
}

/** The second row of a two-row filter line: the switches' labels, their
 *  counts and the new-item chips that fit `w`, richest first. */
export function chipsFit(w: number, cut: Cut = { hidden: 0, ignored: 0 }): ChipsFit {
  const variants: readonly (readonly [ChipLabels, boolean, Adds])[] = [["full", true, "both"], ["full", true, "file"], ["short", true, "both"], ["short", true, "file"], ["short", true, "plus"], ["icon", true, "plus"], ["icon", false, "plus"]];

  for (const [chips, cuts, add] of variants) {
    const [h, i] = LABELS[chips];
    const adds: readonly (readonly [NewKind, string])[] = ADDS[add];
    const parts = [chipW(h, cuts ? cut.hidden : 0), chipW(i, cuts ? cut.ignored : 0), ...adds.map(([, l]) => addW(l)), KEYS_CHIP];
    let sum = 0;

    for (const p of parts) sum += p;

    if (16 + sum + 6 * (parts.length - 1) <= w) return { chips, cuts, add, labels: LABELS[chips] };
  }

  return { chips: "icon", cuts: false, add: "plus", labels: LABELS.icon };
}

/** How wide the filter line is with `fit` (logical px); the ? chip ends it. */
function lensWidth(fit: LensFit, cut: Cut, count: number | null): number {
  const [h, i] = fit.labels;
  const find = CH + (fit.find ? 5 + fit.find.length * CH : 0);
  const adds: readonly (readonly [NewKind, string])[] = ADDS[fit.add];
  const parts = [11, find, chipW(h, fit.cuts ? cut.hidden : 0), chipW(i, fit.cuts ? cut.ignored : 0), ...adds.map(([, l]) => addW(l)), KEYS_CHIP];

  if (fit.count) parts.push(String(count).length * CH);

  let sum = 0;

  for (const p of parts) sum += p;

  return 16 + sum + 6 * (parts.length - 1);
}

/** The toolbar's parts that fit `w`: back, forward and the folder's name
 *  always (`name`: the px it keeps, up to NAME, before it truncates); then, as
 *  room allows, the close button (a pane of its own: its header has one too),
 *  the changed count, the preview's switch, the edit button, the branch, the FILES eyebrow and the
 *  folder's parent path. */
export const NAME = 56;

/** Which of the toolbar's parts show, and the px the name keeps. */
export interface ToolbarFit {
  close: boolean;
  changed: boolean;
  look: boolean;
  edit: boolean;
  branch: boolean;
  eyebrow: boolean;
  path: boolean;
  name: number;
}

/** What the toolbar holds: a pane of its own (a close button), the branch, how many changed, the folder's name. */
export interface ToolbarHas {
  readonly alone?: boolean;
  readonly branch?: string | null;
  readonly changed?: number;
  readonly name?: string;
}

/** The parts of the toolbar that can go when it's narrow. */
type Optional = Exclude<keyof ToolbarFit, "name">;

export function toolbarFit(w: number, { alone = false, branch = null, changed = 0, name = "" }: ToolbarHas = {}): ToolbarFit {
  const fit: ToolbarFit = { close: false, changed: false, look: false, edit: false, branch: false, eyebrow: false, path: false, name: 0 };
  const want = Math.min(NAME, name.length * CH);

  fit.name = Math.max(Math.min(want, 3 * CH), Math.min(want, w - 20 - 19 - 19 - 8 * 2));

  let used = 20 + 19 + 19 + want;
  let n = 3;
  const room = (px: number): boolean => used + px + 8 * n <= w;

  const take = (key: Optional, px: number): void => {
    if (room(px)) {
      fit[key] = true;
      used += px;
      n++;
    }
  };

  if (alone) take("close", 20);

  if (changed > 0) take("changed", (String(changed).length + 1) * CH);

  // The preview split's switch: an icon.
  take("look", 20);
  take("edit", 12 + 4 * CH);

  if (branch) take("branch", Math.min(140, branch.length * CH));

  take("eyebrow", 5 * CH);
  take("path", 80);

  return fit;
}
