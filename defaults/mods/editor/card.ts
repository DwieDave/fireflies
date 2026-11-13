// The editor pane's hover card (main.ts; card-view.ts draws it): what the
// pointer or the keyboard asks about, asking the server, what the card
// shows and how it closes, its keys and links.

import type EditorPane from "./main.ts";
import { cardLinks, linkTarget } from "./cardlinks.ts";
import type { ServerNote } from "./logic.ts";
import { appBindings, chordOf, serverNote, tilde } from "./logic.ts";
import { busy, diagnosticsAt, hoverParts, isHover, progressWord } from "./lsp-replies.ts";
import type { EditorHoverEvent } from "gpui-base";
import type { AsyncContext, Context, KeyEvent } from "gpui-kit";
import { home, keys, panes, run } from "herdr";
import type { Card, HoverAnswer } from "./pane-kit.ts";
import { errorText, MOD, paneProps, PREVIEWED, serverId, serverName } from "./pane-kit.ts";
import { openLooked } from "./drawn-tabs.ts";
import { logStep } from "./lsp-client.ts";
import { ownPane } from "./pane-tabs.ts";

// A server that reported work within this long (ms) is still loading the
// workspace: rust-analyzer goes quiet for a moment between its phases, and
// an empty answer then means "not yet", not "nothing here".
export const SETTLE = 2000;

export function onHover(ed: EditorPane, e: EditorHoverEvent, cx: Context): void {
  if (!e.hovering) {
    // Leaving the word: the card goes unless the pointer went onto it.
    cx.timer.after(250, (cx) => {
      if (!ed.overCard && ed.card && !ed.card.keyboard) {
        ed.card = null;
        cx.notify();
      }
    });

    return;
  }

  // A card asked for with the keyboard stays until it's closed.
  if (ed.card?.keyboard) return;

  if (e.line === undefined || e.col === undefined) return;

  showCard(ed, e.line, e.col, false, cx);
}

/** The card for a place: its problems at once, the server's hover when it
 *  answers. `keyboard`: asked for (cmd-i, K, a problem gone to); the
 *  pointer's card says nothing when there's nothing to say. */
export function showCard(ed: EditorPane, line: number, col: number, keyboard: boolean, cx: Context, level = 0): void {
  const here = diagnosticsAt(ed.problems, line, col);

  const card: Card = {
    line,
    col,
    keyboard,
    problems: here,
    parts: [],
    level,
    more: false,
    pending: true,
    note: null,
    scroll: 0,
    opened: Date.now(),
    asked: null,
    inflight: 0,
    reasked: false,
    waitingOn: false,
    links: [],
    link: null,
    contentH: null,
    viewH: null,
    drawn: false,
  };

  ed.card = card;
  watchFocus(ed, card, cx);
  cardState(ed, cx);
  cx.notify();
}

/** The card's question, as the server stands: answered from what's known,
 *  asked, or waiting (with what it waits for) until the server can answer;
 *  called again when it can (started, done indexing, stopped). */
export function cardState(ed: EditorPane, cx: Context): void {
  const card = ed.card;

  if (!card?.pending) return;

  const s = ed.server;
  const key = `${card.line}:${card.col}:${card.level}`;
  const known = ed.hovers.get(key);

  if (known) return answered(ed, card, known, cx);

  if (serverId(s) === null) {
    // No server to ask yet: starting, loading the environment (the card
    // waits, saying so), or none (the note says why and what to do).
    const coming = !s || s.status === "starting" || s.status === "env";

    card.note = card.keyboard && !coming ? serverNoteOf(ed) : null;

    if (!coming) card.pending = false;

    if (!coming && !card.keyboard && !card.problems.length) ed.card = null;

    return;
  }

  card.note = null;
  card.asked ??= Date.now();
  ask(ed, card, cx);
}

