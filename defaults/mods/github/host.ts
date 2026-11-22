// What the GitHub window's tabs (prs.ts, actions.ts, projects.ts) and forms ask
// of the window (main.ts): types only, so a tab is typed against what it uses
// and main.ts implements it. Nothing runs here.

import type { Context, MouseButtonEvent } from "gpui-kit";
import type { Repo } from "./gh.ts";
import type { Ran } from "./gh-await.ts";
import type { Axis, Note } from "./kit.ts";
import type { Pt } from "@fireflies/menu-place";

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
  readonly near?: Pt | null;
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
  /** The time now (ms): the one clock the window's parts read. */
  now(): number;
  /** Work in the background: `fn` gets the task's own cx, good across its awaits (the one a
   *  handler was given is refused once that handler has returned). */
  spawn(cx: Context, fn: (cx: Context) => Promise<void>): void;
  openUrl(url: string, cx: Context): void;
  openDiff(number: number): void;
  showRun(runId: number, jobId: number | null, cx: Context): void;
  showRuns(filter: RunFilter, cx: Context): void;
  ask(text: string, go: (cx: Context) => void): void;
  act(promise: Promise<Ran>, ok: string, cx: Context, after?: () => void): void;
  kick(cx: Context): void;
  refresh(cx: Context, force?: boolean | ReadOptions): void;
  dragged(key: string): boolean;
  /** A press's place in the body (layout px), where a right-click's menu stands; null while the
   *  body hasn't said where it's drawn. */
  pressAt(e: { readonly position: Pt }): Pt | null;
  resize(e: MouseButtonEvent, key: string, axis: Axis, from: number, set: (px: number) => void, options?: ResizeOptions): void;
}
