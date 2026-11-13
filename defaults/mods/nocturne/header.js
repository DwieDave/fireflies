// A pane's header: name and folder, then a dithered band that fills the
// rest; the band turns moonfly blue on the pane with the keyboard. Hover
// shows text size (− / +, the % resets), float, split, even out (▦, with
// more than one pane: equalize.js), gridify (with more than two:
// gridify.js), park (pane.park, while another pane stays in place), zoom
// and close; a
// right-click opens the pane's menu (menu.js: rename, split, zoom, move to
// another tab or a new one, close). Props from the app: { pane, terminal }.
// A terminal pane goes by the name a person gave it (kit.js givenName), else
// its agent's or program's; double-click the name, or the menu's "Rename",
// to name it in place (enter: keep, esc: leave it, empty: the default back).
// A lazygit pane (lazygit.js) gets its own: a git mark, the branch, and a
// band that fades out in steps toward ahead/behind and the changed files.
//
// Narrow panes give way in order, never overlapping: the folder shrinks
// first and goes under FOLDER_MIN px; the status word goes under WORD_MIN
// (the pip still says it); the hover buttons fold into ⋯ (the pane menu):
// all of them from FULL_MIN, zoom, ⋯ and close from SOME_MIN, ⋯ alone
// below. Close is always the rightmost, ⋯ right before it. The name and the
// pip stay.
//
// Keys: the tab strip's cursor (tabs.js, nav.js) walks the focused pane's
// header as its second row: the name (rename), every button here (the
// header shows them all while the cursor is in it, the one under it in a
// blue ring), ⋯ and close; it says where through shared(nav.js CURSOR).

import { div, svg } from "gpui-kit";
import { h_flex, InputState } from "gpui-base";
import { panes, spaces, props, run, theme, home, shared, setShared, keys } from "herdr";
import { NAME_PANE, openMenu } from "./menu.ts";
import { ART, LOGO, dither, pip, WORD, givenName, nameTerminal, navRing } from "./kit.ts";
import { CURSOR } from "./nav.ts";
import { field } from "./inline.ts";
import { isLazygit, gitState } from "./lazygit.ts";
import { openEqualize } from "./equalize.ts";

// Mod panes: their name and mark (mods/workspace-chrome/<icon>.svg).
const MODS = {
  "agent-graph": ["Agents", "layers"], "browser": ["Web", "monitor"],
  "diff": ["Diff", "git-compare"], "git": ["Git", "git-compare"], "file-tree": ["Files", "files"],
  "usage": ["Usage", "clock"], "pip": ["Picture in picture", "monitor"],
  "markdown": ["Markdown", "file-text"], "preview": ["Preview", "eye"],
  "editor": ["Editor", "file-text"],
  nocturne: ["Worktrees", "git-branch"],
};
// Header widths (px) at which parts give way.
const FOLDER_MIN = 260, WORD_MIN = 240, FULL_MIN = 380, SOME_MIN = 200;

/** "⌘⇧M" for the key bound to a command, if any. */
function keyLabel(action) {
  const k = keys().find((b) => b.section === "global" && b.action === action)?.keys;
  if (!k) return "";
  return k.replace(/cmd-/g, "⌘").replace(/shift-/g, "⇧").replace(/alt-/g, "⌥").replace(/ctrl-/g, "⌃").toUpperCase();
}

/** Parking needs another pane left in place (as the pane menu's "Park pane"). */
export function parkable(p, all = panes()) {
  return !p.parked && all.filter((x) => x.tab === p.tab && !x.parked).length > 1;
}

// Terminal programs with a fitting chrome icon; any other terminal gets "terminal".
const PROGRAMS = { nvim: "file-text", vim: "file-text", hx: "file-text", htop: "server", btop: "server" };

/** The pane's mark: an agent's dithered logo, else its mod's or program's icon. */
export function mark(t, p) {
  const color = p.focused ? t.accent : t.dim;
  return svg(markPath(p)).size(11).flex_none().text_color(color);
}

/** The svg of a pane's mark (mark()): also the jar's for a pinned pane (sky.js). */
export function markPath(p) {
  const logo = LOGO.get(p?.program?.key ?? "");
  return logo ? `${ART}/logo-${logo}.svg`
    : p?.program?.agent ? `${ART}/logo-agent.svg`
    : `mods/workspace-chrome/${MODS[p?.mod]?.[1] ?? PROGRAMS[p?.program?.key] ?? "terminal"}.svg`;
}

