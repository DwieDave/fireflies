// Where a form's fields sit (form.ts draws them), as plain functions: no
// gpui or herdr imports, so scripts/ tests them.
//
// The form is a column the width of what it holds (COLUMN), not the whole
// tab: what it will send (the commits, the workflows) takes the width that's
// left. Inside it, fields fall into sections (a field's `group` starts one,
// drawn as an eyebrow over a dithered rule); a field's label sits above it
// with its hint on the same line. Fields marked `half` (and toggles) pair up
// two to a row when the column is wide enough; a `pair` field shares its row
// with the next one, joined by `join` (base ← head, workflow @ ref); a half
// with no half beside it takes the whole row. One
// multi-line field grows into the room the column leaves free. The buttons
// sit in a footer on the panel's bottom edge, outside the scrolled fields.
//
// A list (a field's picker) opens under its field at the field's width, as
// tall as its rows; without room below it opens upward, and with room on
// neither side it takes the larger and scrolls inside it. It never covers
// the footer or leaves the panel.

export const COLUMN = 640; // the form panel's width beside the side panel
export const WIDE = 860; // from here the side panel shows
export const LABEL = 16, LABEL_GAP = 4, CONTROL = 28, ERROR = 16, TOGGLE = 24;
export const SECTION = 26, ROW_GAP = 10, TOP = 10, BOTTOM = 14, COL_GAP = 12, JOIN = 22;
export const AREA_MIN = 120, AREA_MAX = 440;
export const FOOTER = 40;
export const PICK_ROW = 22, PICK_ROW_SUB = 32, PICK_HEAD = 27, PICK_MAX = 12, PICK_MIN_W = 280, PICK_GAP = 2;

/** What a field is to the layout. */
export type FieldKind = "text" | "area" | "number" | "toggle" | "choice" | "multi";

/** What the layout reads of a field: its id and kind, the section it starts, how it shares a row. */
export interface Placed {
  readonly id: string;
  readonly kind: FieldKind;
  readonly group?: string | undefined;
  readonly half?: boolean | undefined;
  readonly pair?: boolean | undefined;
  readonly join?: string | undefined;
}

/** The form panel's width and the side panel's (0: none). */
export interface Columns {
  readonly form: number;
  readonly side: number;
}

/** The form panel's width and the side panel's, for a tab body `width` wide (0: no side panel). */
export function columns(width: number): Columns {
  if (width < WIDE) return { form: width, side: 0 };

  return { form: COLUMN, side: Math.max(0, width - COLUMN - 6) };
}

/** The side padding inside the form panel. */
export const padOf = (formW: number): number => (formW >= 560 ? 20 : 14);

/** Halves pair up from this inner width; under it they stack. */
export const PAIRS = 420;

const isHalf = (f: Placed) => Boolean(f.half) || f.kind === "toggle";

/** What a field's height depends on: an error under it, the multi-line field's height. */
export interface HeightOptions {
  readonly error?: boolean;
  readonly area?: number;
}

/** A field's height as drawn: a toggle is one line; others a label, the control and the error under it. */
export function fieldHeight(f: Placed, { error = false, area = AREA_MIN }: HeightOptions = {}): number {
  if (f.kind === "toggle") return TOGGLE + (error ? ERROR : 0);

  return LABEL + LABEL_GAP + (f.kind === "area" ? area : CONTROL) + (error ? ERROR : 0);
}

/** A field at its place: its index in the fields (the tab order). */
export interface Cell<F> {
  readonly field: F;
  readonly index: number;
  readonly x: number;
  y: number;
  readonly w: number;
  readonly h: number;
}

/** A row of the laid out column: a section's eyebrow, or one or two fields (`join` between a pair). */
export type Row<F> =
  | { readonly kind: "section"; readonly title: string; readonly y: number; readonly h: number }
  | { readonly kind: "fields"; readonly y: number; readonly h: number; readonly cells: readonly Cell<F>[]; readonly join: string | null };

/** The column laid out. */
export interface Layout<F> {
  readonly rows: readonly Row<F>[];
  readonly height: number;
  readonly area: number;
  readonly pad: number;
  readonly inner: number;
  readonly pairs: boolean;
}

/** What the layout fits the fields to: the panel's inner width, the room for the scrolled
 *  part, and what's wrong by field id. */
export interface LayoutOptions {
  readonly width: number;
  readonly viewH?: number;
  readonly errors?: ReadonlyMap<string, string>;
}

/**
 * The column laid out: rows top to bottom in the scrolled form, each
 *   { kind: "section", title, y, h }
 *   { kind: "fields", y, h, cells: [{ field, index, x, y, w, h }], join }
 * plus the content height and the multi-line field's height. `width` is the
 * form panel's inner width (padding included), `viewH` the room for the
 * scrolled part (the panel's body without the footer), `errors` field id ->
 * words. Every field has its index in `fields`, which is the tab order.
 */
