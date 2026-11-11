// Nocturne agents: a pane showing what a Claude Code session has spawned,
// as a dithered, animated graph (graph.js), from its files under ~/.claude
// (claude.js). Opened from the tab strip's "agents" or the + menu.
//
//   which session   the focused pane's Claude Code; else the one last shown;
//                   else the first in the shown tab or space. The chips at
//                   the top pick one and keep it.
//   click a node    its details below: an agent's task and its steps, oldest
//                   first (a run: its agents; the session: its own steps)
//   follow          keeps the details at the newest step as it works;
//                   scrolling up stops it, scrolling to the bottom (or
//                   clicking it, or G) starts it again
//   drag / scroll   moves the graph; double-click empty sky (or "centre")
//                   puts it back; cmd-scroll zooms around the pointer
//   + / −           click a selected run again to fold or open it (older
//                   finished runs start folded)
//   detail edge     drag the line above the details to resize them
//   stats strip     under the toolbar: every agent of the session together —
//                   how many work, are done or stopped, their summed run time,
//                   the session's wall time, tokens and what they'd cost at API
//                   prices (≈, claude.js). Click it (or s) for each agent's
//                   share: status, time, tokens, cost, grouped by run
//
// Keys (click the pane, or pane.go onto it):
//   h / l           to the parent / into the first child (l opens a folded run)
//   j / k           down / up the column
//   H J K L         move the graph
//   + / -  0        zoom in / out, back to 100% and centred
//   enter           fold or open the selected run
//   f               focus the Claude Code terminal
//   G / gg          the details' newest step (and follow it) / oldest step
//   w               to the next working agent, following it
//   s               every agent's time, tokens and cost
//   esc             close the details
//   [ ]             the previous / next Claude Code session (the chips)
//   ?               every key (the bar along the bottom shows the main ones)
//   focus           jump to the Claude Code terminal
//   ask             asks that Claude Code, in its own terminal, how the
//                   selected agent or run is doing
//
// The same moves as nocturne-agents.<command> for keys.json: h j k l, in, out,
// reset, follow, working, focus.
//
// Props: { terminal?, select?: "working" } (start on that Claude Code / on a working agent).
//
// Reads this machine's files only: a space on another machine shows a note.
// The last read of each terminal's session is kept in shared(CACHE), so a
// pane coming back (another tab, a restart) draws at once, then refreshes.

import { View, div } from "gpui-kit";
import { h_flex, v_flex, v_virtual_list, VirtualListScrollHandle } from "gpui-base";
import { theme, spaces, panes, focused, terminals, hc, run, props, nextCommand, shared, setShared } from "herdr";
import { dither, pip } from "./kit.js";

/** The name a person gave a pane's terminal (Nocturne's "Rename": the nocturne.name label), or null. */
const givenName = (terminal) => terminals().find((x) => x.address === terminal)?.labels?.["nocturne.name"] || null;
import { sessionOf, snapshot, feed, usageOf, ranFor, span, count, emptyUsage, addUsage } from "./claude.js";
import { tree, place, canvas, sky, dims, ZOOM, TONE, WORDS } from "./graph.js";

const POLL = 2500;
const STALE = 15000;
const stop = (_e, cx) => cx.stop_propagation();
const PAN_STEP = 80;
const CACHE = "nocturne-agents.cache";
// Herdr shows a hidden tab's panes at a placeholder size for a moment before
// their real one; sizes under this are ignored, so the graph doesn't jump.
const PLACEHOLDER = 120;

/** A snapshot as JSON-safe values (shared() keeps plain data), and back. */
const pack = (d) => d && { ...d, agents: [...d.agents.entries()] };
const unpack = (d) => d && { ...d, agents: new Map(d.agents) };
const DETAIL_MIN = 90;
// The selection key of the stats breakdown (no node has it).
const STATS = "@stats";

/** This copy's remembered zoom and detail height (localStorage may be missing). */
function remembered() {
  try { return JSON.parse(localStorage.getItem("view") ?? "{}") ?? {}; } catch { return {}; }
}
function remember(v) {
  try { localStorage.setItem("view", JSON.stringify(v)); } catch { /* not kept */ }
}

/** Claude Code panes in the shown space, the shown tab's first. */
function claudePanes() {
  const space = spaces().find((s) => s.active);
  if (!space) return [];
  const tabs = new Map(space.tabs.map((c) => [c.id, c]));
  return panes().filter((p) => p.terminal && p.app === "claude-code" && tabs.has(p.tab))
    .sort((a, b) => (tabs.get(b.tab).active - tabs.get(a.tab).active) || (tabs.get(a.tab).index - tabs.get(b.tab).index))
    .map((p) => ({ ...p, name: givenName(p.terminal) ?? p.program?.name ?? "Claude Code", machine: space.machine }));
}

