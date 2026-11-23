// The Claude Code adapter: what a Claude Code terminal is asking, exactly,
// and the keys that answer it the way a person would in that terminal.
//
// Two sources, checked against each other:
//   the hook record   bin/claude-hook, run by Claude Code's PermissionRequest
//                     hook, keeps the request as Claude sent it (the tool and
//                     its input; for AskUserQuestion every question of the
//                     block, its options and multiSelect) in a file per
//                     terminal. Optional: without it, permissions still come
//                     from the screen, questions fall back to the generic view.
//   the screen        the dialog as drawn now: its options, where the cursor
//                     is, what is checked. Every key is chosen from the screen
//                     just read, and nothing is sent unless the screen still
//                     shows the request that was answered.
//
// This file is the answering: one step at a time, each from the screen just
// read. screen.ts reads the dialogs, request.ts the hook record and what it
// asks. Pure: no herdr imports, so it is tested with captured screens and
// hook payloads (scripts/fixtures/notifications).

import { Array as Arr, Option, Order, String as Str } from "effect";
import type { PermissionRequest, HookRecord, QuestionRequest, Question } from "./request.ts";
import { recordOf, describe, sameRequest, questionMatches } from "./request.ts";
import { parseScreen, norm } from "./screen.ts";
import type { ReviewScreen } from "./screen.ts";

// ---- answering: one step at a time, each from the screen just read

/** An answer to a permission: the screen's option number; `amend` ("yes, but" / "no, but")
 *  only on the first option (Yes) or the "No" one. */
export interface PermissionGoal {
  readonly type: "permission";
  readonly request: PermissionRequest;
  readonly option: number;
  readonly amend?: string;
  readonly record?: HookRecord | null;
}

/** An answer to a question: the option indexes picked, the text typed (null: none). */
export interface Answer {
  readonly picked: readonly number[];
  readonly other: string | null;
}

/** The answers to a block of questions, one per question. */
export interface QuestionGoal {
  readonly type: "question";
  readonly request: QuestionRequest;
  readonly answers: readonly Answer[];
  readonly record?: HookRecord | null;
}

export type Goal = PermissionGoal | QuestionGoal;

/** The next thing to do: press keys (hc keys), paste text and press Enter (hc send --force),
 *  read the screen again (reason: what to say if it never comes), answered, or stop (the
 *  screen isn't what the answer was for). */
export type Step =
  | { readonly keys: readonly string[] }
  | { readonly paste: string }
  | { readonly wait: true; readonly reason?: string }
  | { readonly done: true }
  | { readonly refuse: string };

/** What the driver keeps between steps ({} at first). */
export interface StepState {
  sent?: boolean;
  waited?: number;
  entered?: boolean;
  tabbed?: boolean;
  started?: boolean;
  q?: number;
  // The questions whose typed answer was pasted.
  pasted?: Set<number>;
}

/**
 * The next thing to do for `goal` given the screen now. `state` is kept by
 * the driver between steps ({} at first).
 */
export function step(goal: Goal, screen: string, state: StepState): Step {
  if (goal.type === "permission") return permissionStep(goal.record === undefined ? { ...goal, record: recordOf(goal.request) } : goal, screen, state);

  return questionStep(goal, screen, state);
}

function move(from: number, to: number): string[] | null {
  if (from < 0) return null;

  if (from === to) return [];

  return Arr.replicate(to > from ? "down" : "up", Math.abs(to - from));
}

/** The index of the first item `f` holds for, -1 for none. */
const indexWhere = <A>(xs: readonly A[], f: (a: A) => boolean): number => Option.getOrElse(Arr.findFirstIndex(xs, f), () => -1);