/** Asks the server about a card's place. The answer comes in a task of its
 *  own: an editor event's cx (vim's K, the pointer's hover, a click) is
 *  bound to that call and refuses notify and timers once it has returned,
 *  which left cards at "Asking…" with their answer already in hand. Any
 *  answer for the place fills the card open there, whichever ask brought
 *  it; when the last ask ends without one, the card asks again (the
 *  workspace still loading; a cancel, once) or says why: it never sits
 *  asking with nothing out. */
export function ask(ed: EditorPane, card: Card, cx: Context): void {
  const key = `${card.line}:${card.col}:${card.level}`;
  const verbosity = ed.lang === "typescript" || ed.lang === "tsx" || ed.lang === "javascript" ? { verbosityLevel: card.level } : {};

  card.inflight += 1;
  cx.spawn(async (cx) => {
    let hover = null;
    let error: string | null = null;

    try {
      hover = await ed.request("textDocument/hover", isHover, verbosity, card.line, card.col, "hover");
    } catch (cause) {
      error = errorText(cause);
    }

    card.inflight -= 1;

    const answer: HoverAnswer | null = error === null ? { parts: hoverParts(hover?.contents), more: hover?.canIncreaseVerbosityLevel === true } : null;

    // Something to say: kept for the place, and into the card open there.
    if (answer?.parts.length) {
      ed.hovers.set(key, answer);

      const open = ed.card;

      if (open?.pending && `${open.line}:${open.col}:${open.level}` === key) answered(ed, open, answer, cx);

      return;
    }

    if (ed.card !== card || !card.pending || card.inflight > 0) return; // gone, filled, or a newer ask decides

    // Nothing yet while the workspace loads ("content modified", or null): ask again.
    if (settling(ed)) return askAgain(ed, card, cx);

    if (error !== null && /cancelled/.test(error)) {
      if (!card.reasked) {
        card.reasked = true;

        return ask(ed, card, cx);
      }

      error = "the question was cancelled twice";
    }

    if (answer) {
      ed.hovers.set(key, answer);

      return answered(ed, card, answer, cx);
    }

    card.pending = false;

    if (card.keyboard && !card.problems.length) card.note = { text: `${serverName(ed.server) ?? "The language server"} didn't answer${error ? `: ${error}` : "."}`, fix: null };
    else if (!card.problems.length) ed.card = null;

    cx.notify();
  });
}

/** The server is still loading the workspace: work under way, or some
 *  reported a moment ago (it pauses between phases). */
export function settling(ed: EditorPane): boolean {
  return busy(ed.progress) || Date.now() - ed.lastWork < SETTLE;
}

/** A waiting card asks again: when the work ends (progressed), and once a
 *  second meanwhile, since a server can answer before it's all done. */
export function askAgain(ed: EditorPane, card: Card, cx: Context): void {
  card.waitingOn = true;
  cx.notify();
  cx.timer.after(1000, (cx) => {
    if (ed.card === card && card.pending) cardState(ed, cx);
  });
}

export function answered(ed: EditorPane, card: Card, answer: HoverAnswer, cx: Context): void {
  if (card.keyboard && card.pending) logStep(ed, `hover answered ${Date.now() - card.opened}ms after it was asked`);

  card.pending = false;
  card.waitingOn = false;
  card.parts = answer.parts.map((p) => ({ ...p }));
  card.more = answer.more;
  // Its links (the docs' web pages, files): tab walks them, enter follows (cardKey).
  card.links = cardLinks(card.parts);
  card.link = null;

  // Nothing here: asked for, the card says so; passing over, it goes.
  if (!card.parts.length && !card.problems.length) {
    if (card.keyboard) card.note = serverNoteOf(ed, true);
    else if (ed.card === card) ed.card = null;
  }

  cx.notify();
}