function ago(ms) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`;
}

/** "$4.10", "$0.82", "<$0.01"; "≈" when a model had no price. */
function money(u) {
  const c = u.cost;
  const v = c > 0 && c < 0.01 ? "<$0.01" : c >= 100 ? `$${c.toFixed(0)}` : `$${c.toFixed(2)}`;
  return u.unpriced ? `≈${v}` : v;
}

function chip(t, id, label, action, color) {
  return div().id(id).flex_none().px(6).h(20).flex().items_center().text_size(11).text_color(color ?? t.muted)
    .hover((s) => s.text_color(t.foreground).bg(t.ansi0))
    .on_mouse_down("left", stop)
    .on_click((_e, cx) => { cx.stop_propagation(); action(cx); })
    .child(label);
}

/** What ? lists: every key key() takes, ? keys last. */
export const KEYS = [
  ["h l", "parent / first child"], ["j k", "down / up the column"], ["H J K L", "move the graph"],
  ["+ - 0", "zoom in / out / reset"], ["enter space", "fold or open a run"], ["G", "newest step, follow it"],
  ["gg", "oldest step"], ["w", "next working agent"], ["s", "every agent's time, tokens, cost"], ["f", "focus its terminal"],
  ["[ ]", "previous / next session"], ["esc", "close the details"], ["?", "keys"],
];

export default class Agents extends View {
  init(_props, cx) {
    this.terminal = props()?.terminal ?? null; // the Claude Code shown
    this.pinned = Boolean(this.terminal);
    this.session = null; // { pid, id }
    this.data = null;
    this.error = "";
    this.selected = null; // node key
    this.detail = null; // feed() result for the selected agent / main
    this.open = new Set(); // run ids opened (finished ones), "-<id>" for running ones folded
    this.pan = null; // { x, y } once dragged; until then the graph is kept centred
    this.drag = null; // { x, y, from: { x, y } } while dragging
    this.view = { width: 600, height: 400 };
    const kept = remembered();
    this.zoom = Math.min(ZOOM.max, Math.max(ZOOM.min, Number(kept.zoom) || 1));
    this.detailH = Number(kept.detailH) || null; // px; null: half the pane
    this.resizing = null; // { y, from } while the detail edge is dragged
    this.paneH = 600;
    this.follow = true; // the details stay at the newest step
    this.feedScroll = VirtualListScrollHandle.new();
    this.lastDrawn = 0; // when the feed last drew its newest step (it's on screen)
    this.handle = cx.focus_handle();
    // Start from the last read of this terminal's session, if there is one.
    const hit = this.terminal && shared(CACHE)?.[this.terminal];
    if (hit) { this.session = hit.session; this.data = unpack(hit.data); }
    // Commands: "focus" from pane.go onto this pane (mod.json focusable),
    // and nocturne-agents.<move> from keys.json.
    cx.spawn(async (cx) => {
      for (;;) {
        const c = String(await nextCommand()).replace(/^nocturne-agents\./, "");
        if (c === "focus") this.handle.focus();
        else this.command(c, cx);
        cx.notify();
      }
    });
    this.poll(cx);
    cx.timer.every(POLL, (cx) => this.poll(cx));
  }

  /** Which Claude Code to show now. */
  target() {
    const list = claudePanes();
    const f = focused();
    const here = f?.terminal && list.find((p) => p.terminal === f.terminal);
    if (here && !this.pinned) this.terminal = here.terminal;
    if (!list.some((p) => p.terminal === this.terminal)) { this.terminal = list[0]?.terminal ?? null; this.pinned = false; }
    return list.find((p) => p.terminal === this.terminal) ?? null;
  }

  poll(cx) {
    if (this.busy && Date.now() - this.busy < STALE) return;
    const pane = this.target();
    if (!pane) { if (this.data || this.session) { this.data = null; this.session = null; cx.notify(); } return; }
    if (pane.machine) { this.error = "This space is on another machine: only this computer's Claude Code sessions can be read."; this.data = null; cx.notify(); return; }
    const pid = terminals().find((x) => x.address === pane.terminal)?.foreground?.pid ?? null;
    const gen = (this.gen = (this.gen ?? 0) + 1);
    this.busy = Date.now();
    cx.spawn(async (cx) => {
      try {
        if (this.session?.pid !== pid) {
          const hit = shared(CACHE)?.[pane.terminal];
          if (hit && hit.session?.pid === pid) { this.session = hit.session; this.data = unpack(hit.data); cx.notify(); }
        }
        if (this.session?.pid !== pid) {
          const s = await sessionOf(pid);
          if (gen !== this.gen) return;
          if (this.session?.id !== s?.sessionId) { this.selected = null; this.detail = null; this.open = new Set(); }
          this.session = s ? { pid, id: s.sessionId, name: s.name, cwd: s.cwd } : null;
        }
        if (!this.session) { this.data = null; this.error = pid ? "Waiting for Claude Code to write its session…" : ""; return; }
        const data = await snapshot(this.session.id);
        if (gen !== this.gen) return;
        this.data = data;
        this.error = data ? "" : "No transcript for this session yet.";
        if (data) this.keep(pane.terminal);
        // Tokens per transcript (each read again only once it changed).
        if (data) this.usage = await usageOf([{ file: data.main, changed: data.mainChanged }, ...[...data.agents.values()].map((a) => ({ file: a.file, changed: a.changed }))]);
        // Opened with props { select: "working" }: start on a working agent, once the graph is laid out.
        if (data && props()?.select === "working" && !this.startedOn) { this.startedOn = true; cx.timer.after(50, (cx) => { this.toWorking(cx); cx.notify(); }); }
        const file = this.selectedFile();
        const before = this.detail?.items.length ?? 0;
        this.detail = file ? await feed(file) : null;
        if (this.follow && this.detail && this.detail.items.length !== before) this.feedScroll.scroll_to_bottom();
      } catch (e) {
        this.error = String(e?.message ?? e);
      } finally {
        if (gen === this.gen) this.busy = 0;
        cx.notify();
      }
    });
  }

  /** Keeps this read for the next copy that shows this terminal (only when it changed). */
  keep(terminal) {
    const entry = { session: this.session, data: pack(this.data) };
    const json = JSON.stringify(entry);
    if (json === this.kept) return;
    this.kept = json;
    const all = { ...(shared(CACHE) ?? {}) };
    // Only terminals that still exist.
    const live = new Set(terminals().map((x) => x.address));
    for (const k of Object.keys(all)) if (!live.has(k)) delete all[k];
    all[terminal] = entry;
    setShared(CACHE, all);
  }

  /** Follows the selected agent from now on: to its newest step. */
  startFollowing() {
    this.follow = true;
    this.feedScroll.scroll_to_bottom();
    this.pendingBottom = true; // again once the list has drawn with the newest rows
  }

  /** nocturne-agents.<command>: the keyboard's moves, for keys.json. */
  command(c, cx) {
    if (c === "keys") { this.help = !this.help; return; }
    if ("hjkl".includes(c) && c.length === 1) return this.step(c, cx);
    if (c === "in") this.zoomTo(this.zoom * ZOOM.step);
    else if (c === "out") this.zoomTo(this.zoom / ZOOM.step);
    else if (c === "reset") { this.zoom = 1; this.pan = null; this.save(); }
    else if (c === "follow") this.startFollowing();
    else if (c === "working") this.toWorking(cx);
  }

  /** Selects the next working agent (after the selected one, wrapping) and follows it. */
  toWorking(cx) {
    const list = (this.layout ?? []).filter((n) => n.kind === "agent" && n.status === "working").sort((a, b) => a.x - b.x || a.y - b.y);
    if (!list.length) return;
    const i = list.findIndex((n) => n.key === this.selected);
    const n = list[(i + 1) % list.length];
    this.pick(n, cx, false);
    this.reveal(n);
    this.startFollowing();
  }

  /** The transcript behind the selected node, if it has one. */
  selectedFile() {
    if (!this.data || !this.selected || this.selected === STATS) return null;
    if (this.selected === "main") return this.data.main;
    return this.data.agents.get(this.selected)?.file ?? null;
  }

  pick(n, cx, again = true) {
    this.handle.focus();
    if (again && n.kind === "run" && this.selected === n.key) {
      // A second click folds or opens it.
      this.open.has(n.foldKey) ? this.open.delete(n.foldKey) : this.open.add(n.foldKey);
    }
    if (this.selected !== n.key) this.follow = true;
    this.selected = n.key;
    this.detail = null;
    this.busy = 0;
    this.poll(cx);
    cx.notify();
  }

  ask(n, pane) {
    const what = n.kind === "run" ? `the workflow run ${n.run.name} (${n.run.id})`
      : n.kind === "phase" ? `the ${n.label} phase of the workflow ${n.run.name} (${n.run.id})`
      : `the subagent "${n.label}" (${n.key})`;
    hc(["send", pane.terminal, `How is ${what} doing? Brief status, anything blocked or worth my attention.`]).catch(() => {});
  }

  // ---- keyboard, zoom

  save() { remember({ zoom: this.zoom, detailH: this.detailH }); }

  /** Zooms to z keeping the graph point under `at` (view px; default its centre) where it is. */
  zoomTo(z, at) {
    z = Math.min(ZOOM.max, Math.max(ZOOM.min, Math.round(z * 100) / 100));
    if (z === this.zoom) return;
    const a = at ?? { x: this.view.width / 2, y: this.view.height / 2 };
    const p = this.panFor(this.graphH ?? 0);
    const k = z / this.zoom;
    this.pan = { x: Math.round(a.x - (a.x - p.x) * k), y: Math.round(a.y - (a.y - p.y) * k) };
    this.zoom = z;
    this.save();
  }

  movePan(dx, dy) {
    const p = this.panFor(this.graphH ?? 0);
    this.pan = { x: p.x + dx, y: p.y + dy };
  }

  /** Moves the selection: h parent, l first child, j / k next / previous in the column. */
  step(dir, cx) {
    const nodes = this.layout ?? [];
    if (!nodes.length) return;
    const cur = nodes.find((n) => n.key === this.selected);
    let next = null;
    if (!cur) next = nodes.find((n) => n.kind === "main");
    else if (dir === "h") next = nodes.find((n) => n.children.includes(cur));
    else if (dir === "l") {
      if (cur.kind === "run" && cur.folded) { this.open.has(cur.foldKey) ? this.open.delete(cur.foldKey) : this.open.add(cur.foldKey); return cx.notify(); }
      next = cur.children[0];
    } else {
      const col = nodes.filter((n) => n.x === cur.x).sort((a, b) => a.y - b.y);
      next = col[col.indexOf(cur) + (dir === "j" ? 1 : -1)];
    }
    if (!next) return;
    this.pick(next, cx, false);
    this.reveal(next);
  }

  /** Moves the graph so `n` is in view, if it isn't. */
  reveal(n) {
    const p = this.panFor(this.graphH ?? 0), d = dims(this.zoom), m = 24;
    const x = n.x + p.x, y = n.y + p.y;
    let dx = 0, dy = 0;
    if (x < m) dx = m - x; else if (x + d.NW > this.view.width - m) dx = this.view.width - m - x - d.NW;
    if (y < m) dy = m - y; else if (y + n.h > this.view.height - m) dy = this.view.height - m - y - n.h;
    if (dx || dy) this.movePan(dx, dy);
  }

  /** [ / ]: the previous / next session in the toolbar's chips, kept. */
  cycle(d, cx) {
    const list = claudePanes(), cur = this.target();
    if (!list.length) return;
    const i = list.findIndex((p) => p.terminal === cur?.terminal);
    const p = list[(i + d + list.length) % list.length];
    this.terminal = p.terminal; this.pinned = true; this.session = null; this.busy = 0;
    this.poll(cx);
  }

  key(e, cx) {
    const m = e.modifiers;
    if (m.control || m.platform || m.alt) return;
    const typed = e.key_char && e.key_char.length === 1 ? e.key_char : null;
    if (this.help) {
      if (e.key === "escape" || typed === "?" || typed === "q") { this.help = false; cx.stop_propagation(); cx.notify(); }
      return;
    }
    if (typed === "?" || typed === "[" || typed === "]") {
      if (typed === "?") this.help = true;
      else this.cycle(typed === "]" ? 1 : -1, cx);
      cx.stop_propagation();
      return cx.notify();
    }
    const k = e.key, upper = m.shift || /^[A-Z]$/.test(k), low = k.toLowerCase();
    if (upper && "hjkl".includes(low) && low.length === 1) {
      const [dx, dy] = { h: [PAN_STEP, 0], l: [-PAN_STEP, 0], k: [0, PAN_STEP], j: [0, -PAN_STEP] }[low];
      this.movePan(dx, dy);
    } else if ("hjkl".includes(k) && k.length === 1) return this.step(k, cx);
    else if (k === "+" || k === "=") this.zoomTo(this.zoom * ZOOM.step);
    else if (k === "-" || k === "_") this.zoomTo(this.zoom / ZOOM.step);
    else if (k === "0") { this.zoom = 1; this.pan = null; this.save(); }
    else if (k === "enter" || k === "space") {
      const n = (this.layout ?? []).find((x) => x.key === this.selected);
      if (n?.kind === "run") { this.open.has(n.foldKey) ? this.open.delete(n.foldKey) : this.open.add(n.foldKey); }
    } else if (k === "f" && !upper) { const pane = this.target(); if (pane) run("pane.focus", { pane: pane.pane }); return; }
    else if (low === "g" && upper) this.startFollowing();
    else if (k === "g") {
      // gg (two within half a second): the oldest step, and stop following.
      if (Date.now() - (this.gAt ?? 0) < 500) { this.gAt = 0; this.follow = false; this.feedScroll.scroll_to_item(0); }
      else { this.gAt = Date.now(); return; }
    }
    else if (k === "w") this.toWorking(cx);
    else if (k === "s") { this.selected = this.selected === STATS ? null : STATS; this.detail = null; }
    else if (k === "escape") { this.selected = null; this.detail = null; }
    else return;
    cx.stop_propagation();
    cx.notify();
  }

  // ---- parts

  toolbar(t, list, pane) {
    const counts = this.data ? [...this.data.agents.values()].filter((a) => a.status === "working").length : 0;
    return h_flex().id("ag-toolbar").relative().h(34).flex_none().px(12).gap(6).items_center().text_size(11)
      .child(div().flex_none().pr(4).text_color(t.ansi8).child("AGENTS"))
      .child(h_flex().id("ag-sessions").flex_1().min_w(0).gap(2).items_center().overflow_x_scroll()
        .children(list.map((p) => {
          const on = p.terminal === pane?.terminal;
          return h_flex().id(`ag-s-${p.terminal}`).relative().flex_none().h(20).px(6).gap(6).items_center()
            .text_color(on ? t.foreground : t.muted).hover((s) => s.text_color(t.foreground))
            .on_mouse_down("left", stop)
            .on_click((_e, cx) => { this.terminal = p.terminal; this.pinned = true; this.session = null; this.busy = 0; this.poll(cx); cx.notify(); })
            .when(on, (el) => el.child(dither(t.ansi0, 1)))
            .child(div().relative().child(pip(t, p.status, 5)))
            .child(div().relative().max_w(140).truncate().child(p.name));
        })))
      .when(counts > 0, (el) => el.child(div().flex_none().text_color(t.working).child(`${counts} working`)))
      .child(div().absolute().left(0).right(0).bottom(0).h(2).child(dither(t.ansi0, 1)));
  }

  /**
   * The selected agent's steps, oldest first, newest at the bottom (where
   * follow keeps it). A virtual list, so the scroll handle can move it: rows
   * get fixed heights, text wrapping to at most a few lines (cut off past them).
   */
  feedList(t, f) {
    if (!f) return div().id("ag-feed").flex_1().px(12).py(6).text_size(11).text_color(t.dim).child("reading…");
    const rows = [...(f.task ? [{ kind: "task", text: f.task }] : []), ...f.items.slice(-150)];
    // Roughly how many characters fit on a line (Departure Mono: ~0.6em wide).
    const perLine = Math.max(20, Math.floor((this.view.width - 24) / 6.6));
    const lines = (text, max) => Math.min(max, Math.max(1, Math.ceil(text.length / perLine)));
    const LINE = 15;
    const height = (x) => x.kind === "task" ? 20 + lines(x.text, 5) * LINE
      : x.kind === "tool" ? 19 : x.kind === "result" ? 17 : 6 + lines(x.text, 4) * LINE;
    const row = (x, i) => {
      const box = div().id(`f-${i}`).h(height(x)).overflow_hidden();
      if (x.kind === "task") {
        return box.px(12).pt(4).child(div().text_size(10).text_color(t.ansi8).child("TASK"))
          .child(div().text_size(11).text_color(t.muted).child(x.text));
      }
      if (x.kind === "tool") {
        return box.child(h_flex().h_full().px(12).gap(6).items_center().text_size(11)
          .child(div().flex_none().text_color(t.accent).child(`▸ ${x.name}`))
          .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(x.text)));
      }
      if (x.kind === "result") {
        return box.pl(24).pr(12).truncate().text_size(10).text_color(x.error ? t.blocked : t.dim).child(`↳ ${x.text || "(no output)"}`);
      }
      return box.px(12).pt(3).text_size(11).text_color(x.kind === "prompt" ? t.muted : t.foreground).child(x.text);
    };
    const last = rows.length - 1;
    return div().id("ag-feed-box").relative().flex_1().min_h(0)
      .on_scroll_wheel((e, cx) => {
        const dy = e.delta?.y ?? 0;
        if (dy > 0 && this.follow) { this.follow = false; cx.notify(); }
        // Scrolled down to the newest step: follow again.
        else if (dy < 0 && !this.follow) cx.timer.after(60, (cx) => { if (Date.now() - this.lastDrawn < 250) { this.follow = true; cx.notify(); } });
      })
      .child(v_virtual_list("ag-feed", rows.length, rows.map(height), (i) => `${i}`, (range) => {
        if (range.end - 1 >= last) this.lastDrawn = Date.now();
        const out = [];
        for (let i = range.start; i < range.end; i++) out.push(row(rows[i], i));
        return out;
      }).size_full().track_scroll(this.feedScroll));
  }

  /** "41.2k tok · $0.82" for a transcript, once its tokens are known. */
  tokens(file) {
    const u = file && this.usage?.get(file);
    if (!u || !u.tokens) return null;
    return `${count(u.tokens)} tok · ${money(u)}`;
  }

  /** Every agent of the session together, and the session itself. */
  totals() {
    const list = [...(this.data?.agents.values() ?? [])];
    const by = (st) => list.filter((a) => a.status === st).length;
    const sub = emptyUsage(), all = emptyUsage();
    for (const a of list) addUsage(sub, this.usage?.get(a.file));
    addUsage(all, sub);
    addUsage(all, this.usage?.get(this.data?.main));
    return {
      n: list.length, working: by("working"), done: by("done"), stopped: by("stopped") + by("idle"),
      time: list.reduce((k, a) => k + ranFor(a), 0),
      wall: this.data?.mainStarted ? Date.now() - this.data.mainStarted : 0,
      sub, all,
    };
  }

  /** The strip under the toolbar: counts, time, tokens, cost. Click: each agent's share. */
  statsStrip(t) {
    const s = this.totals();
    const on = this.selected === STATS;
    const part = (color, text) => div().flex_none().text_color(color).child(text);
    const sep = () => div().flex_none().text_color(t.ansi0).child("│");
    return h_flex().id("ag-stats").relative().h(26).flex_none().px(12).gap(8).items_center().text_size(11).overflow_hidden()
      .hover((st) => st.bg(t.ansi0 + "55"))
      .on_mouse_down("left", stop)
      .on_click((_e, cx) => { this.selected = on ? null : STATS; this.detail = null; cx.notify(); })
      .when(on, (el) => el.child(dither(t.ansi0, 1)).child(div().absolute().left(0).top(0).bottom(0).w(2).bg(t.accent)))
      .child(div().relative().flex_none().text_color(t.ansi8).child("ALL"))
      .child(part(t.foreground, `${s.n} agent${s.n === 1 ? "" : "s"}`).relative())
      .when(s.working > 0, (el) => el.child(part(t.working, `${s.working} working`).relative()))
      .when(s.done > 0, (el) => el.child(part(t.done, `${s.done} done`).relative()))
      .when(s.stopped > 0, (el) => el.child(part(t.muted, `${s.stopped} stopped`).relative()))
      .child(sep().relative())
      .child(part(t.muted, `Σ ${span(s.time)}`).relative().tooltip("the agents' run times added up"))
      .when(s.wall > 0, (el) => el.child(part(t.dim, `wall ${span(s.wall)}`).relative().tooltip("since the session started")))
      .when(s.all.tokens > 0, (el) => el.child(sep().relative())
        .child(part(t.muted, `${count(s.all.tokens)} tok`).relative()
          .tooltip(`in ${count(s.all.input)} · out ${count(s.all.output)} · cache write ${count(s.all.cache5m + s.all.cache1h)} · cache read ${count(s.all.cacheRead)}`))
        .child(part(t.foreground, money(s.all)).relative().tooltip("at Anthropic's API list prices; the session and every agent")))
      .child(div().flex_1())
      .child(div().relative().flex_none().text_color(on ? t.accent : t.dim).child(on ? "× close" : "s · breakdown"))
      .child(div().absolute().left(0).right(0).bottom(0).h(1).bg(t.ansi0));
  }

  /** Each agent's share, grouped by run (the session's own first), with totals. */
  statsBody(t) {
    const d = this.data;
    const s = this.totals();
    const cols = (id, color, cells) => h_flex().id(id).h(20).flex_none().gap(8).items_center().text_color(color)
      .child(div().flex_1().min_w(0).truncate().child(cells[0]))
      .child(div().w(70).flex_none().child(cells[1]))
      .child(div().w(64).flex_none().child(cells[2]))
      .child(div().w(64).flex_none().child(cells[3]))
      .child(div().w(56).flex_none().child(cells[4]));
    const row = (a) => {
      const u = this.usage?.get(a.file);
      return h_flex().id(`ag-st-${a.id}`).gap(6).items_center().hover((st) => st.bg(t.ansi0 + "55"))
        .on_click((_e, cx) => this.pick({ key: a.id, kind: "agent" }, cx))
        .child(div().w(6).h(6).flex_none().relative().child(dither(t[TONE[a.status] ?? "ansi8"], 1)))
        .child(div().flex_1().min_w(0).child(cols(`ag-stc-${a.id}`, t.muted, [
          div().truncate().text_color(t.foreground).child(a.label),
          div().text_color(t[TONE[a.status] ?? "dim"]).child(WORDS[a.status] ?? a.status),
          div().text_color(a.status === "working" ? t.working : t.muted).child(span(ranFor(a))),
          u?.tokens ? count(u.tokens) : "–", u?.tokens ? money(u) : "–"])));
    };
    const agents = [...d.agents.values()].sort((a, b) => a.started - b.started);
    const own = agents.filter((a) => !a.run);
    const groups = [
      ...(own.length ? [{ id: "own", name: "the session's subagents", list: own }] : []),
      ...d.runs.map((r) => ({ id: r.id, name: `${r.name} · ${span((r.ended ?? Date.now()) - r.started)}`, list: r.agents.map((id) => d.agents.get(id)).filter(Boolean) })),
    ];
    const head = (g) => h_flex().id(`ag-stg-${g.id}`).pt(6).pb(2).gap(8).items_center()
      .child(div().flex_none().text_size(10).text_color(t.ansi8).child(g.name.toUpperCase()))
      .child(div().flex_1().h(1).relative().opacity(0.6).child(dither(t.ansi8, 1)));
    const main = this.usage?.get(d.main);
    return v_flex().id("ag-stats-body").flex_1().min_h(0).px(12).py(6).gap(2).overflow_y_scroll().text_size(11)
      .child(h_flex().gap(6).pl(12).child(div().flex_1().child(cols("ag-st-head", t.ansi8, ["agent", "status", "time", "tokens", "cost"]))))
      .child(h_flex().id("ag-st-main").gap(6).items_center()
        .child(div().w(6).h(6).flex_none())
        .child(div().flex_1().min_w(0).child(cols("ag-stc-main", t.muted, [
          div().truncate().text_color(t.foreground).child("the session itself"), "", s.wall ? span(s.wall) : "–",
          main?.tokens ? count(main.tokens) : "–", main?.tokens ? money(main) : "–"]))))
      .children(groups.flatMap((g) => [head(g), ...g.list.map(row)]))
      .child(div().h(2).mt(6).relative().child(dither(t.ansi0, 1)))
      .child(h_flex().gap(6).pl(12).child(div().flex_1().child(cols("ag-st-sum", t.foreground, [
        `${s.n} agents · ${s.working} working · ${s.done} done · ${s.stopped} stopped`, "", span(s.time), count(s.all.tokens), money(s.all)]))))
      .child(div().pt(4).text_size(10).text_color(t.dim).child(`agents alone: ${count(s.sub.tokens)} tok · ${money(s.sub)} · costs at API list prices${s.all.unpriced ? "; a model without a price is left out" : ""}`));
  }

  /** What the selected node is: a run's or phase's agents, else its transcript. */
  details(t, n, pane) {
    if (n.kind === "stats") return this.panel(t, h_flex().id("ag-detail-head").relative().h(30).flex_none().px(12).gap(8).items_center().text_size(11)
      .child(div().flex_none().text_color(t.foreground).child("Every agent"))
      .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child("time, tokens and cost, by run"))
      .child(chip(t, "ag-close", "×", (cx) => { this.selected = null; cx.notify(); }))
      .child(div().absolute().left(0).right(0).top(0).h(2).child(dither(t.ansi0, 1))), this.statsBody(t));
    const color = t[TONE[n.status] ?? "ansi8"];
    const head = h_flex().id("ag-detail-head").relative().h(30).flex_none().px(12).gap(8).items_center().text_size(11)
      .child(div().flex_none().w(8).h(8).relative().child(dither(color, 1)))
      .child(div().flex_none().max_w(260).truncate().text_color(t.foreground).child(n.label))
      .child(div().flex_1().min_w(0).truncate().text_color(t.dim)
        .child([n.kind === "main" ? "session" : n.kind, WORDS[n.status], this.detail?.model?.replace(/^claude-/, ""),
          n.agent ? `${n.status === "working" ? "for" : "ran"} ${span(ranFor(n.agent))}` : n.kind === "main" && this.data?.mainStarted ? `started ${ago(this.data.mainStarted)}` : null,
          n.agent?.changed && n.status !== "working" ? ago(n.agent.changed) : null,
          this.tokens(n.kind === "main" ? this.data?.main : n.agent?.file)].filter(Boolean).join(" · ")))
      .when(n.kind === "agent" || n.kind === "main", (el) => el.child(chip(t, "ag-follow", this.follow ? "● follow" : "○ follow",
        (cx) => { this.follow ? (this.follow = false) : this.startFollowing(); cx.notify(); }, this.follow ? t.accent : t.dim)))
      .child(chip(t, "ag-focus", "focus", () => run("pane.focus", { pane: pane.pane })))
      .when(n.kind !== "main", (el) => el.child(chip(t, "ag-ask", "ask", () => this.ask(n, pane), t.accent)))
      .child(chip(t, "ag-close", "×", (cx) => { this.selected = null; this.detail = null; cx.notify(); }))
      .child(div().absolute().left(0).right(0).top(0).h(2).child(dither(t.ansi0, 1)));
    let body;
    if (n.kind === "run" || n.kind === "phase") {
      const r = n.run;
      const ids = n.kind === "run" ? r.agents : r.agents.filter((id) => this.data.agents.get(id)?.phase === n.label);
      body = v_flex().id("ag-run").flex_1().min_h(0).px(12).py(6).gap(3).overflow_y_scroll().text_size(11)
        .when(n.kind === "run" && Boolean(r.summary), (el) => el.child(div().pb(4).text_color(t.muted).child(r.summary)))
        .when(n.kind === "run", (el) => el.child(div().pb(4).text_color(t.dim).child(`phases: ${r.phases.join(" → ") || "-"}`)))
        .children(ids.map((id) => this.data.agents.get(id)).filter(Boolean).map((a) =>
          h_flex().id(`ag-r-${a.id}`).gap(8).items_center().hover((s) => s.bg(t.ansi0 + "55"))
            .on_click((_e, cx) => this.pick({ key: a.id, kind: "agent" }, cx))
            .child(div().w(6).h(6).flex_none().relative().child(dither(t[TONE[a.status] ?? "ansi8"], 1)))
            .child(div().w(54).flex_none().truncate().text_color(t.dim).child(a.phase ?? ""))
            .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(a.label))
            .child(div().flex_none().text_color(t.dim).child(this.tokens(a.file) ?? ""))
            .child(div().w(64).flex_none().text_color(a.status === "working" ? t.working : t.muted).child(span(ranFor(a))))
            .child(div().w(54).flex_none().text_color(t[TONE[a.status] ?? "dim"]).child(WORDS[a.status] ?? a.status))));
    } else body = this.feedList(t, this.detail);
    return this.panel(t, head, body);
  }

  /** The details panel: a head, a body, and the edge above them that resizes it. */
  panel(t, head, body) {
    // The edge above the details: drag it to resize them.
    const edge = div().id("ag-detail-edge").absolute().left(0).right(0).top(-3).h(7).cursor_row_resize()
      .on_mouse_down("left", (e, cx) => {
        cx.stop_propagation();
        this.resizing = { y: e.position.y, from: this.detailH ?? Math.round(this.paneH / 2) };
        cx.notify();
      })
      .child(div().absolute().left(0).right(0).top(3).h(1).when(Boolean(this.resizing), (el) => el.bg(t.accent)));
    const panel = v_flex().id("ag-detail").relative().flex_none().bg(t.background).child(head).child(body).child(edge);
    return this.detailH ? panel.h(this.detailH) : panel.h_1_2();
  }

  /** Where the graph sits: dragged there, else at the left, the whole graph centred when it fits, else the session node. */
  panFor(height) {
    if (this.pan) return this.pan;
    const vh = this.view.height;
    const y = height <= vh ? (vh - height) / 2 : Math.min(0, Math.max(vh - height, vh / 2 - this.rootY));
    return { x: 0, y: Math.round(y) };
  }

  /** The graph's window: drag (or scroll) to move it, double-click empty sky to centre it again. */
  viewport(t, root) {
    const d = dims(this.zoom);
    const probe = place(root, d); // sizes and positions, before drawing
    this.rootY = root.y + root.h / 2;
    this.graphH = probe.height;
    this.layout = probe.nodes;
    const at = this.panFor(probe.height);
    const { el } = canvas(t, root, this.selected, (n, cx) => this.pick(n, cx), at.x, at.y, d);
    const end = (cx) => { if (this.drag) { this.drag = null; cx.notify(); } };
    return div().id("ag-graph").relative().flex_1().min_h(0).overflow_hidden()
      .when(Boolean(this.drag), (el) => el.cursor_grabbing()).when(!this.drag, (el) => el.cursor_grab())
      .on_size_change((size, cx) => { if (size.width >= PLACEHOLDER && size.height >= PLACEHOLDER) { this.view = size; cx.notify(); } })
      .on_mouse_down("left", (e, cx) => {
        if (e.click_count === 2) { this.pan = null; this.drag = null; return cx.notify(); }
        this.handle.focus();
        this.drag = { x: e.position.x, y: e.position.y, from: this.panFor(probe.height) };
        cx.notify();
      })
      .on_mouse_move((e, cx) => {
        const d = this.drag;
        if (!d) return;
        this.pan = { x: Math.round(d.from.x + e.position.x - d.x), y: Math.round(d.from.y + e.position.y - d.y) };
        cx.notify();
      })
      .on_mouse_up("left", (_e, cx) => end(cx))
      .on_hover((h, cx) => { if (!h) end(cx); })
      .on_scroll_wheel((e, cx) => {
        if (e.modifiers?.platform || e.modifiers?.control) {
          // cmd-scroll (or a pinch's ctrl-scroll) zooms around the pointer.
          this.zoomTo(this.zoom * Math.pow(ZOOM.step, (e.delta?.y ?? 0) / 40), e.local_position);
        } else {
          const p = this.panFor(probe.height);
          this.pan = { x: Math.round(p.x + (e.delta?.x ?? 0)), y: Math.round(p.y + (e.delta?.y ?? 0)) };
        }
        cx.notify();
      })
      .child(sky(t, at.x, at.y))
      .child(el)
      .when(Boolean(this.pan), (el) => el.child(div().id("ag-recentre").absolute().right(10).bottom(8).px(6).h(20).flex().items_center()
        .text_size(11).text_color(t.muted).bg(t.background).hover((s) => s.text_color(t.foreground).bg(t.ansi0))
        .on_mouse_down("left", stop)
        .on_click((_e, cx) => { this.pan = null; cx.notify(); })
        .child("centre")))
      .when(this.zoom !== 1, (el) => el.child(div().id("ag-zoom").absolute().left(10).bottom(8).px(6).h(20).flex().items_center()
        .text_size(11).text_color(t.dim).bg(t.background).hover((s) => s.text_color(t.foreground).bg(t.ansi0))
        .on_mouse_down("left", stop)
        .on_click((_e, cx) => { this.zoom = 1; this.save(); cx.notify(); })
        .child(`${Math.round(this.zoom * 100)}%`)));
  }

  /** lazygit's options bar: the main keys. */
  hints(t) {
    const list = this.help ? [["esc", "close"], ["?", "keys"]]
      : [["hjkl", "move"], ["enter", "fold"], ["G", "follow"], ["w", "working"], ["s", "stats"], ["f", "terminal"], ["[ ]", "session"], ["?", "keys"]];
    return h_flex().id("ag-hints").relative().h(22).flex_none().px(12).gap(10).items_center().text_size(11).overflow_hidden()
      .child(div().absolute().left(0).right(0).top(0).h(2).child(dither(t.ansi0, 1)))
      .children(list.map(([key, what], i) => h_flex().id(`ag-hint-${i}`).flex_none().gap(4)
        .child(div().text_color(t.accent).child(key))
        .child(div().text_color(t.dim).child(what))));
  }

  /** ?: every key, over the pane. */
  helpPanel(t) {
    return v_flex().id("ag-help").absolute().inset_0().bg(t.background).px(16).py(12).gap(2).text_size(11)
      .child(div().pb(6).text_color(t.ansi8).child("KEYS"))
      .children(KEYS.map(([k, what], i) => h_flex().id(`ag-help-${i}`).gap(12)
        .child(div().w(90).flex_none().text_color(t.accent).child(k))
        .child(div().text_color(t.muted).child(what))));
  }

  render() {
    const t = theme();
    const list = claudePanes();
    const pane = this.target();
    const endResize = (cx) => { if (this.resizing) { this.resizing = null; this.save(); cx.notify(); } };
    const shell = v_flex().id("nocturne-agents").relative().size_full().bg(t.background)
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.key(e, cx))
      .on_size_change((size, cx) => { if (size.height >= PLACEHOLDER) { this.paneH = size.height; cx.notify(); } })
      .when(Boolean(this.resizing), (el) => el.cursor_row_resize())
      .on_mouse_move((e, cx) => {
        const r = this.resizing;
        if (!r) return;
        this.detailH = Math.round(Math.min(this.paneH - 34 - 80, Math.max(DETAIL_MIN, r.from - (e.position.y - r.y))));
        cx.notify();
      })
      .on_mouse_up("left", (_e, cx) => endResize(cx))
      .on_hover((h, cx) => { if (!h) endResize(cx); })
      .child(this.toolbar(t, list, pane));
    const note = (text, sub) => shell.child(v_flex().flex_1().items_center().justify_center().gap(6).px(16).text_size(11)
      .child(div().text_color(t.foreground).child(text)).child(div().text_center().text_color(t.ansi8).child(sub ?? "")));
    if (!pane) return note("No Claude Code in this space", "Start one from + new, then its agents and workflows show here.");
    if (this.error && !this.data) return note(this.error, "");
    if (!this.data) return note("Reading the session…", pane.cwd ?? "");
    const root = tree(this.data, { label: pane.name, sub: [this.session?.name, WORDS[pane.status] ?? "idle"].filter(Boolean).join(" · "), status: pane.status ?? "idle" }, this.open);
    const find = (n) => n.key === this.selected ? n : n.children.map(find).find(Boolean);
    const sel = this.selected === STATS ? { key: STATS, kind: "stats" } : this.selected ? find(root) : null;
    return shell
      .when(this.data.agents.size > 0, (el) => el.child(this.statsStrip(t)))
      .child(this.viewport(t, root))
      .when(Boolean(this.pendingBottom), (el) => { this.pendingBottom = false; this.feedScroll.scroll_to_bottom(); return el; })
      .when(Boolean(sel), (el) => el.child(this.details(t, sel, pane)))
      .when(!root.children.length, (el) => el.child(div().flex_none().px(12).pb(8).text_size(11).text_color(t.ansi8)
        .child("No subagents or workflows in this session yet.")))
      .child(this.hints(t))
      .when(this.help, (el) => el.child(this.helpPanel(t)));
  }
}
