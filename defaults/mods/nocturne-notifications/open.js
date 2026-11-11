// Opening the overview and the question dialog (centered Nocturne dialogs).

import { openOverlay, closeOverlay, shared, setShared } from "herdr";

const SHOWN = "nocturne-notifications.shown"; // { overview?: id, ask?: id }
export const OVERVIEW_W = 880;
export const OVERVIEW_H = 580;

function shown() { return { ...(shared(SHOWN) ?? {}) }; }
function remember(kind, id) { const s = shown(); if (id) s[kind] = id; else delete s[kind]; setShared(SHOWN, s); }

/** Opens the overview (on `terminal`'s request, if given), in place of one already open. */
export function openOverview(terminal = null) {
  const s = shown();
  if (s.overview) closeOverlay(s.overview);
  if (s.ask) closeOverlay(s.ask);
  const id = openOverlay({ mod: "nocturne-notifications", kind: "dialog", frame: "none", width: OVERVIEW_W, height: OVERVIEW_H, props: { role: "overview", terminal } });
  setShared(SHOWN, { overview: id });
}

/** The question dialog's height for a block: its tallest question, so nothing jumps. */
export function askHeight(questions) {
  const most = Math.max(2, ...questions.map((q) => q.options.length + 1));
  const descs = Math.max(0, ...questions.map((q) => q.options.filter((o) => o.description).length));
  const longest = Math.max(0, ...questions.map((q) => q.question.length));
  return Math.min(720, 34 + 34 + 20 + (longest > 52 ? 46 : 28) + 14 + most * 28 + descs * 15 + 18 + 30 + 32);
}

/** Opens the question dialog for a terminal's block of questions. */
export function openAsk(item) {
  const s = shown();
  if (s.overview) { closeOverlay(s.overview); remember("overview", null); }
  if (s.ask) closeOverlay(s.ask);
  const qs = item?.request?.questions ?? [];
  const id = openOverlay({ mod: "nocturne-notifications", kind: "dialog", frame: "none", width: 520, height: askHeight(qs), props: { role: "ask", terminal: item.address } });
  remember("ask", id);
}

/** An overlay of ours closed (its close()), so the next open doesn't try to close it. */
export function forget(kind, id) {
  if (shown()[kind] === id) remember(kind, null);
}

/** nocturne-notifications.<command> for the overview and the question dialog (keys.json, `herdr-app do`): the key it stands for. */
export const COMMAND_KEYS = {
  next: { key: "j" }, prev: { key: "k" }, up: { key: "up" }, down: { key: "down" },
  enter: { key: "enter" }, space: { key: "space" }, tab: { key: "tab" }, back: { key: "tab", shift: true },
  "yes-but": { key: "tab" }, "no-but": { key: "tab", shift: true },
  peek: { key: "p" }, goto: { key: "g" }, "put-away": { key: "x" }, close: { key: "escape" },
  ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => [String(n), { key: String(n) }])),
};

/** Feeds this copy's commands to its key handler, as if pressed; `focus`
 *  (overlay.focus, a window cycle key) to `onFocus`. */
export function followCommands(cx, nextCommand, handle, onFocus) {
  cx.spawn(async (cx) => {
    for (;;) {
      const c = String(await nextCommand()).replace(/^nocturne-notifications\./, "");
      if (c === "focus") { onFocus?.(); continue; }
      const k = COMMAND_KEYS[c];
      if (!k) continue;
      const shim = { stop_propagation() {}, notify: () => cx.notify(), spawn: (f) => cx.spawn(f) };
      handle({ key: k.key, modifiers: { shift: Boolean(k.shift), control: false, platform: false, alt: false } }, shim);
      cx.notify();
    }
  });
}
