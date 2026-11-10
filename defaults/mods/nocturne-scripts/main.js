// The script runner's deck, in Nocturne's look: one square popover under the
// tab strip's ▶ (../nocturne/scripts.js), or centered from cmd-shift-r.
//
//   head     ▶ Scripts and the folder they come from: the space's own
//            folder, else the focused pane's (props { folder, on })
//   runs     every run (runs.js), running first, a pip and a count per
//            state in the header; each row a pip in its state's color, name, runner, running / ok / exit N / stopped, how long; the row
//            under the cursor or pointer shows watch, ↻ (again) and ■ (stop)
//            or ✕ (dismiss a finished one)
//   filter   type to fuzzy-match; ↑↓ move through runs and scripts alike
//   scripts  what the folder can run (detect.js), grouped by manifest with
//            the runner as a badge; the last ones run here come first
//   foot     what the cursor is on and its keys, as caps
//
// Enter runs a script in the background (a terminal with no pane) and closes
// the deck; shift-enter runs it and floats its terminal to watch. On a run:
// enter watches, cmd/ctrl-backspace stops (or dismisses), cmd/ctrl-r runs it
// again. Esc closes. props.focus "runs" starts the cursor on the runs.

import { View, div, svg, PathBuilder, Background } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { closeOverlay, exec, hc, home, notify, props, settings, shared, setShared, terminals, theme, window as appWindow } from "herdr";
import { PROBE, parseProbe, detect, rank } from "./detect.js";
import { FLAKE_SHOW, nixScripts, oldId, APP_MANAGEMENT, needsAppManagement } from "./nix.js";
import { runs, withEnded, ENDED, elapsed, tone, start, watch, stop, dismiss, restart } from "./runs.js";

const ART = "mods/nocturne/art";
// The tab strip's note that the deck is open (../nocturne/scripts.js DECK).
const DECK = "nocturne-scripts.deck";
// The last scripts run per folder, newest first: { "<machine>:<folder>": [id] }.
const RECENT = "nocturne-scripts.recent";
// What each folder had last time, shown at once while it's looked at again.
const FOUND = "nocturne-scripts.found";
// Each flake's last `nix flake show --json`: { "<machine>:<folder>": { at, show } }.
const FLAKE = "nocturne-scripts.flake";
// A flake evaluated this recently isn't evaluated again on the next open.
const FLAKE_FRESH = 30000;

const W = 420, H = 470;
const HEAD = 36, SECTION = 24, ROW = 26, INPUT = 32, FOOT = 26, RUNS_SHOWN = 5;
const TONE = { running: "working", ok: "done", failed: "blocked", stopped: "dim" };

// The dither fill, copied from ../nocturne/kit.js (a mod can't import another mod's files).
const RECT = () => PathBuilder.fill().move_to("0%", "0%").line_to("100%", "0%").line_to("100%", "100%").line_to("0%", "100%").close().build();
function dither(color, cell = 1) {
  const zoom = Number(settings()?.zoom) || 1;
  const dpr = appWindow()?.platform === "macos" ? 2 : 1;
  return window.paint_path(RECT(), Background.checkerboard(color, Math.max(1, Math.round(cell * zoom * dpr)))).absolute().top(0).left(0).size_full();
}
const eyebrow = (t, text) => div().text_size(11).text_color(t.ansi8).child(text.toUpperCase());

function short(folder) {
  if (!folder) return "";
  const h = home();
  return folder === h ? "~" : folder.startsWith(h + "/") ? "~" + folder.slice(h.length) : folder;
}

/** What a script row says beside its name: what it runs (package.json's
 *  line, a recipe's parameters), else its command when that says more than
 *  "<runner> <name>". */
function aside(s) {
  if (s.hint) return s.hint;
  const plain = [`${s.runner} ${s.name}`, `${s.runner} run ${s.name}`, `${s.runner} task ${s.name}`];
  return plain.includes(s.cmd) ? "" : s.cmd;
}