/** A mod pane's kind in a word ("web", "editor", "files"), null for a terminal. */
export const modKind = (p) => (p?.mod ? (MODS[p.mod]?.[0] ?? p.mod).toLowerCase() : null);

/** What a pane is called: the name a person gave its terminal, its mod's
 *  name, its agent's or shell's, its title, its program's. */
export function paneName(p) {
  return givenName(p.terminal) ?? viewerName(p) ?? MODS[p.mod]?.[0] ?? (((p.program?.agent || p.program?.shell) && p.program.name) || p.title || p.program?.name || (p.mod ? p.mod : "shell"));
}

/** A file viewer (Markdown, preview) goes by the file it shows (it notes that by
 *  slot in shared `<mod>.titles`); a files pane of its own by its folder. */
const VIEWERS = new Set(["markdown", "preview", "editor", "file-tree"]);
function viewerName(p) {
  if (!VIEWERS.has(p.mod) || (p.mod === "file-tree" && !p.props?.path)) return null;
  const slot = p.props?.slot;
  return (slot && shared(`${p.mod}.titles`)?.[slot]) || String(p.props?.path ?? "").split("/").pop() || null;
}

const CHROME = (n) => `mods/workspace-chrome/${n}.svg`;

/** The pane menu (menu.js), as on a right-click (`centered`: from the keyboard). */
export function paneMenu(p, centered = false) {
  // 260: its rows' names beside the longest keys ("Move right" by cmd-alt-shift-]).
  openMenu({ tab: "pane", target: { pane: p.pane, terminal: p.terminal } }, { width: 260, centered });
}

/** Asks this pane's header to name its terminal in place (as the menu's Rename). */
export function renamePane(p) {
  if (p?.terminal) setShared(NAME_PANE, { terminal: p.terminal, at: Date.now() });
}

/**
 * A pane's header controls, in the order drawn: { id, icon | text, tip?, go }.
 * The name (rename) leads when the pane has a terminal; ⋯ (the pane menu)
 * then close end it, close the rightmost.
 * The header draws the buttons from this; the tab strip's keyboard walks it.
 */
export function headerControls(p, all = panes()) {
  if (!p) return [];
  const pane = p.pane, zoom = p.font_zoom ?? 1, term = Boolean(p.terminal) && !p.mod;
  const tab = all.filter((x) => x.tab === p.tab);
  const c = (id, icon, command, args, tip) => ({ id, icon, tip, go: () => run(command, args) });
  return [
    ...(p.terminal ? [{ id: "name", go: () => renamePane(p), tip: "Rename" }] : []),
    ...(term && zoom !== 1 ? [{ id: "fz", text: `${Math.round(zoom * 100)}%`, tip: "Text size back", go: () => run("pane.font_reset", { pane }) }] : []),
    ...(term ? [
      c("fs", CHROME("minus"), "pane.font_smaller", { pane }, "Smaller text"),
      c("fb", CHROME("plus"), "pane.font_bigger", { pane }, "Bigger text"),
      c("float", CHROME("square"), "pane.float", { pane }, "Float"),
    ] : []),
    c("split-right", "split-right", "pane.split", { direction: "right", pane }, "Split right"),
    c("split-down", "split-down", "pane.split", { direction: "down", pane }, "Split down"),
    ...(tab.length > 1 ? [{ id: "equalize", icon: "mods/equalize-panes/equalize.svg", tip: "Even out panes", go: () => openEqualize(pane) }] : []),
    ...(tab.filter((x) => !x.parked).length > 2 ? [c("gridify", "mods/equalize-panes/grid.svg", "nocturne.gridify", undefined, "Gridify panes")] : []),
    ...(parkable(p, all) ? [c("park", CHROME("archive"), "pane.park", { pane }, `Park pane${keyLabel("pane.park") ? ` (${keyLabel("pane.park")})` : ""}`)] : []),
    c("zoom", p.zoomed ? "unzoom" : "zoom", "pane.zoom", { pane }, p.zoomed ? "Unzoom" : "Zoom"),
    { id: "more", icon: `${ART}/more.svg`, tip: parkable(p, all) ? "More: split, even out, park, move, close" : "More: split, even out, move, close", go: () => paneMenu(p, true) },
    c("close", "close", "pane.close", { pane }, "Close"),
  ];
}

export function folder(cwd) {
  if (!cwd) return "";
  const h = home();
  return cwd === h ? "~" : cwd.startsWith(h + "/") ? "~" + cwd.slice(h.length) : cwd;
}

