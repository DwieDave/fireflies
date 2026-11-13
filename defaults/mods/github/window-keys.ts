// The GitHub window's keys (main.ts hands them over): its key handler, the
// picker's, L's list of links, and the commands sent to it (github.<name>).

import type { Context, KeyEvent } from "gpui-kit";
import type { WebLink } from "./model.ts";
import { noteOf } from "./kit.ts";
import { keysKey } from "./keyhelp.ts";
import Actions from "./actions.ts";
import { TABS, isTabId } from "./window-chrome.ts";
import type { default as GitHub } from "./main.ts";

/** The window's keys: a confirm, a form or a composer first, then the picker, ?, the window's own, the shown tab's. */
export function windowKey(v: GitHub, e: KeyEvent, cx: Context): void {
  const m = e.modifiers;
  const c = e.key_char;
  const k = c && c.length === 1 && c.trim() && !m.platform && !m.control ? c : e.key;
  const confirm = v.confirm;

  if (confirm) {
    v.confirm = null;

    if (k === "y" || k === "enter") confirm.go();

    cx.stop_propagation();
    cx.notify();

    return;
  }

  const tab = v.shown();
  const form = tab.form;

  if (form) {
    if (form.key(k, e, cx) === true) {
      cx.stop_propagation();
      cx.notify();
    }

    return;
  }

  if (tab.composer) {
    if (tab.key(k, e, cx) === true) {
      cx.stop_propagation();
      cx.notify();
    }

    return;
  }

  if ((m.platform || m.alt) && k !== "enter") return;

  if (v.picker) {
    pickerKey(v, k, cx);
    cx.stop_propagation();
    cx.notify();

    return;
  }

  const help = keysKey(e, v.help);

  if (help || v.help) {
    if (help) v.help = help === "toggle" ? !v.help : false;

    cx.stop_propagation();
    cx.notify();

    return;
  }

  const ids = TABS.map(([id]) => id);
  const fork = Boolean(v.repo?.parent || v.repo?.child);

  if (k === "1" || k === "2" || k === "3") v.setTab(ids[Number(k) - 1] ?? v.tab, cx);
  else if (k === "[" || k === "]") v.setTab(ids[(ids.indexOf(v.tab) + (k === "]" ? 1 : ids.length - 1)) % ids.length] ?? v.tab, cx);
  else if (((k === "p" && v.tab !== "projects") || k === "F") && fork) v.switchFork(cx);
  else if (k === "L" && v.state === "ready") pickLink(v);
  else if (k === "r" && !m.control) v.refresh(cx, true);
  else if (v.state === "ready" && tab.key(k, e, cx)) { /* the tab's */ }
  else if (k === "escape" || k === "q") v.closeWindow();
  else return;

  cx.stop_propagation();
  cx.notify();
}

/** L: the shown PR's (or card's) links as a list: j/k, enter opens one, esc closes. */
export function pickLink(v: GitHub): void {
  const tab = v.shown();
  const links: WebLink[] = tab instanceof Actions ? [] : tab.links();

  if (!links.length) {
    v.note = noteOf("No links in what's shown.", "working");

    return;
  }

  v.picker = { title: "LINKS", at: 0, rows: links.map((l) => ({ label: l.label, sub: l.label === l.url ? "" : l.url, go: (cx) => v.openUrl(l.url, cx) })) };
}

/** Keys while the picker is open: it keeps them all. */
export function pickerKey(v: GitHub, k: string, cx: Context): void {
  const p = v.picker;

  if (!p) return;

  const n = p.rows.length;

  const go = (i: number) => {
    const r = p.rows[i];

    v.picker = null;
    r?.go(cx);
  };

  if (k === "escape" || k === "q") v.picker = null;
  else if (k === "j" || k === "down" || k === "tab") p.at = Math.min(n - 1, p.at + 1);
  else if (k === "k" || k === "up") p.at = Math.max(0, p.at - 1);
  else if (k === "g" || k === "home") p.at = 0;
  else if (k === "G" || k === "end") p.at = n - 1;
  else if (k === "enter" || k === "o") go(p.at);
  else if (/^[1-9]$/.test(k) && Number(k) <= n) go(Number(k) - 1);
}

/** A command sent to the window (github.<name>, keys.json's or the palette's); focus is init's. */
export function runCommand(v: GitHub, c: string, cx: Context): void {
  if (c === "refresh") v.refresh(cx, true);
  else if (c === "keys") v.help = !v.help;
  else if (c === "fork") v.switchFork(cx);
  else if (isTabId(c)) v.setTab(c, cx);
  else if (c === "diff") {
    const p = v.prs.current();

    if (v.repo && p) v.openDiff(p.number);
  } else if (c === "new-pr") {
    v.wantForm = "pr";
    v.openForm(cx);
  } else if (c === "run-workflow") {
    v.wantForm = "workflow";
    v.openForm(cx);
  }
}