export default class ScriptsDeck extends View {
  init(_p, cx) {
    const p = props() ?? {};
    this.folder = p.folder ?? null;
    this.on = p.on ?? null;
    this.key = `${this.on ?? ""}:${this.folder ?? ""}`;
    this.scripts = shared(FOUND)?.[this.key] ?? null;
    this.looking = true;
    this.failed = null;
    this.query = "";
    this.cursor = p.focus === "runs" ? 0 : -1; // -1: the first script, once there are any
    this.output = null; // an ended run's output, shown in place of the scripts
    // Opened by nocturne.scripts-again: runs this folder's last script once it's found.
    this.again = Boolean(p.again);
    // Opened from a failure's toast: straight to that run's output.
    const shown = p.show && runs(withEnded(terminals(), shared(ENDED))).find((r) => r.address === p.show);
    if (shown && !shown.live) this.showOutput(shown, cx);
    this.hover = null;
    this.scroll = 0;
    this.input = InputState.new({ placeholder: "filter scripts" });
    this.input.on("change", (_e, cx) => { this.query = this.input.value(); this.cursor = -1; this.scroll = 0; cx.notify(); });
    this.input.focus();
    for (const ms of [60, 250, 600]) cx.timer.after(ms, () => this.input.focus());
    this.beat();
    // Elapsed times tick; the strip learns the deck is still open.
    cx.timer.every(1000, (cx) => { this.beat(); if (runs(withEnded(terminals(), shared(ENDED))).some((r) => r.live)) cx.notify(); });
    this.look(cx);
  }

  beat() {
    const id = props()?.overlay;
    if (id) setShared(DECK, { id, beat: Date.now() });
  }

  /** Reads the folder's manifests (one probe) and keeps what it found. */
  look(cx) {
    if (!this.folder) { this.looking = false; return; }
    cx.spawn(async (cx) => {
      try {
        const r = await exec("sh", ["-c", PROBE], { cwd: this.folder, on: this.on, timeout: 15000 });
        const probe = parseProbe(r.stdout);
        this.sys = probe.sys;
        this.base = detect(probe);
        this.failed = null;
        this.merge();
        if (probe.ls.has("flake.nix")) this.evalFlake(cx);
        this.runAgain(cx);
      } catch (e) {
        this.failed = String(e?.message ?? e);
      }
      this.looking = false;
      cx.notify();
    });
  }

  /** nocturne.scripts-again: the last script picked here, picked again. */
  runAgain(cx) {
    if (!this.again) return;
    this.again = false;
    const s = this.scripts?.find((x) => x.id === this.recent()[0]);
    if (s) this.go(s, false, cx);
    else notify({ title: "nothing to run again", body: `no script picked in ${short(this.folder)} yet`, level: "info" });
  }

  /** The folder's scripts and its flake's (the last evaluation), each group
   *  together in the order it first shows up; kept for the next open. */
  merge() {
    const show = shared(FLAKE)?.[this.key]?.show;
    const all = [...(this.base ?? []), ...(show ? nixScripts(show, this.sys) : [])];
    // A group holding this machine's own configuration leads.
    const groups = [...new Set(all.map((s) => s.group))];
    const mine = new Set(all.filter((s) => s.here).map((s) => s.group));
    const order = [...groups.filter((g) => mine.has(g)), ...groups.filter((g) => !mine.has(g))];
    this.scripts = order.flatMap((g) => all.filter((s) => s.group === g));
    const found = { ...(shared(FOUND) ?? {}) };
    delete found[this.key];
    // The last dozen folders, the newest last.
    setShared(FOUND, Object.fromEntries([...Object.entries(found).slice(-11), [this.key, this.scripts]]));
  }

  /** `nix flake show` in the background: the picker shows the last result
   *  meanwhile, and keeps it when nix is missing or the evaluation fails. */
  evalFlake(cx) {
    const last = shared(FLAKE)?.[this.key];
    if (last && Date.now() - (last.at ?? 0) < FLAKE_FRESH) return;
    this.nix = "evaluating";
    cx.spawn(async (cx) => {
      try {
        const r = await exec("nix", FLAKE_SHOW, { cwd: this.folder, on: this.on, timeout: 180000 });
        const show = r.code === 0 ? JSON.parse(r.stdout) : null;
        if (show) {
          const all = { ...(shared(FLAKE) ?? {}) };
          delete all[this.key];
          setShared(FLAKE, Object.fromEntries([...Object.entries(all).slice(-11), [this.key, { at: Date.now(), show }]]));
          this.nix = null;
          this.merge();
        } else this.nix = "failed";
      } catch {
        this.nix = "missing";
      }
      cx.notify();
    });
  }