function permissionStep(goal: PermissionGoal, screen: string, state: StepState): Step {
  const now = describe(screen, goal.record ?? null);
  const s = parseScreen(screen);

  if (state.sent === true) {
    // Answered: done once the screen no longer shows this request.
    if (now === null || !sameRequest(now, goal.request)) return { done: true };

    if (goal.amend !== undefined && s?.kind === "permission" && s.amend !== null) {
      // The note is in the line but its Enter didn't land: press it, once.
      if (norm(s.amendText) === norm(oneLine(goal.amend))) {
        state.waited = (state.waited ?? 0) + 1;

        if (state.waited >= 2 && state.entered !== true) {
          state.entered = true;

          return { keys: ["enter"] };
        }

        return { wait: true, reason: "The note is typed in the terminal but wasn't sent: press enter there." };
      }

      if (Str.isEmpty(s.amendText)) return { wait: true, reason: "The note didn't arrive in the terminal: nothing was sent." };
    }

    return { wait: true, reason: "Sent, but the request is still showing: look at the terminal." };
  }

  if (now === null || now.type !== "permission" || s?.kind !== "permission") return { refuse: "The request is gone: it was answered or withdrawn." };

  if (!sameRequest(now, goal.request)) return { refuse: "The request changed: look at it again." };

  const t = indexWhere(s.options, (o) => o.n === goal.option);
  const want = Option.getOrUndefined(Arr.findFirst(goal.request.options, (o) => o.n === goal.option));

  if (t < 0 || want === undefined || now.options[t]?.label !== want.label) return { refuse: "That option isn't there any more." };

  if (s.cursor !== t) {
    // An amend field open on another option: moving would carry its text, so stop.
    if (s.amend !== null) return { refuse: "Someone is typing in that request: answer it there." };

    return { keys: move(s.cursor, t) ?? [] };
  }

  if (goal.amend !== undefined) {
    const kind = want.kind === "no" ? "no" : t === 0 ? "yes" : null;

    if (kind === null) return { refuse: "Only Yes and No take a note." };

    if (s.amend !== kind) {
      if (s.amend !== null) return { refuse: "Someone is typing in that request: answer it there." };

      // Tab opens the note line and closes it again: pressed once, then
      // waited for (another change on the screen may draw first).
      if (state.tabbed === true) return { wait: true, reason: "The note line didn't open in the terminal: nothing was sent." };

      if (!s.canAmend) return { refuse: "This request doesn't take a note." };

      state.tabbed = true;

      return { keys: ["tab"] };
    }

    if (Str.isNonEmpty(s.amendText)) return { refuse: "Someone is typing in that request: answer it there." };

    state.sent = true;

    return { paste: oneLine(goal.amend) };
  }

  if (s.amend !== null) return { refuse: "Someone is typing in that request: answer it there." };

  state.sent = true;

  return { keys: ["enter"] };
}

/** A control character (below space, or delete): typed text leaves them out. */
const isControl = (c: string): boolean => Option.exists(Str.charCodeAt(c, 0), (n) => n < 0x20 || n === 0x7f);

export const oneLine = (s: string | null | undefined): string =>
  Str.trim(Arr.join(Arr.filter(Arr.fromIterable(Str.replace(/[\r\n\t]+/g, " ")(s ?? "")), (c) => !isControl(c)), ""));

/** How Claude's review shows an answer: picked labels in option order, then typed text. */
export function reviewText(q: Question, a: Answer): string {
  const words = Arr.map(Arr.sort(a.picked, Order.Number), (i) => q.options[i]?.label ?? "");

  return Arr.join(a.other === null || Str.isEmpty(a.other) ? words : Arr.append(words, oneLine(a.other)), ", ");
}

/** Types the answer once per question: text that didn't arrive isn't typed again. */
function pasteOnce(state: StepState, text: string): Step {
  const pasted = state.pasted ?? new Set<number>();
  const q = state.q ?? 0;

  state.pasted = pasted;

  if (pasted.has(q)) return { refuse: "The typed answer didn't arrive in the terminal: nothing was submitted." };

  pasted.add(q);

  return { paste: oneLine(text) };
}

const NO_ANSWER: Answer = { picked: [], other: null };

/** On Claude's review: back to a question not answered yet, else every
 *  answer checked as Claude will send it, then Submit. */
function reviewStep(goal: QuestionGoal, s: ReviewScreen, state: StepState, at: number): Step {
  const qs = goal.request.questions;

  if (at < qs.length) return { keys: ["shift+tab"] };

  // Every answer as Claude will send it, before submitting.
  for (const [i, q] of qs.entries()) {
    const want = reviewText(q, goal.answers[i] ?? NO_ANSWER);

    if (s.answers[i]?.answer !== norm(want)) return { refuse: `Claude's review shows “${s.answers[i]?.answer ?? ""}” for “${q.question}”, not “${want}”: nothing was submitted.` };
  }

  const t = indexWhere(s.options, (o) => /^Submit answers$/.test(o.label));

  if (t < 0) return { refuse: "No submit button on Claude's review." };

  if (s.cursor !== t) return { keys: move(s.cursor, t) ?? [] };

  state.sent = true;

  return { keys: ["enter"] };
}

