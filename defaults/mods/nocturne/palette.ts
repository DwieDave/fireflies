// The command palette in Nocturne's look (the layout's palette_mod, on the
// DwieDave fork): the shipped palette's commands, fuzzy ranking and recents,
// drawn square and 1-bit like popup.ts. The row under the cursor sits on a
// dithered band with a blue edge; groups are eyebrows; keys are plain glyphs.
// Enter runs, ↑/↓ (ctrl-n/p, ctrl-j/k, page up/down) move, Esc closes. Places (spaces, tabs) stay
// in the picker.
// The "Open" group holds Nocturne's own panels (panels.ts): each beside the
// focused pane (or where it always goes) and in a new tab, plus the sidebar fold.
// "Find" is the file picker and grep (picker.ts). The focused pane's own
// commands (an editor's, a web pane's, ...) lead the list while it's focused
// (PANE); the git and GitHub windows' while they're open.
// Every command a person can trigger is either an entry here or in OUT with
// the reason it stays out (scripts/nocturne-palette.test.ts holds that line).

import { div, svg } from "gpui-kit";
import type { Color, Context, Element, FocusHandle, KeyEvent } from "gpui-kit";
import type { Props } from "gpui-shell";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { keys, run, theme, props, closeOverlay, openOverlay, shared, window as win } from "herdr";
import type { Theme } from "herdr";
import { arrayOf, isString, nullable, object, parseJson, readShared, sharedKey } from "./guard.ts";
import { dither, eyebrow } from "./kit.ts";
import type { Binding } from "./keymap.ts";
import { entries, keyOf, sections } from "./palette-entries.ts";
import type { Listed } from "./palette-entries.ts";
import { readLaunchers } from "./launchers.ts";

// Fixed heights, so the list keeps one height while you move.
const SHOWN = 12;
const ROW_H = 28;
const HEAD_H = 30;
const LIST_H = SHOWN * ROW_H;

const GROUPS: readonly string[] = ["Recent", "Editor", "Web", "Markdown", "Preview", "Agents", "Usage", "Files", "Git", "GitHub", "Find", "Open",
  "Tab", "Pane", "Space", "Layout", "Terminal", "Agent", "Window", "App"];

// Each group's mark (mods/workspace-chrome/<icon>.svg).
const ICONS: ReadonlyMap<string, string> = new Map([
  ["Recent", "clock"], ["Editor", "file-text"], ["Web", "monitor"], ["Markdown", "file-text"], ["Preview", "image"], ["Agents", "layers"], ["Usage", "clock"], ["Files", "folder"], ["Git", "git-compare"], ["GitHub", "mods/nocturne/art/github.svg"], ["Find", "search"], ["Open", "layers"], ["Tab", "square"], ["Pane", "panel-right"], ["Space", "folder"], ["Layout", "sidebar"], ["Terminal", "terminal"], ["Agent", "layers"], ["Window", "square"], ["App", "settings"],
]);

const chrome = (n: string): string => (n.includes("/") ? n : `mods/workspace-chrome/${n}.svg`);

/** The layout key the shared `layout` record names (layout.clone's name). */
const LAYOUT = sharedKey("layout", nullable(isString));

/** A fuzzy match: its score and the matched letters' places. */
interface Match {
  readonly score: number;
  readonly hits: number[];
}

/** Fuzzy score of `q` in `text`, with the matched positions; null: no match.
 *  Tried from each word start too, so "file" finds the word in "Find a file…"
 *  rather than the f of Find. */
function fuzzy(q: string, text: string): Match | null {
  const t = text.toLowerCase();
  let best = fuzzyFrom(q, t, text.length, 0);

  for (let i = 1; i < t.length; i++) {
    if (t[i] !== q[0] || !/[\s:.\-_/]/.test(t[i - 1] ?? "")) continue;

    const r = fuzzyFrom(q, t, text.length, i);

    if (r && (!best || r.score > best.score)) best = r;
  }

  return best;
}

function fuzzyFrom(q: string, t: string, length: number, from: number): Match | null {
  let score = 0;
  let at = from;
  let streak = 0;
  const hits: number[] = [];

  for (const ch of q) {
    const i = t.indexOf(ch, at);

    if (i < 0) return null;

    const start = i === 0 || /[\s:.\-_/]/.test(t[i - 1] ?? "");

    streak = i === at && hits.length ? streak + 1 : 0;
    score += 1 + (start ? 6 : 0) + streak * 3 - Math.min(i - at, 6) * 0.3;
    hits.push(i);
    at = i + 1;
  }

  return { score: score - length * 0.02, hits };
}