  dismissDeck() {
    const id = props()?.overlay;
    if (id) closeOverlay(id);
  }

  /** The overlay is going, however it goes. */
  async close() {
    if (shared(DECK)?.id === props()?.overlay) setShared(DECK, null);
  }

  recent() {
    return (shared(RECENT)?.[this.key] ?? []).map(oldId);
  }

  /** Runs a script in the background; `look`: float its terminal too. */
  /** Runs a script in the background; `look`: float its terminal too. The
   *  strip does the starting (runs.js start queues it), so the deck can close
   *  at once without taking the start with it. */
  go(s, look) {
    const ids = [s.id, ...this.recent().filter((x) => x !== s.id)].slice(0, 20);
    setShared(RECENT, { ...(shared(RECENT) ?? {}), [this.key]: ids });
    start(s, this.folder, this.on, look);
    this.dismissDeck();
  }

  act(what, r, cx) {
    // A run that ended has no terminal to float: its output shows here instead.
    if (what === "watch" && !r.live) return this.showOutput(r, cx);
    if (what === "watch") { this.dismissDeck(); return watch(r); }
    // Queued for the strip (runs.js), like a start: closing the deck can't cut them short.
    if (what === "stop") stop(r);
    else if (what === "dismiss") dismiss(r);
    else if (what === "again") restart(r);
    cx.notify();
  }

  /** Shows an ended run's last output lines in place of the scripts (esc: back). */
  showOutput(r, cx) {
    this.output = { r, lines: null, back: 0 };
    cx.notify();
    cx.spawn(async (cx) => {
      const res = await hc(["read", r.address, "--lines", "300"]).catch(() => null);
      if (this.output?.r.address !== r.address) return;
      const text = res?.code === 0 ? res.stdout : null;
      this.output.lines = text == null ? ["(its output is gone)"] : text.replace(/\s+$/, "").split("\n");
      this.output.grant = needsAppManagement(r, text);
      cx.notify();
    });
  }

