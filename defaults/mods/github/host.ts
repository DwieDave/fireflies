// What the GitHub window's tabs (prs.ts, actions.ts, projects.ts) and forms ask
// of the window (main.ts): types only, so a tab is typed against what it uses
// and main.ts implements it. Nothing runs here.

import type { Effect } from "effect";
import type { Context, MouseButtonEvent } from "gpui-kit";
import type { RunOptions } from "@fireflies/kit";
import type { GhError, Repo } from "./gh.ts";
import type { GithubServices } from "./fx.ts";
import type { Axis, Note } from "./kit.ts";
import type { Anchor, Pt, Rect } from "@fireflies/menu-place";

/** A row of the window's picker (L's links, a right-click menu): its words, what it does. */
export interface PickRow {
  readonly label: string;
  readonly sub?: string;
  readonly go: (cx: Context) => void;
}

/** The window's picker: a title, its rows, the row with the keyboard (and the one scrolled to),
 *  and the press it stands at (a right-click's, in the body's layout px; none: the middle). */
export interface Picker {
  readonly title: string;
  readonly rows: readonly PickRow[];
  at: number;
  readonly near?: Anchor;
  shownAt?: number;
}

/** How a read goes: `all` past the timers, `fresh` past the ETags too. */
export interface ReadOptions {
  readonly all?: boolean;
  readonly fresh?: boolean;
}

/** The Actions tab's runs of one branch (a PR's head), and how the tab names it. */
export interface RunFilter {
  readonly branch: string;
  readonly label: string;
}

/** A splitter's drag: the bounds of the panel's size, and which way it grows. */
export interface ResizeOptions {
  readonly min?: number;
  readonly max?: number;
  readonly sign?: 1 | -1;
}

/** The window, as its tabs see it. */
export interface Host {
  readonly repo: Repo | null;
  readonly closed: boolean;
  note: Note | null;
  picker: Picker | null;

  /** When to read GitHub again (ms since the epoch). */
  next: number;
  focusSelf(): void;
  /** Runs `effect` for this copy (interrupted when it closes); a failure is shown as the window's note. */
  run<A, E>(effect: Effect.Effect<A, E, GithubServices>, options?: RunOptions): void;
  /** The time now (ms), one clock for the copy. */
  now(): number;
  openUrl(url: string, cx: Context): void;
  openDiff(number: number): void;
  showRun(runId: number, jobId: number | null): void;
  showRuns(filter: RunFilter): void;
  ask(text: string, go: () => void): void;
  /** Runs a gh action: says how it went (`ok`, or gh's words), then reads again soon. */
  act(effect: Effect.Effect<unknown, GhError, GithubServices>, ok: string, cx: Context, after?: () => void): void;
  /** Soon: a selection changed, its details want reading. */
  kick(): void;
  /** Reads the shown tab now (`force`: true, or { all, fresh }). */
  refresh(force?: boolean | ReadOptions): void;
  dragged(key: string): boolean;
  /** Keeps where a list or a card was drawn (window px), for a key's menu beside it. */
  keepBox(id: string, box: Rect): void;
  /** Where the list or card `id` was drawn, in the body's layout px (null: not drawn yet). */
  boxOf(id: string): Rect | null;
  /** A press's place in the body (layout px), where a right-click's menu stands; null while the
   *  body hasn't said where it's drawn. */
  pressAt(e: { readonly position: Pt }): Pt | null;
  resize(e: MouseButtonEvent, key: string, axis: Axis, from: number, set: (px: number) => void, options?: ResizeOptions): void;
}