export default class Header {
  init(_props, cx) {
    this.hovered = false;
    this.width = 1000; // the header's, as last drawn
    this.git = null;
    this.naming = false;
    this.nameInput = InputState.new({ placeholder: "name" });
    this.nameInput.on("submit", (_e, cx) => this.name(this.nameInput.value(), cx));
    // The pane menu (another copy of this mod) asks through shared(NAME_PANE);
    // a request from before this header was made is old.
    this.nameAsked = shared(NAME_PANE)?.at ?? null;
    // Only a lazygit pane shows git state; every other header stays idle.
    this.poll(cx);
    cx.timer.every(4000, (cx) => this.poll(cx));
  }

  /** The pane this header is for (peek.js describes a pane-less terminal instead). */
  target() {
    return panes().find((x) => x.pane === props()?.pane);
  }

  /** The machine its terminal runs on. */
  machine(p) {
    return spaces().find((s) => s.tabs.some((c) => c.id === p.tab))?.machine ?? null;
  }

  poll(cx) {
    const p = this.target();
    if (!isLazygit(p) || !p.cwd || this.polling) return;
    const on = this.machine(p);
    this.polling = true;
    cx.spawn(async (cx) => {
      try {
        const g = await gitState(p.cwd, on);
        if (JSON.stringify(g) !== JSON.stringify(this.git)) { this.git = g; cx.notify(); }
      } catch { /* unreachable: keep the last state */ }
      finally { this.polling = false; }
    });
  }

  startNaming(p) {
    this.naming = true;
    this.nameInput.set_value(givenName(p.terminal) ?? "");
    this.nameInput.focus();
  }

  name(value, cx) {
    const p = this.target();
    this.naming = false;
    cx.notify();
    if (!p?.terminal) return;
    nameTerminal(p.terminal, value);
    run("pane.focus", { pane: p.pane });
  }

  /** Starts naming when the pane menu asked about this pane, once per request. */
  answerNaming(p) {
    const ask = shared(NAME_PANE);
    if (!ask || ask.at === this.nameAsked) return;
    this.nameAsked = ask.at;
    if (p.terminal && ask.terminal === p.terminal) this.startNaming(p);
  }

  button(t, id, icon, command, args, tip) {
    const path = icon.includes("/") ? icon : `mods/pane/${icon}.svg`;
    return div().id(id).p(3).flex_none().text_color(t.dim)
      .hover((s) => s.text_color(t.foreground))
      .when(Boolean(tip), (el) => el.tooltip(tip))
      .on_click((_e, cx) => { cx.stop_propagation(); run(command, args); })
      .child(svg(path).size(12));
  }

  /** The lazygit pane's header: mark, name, folder and branch, then a band
   *  that thins out in three dithered steps toward the repo's counts. */
  lazygit(t, p) {
    const g = this.git, on = p.focused;
    const band = on ? t.accent : t.ansi0;
    const step = (o) => div().flex_1().h_full().relative().opacity(o).child(dither(band, 2));
    const count = (s, c) => div().flex_none().text_color(c).child(s);
    return this.frame(t, p)
      .child(svg("mods/workspace-chrome/git-branch.svg").size(11).flex_none().text_color(on ? t.ansi2 : t.dim))
      .child(div().min_w(0).truncate().text_color(on ? t.foreground : t.muted).child("Lazygit"))
      .when(this.width >= FOLDER_MIN && !(this.hovered && this.width < FULL_MIN), (el) => el.child(div().min_w(0).max_w(200).flex_shrink(50).truncate().text_color(t.dim).child(folder(p.cwd))))
      .when(Boolean(g?.branch || p.branch), (el) => el.child(div().min_w(0).max_w(180).flex_shrink(10).truncate().text_color(on ? t.ansi2 : t.muted).child(g?.branch || p.branch)))
      .child(h_flex().flex_1().min_w(8).h(6).gap(2).child(step(1)).child(step(0.6)).child(step(0.3)))
      .when(Boolean(g?.ahead), (el) => el.child(count(`↑${g.ahead}`, t.ansi4)))
      .when(Boolean(g?.behind), (el) => el.child(count(`↓${g.behind}`, t.ansi5)))
      .when(Boolean(g), (el) => el.child(g.changed ? count(`±${g.changed}`, t.ansi3) : count("clean", t.dim)));
  }

  mark(t, p) {
    return mark(t, p);
  }

