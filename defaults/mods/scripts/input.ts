// The script runner's keys in its two modes that take keys of their own: a
// run's output shown (scrolling it, back, the grant hint) and the filter line
// typing. main.ts's onKey hands them over.

import type { Context, KeyEvent } from "gpui-kit";
import type { default as ScriptsDeck } from "./main.ts";
import type { Output } from "./state.ts";
import { scrollOutput, filtered, escapeKey } from "./actions.ts";
import { openGrant } from "./bars.ts";
import { isControl } from "./runs.ts";
import { quit } from "./place.ts";

/** A key on a run's output: j k pages, g G, o the grant, esc back, q closes,
 *  ? keys, / filters. True when the deck should redraw. */
export function outputKey(v: ScriptsDeck, o: Output, e: KeyEvent, cx: Context): boolean {
  const m = e.modifiers;
  const k = e.key.toLowerCase();
  const ch = e.key_char ?? "";

  const page = Math.max(1, (o.shown ?? 10) - 1);

  if (k === "down" || k === "j") scrollOutput(o, m.shift ? -page : -1);
  else if (k === "up" || k === "k") scrollOutput(o, m.shift ? page : 1);
  else if (k === "pagedown") scrollOutput(o, -page);
  else if (k === "pageup") scrollOutput(o, page);
  else if (k === "end" || (k === "g" && m.shift)) scrollOutput(o, -1e9);
  else if (k === "home" || k === "g") scrollOutput(o, 1e9);
  else if (k === "o" && o.grant) openGrant(o.r);
  else if (k === "escape" || k === "backspace" || k === "h" || k === "left") v.output = null;
  else if (k === "q") {
    cx.stop_propagation();
    quit(v);

    return false;
  }
  else if (ch === "?") v.help = true;
  else if (k === "/") { v.output = null; v.typing = true; }
  else return false;

  return true;
}

/** A key while the filter types: backspace (cmd: all of it), text, esc.
 *  True when the deck should redraw. */
export function typedKey(v: ScriptsDeck, e: KeyEvent, cx: Context): boolean {
  const m = e.modifiers;
  const k = e.key.toLowerCase();
  const ch = e.key_char ?? "";
  const cmd = m.platform || m.control;

  if (k === "backspace") {
    filtered(v, cmd || m.alt ? "" : [...v.query].slice(0, -1).join(""));

    return true;
  }

  if (!cmd && ch.length && ![...ch].some(isControl)) {
    filtered(v, v.query + ch);

    return true;
  }

  if (k === "escape") {
    cx.stop_propagation();
    escapeKey(v, cx);

    return false;
  }

  return false;
}
