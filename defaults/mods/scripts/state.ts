// The script runner's state: its props and shared records (the open deck,
// the prompts, recent runs, found scripts, nix flakes), its sizes, and the
// shapes it holds (a question, a run's output, a chip, the password bar).

import type { Color } from "gpui-kit";
import { home, props } from "herdr";
import type { Guarded } from "./guard.ts";
import { arrayOf, isBoolean, isNumber, isString, literal, nullable, object, oneOf, sharedKey, sharedMapKey } from "./guard.ts";
import { isRecord } from "./guards.ts";
import type { Row, Script } from "./detect.ts";
import { isScript } from "./detect.ts";
import type { Run } from "./runs.ts";

export const ART = "mods/nocturne/art";

/** What the deck is opened with: by the tab strip ({ folder, on, focus,
 *  show?, again? }, ../nocturne/scripts.ts toggleDeck), or as the bar of a
 *  switch's password window ({ password: address, name }, ../nocturne/prompt.ts). */
export const isDeckProps = object({}, {
  overlay: isString,
  slot: isString,
  folder: nullable(isString),
  on: nullable(isString),
  focus: isString,
  show: isString,
  again: isBoolean,
  password: isString,
  name: isString,
});

export type DeckProps = Guarded<typeof isDeckProps>;

export const NO_PROPS: DeckProps = {};

export const deckProps = (): DeckProps => {
  const p = props();

  return isDeckProps(p) ? p : NO_PROPS;
};

// The tab strip's note that the deck is open (../nocturne/scripts.ts DECK).
export const DECK = sharedKey("scripts.deck", nullable(object({ id: isString, beat: isNumber })));

// The switch password windows ../nocturne/prompt.ts opens, by run: this copy
// is the bar of one when props has { password: address, name }. Each is
// { id } (the window, null while it opens) or { closed: true } (cancelled here).
export const PROMPTS = sharedMapKey("scripts.prompts", oneOf(object({ id: nullable(isString) }), object({ closed: literal(true) })));

// The deck's key context and its esc (init).
export const CONTEXT = "NocturneScriptsDeck";
export const ESCAPE = "nocturne_scripts_escape";

// The last scripts run per folder, newest first: { "<machine>:<folder>": [id] }.
export const RECENT = sharedMapKey("scripts.recent", arrayOf(isString));

// What each folder had last time, shown at once while it's looked at again.
export const FOUND = sharedMapKey("scripts.found", arrayOf(isScript));

// Each flake's last `nix flake show --json`: { "<machine>:<folder>": { at, show } }.
export const FLAKE = sharedMapKey("scripts.flake", object({ show: isRecord }, { at: isNumber }));

// A flake evaluated this recently isn't evaluated again on the next open.
export const FLAKE_FRESH = 30000;

export const H = 470;
export const HEAD = 36, SECTION = 24, ROW = 26, INPUT = 32, FOOT = 26, RUNS_SHOWN = 5;

// A run's chips (runChips): their height, the most room they take (asking
// "again?" the widest), and how long a "stop?" / "again?" waits for the
// second press (ms).
export const CHIP = 20, CHIPS_W = 140, ASK_MS = 3000;

export const ICON = (n: string) => `mods/workspace-chrome/${n}.svg`;
export const OWN = (n: string) => `mods/scripts/${n}.svg`;

/** The keys entry where ? types (the filter): cmd-k then ?, as in the editor. */
export const CHORD = "cmd-k ?";

export function short(folder: string | null) {
  if (!folder) return "";

  const h = home();

  return folder === h ? "~" : folder.startsWith(h + "/") ? "~" + folder.slice(h.length) : folder;
}

/** What a script row says beside its name: what it runs (package.json's
 *  line, a recipe's parameters), else its command when that says more than
 *  "<runner> <name>". */
export function aside(s: Script) {
  if (s.hint) return s.hint;

  const plain = [`${s.runner} ${s.name}`, `${s.runner} run ${s.name}`, `${s.runner} task ${s.name}`];

  return plain.includes(s.cmd) ? "" : s.cmd;
}

/** `line` without its terminal escapes (ESC [ … a letter). */
export function plain(line: string) {
  let out = "";

  for (let i = 0; i < line.length; i++) {
    if (line[i] === "\u001b" && line[i + 1] === "[") {
      let j = i + 2;

      while (/[0-9;?]/.test(line[j] ?? "")) j++;

      if (/[A-Za-z]/.test(line[j] ?? "")) { i = j; continue; }
    }

    out += line[i] ?? "";
  }

  return out;
}


/** What a run's chips and keys do. */
export type Act = "watch" | "stop" | "dismiss" | "again";

/** The presses that ask first on a running one (ASK_MS). */
export type Asked = "stop" | "again";

/** A press asked for: the same one again on the same run before `until` does it. */
export interface Asking {
  readonly what: Asked;
  readonly address: string;
  readonly until: number;
}

/** An ended run's output, shown in place of the scripts. */
export interface Output {
  readonly r: Run;
  /** Its last lines; null while they're read. */
  lines: string[] | null;
  /** Lines scrolled back from the end. */
  back: number;
  /** It failed for want of App Management (nix.ts APP_MANAGEMENT). */
  grant: boolean;
  /** Lines that fit (outputView); null before its first draw. */
  shown: number | null;
  /** The cursor was put on its run. */
  placed: boolean;
}

/** One row the cursor moves over: a run, then the scripts. */
export type Item = { readonly kind: "run"; readonly r: Run } | { readonly kind: "script"; readonly row: Row };

/** A run's control (chip). */
export interface Chip {
  readonly mark: string;
  readonly key: string;
  readonly tip: string;
  readonly color?: Color | null;
  readonly asking?: boolean;
  readonly ask?: string;
}

/** The bar of a switch's password window: its run and its name. */
export interface PasswordBar {
  readonly address: string;
  readonly name: string;
}

/** Where a script row and its group's head sit in the list. */
export interface Top {
  readonly head: boolean;
  readonly title: number;
  readonly row: number;
}