function loadRecent(): string[] {
  try {
    return [...(parseJson(localStorage.getItem("recent") ?? "[]", arrayOf(isString)) ?? [])];
  } catch {
    return [];
  }
}

/** A row shown: its entry, the group it's under (the list as it opens) or its match (while typing). */
interface PaletteRow {
  readonly e: Listed;
  readonly head?: string;
  readonly score?: number;
  readonly hits?: readonly number[];
}

/** Where a row (and the group title before it) sits in the list's strip. */
interface Top {
  readonly head: boolean;
  readonly title: number;
  readonly row: number;
}

/** The palette's props: a search to start from (a mod that opens it), its overlay. */
const isPaletteProps = object({}, { query: isString, overlay: isString });

/** Where the rows go (Palette.measure): their tops, each group's count, whether the strip scrolls. */
interface Measured {
  readonly tops: readonly Top[];
  readonly counts: ReadonlyMap<string, number>;
  readonly fixed: boolean;
}

export default class Palette {
  query = "";
  input: InputState | null = null;
  at = 0;
  scroll = 0; // how far the list is scrolled, px
  maxScroll = 0;
  recent: string[] = [];
  handle: FocusHandle | null = null;

  init(_props: Props | undefined, cx: Context): void {
    const p = props();
    // A mod that opens the palette itself may hand it a search to start from (props.query).
    const query = (isPaletteProps(p) ? p.query : undefined) ?? "";
    const input = InputState.new({ placeholder: "type a command" });

    // Optional mods' entries (launchers.ts), read again as the palette opens.
    readLaunchers().catch(() => undefined);
    this.query = query;
    this.input = input;

    if (query) input.set_value(query);

    input.on("change", (_e, later) => {
      this.query = input.value();
      this.at = 0;
      later.notify();
    });
    input.on("submit", () => this.go(this.rows()[this.at]?.e));
    input.focus();
    cx.timer.after(600, () => input.focus());
    this.at = 0;
    this.scroll = 0;
    this.recent = loadRecent();
    this.handle = cx.focus_handle();
  }

  close(): void {
    const p = props();

    if (isPaletteProps(p) && p.overlay) closeOverlay(p.overlay);
  }

  go(e: Listed | undefined): void {
    if (!e) return;

    this.recent = [e.id, ...this.recent.filter((r) => r !== e.id)].slice(0, 20);

    try {
      localStorage.setItem("recent", JSON.stringify(this.recent));
    } catch {
      /* recents are a nicety */
    }

    this.close();

    if (e.go) {
      e.go();

      return;
    }

    if (e.name === "mod.clone") {
      openOverlay({ mod: "nocturne", kind: "dialog", frame: "none", width: 380, props: {
        role: "prompt", title: "Duplicate mod", hint: "the mod to copy; makes <name>-copy",
        command: { name: "mod.clone", args: {} },
      } });
    } else {
      run(e.name, e.name === "layout.clone" ? { name: readShared(shared, LAYOUT, null) ?? "main" } : e.args);
    }
  }

  /** The rows to show: grouped when empty, ranked while typing. */
  rows(): PaletteRow[] {
    const all = entries();
    const q = this.query.trim().toLowerCase().replace(/\s+/g, "");

    if (!q) {
      const recent = this.recent.flatMap((id) => {
        const e = all.find((x) => x.id === id);

        return e ? [e] : [];
      }).slice(0, 5);

      const rest = GROUPS.slice(1).flatMap((g) => all.filter((e) => e.group === g && !recent.includes(e)));
      const others = all.filter((e) => !GROUPS.includes(e.group) && !recent.includes(e));

      return [...recent.map((e) => ({ e, head: "Recent" })), ...[...rest, ...others].map((e) => ({ e, head: e.group }))];
    }

    const rank = (e: Listed) => {
      const i = this.recent.indexOf(e.id);

      return i < 0 ? 99 : i;
    };

    return all
      .flatMap((e) => {
        const title = fuzzy(q, e.title);
        const more = fuzzy(q, `${e.group} ${e.title} ${e.name} ${e.words}`);
        const best = title ?? (more && { score: more.score - 4, hits: [] });

        return best ? [{ e, score: best.score, hits: best.hits }] : [];
      })
      .sort((a, b) => b.score - a.score || rank(a.e) - rank(b.e));
  }