export function layout<F extends Placed>(fields: readonly F[], { width, viewH = 0, errors = new Map() }: LayoutOptions): Layout<F> {
  const pad = padOf(width);
  const inner = Math.max(0, width - pad * 2);
  const pairs = inner >= PAIRS;
  const err = (f: F) => errors.has(f.id);

  const build = (area: number) => {
    const rows: Row<F>[] = [];
    let y = TOP, group: string | null = null;

    // A section: a gap over it (none at the top), its eyebrow line, a little air under it.
    const section = (title: string) => {
      if (rows.length) y += ROW_GAP + 4;

      rows.push({ kind: "section", title, y, h: SECTION - 10 });
      y += SECTION;
    };

    const push = (cells: Cell<F>[], join: string | null = null) => {
      const h = Math.max(...cells.map((c) => c.h));

      if (rows.at(-1)?.kind === "fields") y += ROW_GAP;

      for (const c of cells) c.y = y;

      rows.push({ kind: "fields", y, h, cells, join });
      y += h;
    };

    const cell = (f: F, index: number, x: number, w: number): Cell<F> => ({ field: f, index, x, y: 0, w, h: fieldHeight(f, { error: err(f), area }) });

    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];

      if (!f) continue;

      if (f.group && f.group !== group) {
        group = f.group;
        section(f.group);
      }

      const next = fields[i + 1];
      const sameGroup = next && (!next.group || next.group === group);

      if (f.pair && next && sameGroup && pairs) {
        const w = Math.floor((inner - JOIN) / 2);

        push([cell(f, i, pad, w), cell(next, i + 1, pad + w + JOIN, inner - w - JOIN)], f.join ?? null);
        i++;

        continue;
      }

      if (isHalf(f) && pairs && next && sameGroup && isHalf(next) && !next.pair) {
        const w = Math.floor((inner - COL_GAP) / 2);

        push([cell(f, i, pad, w), cell(next, i + 1, pad + w + COL_GAP, inner - w - COL_GAP)]);
        i++;

        continue;
      }

      // Alone (no half beside it): the whole row, so no half row stands empty.
      push([cell(f, i, pad, inner)]);
    }

    return { rows, height: y + BOTTOM };
  };

  let out = build(AREA_MIN), area = AREA_MIN;

  // One multi-line field takes the room the column leaves free (up to AREA_MAX).
  if (viewH > 0 && fields.some((f) => f.kind === "area") && out.height < viewH) {
    area = Math.min(AREA_MAX, AREA_MIN + Math.floor(viewH - out.height));

    if (area > AREA_MIN) out = build(area);
  }

  return { ...out, area, pad, inner, pairs };
}

/** Where a field sits: its row's top and height, its cell, its control's top and height. */
export interface CellPlace {
  readonly y: number;
  readonly h: number;
  readonly x: number;
  readonly w: number;
  readonly controlY: number;
  readonly controlH: number;
}

/** Where field `index` sits in a layout: { y, h, x, w, controlY, controlH }, or null. */
export function cellOf<F extends Placed>(lay: Layout<F>, index: number): CellPlace | null {
  for (const r of lay.rows) {
    if (r.kind !== "fields") continue;

    const c = r.cells.find((x) => x.index === index);

    if (!c) continue;

    const f = c.field;
    const controlY = r.y + (f.kind === "toggle" ? 0 : LABEL + LABEL_GAP);
    const controlH = f.kind === "toggle" ? TOGGLE : f.kind === "area" ? lay.area : CONTROL;

    return { y: r.y, h: r.h, x: c.x, w: c.w, controlY, controlH };
  }

  return null;
}

/** What pickerHeight reads of a row: whether it has a second line. */
export interface Sized {
  readonly sub?: string | undefined;
}

/** A list's height for its rows (null: still reading; `sub`: rows with a second line), its filter line included. */
export function pickerHeight(rows: readonly Sized[] | null | undefined): number {
  if (!rows) return PICK_HEAD + 60 + 2;

  const shown = rows.slice(0, PICK_MAX);

  if (!shown.length) return PICK_HEAD + 34 + 2;

  let body = 8;

  for (const r of shown) body += r.sub ? PICK_ROW_SUB : PICK_ROW;

  return PICK_HEAD + body + 2;
}

/** Where a list goes: the form's scroll, the room above the footer, the list's height, the panel's inner width. */
export interface PickerRoom {
  readonly scrollY?: number;
  readonly viewH: number;
  readonly want: number;
  readonly width: number;
}

/** Where a list opens, and whether upward. */
export interface PickerPlace {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly up: boolean;
}

/**
 * Where a field's list opens, in the form body's coordinates (scrolled):
 * `cell` from cellOf, `scrollY` the form's scroll, `viewH` the room above
 * the footer, `want` the list's height (pickerHeight), `width` the panel's
 * inner width. Returns { x, y, w, h, up }: under the control when it fits,
 * else above it when that fits, else on the larger side, cut to fit
 * (the list scrolls inside).
 */
export function pickerPlace(cell: CellPlace, { scrollY = 0, viewH, want, width }: PickerRoom): PickerPlace {
  const top = cell.controlY - scrollY, bottom = top + cell.controlH;
  const below = Math.max(0, viewH - bottom - PICK_GAP - 4), above = Math.max(0, top - PICK_GAP - 4);
  const w = Math.min(Math.max(cell.w, PICK_MIN_W), Math.max(0, width - 8));
  const x = Math.max(4, Math.min(cell.x, width - w - 4));
  let up = false, h = want;

  if (want <= below) h = want;
  else if (want <= above) up = true;
  else if (above > below) {
    up = true;
    h = above;
  } else h = below;

  return { x, w, h, up, y: up ? top - PICK_GAP - h : bottom + PICK_GAP };
}