  /** The output panel: the run's state, then its lines, the last ones at the bottom. */
  outputView(t, h) {
    const { r, lines, back, grant } = this.output;
    const LINE = 15, HINT = 88;
    const shown = Math.max(1, Math.floor((h - SECTION - 12 - (grant ? HINT : 0)) / LINE));
    const all = lines ?? ["reading…"];
    const end = Math.max(0, all.length - back);
    const view = all.slice(Math.max(0, end - shown), end);
    return v_flex().id("output").h(h).flex_none()
      .on_scroll_wheel((e, cx) => {
        const step = Math.round(-e.delta.y / LINE);
        if (!step) return;
        this.output.back = Math.max(0, Math.min(all.length - shown, back - step));
        cx.notify();
      })
      .child(h_flex().h(SECTION).flex_none().px(12).pt(6).gap(8).items_center().text_size(11)
        .child(this.action(t, "out-back", "‹ back", null, (cx) => { this.output = null; cx.notify(); }))
        .child(div().flex_none().text_color(t.foreground).child(r.name))
        .child(div().flex_1().h(1).relative().opacity(0.6).child(dither(t.ansi8, 1)))
        .child(div().flex_none().text_color(t.dim).child(back ? `${back} lines up` : "the end")))
      .when(Boolean(grant), (el) => el.child(this.grantHint(t, r, HINT)))
      .child(v_flex().flex_1().min_h(0).overflow_hidden().px(12).pt(6).pb(6).justify_end()
        .children(view.map((l, i) => div().id(`ol-${i}`).h(LINE).flex_none().text_size(11).text_color(t.muted).truncate()
          .child(l.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/ /g, "\u00a0") || "\u00a0"))));
  }

  /** Why a nix-darwin switch couldn't update its apps, and the way to fix it
   *  (nix.js APP_MANAGEMENT): open the setting and show Herdr Core in Finder. */
  grantHint(t, r, h) {
    return v_flex().id("grant").h(h).flex_none().mx(12).mt(6).px(10).py(6).gap(4)
      .border(1).border_color(t.blocked)
      .child(h_flex().h(22).flex_none().gap(8).items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.blocked).child("App Management needed"))
        .child(div().id("grant-open").flex_none().h(22).px(8).flex().items_center().text_size(11)
          .bg(t.ansi0).text_color(t.foreground).cursor_pointer().hover((s) => s.bg(t.ansi8))
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_click((_e, cx) => { cx.stop_propagation(); exec("sh", ["-c", APP_MANAGEMENT.open], { on: r.on }).catch(() => null); })
          .child("Open settings")))
      .child(div().text_size(11).line_height("15px").text_color(t.foreground).child(`${APP_MANAGEMENT.hint}.`));
  }

  // ---- parts

  pip(t, color, live) {
    const el = svg(`${ART}/pip.svg`).size(6).flex_none().text_color(color);
    return live ? el.loop("opacity", { from: 0.3, to: 1, period: 1600 }) : el;
  }

  badge(t, text, on, w) {
    return div().flex_none().h(14).px(4).when(Boolean(w), (el) => el.w(w).justify_center()).flex().items_center()
      .border(1).border_color(on ? t.ansi8 : t.ansi0).text_size(9).text_color(on ? t.muted : t.dim).child(text);
  }

  section(t, label, aside) {
    return h_flex().h(SECTION).flex_none().px(12).pt(6).gap(8).items_center()
      .child(eyebrow(t, label))
      .child(div().flex_1().h(1).relative().opacity(0.6).child(dither(t.ansi8, 1)))
      .when(Boolean(aside), (el) => el.child(typeof aside === "string" ? div().flex_none().text_size(10).text_color(t.dim).child(aside) : aside));
  }

  /** The row under the cursor: a dithered band and a blue edge, like Nocturne's menus. */
  band(el, t, on) {
    return el.when(on, (el) => el.child(dither(t.ansi0, 1)).child(div().absolute().left(0).top(0).bottom(0).w(2).bg(t.accent)));
  }

  action(t, id, label, color, go) {
    return div().id(id).relative().flex_none().px(3).text_size(11).text_color(t.dim)
      .hover((s) => s.text_color(color ?? t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); go(cx); })
      .child(label);
  }

  runRow(t, r, i, on) {
    const color = t[TONE[tone(r)]];
    const show = on || this.hover === `r${i}`;
    return this.band(h_flex().id(`run-${i}`).relative().h(ROW).flex_none().px(12).gap(8).items_center().text_size(12)
      .text_color(on ? t.foreground : r.live ? t.muted : t.dim)
      .on_hover((h, cx) => { const k = h ? `r${i}` : this.hover === `r${i}` ? null : this.hover; if (k !== this.hover) { this.hover = k; cx.notify(); } })
      .on_click((_e, cx) => this.act("watch", r, cx)), t, on)
      .child(div().relative().w(8).flex_none().flex().items_center().child(this.pip(t, color, r.live)))
      .child(h_flex().relative().flex_1().min_w(0).gap(6).items_center()
        .child(div().min_w(0).truncate().child(r.name))
        .when(Boolean(r.admin), (el) => el.child(this.lock(t, on))))
      .when(Boolean(r.runner), (el) => el.child(div().relative().child(this.badge(t, r.runner, on))))
      .child(div().relative().w(58).flex_none().text_size(11).truncate().text_color(r.reason === "killed" ? t.dim : color).child(r.word))
      .child(div().relative().w(46).flex_none().text_size(11).text_color(t.dim).flex().justify_end().child(elapsed(r)))
      .child(h_flex().relative().w(64).flex_none().justify_end().gap(1)
        .when(show, (el) => el
          .child(this.action(t, `w-${i}`, "watch", null, (cx) => this.act("watch", r, cx)))
          .child(this.action(t, `a-${i}`, "↻", null, (cx) => this.act("again", r, cx)))
          .child(r.live
            ? this.action(t, `s-${i}`, "■", t.blocked, (cx) => this.act("stop", r, cx))
            : this.action(t, `d-${i}`, "✕", null, (cx) => this.act("dismiss", r, cx)))));
  }

  /** A script's name, the matched letters in blue. */
  name(t, text, hits, base) {
    if (!hits?.length) return div().truncate().text_color(base).child(text);
    const parts = [];
    let cur = "", lit = false;
    [...text].forEach((ch, i) => {
      const h = hits.includes(i);
      if (h !== lit && cur) { parts.push([cur, lit]); cur = ""; }
      lit = h;
      cur += ch;
    });
    if (cur) parts.push([cur, lit]);
    return h_flex().min_w(0).overflow_hidden().children(parts.map(([s, h]) => div().flex_none().text_color(h ? t.accent : base).child(s.replace(/ /g, " "))));
  }

  scriptRow(t, row, i, on, running) {
    const s = row.s;
    return this.band(h_flex().id(`sc-${i}`).relative().h(ROW).flex_none().px(12).gap(10).items_center().text_size(12)
      .on_hover((h, cx) => { if (h && this.cursor !== i) { this.cursor = i; cx.notify(); } })
      .on_click((e, cx) => this.go(s, Boolean(e?.modifiers?.shift), cx)), t, on)
      .child(div().relative().child(this.badge(t, s.runner, on, 52)))
      .child(h_flex().relative().flex_none().max_w(250).min_w(0).gap(6).items_center()
        .child(this.name(t, s.name, row.hits, on ? t.foreground : t.muted))
        .when(Boolean(s.admin), (el) => el.child(this.lock(t, on)))
        .when(Boolean(s.here), (el) => el.child(div().flex_none().text_size(10).text_color(t.accent)
          .child(String(this.sys?.os).toLowerCase() === "darwin" ? "this mac" : "this machine")))
        .when(running, (el) => el.child(this.pip(t, t.working, true))))
      // The name comes first; what it runs takes the room that's left.
      .child(h_flex().relative().flex_1().min_w(0).justify_end()
        .child(div().min_w(0).truncate().text_size(11).text_color(on ? t.muted : t.dim).child(aside(s))));
  }

  /** Runs as root (asks for a password first): a small pixel lock. */
  lock(t, on) {
    return svg(`${ART}/lock.svg`).size(9).flex_none().text_color(on ? t.working : t.dim);
  }

  /** A key as a small square cap, then what it does (the palette's keycaps). */
  hint(t, id, key, what) {
    return h_flex().id(id).flex_none().gap(4).items_center()
      .child(div().h(15).px(4).flex().items_center().border(1).border_color(t.ansi0).text_size(10).text_color(t.muted).child(key))
      .child(div().text_size(10).text_color(t.dim).child(what));
  }

  /** The bar along the bottom: what the cursor is on, quietly, and the keys
   *  that act on it as caps. Never the raw shell line: that's what the
   *  script row's own aside is for. */
  foot(t, cur) {
    const mac = appWindow()?.platform === "macos";
    const cmd = mac ? "⌘" : "ctrl";
    const bar = h_flex().relative().h(FOOT).flex_none().px(12).gap(10).items_center().text_size(11)
      .child(div().absolute().left(0).right(0).top(0).h(2).child(dither(t.ansi0, 1)));
    const left = (...kids) => h_flex().flex_1().min_w(0).gap(6).items_center().children(kids);
    const keys = (...caps) => h_flex().flex_none().gap(10).items_center().children(caps);
    if (this.output) {
      const r = this.output.r;
      return bar
        .child(left(div().flex_none().text_color(t.accent).child("↳"),
          this.badge(t, r.runner || "run", false),
          div().flex_none().text_color(t[TONE[tone(r)]]).child(r.word),
          div().flex_none().text_color(t.dim).child(`after ${elapsed(r)}`)))
        .child(keys(this.hint(t, "k-esc", "esc", "back")));
    }
    if (!cur) return bar.child(left(div().truncate().text_color(t.dim).child(this.folder ? "" : "no folder here")));
    if (cur.kind === "run") {
      const r = cur.r;
      return bar
        .child(left(div().flex_none().text_color(t.accent).child("↳"), div().min_w(0).truncate().text_color(t.muted).child(r.name)))
        .child(keys(this.hint(t, "k-enter", "enter", r.live ? "watch" : "output"),
          this.hint(t, "k-stop", `${cmd}⌫`, r.live ? "stop" : "dismiss"),
          this.hint(t, "k-again", `${cmd}R`, "again")));
    }
    return bar
      .child(left(div().flex_none().text_color(t.accent).child("↳"), div().min_w(0).truncate().text_color(t.muted)
        .child(cur.row.s.admin === "osascript" ? "asks for a password first" : cur.row.s.admin ? "sudo asks in its terminal" : "in the background")))
      .child(keys(this.hint(t, "k-run", "enter", "run"), this.hint(t, "k-watch", "⇧enter", "run & watch")));
  }

  /** The runs header's aside: a pip and a count for each state there is. */
  tally(t, all) {
    const n = (k) => all.filter((r) => tone(r) === k).length;
    const parts = [["running", n("running")], ["failed", n("failed")], ["ok", n("ok")], ["stopped", n("stopped")]].filter(([, c]) => c);
    return h_flex().flex_none().gap(8).items_center().children(parts.map(([k, c]) => h_flex().id(`tally-${k}`).gap(4).items_center()
      .child(this.pip(t, t[TONE[k]], false))
      .child(div().text_size(10).text_color(k === "running" ? t.muted : t.dim).child(String(c)))));
  }

  empty(t) {
    const say = !this.folder ? "No folder here: open a space or focus a terminal in one."
      : this.failed ? `Couldn't look in ${short(this.folder)}: ${this.failed}`
      : this.looking && !this.scripts ? "looking…"
      : this.query ? `Nothing matches "${this.query}".`
      : `Nothing to run in ${short(this.folder)}: no package.json, justfile, Makefile, Cargo.toml, deno.json, pyproject.toml, Taskfile, mise.toml, composer.json, go.mod, scripts/ or bin/.`;
    return div().px(12).py(12).text_size(11).text_color(t.dim).child(say);
  }

  key(e, cx, items) {
    const m = e.modifiers ?? {};
    const k = String(e.key ?? "").toLowerCase();
    const n = items.length;
    const cur = items[this.cursor];
    const cmd = m.platform || m.control;
    if (k === "escape") {
      cx.stop_propagation();
      if (this.output) { this.output = null; return cx.notify(); }
      return this.dismissDeck();
    }
    if (k === "down" || k === "up") {
      if (n) this.cursor = Math.max(0, Math.min(n - 1, this.cursor + (k === "down" ? 1 : -1)));
    } else if (k === "enter") {
      if (!cur) return;
      cx.stop_propagation();
      return cur.kind === "run" ? this.act("watch", cur.r, cx) : this.go(cur.row.s, Boolean(m.shift), cx);
    } else if (cmd && k === "backspace" && cur?.kind === "run") {
      this.act(cur.r.live ? "stop" : "dismiss", cur.r, cx);
    } else if (cmd && k === "r" && cur?.kind === "run") {
      this.act("again", cur.r, cx);
    } else return;
    cx.stop_propagation();
    cx.notify();
  }

  render() {
    const t = theme();
    const all = runs(withEnded(terminals(), shared(ENDED)));
    const rows = this.scripts ? rank(this.scripts, this.query, this.recent()) : [];
    const items = [...all.map((r) => ({ kind: "run", r })), ...rows.map((row) => ({ kind: "script", row }))];
    // The cursor starts on the first script that needs no password: a stray
    // enter shouldn't open an administrator dialog.
    if (this.cursor < 0 || this.cursor >= items.length) {
      const safe = rows.findIndex((r) => !r.s.admin);
      this.cursor = rows.length ? all.length + Math.max(0, safe) : Math.max(0, Math.min(this.cursor, items.length - 1));
    }
    // The run whose output shows keeps the cursor.
    if (this.output && !this.output.placed) {
      const i = all.findIndex((r) => r.address === this.output.r.address);
      if (i >= 0) this.cursor = i;
      this.output.placed = true;
    }
    const cur = items[this.cursor];
    const runningIds = new Set(all.filter((r) => r.live && r.folder === this.folder).map((r) => r.id));

    // The runs: up to RUNS_SHOWN rows tall; the rest scroll.
    const runsH = all.length ? SECTION + Math.min(all.length, RUNS_SHOWN) * ROW + 4 : 0;
    const listH = H - 2 - HEAD - runsH - INPUT - FOOT - 4;

    // The scripts: each row (and its group's head) at a fixed y, scrolled to keep the cursor in sight.
    const tops = [];
    let y = 0;
    rows.forEach((r, i) => {
      const head = !this.query.trim() && (i === 0 || r.head !== rows[i - 1].head);
      tops.push({ head, title: y, row: y + (head ? SECTION : 0) });
      y += (head ? SECTION : 0) + ROW;
    });
    const max = Math.max(0, y - listH);
    const sel = cur?.kind === "script" ? tops[this.cursor - all.length] : null;
    if (sel) {
      const from = sel.head ? sel.title : sel.row;
      if (from < this.scroll) this.scroll = from;
      if (sel.row + ROW > this.scroll + listH) this.scroll = sel.row + ROW - listH;
    }
    this.scroll = Math.max(0, Math.min(this.scroll, max));
    const list = [];
    rows.forEach((r, i) => {
      const { head, title, row } = tops[i];
      const vis = (a, b) => b > this.scroll && a < this.scroll + listH;
      const at = (el, a, b) => el.absolute().left(0).right(0).top(a - this.scroll).h(b - a);
      if (head && vis(title, row)) {
        const runner = r.head === "recent" ? null : r.s.runner;
        list.push(at(div().id(`h-${i}`), title, row).child(this.section(t, r.head, runner)));
      }
      if (vis(row, row + ROW)) list.push(at(div().id(`r-${i}`), row, row + ROW).child(this.scriptRow(t, r, all.length + i, this.cursor === all.length + i, runningIds.has(r.s.id))));
    });

    return v_flex().id("nocturne-scripts").size_full().bg(t.background).border(1).border_color(t.ansi0)
      .on_key_down((e, cx) => this.key(e, cx, items))
      .child(h_flex().relative().h(HEAD).flex_none().px(12).gap(10).items_center()
        .child(svg(`${ART}/play.svg`).size(9).flex_none().text_color(t.accent))
        .child(div().flex_none().text_size(12).text_color(t.foreground).child("Scripts"))
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).flex().justify_end().child(short(this.folder) + (this.on ? ` on ${this.on}` : "")))
        .child(div().absolute().left(0).right(0).bottom(0).h(2).child(dither(t.ansi0, 1))))
      .when(all.length > 0, (el) => el
        .child(this.section(t, "runs", this.tally(t, all)))
        .child(v_flex().id("runs").h(Math.min(all.length, RUNS_SHOWN) * ROW).flex_none().overflow_y_scroll()
          .children(all.map((r, i) => this.runRow(t, r, i, this.cursor === i))))
        .child(div().h(4).flex_none()))
      .when(Boolean(this.output), (el) => el.child(this.outputView(t, INPUT + 4 + listH)))
      .when(!this.output, (el) => el.child(h_flex().relative().h(INPUT).flex_none().mx(12).gap(8).items_center()
        .child(div().flex_none().text_size(12).text_color(t.accent).child("›"))
        .child(Input.new(this.input).flex_1().h_full().text_size(12).text_color(t.foreground))
        .child(div().flex_none().text_size(10).text_color(t.dim).child(this.nix === "evaluating" ? "nix…" : this.looking && this.scripts ? "looking…"
          : this.nix === "failed" ? `nix eval failed · ${rows.length}` : rows.length ? `${rows.length}` : ""))
        .child(div().absolute().left(0).right(0).bottom(0).h(1).opacity(0.6).child(dither(t.ansi8, 1))))
      .child(rows.length
        ? div().id("scripts").relative().h(listH).flex_none().overflow_hidden().mt(4)
          .on_scroll_wheel((e, cx) => {
            this.scroll = Math.max(0, Math.min(this.scroll - e.delta.y, max));
            const first = all.length;
            while (this.cursor >= first && this.cursor < items.length - 1 && tops[this.cursor - first].row < this.scroll) this.cursor++;
            while (this.cursor > first && tops[this.cursor - first].row + ROW > this.scroll + listH) this.cursor--;
            cx.notify();
          })
          .children(list)
        : v_flex().h(listH).flex_none().mt(4).child(this.empty(t))))
      .child(this.foot(t, cur));
  }
}
