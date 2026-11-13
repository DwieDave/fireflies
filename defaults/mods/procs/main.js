// The processes and ports manager, in Nocturne's look: one square popover
// under the tab strip's tree mark (../nocturne/procs.js), or centered from
// nocturne.procs / nocturne.ports and the palette. This machine only.
//
//   head       the tree mark, its three tabs (processes and ports with their
//              counts, system with the CPU now), and what's listed:
//              "fireflies" (this app's terminals) or "all of <user>'s" (a switches)
//   processes  a tree: space › tab › terminal › the terminal's process and
//              everything it started (shells, agents, dev servers, builds);
//              terminals without a pane under "no pane"; spaces on another
//              machine as a note. With a, every process of Developer's, each
//              whose parent isn't his (launchd's children) a root. Each row:
//              name, arguments (cut), the ports it listens on, cpu, memory,
//              how long it has run, pid. The selected row opens a detail
//              block, set apart with air above and below, a fainter dither
//              of its own and a dithered rule where it ends: the whole
//              command line (up to three lines; the wheel scrolls a longer
//              one), then pid and parent with show / copy / end / end
//              tree, then its cpu and memory. Rows above it never move as the
//              selection does; the ones below make room.
//   ports      the TCP ports his processes listen on, those in this app's
//              terminals first: port, process, where it runs; on the cursor's
//              row open ↗ (a web pane), copy (http://localhost:<port>), end
//   system     live graphs, dithered, the last minute and a half (a reading
//              a second while this tab shows, every 2 s behind the others,
//              none while the deck is closed; never two at once):
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
// procs.focus gives the deck the keyboard back; procs.keys
// shows its keys.
//
// By pointer, everything the keys do: the wheel scrolls the processes and the
// ports (a mouse's lines a row each, a trackpad's pixels as far as the
// fingers), and the cursor stays on its row (a key brings it back into sight);
// over a long command in the detail block it scrolls the command first. A
// click selects a row, a double click does what enter does, a click on a fold
// arrow folds. The scrollbar along a long list's right edge drags, and a
// press beside its thumb jumps there. The tabs and "fireflies" / "all of …"
// switch on a click, every key in the foot is a button (x end, X tree,
// / find, the find field itself, enter / esc on the ending band), and a port
// row shows open ↗ / copy / end while selected or under the pointer. The
// tree mark in the strip opens and closes the deck; a click outside closes it.

import { View, div, svg, PathBuilder, Background } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { closeOverlay, exec, focused, home, nextCommand, notify, panes, props, run, settings, shared, setShared, spaces, terminals, theme, window as appWindow } from "herdr";
import { PROBE, parseProbe, index, buildTree, flatten, place, targets, guardOf, endGently, signal, address, terminalOf, whereIs, openPort, uptime, memory, oneLine, count, wheelDelta, scrollBy } from "./logic.js";
import { SYS_PROBE, KEEP, STEP, STEP_SHOWN, parseSys, measure, push, rate, size, scale } from "./sys.js";
import { hint, keysHint, keysView, keysKey } from "./keyhelp.ts";

const ART = "mods/nocturne/art";
// The strip's note that the deck is open (../nocturne/procs.js DECK, COUNT).
const DECK = "procs.deck";
const COUNT = "procs.count";
const CONTEXT = "NocturneProcsDeck";
const ESCAPE = "nocturne_procs_escape";
export const REFRESH = 2000;
export const GRACE = 2000;
const SYSTEM_PACE = "a reading every second";

const W = 480, H = 560;
export const ROW = 24, PROW = 30;
const HEAD = 36, COLS = 18, FOOT = 26, IND = 14, CONFIRM = 76;
// The selected process's detail block, under its row: air, the command (1 to 3 lines), air, its
// facts and its buttons, its live readings, air, a dithered rule where its ground ends, air.
const D_TOP = 9, D_GAP = 9, D_LINE = 16, D_LINES_GAP = 4, D_FOOT = 10, D_AFTER = 7;
const D_LEFT = 26, D_RIGHT = 12;
// About how wide a character of the 11 px mono is, to guess a command's lines before it's drawn.
const CHAR_W = 7;
export const LIST_H = H - 2 - HEAD - COLS - FOOT;
// The system tab: five graphs, KEEP bars each, the newest at the right.
const GRAPH_W = W - 2 - 24, GRAPH_H = 48, SLOT = Math.floor(GRAPH_W / KEEP), BAR = SLOT - 2;
const SPARK = 30;
export const PORTS_H = H - 2 - HEAD - FOOT;

