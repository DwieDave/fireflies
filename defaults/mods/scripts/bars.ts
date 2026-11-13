// The script runner's footer, the keys overview, the password bar, a run's
// output and the hint to grant a terminal app management.

import { div, svg } from "gpui-kit";
import type { Element } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { closeOverlay, exec, hc, shared, setShared, window as appWindow } from "herdr";
import type { Theme } from "herdr";
import { readSharedMap, writeSharedMap } from "./guard.ts";
import { APP_MANAGEMENT } from "./nix.ts";
import type { Run } from "./runs.ts";
import { elapsed, tone } from "./runs.ts";
import { keysHint, keysView } from "./keyhelp.ts";
import { CHORD, deckProps, SECTION, plain, ART, FOOT, PROMPTS, HEAD, short, INPUT } from "./state.ts";
import type { PasswordBar, Output, Item } from "./state.ts";
import { dither, toneColor } from "./paint.ts";
import { asked } from "./actions.ts";
import { actionChip, badge, keyHint } from "./rows-view.ts";
import type { default as ScriptsDeck } from "./main.ts";
import { deckKeys } from "./main.ts";
import { inPane, move } from "./place.ts";

/** Opens the App Management setting and shows Herdr Core in Finder, on the run's machine. */
export function openGrant(r: Run) {
  const on = { on: r.on };

  exec("sh", ["-c", APP_MANAGEMENT.open], on).catch(() => null);
}

/** The bar along the bottom: what the cursor is on, quietly, and the keys
 *  that act on it as caps. Never the raw shell line: that's what the
 *  script row's own aside is for. */
export function footBar(v: ScriptsDeck, t: Theme, cur: Item | undefined) {
  const bar = h_flex().relative().h(FOOT).flex_none().px(12).gap(10).items_center().text_size(11)
    .child(div().absolute().left(0).right(0).top(0).h(2).child(dither(t.ansi0, 1)));

  const left = (...kids: Element[]) => h_flex().flex_1().min_w(0).gap(6).items_center().children(kids);
  const keys = (...caps: (Element | null)[]) => h_flex().flex_none().gap(10).items_center().children(caps.flatMap((c) => (c === null ? [] : [c])));
  // Every bar ends with the keys entry: ?, or cmd-k ? while the filter takes what's typed.
  const help = keysHint(t, "k-help", v.help, () => { v.help = !v.help; }, v.typing ? CHORD : "?");

  if (v.help) return bar.child(left(div().text_color(t.dim).child("every key"))).child(keys(keyHint(t, "k-esc", "esc", "back"), help));

  if (v.output) {
    const r = v.output.r;

    return bar
      .child(left(div().flex_none().text_color(t.accent).child("↳"),
        badge(t, r.runner || "run", false),
        div().flex_none().text_color(toneColor(t, tone(r))).child(r.word),
        div().flex_none().text_color(t.dim).child(`after ${elapsed(r)}`)))
      .child(keys(v.output.grant ? keyHint(t, "k-grant", "o", "settings") : null, keyHint(t, "k-scroll", "j k", "scroll"), keyHint(t, "k-esc", "esc", "back"), help));
  }

  if (v.typing) {
    return bar
      .child(left(div().flex_none().text_color(t.accent).child("/"), div().min_w(0).truncate().text_color(t.muted).child(v.query ? `filtering "${v.query}"` : "type to filter")))
      .child(keys(keyHint(t, "k-enter", "enter", cur?.kind === "run" ? "watch" : "run"), keyHint(t, "k-esc", "esc", v.query ? "clear" : "list"), help));
  }

  if (!cur) return bar.child(left(div().truncate().text_color(t.dim).child(v.folder ? "" : "no folder here"))).child(keys(help));

  if (cur.kind === "run") {
    const r = cur.r;

    return bar
      .child(left(div().flex_none().text_color(t.accent).child("↳"), div().min_w(0).truncate().text_color(t.muted).child(r.name)))
      .child(keys(keyHint(t, "k-enter", "enter", r.live ? "watch" : "output"),
        keyHint(t, "k-stop", "x", asked(v, "stop", r) ? "x: stop it" : r.live ? "stop" : "remove"),
        keyHint(t, "k-again", "R", "again"), help));
  }

  return bar
    .child(left(div().flex_none().text_color(t.accent).child("↳"), div().min_w(0).truncate().text_color(t.muted)
      .child(cur.row.s.admin ? "asks for your password" : "in the background")))
    .child(keys(keyHint(t, "k-run", "enter", "run"), keyHint(t, "k-watch", "⇧enter", "& watch"), help));
}