function questionStep(goal: QuestionGoal, screen: string, state: StepState): Step {
  const qs = goal.request.questions;
  const s = parseScreen(screen);
  const ours = s !== null && s.kind !== "permission" && questionMatches(s, qs);

  if (state.sent === true) return ours ? { wait: true } : { done: true };

  if (!ours) return { refuse: state.started === true ? "The questions changed or went away while answering: nothing was submitted." : "The questions are gone: they were answered or withdrawn." };

  state.started = true;

  const at = state.q ?? 0;

  state.q = at;

  const single = qs.length === 1;

  if (s.kind === "review") return reviewStep(goal, s, state, at);

  const qi = indexWhere(qs, (q) => norm(q.question) === s.question);

  // All answered and still on a question: on to the review.
  if (at >= qs.length) return single ? { refuse: "The question is still open after answering." } : { keys: ["tab"] };

  if (qi !== at) return { keys: [qi < at ? "tab" : "shift+tab"] };

  const q = qs[qi];
  const a = goal.answers[qi] ?? NO_ANSWER;

  if (q === undefined) return { refuse: "The options on screen aren't the question's." };

  const n = q.options.length;
  const opts = Arr.flatMap(s.rows, (r) => (r.kind === "option" ? [r] : []));
  const other = opts[n];

  if (other === undefined) return { refuse: "The options on screen aren't the question's." };

  for (let i = 0; i < n; i++) if (norm(opts[i]?.label) !== norm(q.options[i]?.label)) return { refuse: "The options on screen aren't the question's." };

  const otherRow = s.rows.indexOf(other);
  const otherText = /^Type something\.?$/.test(other.label) ? "" : other.label;
  const last = at === qs.length - 1;

  const advance = () => {
    state.q = at + 1;

    if (single || (last && !s.submit)) state.sent = true;
  };

  if (!q.multiSelect) {
    if (a.other !== null && Str.isNonEmpty(a.other)) {
      if (s.cursor !== otherRow) return { keys: move(s.cursor, otherRow) ?? [] };

      if (Str.isNonEmpty(otherText) && otherText !== oneLine(a.other)) return { refuse: "There's other text typed in that answer already: answer it in the terminal." };

      if (Str.isNonEmpty(otherText)) {
        advance();

        return { keys: ["enter"] };
      }

      const p = pasteOnce(state, a.other);

      if ("paste" in p) advance();

      return p;
    }

    const picked = opts[a.picked[0] ?? -1];
    const t = picked === undefined ? -1 : s.rows.indexOf(picked);

    if (s.cursor !== t) return { keys: move(s.cursor, t) ?? [] };

    advance();

    return { keys: ["enter"] };
  }

  // multiSelect: every box as wanted, one at a time, then Next.
  for (let i = 0; i < n; i++) {
    const want = Arr.contains(a.picked, i);
    const box = opts[i];

    if (box !== undefined && box.checked !== want) {
      const t = s.rows.indexOf(box);

      if (s.cursor !== t) return { keys: move(s.cursor, t) ?? [] };

      return { keys: ["space"] };
    }
  }

  const typed = a.other ?? "";
  const wantOther = Str.isNonEmpty(typed);

  if (wantOther && otherText !== oneLine(typed)) {
    if (Str.isNonEmpty(otherText)) return { refuse: "There's other text typed in that answer already: answer it in the terminal." };

    if (s.cursor !== otherRow) return { keys: move(s.cursor, otherRow) ?? [] };

    return pasteOnce(state, typed);
  }

  if (other.checked !== wantOther) {
    if (s.cursor !== otherRow) return { keys: move(s.cursor, otherRow) ?? [] };

    // Enter toggles the typed answer (space would type a space into it).
    return { keys: ["enter"] };
  }

  const next = indexWhere(s.rows, (r) => r.kind === "next");

  if (next < 0) return { refuse: "No Next on screen." };

  if (s.cursor !== next) return { keys: move(s.cursor, next) ?? [] };

  advance();

  return { keys: ["enter"] };
}
