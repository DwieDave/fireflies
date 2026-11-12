// The processes and ports manager, in Nocturne's look: one square popover
// under the tab strip's tree mark (../nocturne/procs.js), or centered from
// nocturne.procs / nocturne.ports and the palette. This machine only.
//
//   head       the tree mark, "Processes", its two tabs (processes | ports,
//              each with its count), and what's listed: "fireflies" (this
//              app's terminals) or "all of <user>'s" (a switches)
//   processes  a tree: space › tab › terminal › the terminal's process and
//              everything it started (shells, agents, dev servers, builds);
//              terminals without a pane under "no pane"; spaces on another
//              machine as a note. With a, every process of Developer's, each
//              whose parent isn't his (launchd's children) a root. Each row:
//              name, arguments (cut), the ports it listens on, cpu, memory,
//              how long it has run, pid. The selected row opens a detail
//              block: the whole command line, pid, parent, cpu, memory, up.
//   ports      the TCP ports his processes listen on, those in this app's
//              terminals first: port, process, where it runs; on the cursor's
//              row open ↗ (a web pane), copy (http://localhost:<port>), end
//   system     live graphs, dithered, the last minute and a half (a reading
//              every 2 s while the deck is open, none while it's closed):
//              CPU, GPU, memory, disk and network, each with its value now
//              (sys.js has the sources); a source this machine lacks says so
//   foot       what the cursor is on and its keys
//
// The selected process's detail block carries its own CPU and memory over
// the readings since the deck opened, as two small graphs.
//
// Ending asks first, in the deck: a red band under the row names what ends
// (and what's under it, for X). enter sends TERM; two seconds on, the ones
// still running are named and K sends KILL (esc leaves them). The app
// itself, herdr-core, its holders, launchd and other users' processes carry a
// shield and can't be ended from here (logic.js guardOf).
//
// It reads everything once a refresh (logic.js PROBE: ps and lsof), every
// 2 s while open; the cursor stays on its pid (or port) across refreshes.
//
// Keys (the deck has the keyboard from the moment it opens):
//   j k ↑ ↓ move · g G home end first / last · pgup pgdn a page
//   h ← fold, or up to the parent · l → unfold, or into the first child
//   space fold or unfold · enter: a group folds, a process or terminal shows
//   its terminal's pane, a port opens
//   tab 1 2 3 processes / ports / system · a this app's terminals / all of yours
//   x end · X end it and everything under it · K kill -9 what held on
//   o open the port in a web pane · c copy the address (a process: its
//   command line) · r read again now · / find (esc clears, again: back)
//   ? keys · q esc close
// nocturne-procs.focus gives the deck the keyboard back; nocturne-procs.keys
// shows its keys.

import { View, div, svg, PathBuilder, Background } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { closeOverlay, exec, focused, home, nextCommand, notify, panes, props, run, settings, shared, setShared, spaces, terminals, theme, window as appWindow } from "herdr";
import { PROBE, parseProbe, index, buildTree, flatten, place, targets, guardOf, endGently, signal, address, terminalOf, whereIs, openPort, uptime, memory, oneLine, count } from "./logic.js";
import { SYS_PROBE, KEEP, STEP, parseSys, measure, push, rate, size, scale } from "./sys.js";
import { hint, keysHint, keysView, keysKey } from "./keyhelp.js";

const ART = "mods/nocturne/art";
// The strip's note that the deck is open (../nocturne/procs.js DECK, COUNT).
const DECK = "nocturne-procs.deck";
const COUNT = "nocturne-procs.count";
const CONTEXT = "NocturneProcsDeck";
const ESCAPE = "nocturne_procs_escape";
export const REFRESH = 2000;
export const GRACE = 2000;

const W = 480, H = 560;
const HEAD = 36, COLS = 18, ROW = 24, PROW = 30, FOOT = 26, IND = 14, DETAIL = 66, CONFIRM = 76;
const LIST_H = H - 2 - HEAD - COLS - FOOT;
// The system tab: five graphs, KEEP bars each, the newest at the right.
const GRAPH_W = W - 2 - 24, GRAPH_H = 48, SLOT = Math.floor(GRAPH_W / KEEP), BAR = SLOT - 2;
const SPARK = 30;
const PORTS_H = H - 2 - HEAD - FOOT;

// The dither fill, copied from ../nocturne/kit.js (a mod can't import another mod's files).
const RECT = () => PathBuilder.fill().move_to("0%", "0%").line_to("100%", "0%").line_to("100%", "100%").line_to("0%", "100%").close().build();
function dither(color, cell = 1) {
  const zoom = Number(settings()?.zoom) || 1;
  const dpr = appWindow()?.platform === "macos" ? 2 : 1;
  return window.paint_path(RECT(), Background.checkerboard(color, Math.max(1, Math.round(cell * zoom * dpr)))).absolute().top(0).left(0).size_full();
}

function short(folder) {
  if (!folder) return "";
  const h = home();
  return folder === h ? "~" : folder.startsWith(h + "/") ? "~" + folder.slice(h.length) : folder;
}

/** What ? lists: every key onKey() takes. */
export const deckKeys = () => [
  ["j k ↑ ↓", "move"], ["g G home end", "first / last"], ["pgup pgdn", "a page"],
  ["h ←", "fold, or up to the parent"], ["l →", "unfold, or into the first child"], ["space", "fold or unfold"],
  ["enter", "a group: fold · a process: show its terminal · a port: open it"],
  ["tab 1 2 3", "processes / ports / system"], ["a", "this app's terminals / all of yours"],
  ["x", "end it (TERM, asks first)"], ["X", "end it and everything under it"], ["K", "kill -9 what held on"],
  ["o", "open the port in a web pane"], ["c", "copy the address · a process: its command line"],
  ["r", "read again now"], ["/", "find (esc clears, again: back)"], ["q esc", "close"], ["?", "keys"],
];

