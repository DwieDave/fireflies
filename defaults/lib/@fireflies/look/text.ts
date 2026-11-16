// How wide a line of the UI's text runs, for the few places that lay text out
// by arithmetic (a keys overview's columns, a label that must fit before a
// chip). Nocturne's Departure Mono is fixed-width (7 px a character at
// 11 px); a plain layout's Geist is proportional, so a count of characters
// times one width over- or undershoots it. Where flex layout can place the
// text, let it: these are estimates, not measurements (the engine gives mods
// none).
//
//   textWidth(text, size)   about how many px `text` runs at `size` px in the UI font

import { Array as Arr, String as Str } from "effect";
import { settings } from "herdr";

/** A fixed-width font: every character as wide (in em). */
const monoEm = (family: string): number | null => {
  if (family === "Departure Mono") return 7 / 11;

  return /\bmono\b/i.test(family) ? 0.6 : null;
};

/** A character's width in em in a proportional sans (Geist's proportions). */
function charEm(ch: string): number {
  if (/[iljI.,:;'|!]/.test(ch)) return 0.28;

  if (ch === " ") return 0.28;

  if (/[mwMW@]/.test(ch)) return 0.86;

  if (/[A-Z]/.test(ch)) return 0.66;

  if (/[0-9]/.test(ch)) return 0.58;

  return 0.53;
}

/** About how many px `text` runs at `size` px in the UI font (`family`: the
 *  layout's, by default). */
export function textWidth(text: string, size: number, family: string = settings().ui_font_family): number {
  const mono = monoEm(family);

  if (mono !== null) return Math.ceil(Str.length(text) * mono * size);

  return Math.ceil(Arr.reduce(Array.from(text), 0, (sum, ch) => sum + charEm(ch)) * size);
}