/** ? : every key of the deck, in place of the scripts (keyhelp.ts). */
export function helpView(v: ScriptsDeck, t: Theme, h: number) {
  const rows = deckKeys(appWindow().platform === "macos" ? "⌘" : "ctrl-");

  return div().id("deck-help").relative().h(h).flex_none()
    .child(keysView(t, { id: "deck-keys", title: "scripts", list: rows, close: () => { v.help = false; } }));
}

/** The bar of a switch's password window (../nocturne/prompt.ts): its name,
 *  and cancel, which presses ctrl-c in the run (it ends "cancelled"). */
export function passwordBar(t: Theme, bar: PasswordBar) {
  const { address, name } = bar;

  const cancel = () => {
    writeSharedMap(setShared, PROMPTS, new Map([...readSharedMap(shared, PROMPTS), [address, { closed: true }]]));
    hc(["keys", address, "ctrl+c"]).catch(() => null);

    const overlay = deckProps().overlay;

    if (overlay !== undefined) closeOverlay(overlay);
  };

  return h_flex().id("pw-bar").size_full().px(12).gap(8).items_center().text_size(12)
    .child(svg(`${ART}/lock.svg`).size(9).flex_none().text_color(t.working))
    .child(div().flex_none().text_color(t.foreground).child(name))
    .child(div().flex_none().text_color(t.dim).child("· password"))
    .child(div().flex_1().h(1).relative().opacity(0.6).child(dither(t.ansi8, 1)))
    .child(div().flex_none().text_size(11).text_color(t.dim).child("type it, enter · ctrl-c cancels"))
    .child(actionChip(t, "pw-cancel", "cancel", t.blocked, cancel));
}

/** The output panel: the run's state, then its lines, the last ones at the bottom. */
export function outputView(v: ScriptsDeck, t: Theme, h: number, o: Output) {
  const { r, lines, back, grant } = o;
  const LINE = 15, HINT = 88;
  const shown = Math.max(1, Math.floor((h - SECTION - 12 - (grant ? HINT : 0)) / LINE));
  const all = lines ?? ["reading…"];
  const end = Math.max(0, all.length - back);
  const view = all.slice(Math.max(0, end - shown), end);

  o.shown = shown;

  return v_flex().id("output").h(h).flex_none()
    .on_scroll_wheel((e, cx) => {
      const step = Math.round(-e.delta.y / LINE);

      if (!step) return;

      o.back = Math.max(0, Math.min(all.length - shown, back - step));
      cx.notify();
    })
    .child(h_flex().h(SECTION).flex_none().px(12).pt(6).gap(8).items_center().text_size(11)
      .child(actionChip(t, "out-back", "‹ back", null, (cx) => { v.output = null; cx.notify(); }))
      .child(div().flex_none().text_color(t.foreground).child(r.name))
      .child(div().flex_1().h(1).relative().opacity(0.6).child(dither(t.ansi8, 1)))
      .child(div().flex_none().text_color(t.dim).child(back ? `${back} lines up` : "the end")))
    .when(grant, (el) => el.child(grantHint(t, r, HINT)))
    .child(v_flex().flex_1().min_h(0).overflow_hidden().px(12).pt(6).pb(6).justify_end()
      .children(view.map((l, i) => div().id(`ol-${i}`).h(LINE).flex_none().text_size(11).text_color(t.muted).truncate()
        .child(plain(l).replace(/ /g, " ") || " "))));
}