// The dither fill, copied from ../nocturne/kit.js (a mod can't import another mod's files).
const RECT = () => PathBuilder.fill().move_to("0%", "0%").line_to("100%", "0%").line_to("100%", "100%").line_to("0%", "100%").close().build();
function dither(color, cell = 1) {
  const zoom = Number(settings()?.zoom) || 1;
  const dpr = appWindow()?.platform === "macos" ? 2 : 1;
  return window.paint_path(RECT(), Background.checkerboard(color, Math.max(1, Math.round(cell * zoom * dpr)))).absolute().top(0).left(0).size_full();
}

const zoom = () => Number(settings()?.zoom) || 1;
// The dither's cell in device px: one layout px at the zoom (as dither() has it).
const dotCell = () => Math.max(1, Math.round(zoom() * (appWindow()?.platform === "macos" ? 2 : 1)));
const unzoom = (v) => v / zoom();
// The scrollbar's hit strip along a list's right edge, and its thumb's least height.
const BAR_HIT = 8, THUMB_MIN = 16;
// The detail block's command: lines of CMD_LINE px, at most CMD_SHOWN shown (the wheel scrolls the rest).
const CMD_LINE = 15, CMD_SHOWN = 3;

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
    // The list keeps the cursor in sight until the wheel or the scrollbar moves it away; a key or a click brings it back.
    this.follow = true;
    this.drag = null; // the scrollbar's drag: { tab, at, from, ratio }
    this.cmd = { pid: null, y: 0, h: 0 }; // the detail block's command: its scroll and its drawn height
    this.ask = null; // { pids, key, tree, phase: ask | ending | held, left, name, tab }
    this.note = null; // { text, tone, until }
    this.help = false;
    this.hover = null;
    this.handle = cx.focus_handle();
    this.handle.focus();
    for (const ms of [60, 250, 600]) cx.timer.after(ms, () => this.handle.focus());
    cx.spawn(async (cx) => {
      for (;;) {
        const c = String(await nextCommand()).replace(/^procs\./, "");
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
    // Checked every quarter second, and as each reading ends: the next starts once its pace has
    // passed since the last began (the probe itself takes a second, so a plain timer would skip beats).
    cx.timer.every(250, (cx) => this.tick(cx));
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

  /** The system readings' pace: a second while the system tab shows, else 2 s. */
  pace() { return this.tab === "system" ? STEP_SHOWN : STEP; }

  /** A system reading, when its pace has passed since the last began and none is running:
   *  a slow source holds the next one back instead of piling them up. */
  tick(cx, now = Date.now()) {
    if (!this.sampling && now - (this.sampled ?? 0) >= this.pace()) this.sample(cx);
  }

  /** One system reading (sys.js SYS_PROBE, about a second: iostat measures one). */
  sample(cx) {
    if (this.sampling) return;
    this.sampling = true;
    this.sampled = Date.now();
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
      this.tick(cx);
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

  /** The tree, built again only when a refresh, a or the app's spaces, tabs and terminals
   *  change it: a frame has 50 ms, and building it over every process of a Mac's takes more. */
  tree() {
    if (!this.snap) return [];
    const ctx = { terminals: terminals(), panes: panes(), spaces: spaces() };
    // What buildTree reads, no more: an agent's terminal carries its whole brief in argv.
    const sig = JSON.stringify([this.all,
      ctx.terminals.map((t) => [t?.address, t?.pid, t?.state, t?.labels?.["nocturne.name"], t?.name, t?.argv?.[0], t?.cwd, t?.status]),
      ctx.panes.map((p) => [p?.tab, p?.terminal, p?.status, p?.cwd, p?.program?.name, p?.title]),
      ctx.spaces.map((x) => [x?.id, x?.name, x?.folder, x?.machine, (x?.tabs ?? []).map((tab) => [tab.id, tab.index, tab.name])])]);
    const c = this.treeCache;
    if (c?.snap === this.snap && c.sig === sig) return c.tree;
    const tree = buildTree({ procs: this.snap.procs, me: this.snap.me, ix: this.ix, all: this.all, ...ctx });
    this.treeCache = { snap: this.snap, sig, tree, n: tree.reduce((n, node) => n + count(node), 0) };
    return tree;
  }

  /** How many processes the tree holds (the processes tab's count). */
  procCount() { return this.snap ? (this.tree(), this.treeCache.n) : 0; }

  /** The rows on screen, made again only when the tree, a fold or the query changes. */
  rows(tree = this.tree()) {
    if (!this.snap) return [];
    const sig = JSON.stringify([this.folds, this.query]);
    const c = this.rowsCache;
    if (c?.tree === tree && c.sig === sig) return c.rows;
    const rows = flatten(tree, { folds: this.folds, query: this.query, byPid: this.ix.byPid });
    this.rowsCache = { tree, sig, rows };
    return rows;
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
    this.follow = true;
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
    // A port's process that started after ps ran (lsof runs after it): nothing to end yet.
    if (!p) return this.say(`${item.name ?? pid} (${pid}): not in the last reading, r reads again`, "dim");
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

  switchTab(to, cx = null) {
    const order = ["procs", "ports", "system"];
    this.tab = to ?? order[(order.indexOf(this.tab) + 1) % order.length];
    this.ask = null;
    this.follow = true;
    this.beat();
    if (cx) this.tick(cx);
  }

  /** a, or a click on "fireflies" / "all of …": this app's terminals or every process of yours. */
  toggleAll() {
    this.all = !this.all;
    this.cur.procs = { key: this.cur.procs.key, at: 0 };
    this.follow = true;
  }

  /** enter, or a double click: a port opens, a process or terminal shows its pane, a group folds. */
  activate(items, i) {
    const item = items[i];
    if (!item) return;
    if (this.tab === "ports") return this.open(item);
    if (item.kind === "proc" || item.kind === "term") return this.show(item);
    this.fold(items, i, null);
  }

  /** A click on a row: the cursor goes there; a double click does what enter does. */
  clickRow(e, i, cx) {
    const items = this.list();
    this.moveTo(items, i);
    this.handle.focus();
    if ((e?.click_count ?? 1) >= 2) this.activate(items, i);
    cx.notify();
  }

  /** The wheel over a list (a mouse's lines or a trackpad's pixels): the rows move, the
   *  cursor stays on its row (a key brings it back into sight). */
  wheel(tab, e, row, max, cx) {
    cx.stop_propagation();
    const to = scrollBy(this.scroll[tab], wheelDelta(e, row, zoom()), max);
    this.follow = false;
    if (to !== this.scroll[tab]) { this.scroll[tab] = to; cx.notify(); }
  }

  /** A list's scrollbar while its rows overflow: a 2 px dithered thumb along the right edge.
   *  Drag it; a press on the strip beside it brings the thumb there first. */
  scrollbar(t, tab, total, view) {
    if (total <= view) return null;
    const room = total - view;
    const th = Math.max(THUMB_MIN, Math.round((view * view) / total));
    const ty = Math.round((this.scroll[tab] / room) * (view - th));
    const ratio = room / Math.max(1, view - th);
    return div().id(`bar-${tab}`).absolute().top(0).right(0).w(BAR_HIT).h(view).cursor_pointer()
      .on_mouse_down("left", (e, cx) => {
        cx.stop_propagation();
        const y = unzoom(e?.local_position?.y ?? 0);
        if (y < ty || y > ty + th) this.scroll[tab] = scrollBy(0, (y - th / 2) * ratio, room);
        this.drag = { tab, at: e.position.y, from: this.scroll[tab], ratio, room };
        this.follow = false;
        this.handle.focus();
        cx.notify();
      })
      .child(div().absolute().right(2).top(ty).w(2).h(th).child(dither(this.drag?.tab === tab ? t.accent : t.ansi8, 1)));
  }

  /** The scrollbar's thumb follows the pointer while it's held. */
  dragTo(e, cx) {
    const d = this.drag;
    if (!d) return;
    const to = scrollBy(d.from, unzoom(e.position.y - d.at) * d.ratio, d.room);
    if (to !== this.scroll[d.tab]) { this.scroll[d.tab] = to; cx.notify(); }
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
    const done = () => { this.follow = true; cx.stop_propagation(); cx.notify(); };
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
    if (k === "tab" && m.shift) return this.switchTab(["procs", "ports", "system"][(["procs", "ports", "system"].indexOf(this.tab) + 2) % 3], cx), done();
    if (k === "tab") return this.switchTab(undefined, cx), done();
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
    else if (k === "enter") this.activate(items, i);
    else if (k === "1") this.switchTab("procs", cx);
    else if (k === "2") this.switchTab("ports", cx);
    else if (k === "3") this.switchTab("system", cx);
    else if (k === "a") this.toggleAll();
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

  /** The fold arrow; a click on it (a few px around it count) folds or unfolds its row. */
  fold_(t, r, i) {
    const icon = r.open === null ? null : svg(`${ART}/${r.open ? "fold-open" : "fold-shut"}.svg`).size(6).text_color(t.dim);
    return div().relative().w(6).flex_none().flex().items_center().when(Boolean(icon), (el) => el.child(icon)
      .child(div().id(`fold-${i}`).absolute().left(-5).right(-5).top(-4).bottom(-4).cursor_pointer()
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => {
          cx.stop_propagation();
          this.moveTo(this.list(), i);
          this.folds[r.key] = r.open;
          this.handle.focus();
          cx.notify();
        })));
  }

  /** One tree row (its depth's guides are the list's, procsView). */
  treeRow(t, r, i, on, ports, tp) {
    const n = r.node;
    const row = h_flex().id(`row-${i}`).relative().h(ROW).flex_none().pl(12 + r.depth * IND).pr(12).gap(7).items_center().text_size(12)
      .text_color(on ? t.foreground : t.muted)
      .cursor_pointer()
      .on_click((e, cx) => this.clickRow(e, i, cx))
      .on_hover((h, cx) => { const k = h ? r.key : this.hover === r.key ? null : this.hover; if (k !== this.hover) { this.hover = k; cx.notify(); } });
    const el = this.band(row, t, on).child(this.fold_(t, r, i));
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

  /** How many lines the command takes in the block (1 to CMD_SHOWN): as drawn once it has been,
   *  else guessed from its length. */
  cmdLines(pid, full) {
    const drawn = this.cmd.pid === pid && this.cmd.h > 0 ? Math.round(this.cmd.h / CMD_LINE) : 0;
    const guess = Math.ceil((full.length * CHAR_W) / (W - 2 - D_LEFT - D_RIGHT));
    return Math.max(1, Math.min(CMD_SHOWN, drawn || guess));
  }

  /** The detail block's height under the selected process's row. */
  blockH(pid) {
    const p = this.proc(pid);
    const lines = p ? this.cmdLines(pid, oneLine(p.cmd)) : 1;
    return D_TOP + lines * CMD_LINE + D_GAP + D_LINE + D_LINES_GAP + D_LINE + D_FOOT + D_AFTER;
  }

  /** Under the selected process, set apart from the rows around it: a ground of its own (the
   *  row's dither, fainter), its whole command line, then its pid and parent with what a click
   *  can do to it, its own cpu and memory, and a dithered rule where it ends. */
  detail(t, item) {
    const pid = item.node.pid;
    const h = this.blockH(pid);
    const p = this.proc(pid);
    if (!p) return div().h(h);
    const up = this.proc(p.ppid);
    const guard = guardOf(p, this.snap.me);
    const full = oneLine(p.cmd);
    const here = terminalOf(pid, this.ix.byPid, this.termPids());
    const meta = (k, v, c) => h_flex().flex_none().gap(5).child(div().text_color(t.dim).child(k)).child(div().text_color(c ?? t.muted).child(v));
    return div().id(`detail-${pid}`).relative().h(h).flex_none().text_size(11)
      .child(v_flex().id("block").absolute().left(0).right(0).top(0).bottom(D_AFTER).pl(D_LEFT).pr(D_RIGHT).pt(D_TOP)
        .child(div().absolute().left(0).right(0).top(0).bottom(0).opacity(0.45).child(dither(t.ansi0, 1)))
        .child(div().absolute().left(0).top(0).bottom(0).w(1).opacity(0.7).child(dither(t.accent, 1)))
        .child(div().absolute().left(12).right(D_RIGHT).bottom(0).h(1).child(dither(t.ansi8, 1)))
        .child(this.command(t, pid, full, this.cmdLines(pid, full) * CMD_LINE))
        .child(h_flex().id("facts").relative().h(D_LINE).mt(D_GAP).flex_none().gap(14).items_center()
          .child(meta("pid", String(p.pid), t.ansi8))
          .when(Boolean(up), (el) => el.child(meta("parent", `${up.name} ${up.pid}`)))
          .child(div().flex_1())
          .when(Boolean(here), (el) => el.child(this.action(t, "d-show", "show", null, () => this.show(item))))
          .child(this.action(t, "d-copy", "copy", null, (cx) => this.copy(item, cx)))
          .when(!guard, (el) => el.child(this.action(t, "d-end", "end", t.blocked, () => this.begin(item, false))))
          .when(!guard && item.node.kids.length > 0, (el) => el.child(this.action(t, "d-tree", "end tree", t.blocked, () => this.begin(item, true)))))
        .child(h_flex().id("live").relative().h(D_LINE).mt(D_LINES_GAP).flex_none().gap(8).items_center()
          .child(meta("cpu", `${p.cpu.toFixed(1)}%`, p.cpu >= 20 ? t.working : null).w(78))
          .child(this.spark(t, "sp-cpu", this.hist.get(pid)?.cpu, t.working, 100))
          .child(div().w(10).flex_none())
          .child(meta("mem", memory(p.rss)).w(62))
          .child(this.spark(t, "sp-mem", this.hist.get(pid)?.rss, t.accent, null))
          .when(Boolean(guard), (el) => el.child(div().flex_1()).child(h_flex().flex_none().gap(4).items_center()
            .child(svg(`${ART}/shield.svg`).size(8).text_color(t.dim)).child(div().text_color(t.dim).child(guard))))));
  }

  /** The detail block's whole command line in `box` px; one that runs longer scrolls under the
   *  wheel (a thin thumb says so), and once it's at its end the wheel scrolls the list again. */
  command(t, pid, full, box) {
    if (this.cmd.pid !== pid) this.cmd = { pid, y: 0, h: 0 };
    const c = this.cmd;
    const room = Math.max(0, c.h - box);
    c.y = Math.min(c.y, room);
    return div().id("cmd").relative().h(box).flex_none().overflow_hidden()
      .on_scroll_wheel((e, cx) => {
        const to = scrollBy(c.y, wheelDelta(e, CMD_LINE, zoom()), Math.max(0, c.h - box));
        if (to === c.y) return;
        cx.stop_propagation();
        c.y = to;
        cx.notify();
      })
      .child(div().id("cmd-text").absolute().left(0).right(0).top(-c.y).line_height(`${CMD_LINE}px`).text_color(t.muted)
        .on_size_change((size, cx) => { const h = Math.round(unzoom(size?.height ?? 0)); if (h !== c.h) { c.h = h; cx.notify(); } })
        .child(full))
      .when(room > 0, (el) => el.child(div().absolute().right(0).w(1).h(Math.max(6, Math.round((box * box) / c.h))).top(Math.round((c.y / room) * (box - Math.max(6, Math.round((box * box) / c.h)))))
        .child(dither(t.ansi8, 1))));
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
    const extra = (r) => (this.ask && this.ask.tab === "procs" && this.ask.key === r.key ? CONFIRM : r === sel && r.kind === "proc" ? this.blockH(r.node.pid) : 0);
    const tops = [];
    let y = 0;
    for (const r of items) { tops.push(y); y += ROW + extra(r); }
    if (sel && this.follow) {
      const a = tops[ci], b = tops[ci] + ROW + extra(sel);
      if (a < this.scroll.procs) this.scroll.procs = a;
      if (b > this.scroll.procs + LIST_H) this.scroll.procs = b - LIST_H;
    }
    const max = Math.max(0, y - LIST_H);
    this.scroll.procs = Math.max(0, Math.min(this.scroll.procs, max));
    const s = this.scroll.procs;
    const kids = [];
    // The depth guides of every row in sight as one 1 px dithered path over the rows (one
    // element for the list, not two a level a row).
    const guides = [];
    items.forEach((r, i) => {
      const top = tops[i], h = ROW + extra(r);
      if (top + h <= s || top >= s + LIST_H) return;
      for (let g = 0; g < r.depth; g++) guides.push({ x: 12 + g * IND + 3, y: top - s, w: 1, h: ROW });
      const on = i === ci;
      kids.push(v_flex().id(`slot-${r.key}`).absolute().left(0).right(0).top(top - s).h(h)
        .child(this.treeRow(t, r, i, on, ports, tp))
        .when(h > ROW, (el) => el.child(this.ask?.key === r.key ? this.confirmBand(t) : this.detail(t, r))));
    });
    const head = (w, text) => div().w(w).flex_none().flex().justify_end().child(text);
    return v_flex().id("procs").h(COLS + LIST_H).flex_none()
      .child(h_flex().h(COLS).flex_none().px(12).gap(7).items_center().text_size(9).text_color(t.ansi8).opacity(0.8)
        .child(div().flex_1().child(this.all ? `ALL OF ${String(this.snap?.me ?? "").toUpperCase()}'S` : "THIS APP'S TERMINALS"))
        .child(head(34, "CPU")).child(head(44, "MEM")).child(head(54, "UP")).child(head(44, "PID")))
      .child(items.length
        ? div().id("procs-list").relative().h(LIST_H).flex_none().overflow_hidden()
          .on_scroll_wheel((e, cx) => this.wheel("procs", e, ROW, max, cx))
          .children(kids)
          .children([this.layer(guides, Background.checkerboard(t.ansi0, dotCell()).opacity(0.9), W - 2, LIST_H), this.scrollbar(t, "procs", y, LIST_H)].filter(Boolean))
        : this.empty(t, LIST_H));
  }

  /** A process's own readings since the deck opened: SPARK thin dithered bars, 12 px tall. */
  spark(t, id, values, color, max) {
    const v = values ?? [];
    // Memory (no max) against a quarter more than its peak, so a steady one reads as a level, not a block.
    const hs = scale(v, { max: max == null ? Math.max(1, ...v) * 1.25 : Math.max(max, ...v), floor: 1 });
    return div().id(id).relative().w(SPARK * 2).h(12).flex_none()
      .child(div().absolute().left(0).right(0).bottom(0).h(1).child(dither(t.ansi0, 1)))
      .children([this.layer(hs.map((h, i) => {
        const tall = Math.max(1, Math.round((h ?? 0) * 12));
        return { x: (SPARK - hs.length + i) * 2, y: 12 - tall, w: 2, h: tall };
      }), Background.checkerboard(color, dotCell()), SPARK * 2, 12)].filter(Boolean));
  }

  /** Bars as one layer: `rects` ({ x, y, w, h } in the graph's px) as one path, filled with
   *  `fill`. Percentages of the graph's box, so the zoom never shifts them; one element a
   *  layer instead of three a bar keeps the system tab's frame inside its render budget. */
  layer(rects, fill, w = GRAPH_W, h = GRAPH_H) {
    if (!rects.length) return null;
    const px = (v) => `${(v / w) * 100}%`, py = (v) => `${(v / h) * 100}%`;
    const path = rects.reduce((b, r) => b.add_polygon([[px(r.x), py(r.y)], [px(r.x + r.w), py(r.y)], [px(r.x + r.w), py(r.y + r.h)], [px(r.x), py(r.y + r.h)]], true), PathBuilder.fill()).build();
    return window.paint_path(path, fill).absolute().top(0).left(0).size_full();
  }

  /** A graph: the history `values` (0..1, null: no reading) as bars, the newest at the right:
   *  dithered columns with a solid 1 px head. `down`: a second series hung under a midline
   *  (network out). `none`: what to say instead. */
  graph(t, id, values, color, { down = null, color2 = null, none = null } = {}) {
    const box = div().id(id).relative().w(GRAPH_W).h(GRAPH_H).flex_none()
      .child(div().absolute().left(0).right(0).bottom(down ? GRAPH_H / 2 : 0).h(1).child(dither(t.ansi0, 1)));
    if (none) return box.child(div().absolute().left(0).right(0).top(0).bottom(0).flex().items_center().justify_center().text_size(11).text_color(t.dim).child(none));
    const x = (i, n) => GRAPH_W - (n - i) * SLOT + 1;
    const half = down ? GRAPH_H / 2 : GRAPH_H;
    const tall = (v) => Math.max(1, Math.round(v * (half - 1)));
    const up = values.map((v, i) => (v == null ? null : { x: x(i, values.length), y: half - tall(v), w: BAR, h: tall(v) })).filter(Boolean);
    const under = (down ?? []).map((v, i) => (v == null ? null : { x: x(i, down.length), y: half + 1, w: BAR, h: tall(v) })).filter(Boolean);
    const cell = dotCell();
    const layers = [
      this.layer(up, Background.checkerboard(color, cell)),
      this.layer(up.map((r) => ({ ...r, h: 1 })), Background.solid(color)),
      this.layer(under, Background.checkerboard(color2 ?? color, cell)),
      this.layer(under.map((r) => ({ ...r, y: r.y + r.h - 1, h: 1 })), Background.solid(color2 ?? color)),
    ];
    return box.children(layers.filter(Boolean));
  }

  /** One graph's block: its name and value now, the graph, a line of detail. */
  meter(t, id, name, value, valueColor, graph, sub) {
    return v_flex().id(`m-${id}`).flex_none().px(12).pt(10).gap(3)
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
      .cursor_pointer()
      .on_click((e, cx) => this.clickRow(e, i, cx))
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
    if (sel && this.follow) {
      const b = tops[ci] + PROW + (this.ask?.key === sel.key ? CONFIRM : 0);
      if (tops[ci] < this.scroll.ports) this.scroll.ports = tops[ci];
      if (b > this.scroll.ports + PORTS_H) this.scroll.ports = b - PORTS_H;
    }
    const max = Math.max(0, y - PORTS_H);
    this.scroll.ports = Math.max(0, Math.min(this.scroll.ports, max));
    if (!items.length) return this.empty(t, PORTS_H);
    return div().id("ports-list").relative().h(PORTS_H).flex_none().overflow_hidden()
      .on_scroll_wheel((e, cx) => this.wheel("ports", e, PROW, max, cx))
      .children(items.map((x, i) => v_flex().id(`pslot-${x.key}`).absolute().left(0).right(0).top(tops[i] - this.scroll.ports)
        .child(this.portRow(t, x, i, i === ci))
        .when(this.ask?.tab === "ports" && this.ask.key === x.key, (el) => el.child(this.confirmBand(t)))))
      .children([this.scrollbar(t, "ports", y, PORTS_H)].filter(Boolean));
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

  /** The bar along the bottom: what the cursor is on and its keys, each a button too. */
  foot(t, items, ci) {
    const item = items[ci];
    const bar = h_flex().relative().h(FOOT).flex_none().px(12).gap(10).items_center().text_size(11)
      .child(div().absolute().left(0).right(0).top(0).h(2).child(dither(t.ansi0, 1)));
    const left = (...kids) => h_flex().flex_1().min_w(0).gap(6).items_center().children(kids.filter(Boolean));
    const keys = (...caps) => h_flex().flex_none().gap(8).items_center().children(caps.filter(Boolean));
    // A key's hint, and a click does what the key does.
    const k = (id, key, what, go) => hint(t, id, key, what).px(2).cursor_pointer().hover((s) => s.bg(t.ansi0))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); go(cx); this.follow = true; this.handle.focus(); cx.notify(); });
    const help = keysHint(t, "k-help", this.help, () => { this.help = !this.help; });
    const arrow = div().flex_none().text_color(t.accent).child("↳");
    const word = (s, c) => div().min_w(0).truncate().text_color(c ?? t.muted).child(s);
    const find = k("k-find", "/", "find", () => { this.typing = true; });
    const all = k("k-all", "a", this.all ? "this app" : "all", () => this.toggleAll());
    const keep = (what) => k("k-no", "esc", what, () => { this.ask = null; });
    if (this.help) return bar.child(left(word("every key", t.dim))).child(keys(k("k-esc", "esc", "back", () => { this.help = false; }), help));
    if (this.ask?.phase === "ask") return bar.child(left(arrow, word(`end ${this.ask.name}`, t.blocked))).child(keys(k("k-yes", "enter", "end", (cx) => this.confirm(cx)), keep("keep")));
    if (this.ask?.phase === "held") return bar.child(left(arrow, word("still running", t.blocked))).child(keys(k("k-kill", "K", "kill -9", (cx) => this.killHard(cx)), keep("leave")));
    if (this.ask) return bar.child(left(arrow, word("ending…", t.dim))).child(keys(keep("hide")));
    if (this.typing) {
      // The find field: a click on it keeps it taking letters.
      const field = h_flex().id("find-field").flex_1().min_w(0).gap(6).items_center().cursor_text()
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => { cx.stop_propagation(); this.typing = true; this.handle.focus(); cx.notify(); })
        .child(div().flex_none().text_color(t.accent).child("/"))
        .child(word(this.query ? this.query.replace(/ /g, " ") : "type to find", this.query ? t.foreground : t.dim))
        .child(div().flex_none().w(1).h(14).bg(t.accent).loop("opacity", { from: 0, to: 1, period: 1000 }));
      return bar.child(field)
        .child(keys(k("k-enter", "enter", "keep", () => { this.typing = false; }), k("k-esc", "esc", this.query ? "clear" : "back", (cx) => this.escape(cx)), help));
    }
    const note = this.note && Date.now() < this.note.until ? word(this.note.text, t[this.note.tone] ?? t.done) : null;
    if (this.tab === "system") return bar.child(left(arrow, word(SYSTEM_PACE, t.dim))).child(keys(k("k-tabs", "tab", "processes", (cx) => this.switchTab("procs", cx)), help));
    // The query, kept after enter: a click on it opens the field again.
    const q = this.query ? div().id("find-query").flex_none().text_color(t.accent).cursor_text()
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); this.typing = true; this.handle.focus(); cx.notify(); })
      .child(`/${this.query}`) : null;
    if (this.tab === "ports") {
      if (!item) return bar.child(left(note ?? word(""), q)).child(keys(k("k-a", "tab", "processes", (cx) => this.switchTab("procs", cx)), find, help));
      return bar.child(left(arrow, note ?? word(address(item.port)), q))
        .child(keys(k("k-open", "enter", "open", () => this.open(item)), k("k-copy", "c", "copy", (cx) => this.copy(item, cx)),
          item.guard ? null : k("k-end", "x", "end", () => this.begin(item, false)), find, help));
    }
    if (!item) return bar.child(left(note ?? word(""), q)).child(keys(all, find, help));
    if (item.kind === "proc") {
      const p = this.proc(item.node.pid);
      const guard = guardOf(p, this.snap?.me);
      if (guard) return bar.child(left(arrow, note ?? word(`${p?.name ?? ""} · ${guard}`, t.dim), q)).child(keys(k("k-show", "enter", "show", () => this.show(item)), all, help));
      return bar.child(left(arrow, note ?? word(p?.name ?? ""), q))
        .child(keys(k("k-end", "x", "end", () => this.begin(item, false)), item.node.kids.length ? k("k-tree", "X", "tree", () => this.begin(item, true)) : null, find, help));
    }
    return bar.child(left(arrow, note ?? word(item.node.name ?? ""), q))
      .child(keys(item.kind === "term" ? k("k-show", "enter", "show", () => this.show(item)) : null,
        item.open !== null ? k("k-fold", "←→", "fold", () => this.fold(items, ci, null)) : null, all, help));
  }

  head(t, nProcs, nPorts) {
    const tabBtn = (id, to, label, n) => {
      const on = this.tab === to;
      return h_flex().id(id).relative().h_full().px(8).gap(6).items_center().text_size(11).cursor_pointer()
        .text_color(on ? t.foreground : t.muted).hover((s) => s.text_color(t.foreground))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => { this.switchTab(to, cx); this.handle.focus(); cx.notify(); })
        .child(div().child(label)).child(div().text_color(t.dim).child(String(n)))
        .when(on, (el) => el.child(div().absolute().left(4).right(4).bottom(0).h(2).bg(t.accent)));
    };
    return h_flex().relative().h(HEAD).flex_none().pl(12).pr(12).gap(10).items_center()
      .child(svg(`${ART}/tree.svg`).size(9).flex_none().text_color(t.accent))
      .child(h_flex().h_full().flex_none().child(tabBtn("tab-procs", "procs", "processes", nProcs)).child(tabBtn("tab-ports", "ports", "ports", nPorts))
        .child(tabBtn("tab-system", "system", "system", this.now?.cpu ? `${Math.round(this.now.cpu.pct)}%` : "")))
      .child(div().flex_1())
      .child(div().id("scope").flex_none().text_size(11).text_color(t.dim).cursor_pointer()
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => { this.toggleAll(); this.handle.focus(); cx.notify(); })
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
    const nProcs = this.procCount();
    return v_flex().id("procs-deck").size_full().bg(t.background).border(1).border_color(t.ansi0)
      .track_focus(this.handle)
      .key_context(CONTEXT)
      .on_action(ESCAPE, (_e, cx) => this.escape(cx))
      .on_mouse_down("left", () => this.handle.focus())
      .on_mouse_move((e, cx) => this.dragTo(e, cx))
      .on_mouse_up("left", (_e, cx) => { if (this.drag) { this.drag = null; cx.notify(); } })
      .on_key_down((e, cx) => this.onKey(e, cx))
      .child(this.head(t, nProcs, ports.length))
      .when(this.help, (el) => el.child(div().id("procs-help").relative().h(H - 2 - HEAD - FOOT).flex_none()
        .child(keysView(t, { id: "procs-keys", title: "processes and ports", list: deckKeys(), close: () => { this.help = false; } }))))
      .when(!this.help && this.tab === "procs", (el) => el.child(this.procsView(t, items, ci)))
      .when(!this.help && this.tab === "ports", (el) => el.child(this.portsView(t, items, ci)))
      .when(!this.help && this.tab === "system", (el) => el.child(this.systemView(t)))
      .child(this.foot(t, items, ci));
  }
}