/** What a waiting card says: what the answer waits for. */
export function waitWords(ed: EditorPane): string {
  const s = ed.server;
  const name = serverName(s) ?? "the language server";

  if (!s || s.status === "env") return s?.envrc ? `Loading this project's environment (${tilde(s.envrc, home())}/.envrc)…` : "Finding the language server…";

  if (s.status === "starting") return `Starting ${name}…`;

  const work = busy(ed.progress) ? progressWord(ed.progress) : null;

  if (work) return `${name}: ${work}${work.endsWith("…") ? "" : "."} The answer comes when it's done.`;

  if (settling(ed)) return `${name} is loading the workspace. The answer comes when it's done.`;

  return `Asking ${name}…`;
}

/** While the card is open: the editor going from having the keyboard to
 *  not having it (the find line, another pane) closes it. A pointer's card
 *  over an editor that never had the keyboard stays. */
export function watchFocus(ed: EditorPane, card: Card, cx: Context): void {
  const had = ed.editor.focused();

  const check = (cx: Context): void => {
    if (ed.card !== card) return;

    const has = ed.editor.focused();

    if (had && !has) return closeCard(ed, cx);

    cx.timer.after(200, check);
  };

  cx.timer.after(200, check);
}

export function closeCard(ed: EditorPane, cx: Context | null): void {
  if (!ed.card) return;

  ed.card = null;
  ed.overCard = false;
  cx?.notify();
}

/** Why the hover has nothing (logic.ts serverNote), the paths as ~. */
export function serverNoteOf(ed: EditorPane, empty = false): ServerNote | null {
  return serverNote(ed.server, ed.lang, { empty, tilde: (p) => tilde(p, home()) });
}

/** TypeScript's expandable hover: one level more (1) or less (-1). */
export function hoverLevel(ed: EditorPane, d: number, cx: Context): void {
  const c = ed.card;

  if (!c) return;

  const level = Math.max(0, c.level + d);

  if (level === c.level || (d > 0 && !c.more)) return;

  showCard(ed, c.line, c.col, c.keyboard, cx, level);
}

/** A key while the card is open, before vim and the editor: esc closes it
 *  (and does nothing else), ctrl-d / ctrl-u and page down / up scroll a long
 *  one. True when taken. Other keys go on; when one moves the caret or the
 *  text, the card goes (checked once the editor has had the key). */
export function cardKeyDown(ed: EditorPane, e: KeyEvent, cx: Context): boolean {
  const c = ed.card;

  if (!c) return false;

  const k = e.key;
  const m = e.modifiers;

  if (["shift", "control", "alt", "platform", "function", "capslock"].includes(k)) return false;

  const plain = !m.platform && !m.control && !m.alt;

  if (k === "escape" && plain && !m.shift) {
    closeCard(ed, cx);

    return true;
  }

  // A card asked for with the keyboard: tab / shift-tab ring its links, enter follows the ringed one.
  const links = c.links;

  if (c.keyboard && links.length && k === "tab" && !m.platform && !m.control && !m.alt) {
    const n = links.length;

    c.link = c.link === null ? (m.shift ? n - 1 : 0) : (c.link + (m.shift ? n - 1 : 1)) % n;
    cx.notify();

    return true;
  }

  const ringed = c.link === null ? undefined : links[c.link];

  if (ringed && k === "enter" && plain && !m.shift) {
    followLink(ed, ringed.url, cx);

    return true;
  }

  const page = Math.max(40, Math.round((c.viewH ?? 200) * 0.6));
  const scroll = m.control && !m.platform && !m.alt && (k === "d" || k === "u") ? (k === "d" ? page : -page) : plain && (k === "pagedown" || k === "pageup") ? (k === "pagedown" ? page : -page) : 0;

  if (scroll && cardOverflows(ed)) {
    c.scroll = Math.max(0, Math.min((c.contentH ?? 0) - (c.viewH ?? 0), c.scroll + scroll));
    cx.notify();

    return true;
  }

  // App keys (cmd-…) are commands: cmd-i closes it, gd / cmd-k d go.
  if (m.platform) return false;

  // (Typing closes it through the change it makes.)
  const was = ed.editor.cursor();

  cx.timer.after(0, (cx) => {
    if (ed.card !== c) return;

    const now = ed.editor.cursor();

    if (now.line !== was.line || now.col !== was.col) closeCard(ed, cx);
  });

  return false;
}

