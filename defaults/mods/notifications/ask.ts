// The question dialog's state: answering a block of questions the way Claude
// Code's AskUserQuestion does, then a review that submits them together.
//
//   up / down, k / j      move between the options (and the typed answer)
//   enter / space         pick (single-select: picks and goes on); in a
//                         multiSelect space toggles, enter toggles too
//   enter on "other"      types an answer: the dialog's input takes the keys;
//                         enter keeps it (and goes on), esc drops the edit
//   tab / shift-tab       the next / previous stop, wrapping, as in every
//                         form (form-keys.ts): the questions, then the
//                         review's "submit" and "back" rows; tab in the
//                         typed answer keeps it and goes on
//   review                every answer; enter on "submit" sends them all,
//                         a question without an answer is gone back to first
//   cmd-enter             submits from anywhere ("submit"), as the review does
//   esc                   closes without answering
//
// Pure: press() returns a new state and maybe an action for the dialog.


import type { Answer, Question } from "./claude.ts";

/** Where the dialog is: the question shown (questions.length: the review), each question's
 *  cursor, picked options and typed answer (and whether it counts), typing it, the review's row. */
export interface AskState {
  readonly q: number;
  readonly cursor: readonly number[];
  readonly picked: readonly (readonly number[])[];
  readonly other: readonly string[];
  readonly otherOn: readonly boolean[];
  readonly editing: boolean;
  readonly reviewCursor: number;
}

/** What a key asks of the dialog: close it, submit the answers, focus the typed answer's input. */
export type AskAction = "close" | "submit" | "edit" | null;

/** A key's outcome: the state after it, and what the dialog does. */
export interface Pressed {
  readonly state: AskState;
  readonly action: AskAction;
}

type Questions = readonly Question[];

/** A state being changed. */
interface Draft {
  q: number;
  cursor: number[];
  picked: number[][];
  other: string[];
  otherOn: boolean[];
  editing: boolean;
  reviewCursor: number;
}

/** A fresh state for these questions. */
export function start(questions: Questions): AskState {
  return {
    q: 0,
    cursor: questions.map(() => 0),
    picked: questions.map(() => []),
    other: questions.map(() => ""),
    otherOn: questions.map(() => false),
    editing: false,
    reviewCursor: 0,
  };
}

/** Rows of question i: its options, then "other". */
export const rows = (questions: Questions, i: number): number => (questions[i]?.options.length ?? 0) + 1;
export const isReview = (questions: Questions, s: AskState): boolean => s.q >= questions.length;
export const otherRow = (questions: Questions, i: number): number => questions[i]?.options.length ?? 0;

/** The answer for question i: { picked: [option index], other: text | null }. */
export function answerOf(questions: Questions, s: AskState, i: number): Answer {
  const typed = s.other[i]?.trim() ?? "";
  const other = s.otherOn[i] && typed ? typed : null;
  const picked = s.picked[i] ?? [];

  if (!questions[i]?.multiSelect) return other !== null ? { picked: [], other } : { picked: picked.slice(0, 1), other: null };

  return { picked: [...picked].sort((a, b) => a - b), other };
}

export const answered = (questions: Questions, s: AskState, i: number): boolean => {
  const a = answerOf(questions, s, i);

  return a.picked.length > 0 || a.other !== null;
};

export const answers = (questions: Questions, s: AskState): Answer[] => questions.map((_, i) => answerOf(questions, s, i));

/** The review's rows: submit, then back to the first question. */
export const REVIEW = ["submit", "back"] as const;

function clone(s: AskState): Draft {
  return { ...s, cursor: [...s.cursor], picked: s.picked.map((p) => [...p]), other: [...s.other], otherOn: [...s.otherOn] };
}

function go(questions: Questions, s: Draft, q: number) {
  s.q = Math.max(0, Math.min(questions.length, q));
  s.editing = false;

  if (s.q === questions.length) s.reviewCursor = 0;
}

/** Tab's stops: each question, then the review's rows; wrapping at both ends. */
function tab(questions: Questions, s: Draft, by: number) {
  const n = questions.length, stops = n + REVIEW.length;
  const at = isReview(questions, s) ? n + s.reviewCursor : s.q;
  const to = (((at + by) % stops) + stops) % stops;

  go(questions, s, Math.min(to, n));

  if (to >= n) s.reviewCursor = to - n;
}

