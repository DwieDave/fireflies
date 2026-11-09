// A pane's header: name and folder, then a dithered band that fills the
// rest; the band turns moonfly blue on the pane with the keyboard. Hover
// shows text size (− / +, the % resets), float, split, zoom and close; a
// right-click opens the pane's menu (menu.js: split, zoom, move to another
// tab or a new one, close). Props from the app: { pane, terminal }.
// A lazygit pane (lazygit.js) gets its own: a git mark, the branch, and a
// band that fades out in steps toward ahead/behind and the changed files.

import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { panes, spaces, props, run, theme, home, openOverlay } from "herdr";
import { menuHeight } from "./menu.js";
import { ART, LOGO, dither, pip, WORD } from "./kit.js";
import { isLazygit, gitState } from "./lazygit.js";

// Mod panes: their name and mark (mods/workspace-chrome/<icon>.svg).
const MODS = {
  "nocturne-agents": ["Agents", "layers"], "nocturne-browser": ["Web", "monitor"],
  "nocturne-diff": ["Diff", "git-compare"], "nocturne-files": ["Files", "files"],
  "nocturne-usage": ["Usage", "clock"], nocturne: ["Worktrees", "git-branch"],
};
// Terminal programs with a fitting chrome icon; any other terminal gets "terminal".
const PROGRAMS = { nvim: "file-text", vim: "file-text", hx: "file-text", htop: "server", btop: "server" };

/** The pane's mark: an agent's dithered logo, else its mod's or program's icon. */
export function mark(t, p) {
  const color = p.focused ? t.accent : t.dim;
  const logo = LOGO[p.program?.key];
  const path = logo ? `${ART}/logo-${logo}.svg`
    : p.program?.agent ? `${ART}/logo-agent.svg`
    : `mods/workspace-chrome/${MODS[p.mod]?.[1] ?? PROGRAMS[p.program?.key] ?? "terminal"}.svg`;
  return svg(path).size(11).flex_none().text_color(color);
}

export function folder(cwd) {
  if (!cwd) return "";
  const h = home();
  return cwd === h ? "~" : cwd.startsWith(h + "/") ? "~" + cwd.slice(h.length) : cwd;
}

export default class Header {
  init(_props, cx) {
    this.hovered = false;
    this.git = null;
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

  button(t, id, icon, command, args) {
    const path = icon.includes("/") ? icon : `mods/pane/${icon}.svg`;
    return div().id(id).p(3).flex_none().text_color(t.dim)
      .hover((s) => s.text_color(t.foreground))
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
      .child(div().min_w(0).max_w(200).truncate().text_color(t.dim).child(folder(p.cwd)))
      .when(Boolean(g?.branch || p.branch), (el) => el.child(div().min_w(0).max_w(180).truncate().text_color(on ? t.ansi2 : t.muted).child(g?.branch || p.branch)))
      .child(h_flex().flex_1().min_w(12).h(6).gap(2).child(step(1)).child(step(0.6)).child(step(0.3)))
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
      .on_hover((h, cx) => { this.hovered = h; cx.notify(); })
      .on_mouse_down("right", (_e, cx) => {
        cx.stop_propagation();
        const props = { role: "menu", tab: "pane", target: { pane: p.pane, terminal: p.terminal } };
        openOverlay({ mod: "nocturne", kind: "popup", frame: "none", width: 240, height: menuHeight(props), props });
      })
      .on_click(() => run("pane.focus", { pane: p.pane }));
  }

  buttons(t, el, p) {
    const pane = p.pane;
    const zoom = p.font_zoom ?? 1, term = Boolean(p.terminal) && !p.mod;
    const chrome = (n) => `mods/workspace-chrome/${n}.svg`;
    return el
      // A pane's own text size shows while it differs; click to reset.
      .when(term && zoom !== 1, (el) => el.child(div().id(`h-fz-${pane}`).flex_none().text_color(t.dim)
        .hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => { cx.stop_propagation(); run("pane.font_reset", { pane }); })
        .child(`${Math.round(zoom * 100)}%`)))
      .when(this.hovered, (el) => el
      .when(term, (el) => el
        .child(this.button(t, `h-fs-${pane}`, chrome("minus"), "pane.font_smaller", { pane }))
        .child(this.button(t, `h-fb-${pane}`, chrome("plus"), "pane.font_bigger", { pane }))
        .child(this.button(t, `h-f-${pane}`, chrome("square"), "pane.float", { pane })))
      .child(this.button(t, `h-r-${pane}`, "split-right", "pane.split", { direction: "right", pane }))
      .child(this.button(t, `h-d-${pane}`, "split-down", "pane.split", { direction: "down", pane }))
      .child(this.button(t, `h-z-${pane}`, p.zoomed ? "unzoom" : "zoom", "pane.zoom", { pane }))
      .child(this.button(t, `h-x-${pane}`, "close", "pane.close", { pane })));
  }

  render() {
    const t = theme();
    const p = this.target();
    if (!p) return div();
    if (isLazygit(p)) return this.buttons(t, this.lazygit(t, p), p);
    const name = MODS[p.mod]?.[0] ?? (((p.program?.agent || p.program?.shell) && p.program.name) || p.title || p.program?.name || "shell");
    const st = p.status;
    return this.buttons(t, this.frame(t, p)
      .child(this.mark(t, p))
      .when(Boolean(st) && st !== "idle", (el) => el.child(pip(t, st)))
      .child(div().min_w(24).max_w(220).truncate().text_color(p.focused ? t.foreground : t.muted).child(name))
      .child(div().min_w(0).max_w(260).truncate().text_color(t.dim).child(folder(p.cwd)))
      .child(div().flex_1().min_w(12).h(6).relative().child(dither(p.focused ? t.accent : t.ansi0, 2)))
      .when(st === "blocked" || st === "working", (el) => el.child(div().flex_none().text_color(t[st]).child(WORD[st]))), p);
  }
}
