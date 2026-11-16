// Text helpers Effect's String module leaves out.

import { Array as Arr, String as Str } from "effect";

/**
 * `s` with each match of `pattern` replaced by `replace(match)`: what
 * `String.replace` does with a function, which Effect's `Str.replace` (a
 * string replacement only) doesn't take. A global pattern replaces every
 * match, another the first, as `String.replace` does.
 */
export const replaceWith = (pattern: RegExp, replace: (match: RegExpMatchArray) => string) => (s: string): string => {
  const all = pattern.global ? Arr.fromIterable(Str.matchAll(pattern)(s)) : Arr.fromNullishOr(pattern.exec(s));
  let out = "";
  let at = 0;

  for (const m of all) {
    const start = m.index ?? 0;

    out += Str.slice(at, start)(s) + replace(m);
    at = start + m[0].length;
  }

  return out + Str.slice(at)(s);
};