  /** A row's title, the matched letters in blue. */
  title(t: Theme, text: string, hits: readonly number[] | undefined, on: boolean): Element {
    const base = on ? t.foreground : t.muted;

    if (!hits?.length) return div().truncate().text_color(base).child(text);

    const parts: (readonly [string, boolean])[] = [];
    let cur = "";
    let lit = false;

    [...text].forEach((ch, i) => {
      const h = hits.includes(i);

      if (h !== lit && cur) {
        parts.push([cur, lit]);
        cur = "";
      }

      lit = h;
      cur += ch;
    });

    if (cur) parts.push([cur, lit]);

    return h_flex().min_w(0).children(parts.map(([s, h]) => div().text_color(h ? t.accent : base).child(s.replace(/ /g, " "))));
  }

  /** Where a search that found no command may belong: files, text in files, places. */
  elsewhere(bound: readonly Binding[], mac: boolean, order: readonly string[]): string {
    const k = (name: string) => {
      const key = keyOf({ name, args: {} }, bound, mac, order);

      return key ? ` (${key})` : "";
    };

    return `Files: Find a file…${k("nocturne.picker")}. Text: Grep the project…${k("nocturne.grep")}. Spaces and tabs: Go to space or tab…${k("mod.open:picker")}.`;
  }

  /** A key as a small square cap, one per stroke. */
  keycap(t: Theme, k: string, on: boolean): Element {
    return h_flex().flex_none().gap(3).children(k.split(" ").map((stroke, i) =>
      div().id(`kc-${i}`).h(18).px(5).flex().items_center().text_size(10)
        .border(1).border_color(on ? t.accent : t.ansi0).text_color(on ? t.accent : t.dim).child(stroke)));
  }

  /** A group's head: its mark, the eyebrow, a dithered hairline, how many it holds. */
  groupHead(t: Theme, name: string, count: number): Element {
    return h_flex().px(16).pb(6).gap(8).items_end()
      .child(svg(chrome(ICONS.get(name) ?? "square")).size(11).flex_none().text_color(t.ansi8))
      .child(div().flex_none().child(eyebrow(t, name)))
      .child(div().flex_1().h(1).mb(5).relative().opacity(0.6).child(dither(t.ansi8, 1)))
      .child(div().flex_none().text_size(10).text_color(t.dim).child(String(count)));
  }

  /** A key on the palette (its root's on_key_down). */
  key(e: KeyEvent, cx: Context, n: number): void {
    const k = e.key;
    const ctrl = e.modifiers.control && !e.modifiers.platform && !e.modifiers.alt;

    if (k === "escape") {
      cx.stop_propagation();
      this.close();

      return;
    }

    // Stops at the ends: wrapping jumps out of sight.
    if (k === "down" || (ctrl && (k === "n" || k === "j"))) this.at = Math.min(this.at + 1, n - 1);
    else if (k === "up" || (ctrl && (k === "p" || k === "k"))) this.at = Math.max(this.at - 1, 0);
    else if (k === "pagedown") this.at = Math.min(this.at + SHOWN, n - 1);
    else if (k === "pageup") this.at = Math.max(this.at - SHOWN, 0);
    else return;

    cx.stop_propagation();
    cx.notify();
  }

  /** One strip: each row (and the group title before it) at a fixed y, each
   *  group's count; the strip scrolls only as far as it takes to keep the
   *  selected row in view (`fixed`: taller than the list, so it scrolls). */
  measure(rows: readonly PaletteRow[]): Measured {
    const tops: Top[] = [];
    const counts = new Map<string, number>();
    let y = 0;

    rows.forEach((r, i) => {
      const head = !this.query && (i === 0 || r.head !== rows[i - 1]?.head);

      tops.push({ head, title: y, row: y + (head ? HEAD_H : 0) });
      y += (head ? HEAD_H : 0) + ROW_H;

      if (r.head !== undefined) counts.set(r.head, (counts.get(r.head) ?? 0) + 1);
    });

    this.maxScroll = Math.max(0, y - LIST_H);

    const sel = tops[this.at];

    if (sel) {
      const from = sel.head ? sel.title : sel.row;

      if (from < this.scroll) this.scroll = from;

      if (sel.row + ROW_H > this.scroll + LIST_H) this.scroll = sel.row + ROW_H - LIST_H;
    }

    this.scroll = Math.max(0, Math.min(this.scroll, this.maxScroll));

    return { tops, counts, fixed: y > LIST_H };
  }