/** The app's keys win over the code editor's own keymap: a chord keys.json
 *  binds for the window (global, Nocturne's) and this editor's section
 *  doesn't is run as the app's command here and taken, so the editor does
 *  nothing with it. The editor's keymap binds cmd-alt-up / down (a caret
 *  above / below), cmd-] / cmd-[ (indent) and cmd-shift-f (replace), which
 *  ate pane.go, agent.next / prev and grep. keys.json is read again after a
 *  few seconds, so an edit there counts. */
export function appKey(ed: EditorPane, e: KeyEvent): boolean {
  const now = Date.now();
  let known = ed.appKeys;

  if (!known || now - known.at > 3000) {
    let list: ReturnType<typeof keys> = [];

    try {
      list = keys();
    } catch {
      /* no keys: none taken */
    }

    known = { at: now, map: appBindings(list, MOD, "nocturne") };
    ed.appKeys = known;
  }

  const bound = known.map.get(chordOf(e.keystroke));

  if (!bound) return false;

  if (bound.args === undefined) run(bound.command);
  else run(bound.command, bound.args);

  return true;
}

/** A link from the hover card: a web page in the shown tab's browser pane
 *  (a new one beside this editor when there's none), a file as a tab of
 *  this editor at its line (a picture, a PDF: the preview beside), mailto:
 *  and the like through the system. */
export function followLink(ed: EditorPane, url: string, cx: Context): void {
  const to = linkTarget(url, ed.path);

  if (!to) return;

  closeCard(ed, cx);

  if (to.kind !== "file") {
    if (to.kind === "web") openWeb(ed, to.url);
    else run("app.open_url", { url: to.url, in: "system" });
  } else if (PREVIEWED.test(to.path)) openLooked(ed, to.path, cx);
  else ed.openFile(to.path, cx, { line: to.line, col: to.col });

  cx.notify();
}

/** A web page in a browser pane: the one in this editor's tab (browser's
 *  `open` command, by its slot: a new tab there, in front, with the keyboard),
 *  else a new browser pane beside this editor (app.open_url in the app). */
export function openWeb(ed: EditorPane, url: string): void {
  const me = ownPane(ed);
  const browser = me ? panes().find((p) => p.mod === "browser" && p.tab === me.tab && !p.parked && paneProps(p).slot) : undefined;
  const slot = browser ? paneProps(browser).slot : undefined;

  if (slot) {
    run(`browser.open:${JSON.stringify({ url, slot })}`);

    return;
  }

  run("app.open_url", { url, in: "app" });
}

/** Whether a card is drawn: the keyboard's always, the pointer's once it has something. */
export function cardShown(ed: EditorPane, c: Card): boolean {
  return c.keyboard || c.problems.length > 0 || c.parts.length > 0;
}

/** Runs `work` in a task: its cx lasts past an await, where an editor
 *  event's (a key, a click) refuses notify and timers once that call has
 *  returned. Resolves with what `work` returns. */
export function later<T>(ed: EditorPane, cx: Context, work: (cx: AsyncContext) => Promise<T> | T): Promise<T> {
  return new Promise((resolve, reject) =>
    cx.spawn(async (cx) => {
      try {
        resolve(await work(cx));
      } catch (cause) {
        reject(cause instanceof Error ? cause : new Error(String(cause)));
      }
    }),
  );
}

export function cardOverflows(ed: EditorPane): boolean {
  const c = ed.card;

  return Boolean(c) && (c?.contentH ?? 0) > (c?.viewH ?? 0) + 1;
}