export default class ProcsDeck extends View {
  init(_p, cx) {
    const p = props() ?? {};
    this.tab = ["ports", "system"].includes(p.tab) ? p.tab : "procs";
    // The system graphs' histories (sys.js), the last reading's values, and each process's own.
    this.sys = { cpu: [], gpu: [], mem: [], disk: [], rx: [], tx: [] };
    this.now = null;
    this.hist = new Map(); // pid -> { cpu: [], rss: [] }
    this.all = false;
    this.snap = null; // { me, procs, ports }
    this.failed = null;
    this.folds = {};
    this.query = "";
    this.typing = false;
    this.cur = { procs: { key: null, at: 0 }, ports: { key: null, at: 0 }, system: { key: null, at: 0 } };
    this.scroll = { procs: 0, ports: 0 };
    this.ask = null; // { pids, key, tree, phase: ask | ending | held, left, name, tab }
    this.note = null; // { text, tone, until }
    this.help = false;
    this.hover = null;
    this.handle = cx.focus_handle();
    this.handle.focus();
    for (const ms of [60, 250, 600]) cx.timer.after(ms, () => this.handle.focus());
    cx.spawn(async (cx) => {
      for (;;) {
        const c = String(await nextCommand()).replace(/^nocturne-procs\./, "");
        if (c === "focus") this.handle.focus();
        else if (c === "keys") { this.help = !this.help; cx.notify(); }
      }
    });
    if (!ProcsDeck.bound) {
      try {
        cx.bind_keys([{ keystroke: "escape", action: ESCAPE, context: CONTEXT }]);
        ProcsDeck.bound = true;
      } catch { /* esc then closes the deck, as the overlay's */ }
    }
    this.beat();
    this.refresh(cx);
    this.sample(cx);
    cx.timer.every(REFRESH, (cx) => { this.beat(); this.refresh(cx); });
    cx.timer.every(STEP, (cx) => this.sample(cx));
  }

  /** The strip learns the deck is open (and which tab); a tab the strip asked for (nocturne.ports) is taken. */
  beat() {
    const id = props()?.overlay;
    if (!id) return;
    const d = shared(DECK);
    if (d?.id === id && d.want && d.want !== this.tab) { this.tab = d.want; this.ask = null; }
    setShared(DECK, { id, tab: this.tab, beat: Date.now() });
  }

  /** One probe; the cursor stays on its row's key. */
  refresh(cx) {
    if (this.reading) return;
    this.reading = true;
    cx.spawn(async (cx) => {
      try {
        const r = await exec("sh", ["-c", PROBE], { timeout: 10000 });
        this.snap = parseProbe(r?.stdout ?? "");
        this.ix = index(this.snap.procs);
        this.track(this.snap.procs);
        this.failed = this.snap.procs.length ? null : (r?.stderr || "ps printed nothing").trim();
        setShared(COUNT, { at: Date.now(), n: this.portList().filter((x) => x.term).length });
      } catch (e) {
        this.failed = String(e?.message ?? e);
      }
      this.reading = false;
      cx.notify();
    });
  }

  /** Each process's cpu and memory, a reading a refresh (the gone ones forgotten). */
  track(procs) {
    const next = new Map();
    for (const p of procs) {
      const h = this.hist.get(p.pid);
      next.set(p.pid, { cpu: push(h?.cpu, p.cpu, 30), rss: push(h?.rss, p.rss, 30) });
    }
    this.hist = next;
  }

