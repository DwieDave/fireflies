// The question dialog's state: answering a block of questions the way Claude
// Code's AskUserQuestion does, then a review that submits them together.
//
//   up / down, k / j      move between the options (and the typed answer)
//   enter / space         pick (single-select: picks and goes on); in a
//                         multiSelect space toggles, enter toggles too
//   enter on "other"      types an answer: the dialog's input takes the keys;
//                         enter keeps it (and goes on), esc drops the edit
//   tab / shift-tab       the next / previous question; past the last one,
//                         the review
//   review                every answer; enter on "submit" sends them all,
//                         a question without an answer is gone back to first
//   esc                   closes without answering
//
// Pure: press() returns a new state and maybe an action for the dialog.

/** A fresh state for these questions. */
export function start(questions) {
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
export const rows = (questions, i) => questions[i].options.length + 1;
export const isReview = (questions, s) => s.q >= questions.length;
export const otherRow = (questions, i) => questions[i].options.length;

/** The answer for question i: { picked: [option index], other: text | null }. */
export function answerOf(questions, s, i) {
  const q = questions[i];
  const other = s.otherOn[i] && s.other[i].trim() ? s.other[i].trim() : null;
  if (!q.multiSelect) return other != null ? { picked: [], other } : { picked: s.picked[i].slice(0, 1), other: null };
  return { picked: [...s.picked[i]].sort((a, b) => a - b), other };
}

export const answered = (questions, s, i) => {
  const a = answerOf(questions, s, i);
  return a.picked.length > 0 || a.other != null;
};

export const answers = (questions, s) => questions.map((_, i) => answerOf(questions, s, i));

/** The review's rows: submit, then back to the first question. */
export const REVIEW = ["submit", "back"];

function clone(s) {
  return { ...s, cursor: [...s.cursor], picked: s.picked.map((p) => [...p]), other: [...s.other], otherOn: [...s.otherOn] };
}

function go(questions, s, q) {
  s.q = Math.max(0, Math.min(questions.length, q));
  s.editing = false;
  if (s.q === questions.length) s.reviewCursor = 0;
}

/**
 * One key. Keys are GPUI names ("up", "down", "j", "k", "enter", "space",
 * "tab", "escape") with `shift` for shift-tab. Returns { state, action }:
 * action "close", "submit" (answers(questions, state) are ready), "edit"
 * (focus the typed-answer input), or null.
 */
export function press(questions, state, key, { shift = false } = {}) {
  const s = clone(state);
  const n = questions.length;
  if (key === "escape") {
    if (s.editing) { s.editing = false; return { state: s, action: null }; }
    return { state: s, action: "close" };
  }
  if (s.editing) return { state: s, action: null }; // the input has the keys
  if (key === "tab") { go(questions, s, s.q + (shift ? -1 : 1)); return { state: s, action: null }; }

  if (isReview(questions, s)) {
    if (key === "up" || key === "k") s.reviewCursor = Math.max(0, s.reviewCursor - 1);
    else if (key === "down" || key === "j") s.reviewCursor = Math.min(REVIEW.length - 1, s.reviewCursor + 1);
    else if (key === "enter" || key === "space") {
      if (REVIEW[s.reviewCursor] === "back") { go(questions, s, 0); return { state: s, action: null }; }
      const missing = questions.findIndex((_, i) => !answered(questions, s, i));
      if (missing >= 0) { go(questions, s, missing); return { state: s, action: null }; }
      return { state: s, action: "submit" };
    }
    return { state: s, action: null };
  }

  const i = s.q;
  const q = questions[i];
  const r = rows(questions, i);
  if (key === "up" || key === "k") s.cursor[i] = (s.cursor[i] - 1 + r) % r;
  else if (key === "down" || key === "j") s.cursor[i] = (s.cursor[i] + 1) % r;
  else if (/^[1-9]$/.test(key) && Number(key) <= r) {
    s.cursor[i] = Number(key) - 1;
    return press(questions, s, "enter");
  } else if (key === "enter" || key === "space") {
    const c = s.cursor[i];
    if (c === otherRow(questions, i)) {
      if (q.multiSelect && key === "space" && s.other[i].trim()) { s.otherOn[i] = !s.otherOn[i]; return { state: s, action: null }; }
      s.editing = true;
      return { state: s, action: "edit" };
    }
    if (q.multiSelect) {
      const p = s.picked[i];
      s.picked[i] = p.includes(c) ? p.filter((x) => x !== c) : [...p, c];
    } else {
      s.picked[i] = [c];
      s.otherOn[i] = false;
      go(questions, s, i + 1);
    }
  }
  return { state: s, action: null };
}

/** The typed answer for the current question was entered (enter in the input). */
export function setOther(questions, state, text) {
  const s = clone(state);
  const i = s.q;
  if (i >= questions.length) return s;
  s.other[i] = String(text ?? "").replace(/[\r\n]+/g, " ").trim();
  s.otherOn[i] = Boolean(s.other[i]);
  s.editing = false;
  if (!questions[i].multiSelect && s.otherOn[i]) { s.picked[i] = []; go(questions, s, i + 1); }
  return s;
}
