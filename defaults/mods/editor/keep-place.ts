// Where a place in a file is after its text was replaced (a change on disk,
// file-io.ts): the line Developer was reading stays at the top, the caret and
// selection on the text they were on. Plain functions (no app calls), so
// scripts/editor-reload.test.ts can check them.
//
// A line before the first changed one keeps its number; one after the last
// changed one moves by the lines added or removed; one inside the changed
// stretch goes to the nearest line holding its text (and the two after it),
// looking a few lines further down when it's gone; else it keeps its number.

const LOOK_DOWN = 6; // lines below a vanished line tried as its stand-in
const WINDOW = 3; // lines that have to match together (a lone blank line matches anywhere)

/** Line `line` of `was` in `now`. */
export function lineAfter(was: readonly string[], now: readonly string[], line: number): number {
  const last = Math.max(0, now.length - 1);
  const at = Math.max(0, Math.floor(line));
  const min = Math.min(was.length, now.length);
  let pre = 0;

  while (pre < min && was[pre] === now[pre]) pre++;

  if (at < pre) return Math.min(at, last);

  let post = 0;

  while (post < min - pre && was[was.length - 1 - post] === now[now.length - 1 - post]) post++;

  if (at >= was.length - post) return Math.min(last, Math.max(0, at + now.length - was.length));

  // Inside the changed stretch: the nearest line where this one's text (and what follows) is now.
  for (let k = 0; k <= LOOK_DOWN && at + k < was.length - post; k++) {
    const found = nearest(was, now, at + k, at);

    if (found !== null) return Math.min(last, Math.max(0, found - k));
  }

  return Math.min(at, last);
}

/** The line of `now` nearest `near` where `was`'s lines from `from` (up to WINDOW of them) are. */
function nearest(was: readonly string[], now: readonly string[], from: number, near: number): number | null {
  const n = Math.min(WINDOW, was.length - from);

  if (n <= 0) return null;

  const fits = (j: number): boolean => {
    for (let i = 0; i < n; i++) if (now[j + i] !== was[from + i]) return false;

    return true;
  };

  for (let d = 0; d < now.length; d++) {
    if (near - d >= 0 && fits(near - d)) return near - d;

    if (d && near + d < now.length && fits(near + d)) return near + d;

    if (near - d < 0 && near + d >= now.length) break;
  }

  return null;
}

/** A place in a text: 0-based line and column. */
export interface Pos {
  readonly line: number;
  readonly col: number;
}

/** A place in `was` in `now`: its line moved, its column within that line. */
export function placeAfter(was: readonly string[], now: readonly string[], p: Pos): Pos {
  const line = lineAfter(was, now, p.line);

  return { line, col: Math.max(0, Math.min(p.col, now[line]?.length ?? 0)) };
}

/** A fractional top line (2.5: halfway down line 2) in `now`: its line moved, the fraction kept. */
export function topAfter(was: readonly string[], now: readonly string[], top: number): number {
  const whole = Math.max(0, Math.floor(top));

  return lineAfter(was, now, whole) + Math.max(0, top - whole);
}