/** Why a nix-darwin switch couldn't update its apps, and the way to fix it
 *  (nix.ts APP_MANAGEMENT): open the setting and show Herdr Core in Finder. */
export function grantHint(t: Theme, r: Run, h: number) {
  return v_flex().id("grant").h(h).flex_none().mx(12).mt(6).px(10).py(6).gap(4)
    .border(1).border_color(t.blocked)
    .child(h_flex().h(22).flex_none().gap(8).items_center()
      .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.blocked).child("Couldn't update Nix Apps"))
      .child(div().id("grant-open").flex_none().h(22).px(8).flex().items_center().text_size(11)
        .bg(t.ansi0).text_color(t.foreground).cursor_pointer().hover((s) => s.bg(t.ansi8))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => { cx.stop_propagation(); openGrant(r); })
        .child("Open settings")))
    .child(div().text_size(11).line_height("15px").text_color(t.foreground).child(`${APP_MANAGEMENT.hint}.`));
}

/** The deck's head: its mark, "Scripts", the folder (and machine). */
/** ◧ into a pane, or from a pane ⧉ out over the tab (place.ts). */
function moveChip(v: ScriptsDeck, t: Theme): Element {
  const pane = inPane(v);

  return h_flex().id("scripts-move").flex_none().h(20).px(6).items_center().text_size(11).text_color(t.dim)
    .hover((s) => s.text_color(t.foreground))
    .tooltip(pane ? "Out over the tab · ctrl-t" : "Into a pane · ctrl-t")
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_click((_e, cx) => {
      cx.stop_propagation();
      move(v, cx);
      cx.notify();
    })
    .child(pane ? "⧉" : "◧");
}

export function deckHead(v: ScriptsDeck, t: Theme): Element {
  return h_flex().relative().h(HEAD).flex_none().px(12).gap(10).items_center()
        .child(svg(`${ART}/play.svg`).size(9).flex_none().text_color(t.accent))
        .child(div().flex_none().text_size(12).text_color(t.foreground).child("Scripts"))
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).flex().justify_end().child(short(v.folder) + (v.on ? ` on ${v.on}` : "")))
        .child(moveChip(v, t))
        .child(div().absolute().left(0).right(0).bottom(0).h(2).child(dither(t.ansi0, 1)));
}

/** The filter line: / and what's typed (a caret while typing), what's being
 *  read (nix, the folder) or the count of `n` scripts. */
export function filterLine(v: ScriptsDeck, t: Theme, n: number): Element {
  return h_flex().relative().h(INPUT).flex_none().mx(12).gap(8).items_center()
        .on_mouse_down("left", (_e, cx) => { v.typing = true; cx.notify(); })
        .child(div().flex_none().text_size(12).text_color(v.typing ? t.accent : t.dim).child("/"))
        .child(h_flex().flex_1().min_w(0).h_full().items_center().text_size(12)
          .when(Boolean(v.query), (el) => el.child(div().flex_none().text_color(t.foreground).child(v.query.replace(/ /g, " "))))
          .when(v.typing, (el) => el.child(div().flex_none().w(1).h(14).bg(t.accent).loop("opacity", { from: 0, to: 1, period: 1000 })))
          .when(!v.query && !v.typing, (el) => el.child(div().text_color(t.dim).child("filter"))))
        .child(div().flex_none().text_size(10).text_color(t.dim).child(v.nix === "evaluating" ? "nix…" : v.looking && v.scripts ? "looking…"
          : v.nix === "failed" ? `nix eval failed · ${n}` : n ? `${n}` : ""))
        .child(div().absolute().left(0).right(0).bottom(0).h(1).opacity(0.6).child(dither(t.ansi8, 1)));
}