  render(): Element {
    const t = theme();
    const rows = this.rows();
    const bound = keys();
    const mac = win().platform === "macos";
    const order = sections();

    this.at = Math.min(this.at, Math.max(0, rows.length - 1));

    const { tops, counts, fixed } = this.measure(rows);

    // Rows are placed at their edges from the model, not stacked: rounded
    // heights would drift away from it over a long list.
    const place = (el: Element, start: number, end: number) => (fixed
      ? el.absolute().left(0).right(0).top(start - this.scroll).h(end - start)
      : el.flex_none().h(end - start));

    const visible = (start: number, end: number) => !fixed || (end > this.scroll && start < this.scroll + LIST_H);
    const list: Element[] = [];

    rows.forEach((r, i) => {
      const top = tops[i];

      if (!top) return;

      const { head, title, row } = top;

      if (head && r.head !== undefined && visible(title, row)) list.push(place(v_flex().id(`pl-h-${i}`), title, row).justify_end().child(this.groupHead(t, r.head, counts.get(r.head) ?? 0)));

      if (!visible(row, row + ROW_H)) return;

      const on = i === this.at;
      const k = keyOf(r.e, bound, mac, order);
      const icon = r.e.icon ?? ICONS.get(r.e.group) ?? "square";

      // Placed last: an absolute row is its own anchor for the band; .relative() after it would undo it.
      list.push(place(h_flex().id(`pl-${i}`).relative(), row, row + ROW_H).px(16).gap(10).items_center().text_size(12)
        .on_hover((h, cx) => {
          if (h && this.at !== i) {
            this.at = i;
            cx.notify();
          }
        })
        .on_click(() => this.go(r.e))
        .when(on, (el) => el
          .child(dither(t.ansi0, 1))
          .child(div().absolute().left(0).top(0).bottom(0).w(2).bg(t.accent)))
        .child(svg(chrome(icon)).size(13).flex_none().relative().text_color(on ? t.accent : t.ansi8))
        .child(div().relative().flex_1().min_w(0).child(this.title(t, r.e.title, r.hits, on)))
        .when(Boolean(this.query), (el) => el.child(div().relative().flex_none().text_size(10).text_color(t.dim).child(r.e.group.toLowerCase())))
        .when(Boolean(k), (el) => (k ? el.child(div().relative().child(this.keycap(t, k, on))) : el)));
    });

    const hint = (key: string, what: string) => h_flex().flex_none().gap(4).child(div().text_color(t.accent).child(key)).child(div().text_color(t.dim).child(what));
    const handle = this.handle;
    const input = this.input;
    const rule: Color = t.ansi0;

    return v_flex().id("nocturne-palette").when(Boolean(handle), (el) => (handle ? el.track_focus(handle) : el)).w_full().min_h(0)
      .bg(t.background).border(1).border_color(rule)
      .on_key_down((e, cx) => this.key(e, cx, rows.length))
      // The search line on the horizon: the prompt sits on a dithered block, like a cursor.
      .child(h_flex().relative().h(48).flex_none().px(16).gap(12).items_center()
        .child(div().relative().size(20).flex_none().flex().items_center().justify_center()
          .child(dither(t.accent, 1).opacity(0.35))
          .child(div().relative().text_size(13).text_color(t.foreground).child(">")))
        .when(Boolean(input), (el) => (input ? el.child(Input.new(input).flex_1().h_full().text_size(13).text_color(t.foreground)) : el))
        .child(div().flex_none().text_size(10).text_color(t.dim).child(this.query ? `${rows.length} found` : `${rows.length} commands`))
        .child(div().absolute().left(0).right(0).bottom(0).h(2).child(dither(t.ansi0, 1))))
      .child(rows.length
        ? div().id("palette-rows").relative().pt(4)
          .when(fixed, (el) => el.h(LIST_H + 4).overflow_hidden())
          .on_scroll_wheel((e, cx) => {
            this.scroll = Math.max(0, Math.min(this.scroll - e.delta.y, this.maxScroll));

            // The selection stays on screen, so the next frame doesn't scroll back to it.
            while (this.at < rows.length - 1 && (tops[this.at]?.row ?? 0) < this.scroll) this.at++;

            while (this.at > 0 && (tops[this.at]?.row ?? 0) + ROW_H > this.scroll + LIST_H) this.at--;

            cx.notify();
          })
          .children(fixed ? [div().relative().h(LIST_H).children(list)] : [v_flex().children(list)])
        : v_flex().px(16).py(14).gap(4).text_size(11)
          .child(div().text_color(t.muted).child(`Nothing matches "${this.query}".`))
          .child(div().text_color(t.dim).child(this.elsewhere(bound, mac, order))))
      .child(h_flex().relative().h(26).mt(4).flex_none().px(16).gap(14).items_center().text_size(10)
        .child(div().absolute().left(0).right(0).top(0).h(2).child(dither(t.ansi0, 1)))
        .child(hint("↑↓ ctrl-n/p", "move")).child(hint("enter", "run")).child(hint("esc", "close"))
        .child(div().flex_1())
        .child(div().text_color(t.dim).child("type to filter")));
  }
}