/** Submitting: the first question without an answer, else the answers go. */
function submit(questions: Questions, s: Draft): Pressed {
  const missing = questions.findIndex((_, i) => !answered(questions, s, i));

  if (missing >= 0) {
    go(questions, s, missing);

    return { state: s, action: null };
  }

  return { state: s, action: "submit" };
}

/** press()'s options: shift held (shift-tab). */
export interface PressOptions {
  readonly shift?: boolean;
}

/**
 * One key. Keys are GPUI names ("up", "down", "j", "k", "enter", "space",
 * "tab", "escape") with `shift` for shift-tab, and "submit". Returns { state, action }:
 * action "close", "submit" (answers(questions, state) are ready), "edit"
 * (focus the typed-answer input), or null.
 */
export function press(questions: Questions, state: AskState, key: string, { shift = false }: PressOptions = {}): Pressed {
  const s = clone(state);

  if (key === "escape") {
    if (s.editing) {
      s.editing = false;

      return { state: s, action: null };
    }

    return { state: s, action: "close" };
  }

  if (s.editing) return { state: s, action: null }; // the input has the keys

  if (key === "tab") {
    tab(questions, s, shift ? -1 : 1);

    return { state: s, action: null };
  }

  if (key === "submit") return submit(questions, s);

  if (isReview(questions, s)) {
    if (key === "up" || key === "k") s.reviewCursor = Math.max(0, s.reviewCursor - 1);
    else if (key === "down" || key === "j") s.reviewCursor = Math.min(REVIEW.length - 1, s.reviewCursor + 1);
    else if (key === "enter" || key === "space") {
      if (REVIEW[s.reviewCursor] === "back") {
        go(questions, s, 0);

        return { state: s, action: null };
      }

      return submit(questions, s);
    }

    return { state: s, action: null };
  }

  const i = s.q;
  const q = questions[i];
  const r = rows(questions, i);
  const c = s.cursor[i] ?? 0;

  if (!q) return { state: s, action: null };

  if (key === "up" || key === "k") s.cursor[i] = (c - 1 + r) % r;
  else if (key === "down" || key === "j") s.cursor[i] = (c + 1) % r;
  else if (/^[1-9]$/.test(key) && Number(key) <= r) {
    s.cursor[i] = Number(key) - 1;

    return press(questions, s, "enter");
  } else if (key === "enter" || key === "space") {
    if (c === otherRow(questions, i)) {
      if (q.multiSelect && key === "space" && s.other[i]?.trim()) {
        s.otherOn[i] = !s.otherOn[i];

        return { state: s, action: null };
      }

      s.editing = true;

      return { state: s, action: "edit" };
    }

    if (q.multiSelect) {
      const p = s.picked[i] ?? [];

      s.picked[i] = p.includes(c) ? p.filter((x) => x !== c) : [...p, c];
    } else {
      s.picked[i] = [c];
      s.otherOn[i] = false;
      go(questions, s, i + 1);
    }
  }

  return { state: s, action: null };
}

/** The typed answer for the current question was entered (enter in the input):
 *  kept, and a single-select one goes on. */
export function setOther(questions: Questions, state: AskState, text: string): AskState {
  const s = keepDraft(questions, state, text);
  const i = s.q;

  if (i < questions.length && !questions[i]?.multiSelect && s.otherOn[i]) go(questions, s, i + 1);

  return s;
}

/** The typed answer kept where it is (tab leaving the input moves on by itself). */
export function keepOther(questions: Questions, state: AskState, text: string): AskState {
  return keepDraft(questions, state, text);
}

function keepDraft(questions: Questions, state: AskState, text: string): Draft {
  const s = clone(state);
  const i = s.q;

  if (i >= questions.length) return s;

  const typed = text.replace(/[\r\n]+/g, " ").trim();

  s.other[i] = typed;
  s.otherOn[i] = Boolean(typed);
  s.editing = false;

  if (!questions[i]?.multiSelect && s.otherOn[i]) s.picked[i] = [];

  return s;
}