  /** One system reading (sys.js SYS_PROBE, about a second: iostat measures one). */
  sample(cx) {
    if (this.sampling) return;
    this.sampling = true;
    cx.spawn(async (cx) => {
      try {
        const r = await exec("sh", ["-c", SYS_PROBE], { timeout: 10000 });
        const reading = parseSys(r?.stdout ?? "");
        const m = measure(reading, this.sysReading);
        this.sysReading = reading;
        this.now = m;
        const s = this.sys;
        s.cpu = push(s.cpu, m.cpu?.pct ?? null);
        s.gpu = push(s.gpu, m.gpu?.pct ?? null);
        s.mem = push(s.mem, m.mem?.pct ?? null);
        s.disk = push(s.disk, m.disk?.mbps ?? null);
        if (m.netSeen) { s.rx = push(s.rx, m.net?.rx ?? null); s.tx = push(s.tx, m.net?.tx ?? null); }
      } catch { /* the graphs keep what they had */ }
      this.sampling = false;
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

  // ---- what's listed

  /** Live local terminals' pids: pid -> address. */
  termPids() {
    return new Map(terminals().filter((t) => t?.pid && !String(t.address).includes("/") && t.state !== "finished").map((t) => [Number(t.pid), t.address]));
  }

  tree() {
    return this.snap ? buildTree({ procs: this.snap.procs, me: this.snap.me, terminals: terminals(), panes: panes(), spaces: spaces(), all: this.all }) : [];
  }

  rows(tree = this.tree()) {
    return this.snap ? flatten(tree, { folds: this.folds, query: this.query, byPid: this.ix.byPid }) : [];
  }

  /** The ports, those in this app's terminals first: { key, port, pid, name, hosts, term, where, guard }. */
  portList() {
    if (!this.snap) return [];
    const tp = this.termPids();
    const ctx = { panes: panes(), spaces: spaces() };
    const q = this.query.trim().toLowerCase();
    return this.snap.ports.map((x) => {
      const term = terminalOf(x.pid, this.ix.byPid, tp);
      const p = this.ix.byPid.get(x.pid);
      return { key: `${x.port}:${x.pid}`, ...x, name: p?.name ?? x.name, term, where: term ? whereIs(term, ctx) : null, guard: guardOf(p, this.snap.me) };
    })
      .filter((x) => !q || `${x.port} ${x.name}`.toLowerCase().includes(q))
      .sort((a, b) => Number(Boolean(b.term)) - Number(Boolean(a.term)) || a.port - b.port);
  }

  list() { return this.tab === "ports" ? this.portList() : this.tab === "system" ? [] : this.rows(); }

  /** The cursor's index in `items`, kept on its key. */
  at(items) {
    const c = this.cur[this.tab];
    const i = place(items, c.key, c.at);
    c.at = Math.max(0, i);
    c.key = items[i]?.key ?? null;
    return i;
  }

  moveTo(items, i) {
    if (!items.length) return;
    const c = this.cur[this.tab];
    c.at = Math.max(0, Math.min(items.length - 1, i));
    c.key = items[c.at].key;
  }

  proc(pid) { return this.ix?.byPid.get(pid) ?? null; }

  // ---- actions

  say(text, tone = "done") { this.note = { text, tone, until: Date.now() + 3000 }; }

  /** x / X: ask before ending the cursor's process (with what's under it), or a port's. */
  begin(item, tree) {
    if (!item || !this.snap) return;
    const pid = this.tab === "ports" ? item.pid : item.kind === "proc" ? item.node.pid : null;
    if (pid == null) return this.say("a process ends, not a group: move onto one", "dim");
    const p = this.proc(pid);
    const why = guardOf(p, this.snap.me);
    if (why) return this.say(`${p?.name ?? pid}: ${why}, not ended from here`, "dim");
    const pids = targets(pid, { tree, byPid: this.ix.byPid, kids: this.ix.kids, me: this.snap.me });
    const ports = this.snap.ports.filter((x) => pids.includes(x.pid)).map((x) => x.port);
    this.ask = { pids, key: item.key, tab: this.tab, tree, phase: "ask", left: [], name: p.name, pid, ports: [...new Set(ports)] };
  }

  /** enter on the band: TERM, the grace, then KILL is offered for the ones left. */
  confirm(cx) {
    const a = this.ask;
    if (!a || a.phase !== "ask") return;
    a.phase = "ending";
    cx.spawn(async (cx) => {
      const left = await endGently(a.pids, { exec, wait: (ms) => new Promise((r) => cx.timer.after(ms, () => r())), grace: GRACE });
      if (this.ask !== a) return;
      if (left.length) { a.phase = "held"; a.left = left; }
      else { this.ask = null; this.say(a.pids.length > 1 ? `ended ${a.name} and ${a.pids.length - 1} under it` : `ended ${a.name}`); }
      this.refresh(cx);
      cx.notify();
    });
  }

  /** K on a band that held on: KILL them. */
  killHard(cx) {
    const a = this.ask;
    if (!a || a.phase !== "held") return;
    signal(a.left, "KILL", exec).then(() => { this.say(`killed ${a.left.length > 1 ? `${a.left.length} processes` : a.name}`); this.refresh(cx); cx.notify(); });
    this.ask = null;
  }

  /** c: the port's address, or a process's command line. */
  copy(item, cx) {
    let text = null;
    if (this.tab === "ports" && item) text = address(item.port);
    else if (item?.kind === "proc") text = this.proc(item.node.pid)?.cmd ?? null;
    else if (item?.kind === "term") text = item.node.address;
    if (!text) return;
    cx.write_to_clipboard?.(text);
    this.say(`copied ${text.length > 48 ? text.slice(0, 47) + "…" : text}`);
  }

  /** o / enter on a port: a web pane on it; the deck closes. */
  open(item) {
    if (!item) return;
    openPort(item.port, { panes: panes(), focused: focused(), run });
    this.dismissDeck();
  }

  /** enter on a process or terminal: its terminal's pane, focused; the deck closes. */
  show(item) {
    const addr = item.kind === "term" ? item.node.address : terminalOf(item.node.pid, this.ix.byPid, this.termPids());
    if (!addr) return this.say("not in one of this app's terminals", "dim");
    if (!panes().some((p) => p.terminal === addr)) return this.say(`${addr} has no pane`, "dim");
    run("pane.focus", { terminal: addr });
    this.dismissDeck();
  }

  /** h / l: fold or unfold the cursor's row, else step to its parent / first child. */
  fold(items, i, open) {
    const r = items[i];
    if (!r || this.tab !== "procs") return;
    if (open === null) { if (r.open !== null) this.folds[r.key] = r.open; return; }
    if (open) {
      if (r.open === false) this.folds[r.key] = false;
      else if (r.open && items[i + 1]) this.moveTo(items, i + 1);
      return;
    }
    if (r.open) { this.folds[r.key] = true; return; }
    for (let j = i - 1; j >= 0; j--) if (items[j].depth < r.depth) return this.moveTo(items, j);
  }

  switchTab(to) {
    const order = ["procs", "ports", "system"];
    this.tab = to ?? order[(order.indexOf(this.tab) + 1) % order.length];
    this.ask = null;
    this.beat();
  }

  escape(cx) {
    if (this.help) this.help = false;
    else if (this.ask) this.ask = null;
    else if (this.typing && this.query) this.query = "";
    else if (this.typing) this.typing = false;
    else if (this.query) this.query = "";
    else return this.dismissDeck();
    cx.notify();
  }

  onKey(e, cx) {
    const m = e.modifiers ?? {};
    const k = String(e.key ?? "").toLowerCase();
    const ch = typeof e.key_char === "string" ? e.key_char : "";
    const done = () => { cx.stop_propagation(); cx.notify(); };
    if (m.platform || m.control || m.alt) return;
    if (this.help) {
      if (keysKey(e, true) || k === "enter") { this.help = false; return done(); }
      return;
    }
    if (k === "escape") return cx.stop_propagation(), this.escape(cx);
    if (this.ask) {
      const a = this.ask;
      if (a.phase === "ask" && (k === "enter" || k === "y")) this.confirm(cx);
      else if (a.phase === "held" && ((k === "k" && m.shift) || k === "enter")) this.killHard(cx);
      else if (k === "n" || k === "q") this.ask = null;
      return done();
    }
    const items = this.list();
    const i = this.at(items);
    const item = items[i];
    const page = Math.max(1, Math.floor((this.tab === "ports" ? PORTS_H / PROW : LIST_H / ROW)) - 1);
    if (k === "down" || k === "up") return this.moveTo(items, i + (k === "down" ? 1 : -1)), done();
    if (k === "pagedown" || k === "pageup") return this.moveTo(items, i + (k === "pagedown" ? page : -page)), done();
    if (k === "tab" && m.shift) return this.switchTab(["procs", "ports", "system"][(["procs", "ports", "system"].indexOf(this.tab) + 2) % 3]), done();
    if (k === "tab") return this.switchTab(), done();
    if (this.typing) {
      if (k === "backspace") { this.query = [...this.query].slice(0, -1).join(""); return done(); }
      if (k === "enter") { this.typing = false; return done(); }
      if (ch.length && !/[\u0000-\u001f\u007f]/.test(ch)) { this.query += ch; return done(); }
      return;
    }
    if (k === "j") this.moveTo(items, i + 1);
    else if (k === "k" && !m.shift) this.moveTo(items, i - 1);
    else if (k === "end" || (k === "g" && m.shift)) this.moveTo(items, items.length - 1);
    else if (k === "home" || k === "g") this.moveTo(items, 0);
    else if (k === "h" || k === "left") this.fold(items, i, false);
    else if (k === "l" || k === "right") this.fold(items, i, true);
    else if (k === "space" || ch === " ") this.fold(items, i, null);
    else if (k === "enter") {
      if (this.tab === "ports") return cx.stop_propagation(), this.open(item);
      if (!item) return done();
      if (item.kind === "proc" || item.kind === "term") return cx.stop_propagation(), this.show(item);
      this.fold(items, i, null);
    }
    else if (k === "1") this.switchTab("procs");
    else if (k === "2") this.switchTab("ports");
    else if (k === "3") this.switchTab("system");
    else if (k === "a") { this.all = !this.all; this.cur.procs = { key: this.cur.procs.key, at: 0 }; }
    else if (k === "x") this.begin(item, Boolean(m.shift));
    else if (k === "o" && this.tab === "ports") return cx.stop_propagation(), this.open(item);
    else if (k === "c") this.copy(item, cx);
    else if (k === "r") this.refresh(cx);
    else if (k === "q") return cx.stop_propagation(), this.dismissDeck();
    else if (ch === "?") this.help = true;
    else if (ch === "/" || k === "/") this.typing = true;
    else return;
    done();
  }

  // ---- parts

  pip(color, live = false) {
    const el = svg(`${ART}/pip.svg`).size(6).flex_none().text_color(color);
    return live ? el.loop("opacity", { from: 0.3, to: 1, period: 1600 }) : el;
  }

  badge(t, text, on) {
    return div().flex_none().h(14).px(4).flex().items_center().border(1).border_color(on ? t.ansi8 : t.ansi0).text_size(9).text_color(on ? t.muted : t.dim).child(text);
  }

  /** The row under the cursor: a dithered band and a blue edge, like Nocturne's menus. */
  band(el, t, on, edge = t.accent) {
    return el.when(on, (el) => el.child(dither(t.ansi0, 1)).child(div().absolute().left(0).top(0).bottom(0).w(2).bg(edge)));
  }

  action(t, id, label, color, go) {
    return div().id(id).relative().flex_none().px(3).text_size(11).text_color(t.dim).cursor_pointer()
      .hover((s) => s.text_color(color ?? t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); go(cx); cx.notify(); })
      .child(label);
  }

  num(t, w, text, color) {
    return div().relative().w(w).flex_none().flex().justify_end().text_size(11).text_color(color ?? t.dim).child(text);
  }

  fold_(t, r) {
    const icon = r.open === null ? null : svg(`${ART}/${r.open ? "fold-open" : "fold-shut"}.svg`).size(6).text_color(t.dim);
    return div().relative().w(6).flex_none().flex().items_center().when(Boolean(icon), (el) => el.child(icon));
  }

  /** One tree row; its depth drawn as 1 px dithered guides. */
  treeRow(t, r, i, on, ports, tp) {
    const n = r.node;
    const guides = Array.from({ length: r.depth }, (_, g) => div().absolute().top(0).bottom(0).left(12 + g * IND + 3).w(1).opacity(0.9).child(dither(t.ansi0, 1)));
    const row = h_flex().id(`row-${i}`).relative().h(ROW).flex_none().pl(12 + r.depth * IND).pr(12).gap(7).items_center().text_size(12)
      .text_color(on ? t.foreground : t.muted)
      .on_click((_e, cx) => { this.moveTo(this.list(), i); this.handle.focus(); cx.notify(); })
      .on_hover((h, cx) => { const k = h ? r.key : this.hover === r.key ? null : this.hover; if (k !== this.hover) { this.hover = k; cx.notify(); } });
    const el = this.band(row, t, on).children(guides).child(this.fold_(t, r));
    if (r.kind === "space") {
      if (n.machine) return el.child(this.pip(t.dim)).child(div().relative().flex_none().text_color(t.muted).child(n.name))
        .child(div().relative().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(`on ${n.machine} · this machine only for now`));
      return el.child(this.pip(t.accent)).child(div().relative().flex_none().text_size(11).text_color(t.foreground).child(n.name))
        .child(div().relative().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(short(n.folder)))
        .child(this.num(t, 40, String(count(n))));
    }
    if (r.kind === "tab") {
      return el.child(div().relative().flex_none().text_size(11).text_color(t.dim).child(String(n.n)))
        .child(div().relative().flex_1().min_w(0).truncate().text_size(11).text_color(on ? t.foreground : t.muted).child(n.name))
        .child(this.num(t, 40, String(count(n))));
    }
    if (r.kind === "term") {
      const tone = { working: t.working, blocked: t.blocked, done: t.done }[n.status] ?? null;
      return el.child(div().relative().child(this.badge(t, n.address, on)))
        .child(div().relative().flex_none().max_w(160).truncate().text_color(on ? t.foreground : t.muted).child(n.name))
        .child(div().relative().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(short(n.cwd)))
        .when(Boolean(tone), (el) => el.child(div().relative().child(this.pip(tone, n.status === "working"))));
    }
    const p = this.proc(n.pid);
    if (!p) return el;
    const guard = guardOf(p, this.snap.me);
    const mine = ports.get(p.pid);
    return el
      .child(div().relative().flex_none().max_w(130).truncate().text_color(guard ? t.dim : on ? t.foreground : t.muted).child(p.name))
      .when(Boolean(guard), (el) => el.child(svg(`${ART}/shield.svg`).size(8).flex_none().text_color(t.dim)))
      .when(this.all && tp.has(p.pid), (el) => el.child(div().relative().child(this.badge(t, tp.get(p.pid), on))))
      .child(div().relative().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(oneLine(p.args)))
      .when(Boolean(mine), (el) => el.child(div().relative().flex_none().text_size(11).text_color(t.ansi6).child(mine.map((x) => `:${x}`).join(" "))))
      .child(this.num(t, 34, p.cpu.toFixed(1), p.cpu >= 20 ? t.working : null))
      .child(this.num(t, 44, memory(p.rss)))
      .child(this.num(t, 54, uptime(p.secs)))
      .child(this.num(t, 44, String(p.pid), t.ansi8));
  }

  /** Under the selected process: its whole command line and its numbers. */
  detail(t, pid) {
    const p = this.proc(pid);
    if (!p) return div().h(DETAIL);
    const up = this.proc(p.ppid);
    const guard = guardOf(p, this.snap.me);
    const full = oneLine(p.cmd);
    const meta = (k, v, c) => h_flex().flex_none().gap(4).child(div().text_color(t.dim).child(k)).child(div().text_color(c ?? t.muted).child(v));
    return v_flex().id(`detail-${pid}`).relative().h(DETAIL).flex_none().pl(26).pr(12).pt(4).gap(4).text_size(11)
      .child(div().h(45).flex_none().overflow_hidden().line_height("15px").text_color(t.muted).child(full.length > 300 ? full.slice(0, 299) + "…" : full))
      .child(h_flex().h(14).flex_none().gap(12).items_center().overflow_hidden()
        .child(meta("pid", String(p.pid)))
        .when(Boolean(up), (el) => el.child(meta("parent", `${up.name} ${up.pid}`)))
        .child(meta("cpu", `${p.cpu.toFixed(1)}%`, p.cpu >= 20 ? t.working : null))
        .child(this.spark(t, "sp-cpu", this.hist.get(pid)?.cpu, t.working, 100))
        .child(meta("mem", memory(p.rss)))
        .child(this.spark(t, "sp-mem", this.hist.get(pid)?.rss, t.accent, null))
        .when(Boolean(guard), (el) => el.child(h_flex().gap(4).items_center().child(svg(`${ART}/shield.svg`).size(8).text_color(t.dim)).child(div().text_color(t.dim).child(guard)))));
  }

  /** The band that asks before ending, then tells what held on. */
  confirmBand(t) {
    const a = this.ask;
    const btn = (id, label, hot, go) => div().id(id).flex_none().h(20).px(8).flex().items_center().border(1).border_color(hot ? t.blocked : t.ansi0)
      .text_size(11).text_color(hot ? t.blocked : t.muted).cursor_pointer().hover((s) => s.bg(t.ansi0))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); go(cx); cx.notify(); }).child(label);
    const others = a.pids.length - 1;
    const title = a.phase === "held" ? `${a.left.length > 1 ? `${a.left.length} processes are` : `${a.name} (${a.left[0]}) is`} still running.`
      : a.phase === "ending" ? `ending ${a.name}…`
      : others ? `End ${a.name} (${a.pid}) and the ${others} under it?` : `End ${a.name} (${a.pid})?`;
    const why = a.phase === "held" ? "It didn't end on TERM. Kill -9 ends it at once, without cleanup."
      : a.phase === "ending" ? "TERM sent; a moment for it to clean up."
      : [a.ports.length ? `It serves ${a.ports.map((p) => `:${p}`).join(" ")}.` : null, "TERM first: it can clean up."].filter(Boolean).join(" ");
    return v_flex().id("confirm").relative().h(CONFIRM).flex_none().px(12).py(8).gap(5)
      .child(div().absolute().left(0).top(0).right(0).bottom(0).opacity(0.22).child(dither(t.blocked, 1)))
      .child(div().absolute().left(0).top(0).bottom(0).w(2).bg(t.blocked))
      .child(div().relative().text_size(12).text_color(t.blocked).truncate().child(title))
      .child(div().relative().text_size(11).text_color(t.muted).truncate().child(why))
      .child(h_flex().relative().gap(8)
        .when(a.phase === "ask", (el) => el.child(btn("c-yes", "enter · end it", true, (cx) => this.confirm(cx))).child(btn("c-no", "esc · keep", false, () => { this.ask = null; })))
        .when(a.phase === "held", (el) => el.child(btn("c-kill", "K · kill -9", true, (cx) => this.killHard(cx))).child(btn("c-leave", "esc · leave it", false, () => { this.ask = null; }))));
  }

  /** The processes tab: column heads, then the rows at fixed y's, scrolled to keep the cursor and its block in sight. */
  procsView(t, items, ci) {
    const ports = new Map();
    for (const x of this.snap?.ports ?? []) ports.set(x.pid, [...(ports.get(x.pid) ?? []), x.port].filter((v, i, s) => s.indexOf(v) === i));
    const tp = this.termPids();
    const sel = items[ci];
    const extra = (r) => (this.ask && this.ask.tab === "procs" && this.ask.key === r.key ? CONFIRM : r === sel && r.kind === "proc" ? DETAIL : 0);
    const tops = [];
    let y = 0;
    for (const r of items) { tops.push(y); y += ROW + extra(r); }
    if (sel) {
      const a = tops[ci], b = tops[ci] + ROW + extra(sel);
      if (a < this.scroll.procs) this.scroll.procs = a;
      if (b > this.scroll.procs + LIST_H) this.scroll.procs = b - LIST_H;
    }
    const max = Math.max(0, y - LIST_H);
    this.scroll.procs = Math.max(0, Math.min(this.scroll.procs, max));
    const s = this.scroll.procs;
    const kids = [];
    items.forEach((r, i) => {
      const top = tops[i], h = ROW + extra(r);
      if (top + h <= s || top >= s + LIST_H) return;
      const on = i === ci;
      kids.push(v_flex().id(`slot-${r.key}`).absolute().left(0).right(0).top(top - s).h(h)
        .child(this.treeRow(t, r, i, on, ports, tp))
        .when(h > ROW, (el) => el.child(this.ask?.key === r.key ? this.confirmBand(t) : this.detail(t, r.node.pid))));
    });
    const head = (w, text) => div().w(w).flex_none().flex().justify_end().child(text);
    return v_flex().id("procs").h(COLS + LIST_H).flex_none()
      .child(h_flex().h(COLS).flex_none().px(12).gap(7).items_center().text_size(9).text_color(t.ansi8).opacity(0.8)
        .child(div().flex_1().child(this.all ? `ALL OF ${String(this.snap?.me ?? "").toUpperCase()}'S` : "THIS APP'S TERMINALS"))
        .child(head(34, "CPU")).child(head(44, "MEM")).child(head(54, "UP")).child(head(44, "PID")))
      .child(items.length
        ? div().id("procs-list").relative().h(LIST_H).flex_none().overflow_hidden()
          .on_scroll_wheel((e, cx) => { this.scroll.procs = Math.max(0, Math.min(this.scroll.procs - e.delta.y, max)); cx.notify(); })
          .children(kids)
        : this.empty(t, LIST_H));
  }

  /** A process's own readings since the deck opened: SPARK thin dithered bars, 12 px tall. */
  spark(t, id, values, color, max) {
    const v = values ?? [];
    const hs = scale(v, { max: max == null ? null : Math.max(max, ...v), floor: 1 });
    return div().id(id).relative().w(SPARK * 2).h(12).flex_none()
      .child(div().absolute().left(0).right(0).bottom(0).h(1).child(dither(t.ansi0, 1)))
      .children(hs.map((h, i) => div().absolute().bottom(0).left((SPARK - hs.length + i) * 2).w(2).h(Math.max(1, Math.round((h ?? 0) * 12)))
        .child(dither(color, 1))));
  }

  /** One bar: a dithered column in `color` with a solid 1 px head; `down` hangs it from its top. */
  bar(t, x, h, color, down = false) {
    const px = Math.max(1, Math.round(h));
    const el = div().absolute().left(x).w(BAR).h(px).child(dither(color, 1))
      .child(div().absolute().left(0).right(0).h(1).bg(color).map((c) => (down ? c.bottom(0) : c.top(0))));
    return el;
  }

  /** A graph: the history `values` (0..1, null: no reading) as bars, the newest at the right.
   *  `down`: a second series hung under a midline (network out). `none`: what to say instead. */
  graph(t, id, values, color, { down = null, color2 = null, none = null } = {}) {
    const box = div().id(id).relative().w(GRAPH_W).h(GRAPH_H).flex_none()
      .child(div().absolute().left(0).right(0).bottom(down ? GRAPH_H / 2 : 0).h(1).child(dither(t.ansi0, 1)));
    if (none) return box.child(div().absolute().left(0).right(0).top(0).bottom(0).flex().items_center().justify_center().text_size(11).text_color(t.dim).child(none));
    const x = (i, n) => GRAPH_W - (n - i) * SLOT + 1;
    const half = down ? GRAPH_H / 2 : GRAPH_H;
    const up = values.map((v, i) => (v == null ? null : this.bar(t, x(i, values.length), v * (half - 1), color).bottom(down ? half : 0))).filter(Boolean);
    const under = (down ?? []).map((v, i) => (v == null ? null : this.bar(t, x(i, down.length), v * (half - 1), color2, true).top(half + 1))).filter(Boolean);
    return box.children(up).children(under);
  }

  /** One graph's block: its name and value now, the graph, a line of detail. */
  meter(t, id, name, value, valueColor, graph, sub) {
    return v_flex().id(`m-${id}`).flex_none().px(12).pt(6).gap(3)
      .child(h_flex().h(16).gap(8).items_center()
        .child(div().flex_none().text_size(11).text_color(t.ansi8).child(name.toUpperCase()))
        .child(div().flex_1().h(1).relative().opacity(0.6).child(dither(t.ansi8, 1)))
        .child(div().flex_none().text_size(12).text_color(valueColor).child(value)))
      .child(graph)
      .child(div().h(14).flex_none().truncate().text_size(11).text_color(t.dim).child(sub));
  }

  /** The system tab: CPU, GPU, memory, disk and network. */
  systemView(t) {
    const n = this.now, s = this.sys;
    const pct = (v) => (v == null ? "" : `${Math.round(v)}%`);
    const missing = (what) => `no ${what} reading on this machine`;
    const waiting = !n ? "reading…" : null;
    const pressure = n?.mem?.pressure;
    const netTop = Math.max(10e3, ...s.rx.filter((v) => v != null), ...s.tx.filter((v) => v != null));
    const net = n?.net;
    return v_flex().id("system").h(PORTS_H).flex_none().overflow_hidden()
      .child(this.meter(t, "cpu", "cpu", pct(n?.cpu?.pct), t.accent,
        this.graph(t, "g-cpu", scale(s.cpu, { max: 100 }), t.accent, { none: waiting ?? (n.cpu ? null : missing("CPU")) }),
        n?.cpu ? `user ${n.cpu.us}% · system ${n.cpu.sy}%${this.sysReading?.sysctl?.ncpu ? ` · ${this.sysReading.sysctl.ncpu} cores` : ""}` : ""))
      .child(this.meter(t, "gpu", "gpu", pct(n?.gpu?.pct), t.ansi5,
        this.graph(t, "g-gpu", scale(s.gpu, { max: 100 }), t.ansi5, { none: waiting ?? (n.gpu ? null : missing("GPU")) }),
        n?.gpu ? "busy, as the graphics processor reports it" : ""))
      .child(this.meter(t, "mem", "memory", n?.mem ? `${size(n.mem.used)} of ${size(n.mem.total)}` : "", t.done,
        this.graph(t, "g-mem", scale(s.mem, { max: 100 }), t.done, { none: waiting ?? (n.mem ? null : missing("memory")) }),
        n?.mem ? `${pct(n.mem.pct)} used${pressure ? ` · pressure ${pressure}` : ""}` : ""))
      .child(this.meter(t, "disk", "disk", n?.disk?.mbps != null ? `${n.disk.mbps.toFixed(1)} MB/s` : "", t.working,
        this.graph(t, "g-disk", scale(s.disk, { floor: 1 }), t.working, { none: waiting ?? (n.disk?.mbps != null ? null : missing("disk")) }),
        n?.disk?.full != null ? `the startup disk is ${n.disk.full}% full` : ""))
      .child(this.meter(t, "net", "network", net ? `↓ ${rate(net.rx)}  ↑ ${rate(net.tx)}` : "", t.ansi6,
        this.graph(t, "g-net", scale(s.rx, { max: netTop }), t.ansi6, { down: scale(s.tx, { max: netTop }), color2: t.ansi11,
          none: waiting ?? (!n.netSeen ? missing("network") : s.rx.some((v) => v != null) ? null : "measuring…") }),
        net ? "in above the line, out below · every interface but loopback" : ""));
  }

  portRow(t, x, i, on) {
    const show = on || this.hover === x.key;
    return this.band(h_flex().id(`port-${i}`).relative().h(PROW).flex_none().px(12).gap(10).items_center().text_size(12)
      .text_color(on ? t.foreground : x.term ? t.muted : t.dim)
      .on_click((_e, cx) => { this.moveTo(this.list(), i); this.handle.focus(); cx.notify(); })
      .on_hover((h, cx) => { const k = h ? x.key : this.hover === x.key ? null : this.hover; if (k !== this.hover) { this.hover = k; cx.notify(); } }), t, on)
      .child(div().relative().w(52).flex_none().text_color(x.term ? t.ansi6 : t.dim).child(`:${x.port}`))
      .child(div().relative().flex_none().max_w(110).truncate().child(x.name))
      .when(Boolean(x.guard), (el) => el.child(svg(`${ART}/shield.svg`).size(8).flex_none().text_color(t.dim)))
      .child(div().relative().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim)
        .child(`${x.where ?? "not from this app"} · ${x.hosts.join(" ")}`))
      .child(h_flex().relative().flex_none().gap(2).justify_end()
        .when(show, (el) => el
          .child(this.action(t, `o-${i}`, "open ↗", null, () => this.open(x)))
          .child(this.action(t, `c-${i}`, "copy", null, (cx) => this.copy(x, cx)))
          .when(!x.guard, (el) => el.child(this.action(t, `x-${i}`, "end", t.blocked, () => { this.moveTo(this.list(), i); this.begin(x, false); })))));
  }

  portsView(t, items, ci) {
    const tops = [];
    let y = 0;
    for (const x of items) { tops.push(y); y += PROW + (this.ask?.tab === "ports" && this.ask.key === x.key ? CONFIRM : 0); }
    const sel = items[ci];
    if (sel) {
      const b = tops[ci] + PROW + (this.ask?.key === sel.key ? CONFIRM : 0);
      if (tops[ci] < this.scroll.ports) this.scroll.ports = tops[ci];
      if (b > this.scroll.ports + PORTS_H) this.scroll.ports = b - PORTS_H;
    }
    this.scroll.ports = Math.max(0, Math.min(this.scroll.ports, Math.max(0, y - PORTS_H)));
    if (!items.length) return this.empty(t, PORTS_H);
    return div().id("ports-list").relative().h(PORTS_H).flex_none().overflow_hidden()
      .children(items.map((x, i) => v_flex().id(`pslot-${x.key}`).absolute().left(0).right(0).top(tops[i] - this.scroll.ports)
        .child(this.portRow(t, x, i, i === ci))
        .when(this.ask?.tab === "ports" && this.ask.key === x.key, (el) => el.child(this.confirmBand(t)))));
  }

  empty(t, h) {
    const box = v_flex().h(h).flex_none().items_center().justify_center().gap(8).px(24).text_size(11).text_color(t.dim);
    if (this.failed) return box.child(div().text_color(t.blocked).child("Couldn't read the processes")).child(div().child(this.failed));
    if (!this.snap) return box.child(div().child("reading…"));
    if (this.query) return box.child(div().child(`Nothing matches "${this.query}".`));
    if (this.tab === "ports") {
      return box.child(svg(`${ART}/plug.svg`).size(22).text_color(t.ansi0))
        .child(div().mt(6).text_size(12).text_color(t.muted).child("Nothing of yours listens on a port."))
        .child(div().child("a dev server shows here as it starts"));
    }
    return box.child(div().text_size(12).text_color(t.muted).child("No terminals here on this machine."))
      .child(div().child("a lists every process of yours"));
  }

  /** The bar along the bottom: what the cursor is on and its keys. */
  foot(t, item) {
    const bar = h_flex().relative().h(FOOT).flex_none().px(12).gap(10).items_center().text_size(11)
      .child(div().absolute().left(0).right(0).top(0).h(2).child(dither(t.ansi0, 1)));
    const left = (...kids) => h_flex().flex_1().min_w(0).gap(6).items_center().children(kids.filter(Boolean));
    const keys = (...caps) => h_flex().flex_none().gap(10).items_center().children(caps.filter(Boolean));
    const k = (id, key, what) => hint(t, id, key, what);
    const help = keysHint(t, "k-help", this.help, () => { this.help = !this.help; });
    const arrow = div().flex_none().text_color(t.accent).child("↳");
    const word = (s, c) => div().min_w(0).truncate().text_color(c ?? t.muted).child(s);
    if (this.help) return bar.child(left(word("every key", t.dim))).child(keys(k("k-esc", "esc", "back"), help));
    if (this.ask?.phase === "ask") return bar.child(left(arrow, word(`end ${this.ask.name}`, t.blocked))).child(keys(k("k-yes", "enter", "end"), k("k-no", "esc", "keep")));
    if (this.ask?.phase === "held") return bar.child(left(arrow, word("still running", t.blocked))).child(keys(k("k-kill", "K", "kill -9"), k("k-no", "esc", "leave")));
    if (this.ask) return bar.child(left(arrow, word("ending…", t.dim))).child(keys(k("k-no", "esc", "hide")));
    if (this.typing) {
      return bar.child(left(div().flex_none().text_color(t.accent).child("/"), word(this.query ? this.query.replace(/ /g, " ") : "type to find", this.query ? t.foreground : t.dim),
        div().flex_none().w(1).h(14).bg(t.accent).loop("opacity", { from: 0, to: 1, period: 1000 })))
        .child(keys(k("k-enter", "enter", "keep"), k("k-esc", "esc", this.query ? "clear" : "back"), help));
    }
    const note = this.note && Date.now() < this.note.until ? word(this.note.text, t[this.note.tone] ?? t.done) : null;
    if (this.tab === "system") return bar.child(left(arrow, word("a reading every 2 s while this is open", t.dim))).child(keys(k("k-tabs", "tab", "processes"), help));
    const q = this.query ? div().flex_none().text_color(t.accent).child(`/${this.query}`) : null;
    if (this.tab === "ports") {
      if (!item) return bar.child(left(note ?? word(""), q)).child(keys(k("k-a", "tab", "processes"), help));
      return bar.child(left(arrow, note ?? word(address(item.port)), q))
        .child(keys(k("k-open", "enter", "open"), k("k-copy", "c", "copy"), item.guard ? null : k("k-end", "x", "end"), help));
    }
    if (!item) return bar.child(left(note ?? word(""), q)).child(keys(k("k-all", "a", this.all ? "this app" : "all"), help));
    if (item.kind === "proc") {
      const p = this.proc(item.node.pid);
      const guard = guardOf(p, this.snap?.me);
      if (guard) return bar.child(left(arrow, note ?? word(`${p?.name ?? ""} · ${guard}`, t.dim), q)).child(keys(k("k-show", "enter", "show"), k("k-all", "a", this.all ? "this app" : "all"), help));
      return bar.child(left(arrow, note ?? word(p?.name ?? ""), q))
        .child(keys(k("k-end", "x", "end"), item.node.kids.length ? k("k-tree", "X", "tree") : null, k("k-find", "/", "find"), help));
    }
    return bar.child(left(arrow, note ?? word(item.node.name ?? ""), q))
      .child(keys(item.kind === "term" ? k("k-show", "enter", "show") : null, item.open !== null ? k("k-fold", "←→", "fold") : null, k("k-all", "a", this.all ? "this app" : "all"), help));
  }

  head(t, nProcs, nPorts) {
    const tabBtn = (id, to, label, n) => {
      const on = this.tab === to;
      return h_flex().id(id).relative().h_full().px(8).gap(6).items_center().text_size(11).cursor_pointer()
        .text_color(on ? t.foreground : t.muted).hover((s) => s.text_color(t.foreground))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => { this.switchTab(to); this.handle.focus(); cx.notify(); })
        .child(div().child(label)).child(div().text_color(t.dim).child(String(n)))
        .when(on, (el) => el.child(div().absolute().left(4).right(4).bottom(0).h(2).bg(t.accent)));
    };
    return h_flex().relative().h(HEAD).flex_none().pl(12).pr(12).gap(10).items_center()
      .child(svg(`${ART}/tree.svg`).size(9).flex_none().text_color(t.accent))
      .child(div().flex_none().text_size(12).text_color(t.foreground).child("Processes"))
      .child(h_flex().h_full().flex_none().ml(4).child(tabBtn("tab-procs", "procs", "processes", nProcs)).child(tabBtn("tab-ports", "ports", "ports", nPorts))
        .child(tabBtn("tab-system", "system", "system", this.now?.cpu ? `${Math.round(this.now.cpu.pct)}%` : "")))
      .child(div().flex_1())
      .child(div().id("scope").flex_none().text_size(11).text_color(t.dim).cursor_pointer()
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => { this.all = !this.all; cx.notify(); })
        .child(this.all ? `all of ${this.snap?.me ?? "yours"}` : "fireflies"))
      .child(this.badge(t, "a", false))
      .child(div().absolute().left(0).right(0).bottom(0).h(2).child(dither(t.ansi0, 1)));
  }

  render() {
    const t = theme();
    const tree = this.tree();
    const ports = this.portList();
    const items = this.tab === "ports" ? ports : this.rows(tree);
    const ci = this.at(items);
    const nProcs = tree.reduce((n, node) => n + count(node), 0);
    return v_flex().id("nocturne-procs").size_full().bg(t.background).border(1).border_color(t.ansi0)
      .track_focus(this.handle)
      .key_context(CONTEXT)
      .on_action(ESCAPE, (_e, cx) => this.escape(cx))
      .on_mouse_down("left", () => this.handle.focus())
      .on_key_down((e, cx) => this.onKey(e, cx))
      .child(this.head(t, nProcs, ports.length))
      .when(this.help, (el) => el.child(div().id("procs-help").relative().h(H - 2 - HEAD - FOOT).flex_none()
        .child(keysView(t, { id: "procs-keys", title: "processes and ports", list: deckKeys(), close: () => { this.help = false; } }))))
      .when(!this.help && this.tab === "procs", (el) => el.child(this.procsView(t, items, ci)))
      .when(!this.help && this.tab === "ports", (el) => el.child(this.portsView(t, items, ci)))
      .when(!this.help && this.tab === "system", (el) => el.child(this.systemView(t)))
      .child(this.foot(t, items[ci]));
  }
}