  /** The row every header draws on: click focuses the pane, hover shows its buttons.
   *  Name, folder and branch truncate so a narrow pane still has
   *  room for every button: close, the last, used to be pushed off the edge. */
  frame(t, p) {
    return h_flex().id(`head-${p.pane}`).size_full().overflow_hidden().px(10).gap(8).items_center().bg(t.background)
      .text_size(11)
      .on_size_change((size, cx) => { if (Math.abs(size.width - this.width) >= 1) { this.width = size.width; cx.notify(); } })
      .on_hover((h, cx) => { this.hovered = h; cx.notify(); })
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.menu(p); })
      .on_click(() => run("pane.focus", { pane: p.pane }));
  }

  /** The pane menu (menu.js), as on a right-click: rename, split, zoom, even out, move, close. */
  menu(p) { paneMenu(p); }

  /** The tab strip's keyboard cursor in this header: the control's id, else null. */
  cursor(p) {
    const c = shared(CURSOR);
    return c?.region === "head" && c.pane === p.pane ? c.item : null;
  }

  /** One control (headerControls) as drawn; `on`: the keyboard's cursor is on it. */
  control(t, p, c, on) {
    const el = div().id(`h-${c.id}-${p.pane}`).relative().p(c.text ? 0 : 3).flex_none().text_color(on ? t.foreground : t.dim)
      .hover((s) => s.text_color(t.foreground))
      .when(Boolean(c.tip) && !c.text, (el) => el.tooltip(c.tip))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); c.go(); });
    const path = c.icon && (c.icon.includes("/") ? c.icon : `mods/pane/${c.icon}.svg`);
    return navRing(t, el.child(c.text ?? svg(path).size(12)), on);
  }

  /** The buttons: the text size while it differs; on hover all (wide) or
   *  zoom, ⋯ and close (narrow); with the keyboard's cursor here, all, ⋯ included. */
  buttons(t, el, p) {
    const all = headerControls(p).filter((c) => c.id !== "name");
    const at = this.cursor(p);
    const pick = (ids) => all.filter((c) => ids.includes(c.id));
    const shown = at ? all
      : !this.hovered ? pick(["fz"])
      : this.width >= FULL_MIN ? all.filter((c) => c.id !== "more")
      : pick(this.width >= SOME_MIN ? ["fz", "zoom", "close", "more"] : ["fz", "more"]);
    return el.children(shown.map((c) => this.control(t, p, c, at === c.id)));
  }

  render(cx) {
    const t = theme();
    const p = this.target();
    if (!p) return div();
    if (isLazygit(p)) return this.buttons(t, this.lazygit(t, p), p);
    // The pane menu's Rename is answered just after this render, from a task:
    // a render can't start the field and draw again (sky.js does the same).
    const ask = shared(NAME_PANE);
    if (ask && ask.at !== this.nameAsked) cx?.timer?.after(0, (cx) => { this.answerNaming(this.target() ?? p); cx.notify?.(); });
    const name = paneName(p);
    const st = p.status;
    const label = this.naming && p.terminal
      ? h_flex().min_w(60).w(200).child(field(t, `name-${p.pane}`, this.nameInput, (cx) => { this.naming = false; cx.notify(); }))
      : div().id(`h-n-${p.pane}`).relative().min_w(24).max_w(220).flex_shrink(1).truncate().text_color(p.focused ? t.foreground : t.muted)
        .map((el) => navRing(t, el, this.cursor(p) === "name"))
        .when(Boolean(p.terminal), (el) => el.on_mouse_down("left", (e, cx) => {
          if (e.click_count === 2) { cx.stop_propagation(); this.startNaming(p); cx.notify(); }
        }))
        .child(name);
    return this.buttons(t, this.frame(t, p)
      .child(this.mark(t, p))
      .when(Boolean(st) && st !== "idle", (el) => el.child(pip(t, st)))
      .child(label)
      // The folder gives way long before the name does (shrinks 50x faster), then goes.
      .when(this.width >= FOLDER_MIN && !(this.hovered && this.width < FULL_MIN) && !this.cursor(p) && Boolean(p.cwd), (el) => el.child(div().min_w(0).max_w(260).flex_shrink(50).truncate().text_color(t.dim).child(folder(p.cwd))))
      .child(div().flex_1().min_w(8).h(6).relative().child(dither(p.focused ? t.accent : t.ansi0, 2)))
      .when((st === "blocked" || st === "working") && this.width >= WORD_MIN, (el) => el.child(div().flex_none().text_color(t[st]).child(WORD[st]))), p);
  }
}
