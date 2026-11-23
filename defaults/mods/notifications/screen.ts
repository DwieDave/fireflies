// Claude Code's dialogs as the screen draws them (claude.ts reads the hook
// record beside them): a permission's options, a question's (checked, the
// cursor, Other), the review before submitting, each from the terminal's
// text. Pure: tested with captured screens (scripts/fixtures/notifications).

import { Array as Arr, Option, String as Str } from "effect";

/** Whether a line has nothing but blanks. */
export const blankLine = (l: string): boolean => Str.isEmpty(Str.trim(l));

/** The terminal's text as lines, without trailing blanks. */
export function lines(screen: string): string[] {
  return Arr.map(Str.split(Str.replace(/\r/g, "")(screen), "\n"), Str.replace(/\s+$/, ""));
}

export const RULE = /^[─━]{8,}$/; // the full-width rule above Claude's input and dialogs
export const DASH = /^\s*[╌]{8,}$/; // the dashed rules around a command or a diff
export const OPTION = /^(\s*)(❯\s+)?(\s*)(\d+)\.\s(.*)$/;
export const norm = (s: string | null | undefined): string => Str.trim(Str.replace(/\s+/g, " ")(s ?? ""));

/** The index of the last line matching `re`, else -1. */
export function lastIndex(ls: readonly string[], re: RegExp, before = ls.length): number {
  for (let i = Math.min(before, ls.length) - 1; i >= 0; i--) if (re.test(ls[i] ?? "")) return i;

  return -1;
}

/** The index of the first line from `from` on matching `re`, else -1. */
const firstIndex = (ls: readonly string[], re: RegExp, from: number): number =>
  Option.getOrElse(Arr.findFirstIndex(ls, (l, i) => i > from && re.test(l)), () => -1);

/** Lines, the blank ones at the end dropped. */
export function trimEnd(ls: readonly string[]): string[] {
  const out = [...ls];

  while (out.length > 0 && blankLine(out.at(-1) ?? "")) out.pop();

  return out;
}

/** A numbered option of a dialog: its number and its words. */
export interface ScreenOption {
  readonly n: number;
  readonly label: string;
}

/** A permission dialog: the request's title, body and question, its options, the one under
 *  the cursor; amend: the note line is open on Yes or No (Tab), amendText: what is typed in it. */
export interface PermissionScreen {
  readonly kind: "permission";
  readonly title: string;
  readonly body: readonly string[];
  readonly question: string;
  readonly options: readonly ScreenOption[];
  readonly cursor: number;
  readonly amend: Amend | null;
  readonly amendText: string;
  readonly canAmend: boolean;
}

/** Which answer the note line is open on. */
export type Amend = "yes" | "no";

/** A row of a question: an option (checked: its box, null without one), Claude's "Chat about
 *  this", or Next / Submit. */
export type Row =
  | { readonly kind: "option" | "chat"; readonly n: number; readonly label: string; readonly desc: string; readonly checked: boolean | null }
  | { readonly kind: "next" };

/** A question of a block: the headers row (done ones ticked), whether it has Submit, the
 *  question, its rows and the one under the cursor. */
export interface QuestionScreen {
  readonly kind: "question";
  readonly headers: readonly { readonly header: string; readonly done: boolean }[] | null;
  readonly submit: boolean;
  readonly question: string;
  readonly rows: readonly Row[];
  readonly cursor: number;
}

/** Claude's review of a question block: each answer, its options, the one under the cursor. */
export interface ReviewScreen {
  readonly kind: "review";
  readonly answers: readonly { readonly question: string; readonly answer: string }[];
  readonly options: readonly ScreenOption[];
  readonly cursor: number;
}

/** The dialog at the bottom of a Claude Code screen. `cursor` is an index into options
 *  (permission, review) or rows (question). */
export type ScreenDialog = PermissionScreen | QuestionScreen | ReviewScreen;

const ESC = /Esc to cancel/;

/** The dialog at the bottom of a Claude Code screen, or null. */
export function parseScreen(screen: string | null): ScreenDialog | null {
  const ls = trimEnd(lines(screen ?? ""));

  // Claude's review of a question block: "Ready to submit your answers?" over
  // its options at the bottom (drawn with or without a key line under them).
  const ready = lastIndex(ls, /^\s*Ready to submit your answers\?\s*$/);

  if (ready >= 0 && ls.length - ready < 10 && Arr.every(Arr.drop(ls, ready + 1), (l) => blankLine(l) || OPTION.test(l) || ESC.test(l))) {
    const end = firstIndex(ls, ESC, ready);

    return parseReview(ls, end < 0 ? ls.length : end);
  }

  const foot = lastIndex(ls, ESC);

  if (foot < 0 || ls.length - foot > 4) return null;

  const footer = ls[foot] ?? "";

  if (/Enter to select/.test(footer)) return parseQuestion(ls, foot);

  return parsePermission(ls, foot, /Tab to amend/.test(footer));
}

/** An option as read off the screen, with whether the cursor is on it. */
export interface ReadOption {
  readonly n: number;
  label: string;
  readonly cursor: boolean;
}

/** A block of options and the line above it. */
export interface OptionsBlock {
  readonly options: readonly ReadOption[];
  readonly top: number;
}

/** Numbered options ending just above `end`; continuation lines (deeper indent) join their option. */
export function optionsAbove(ls: readonly string[], end: number): OptionsBlock {
  const out: ReadOption[] = [];
  let i = end - 1;

  while (i >= 0 && blankLine(ls[i] ?? "")) i--;

  const block: string[] = [];

  for (; i >= 0; i--) {
    const l = ls[i] ?? "";

    if (blankLine(l)) break;

    block.unshift(l);

    if (OPTION.test(l) && /^\s*(❯\s+)?1\.\s/.test(l)) break;
  }

  let start = -1;

  for (const l of block) {
    const m = Option.getOrNull(Str.match(OPTION)(l));
    const last = out.at(-1);

    if (m !== null) {
      out.push({ n: Number(m[4]), label: Str.trim(m[5] ?? ""), cursor: m[2] !== undefined });
      start = out.length;
    } else if (start > 0 && last !== undefined) last.label += ` ${Str.trim(l)}`;
  }

  return { options: out, top: i };
}

/** The index of the option under the cursor, -1 for none. */
const cursorOf = (options: readonly ReadOption[]): number => Option.getOrElse(Arr.findFirstIndex(options, (o) => o.cursor), () => -1);

/** The options as a dialog lists them (number and words). */
const plainOptions = (options: readonly ReadOption[]): ScreenOption[] => Arr.map(options, ({ n, label }) => ({ n, label }));

export function parsePermission(ls: readonly string[], foot: number, canAmend: boolean): PermissionScreen | null {
  const { options, top } = optionsAbove(ls, foot);

  if (options[0]?.n !== 1) return null;

  const cursor = cursorOf(options);
  const rule = lastIndex(ls, RULE, top + 1);

  if (rule < 0) return null;

  // Claude's own "Tip: …" line (auto mode) isn't part of the request.
  const head = Arr.filter(ls.slice(rule + 1, top), (l) => !blankLine(l) && !DASH.test(l) && !TIP.test(l));
  const question = norm(head.at(-1) ?? "");
  const { amend, amendText } = amendOf(options[cursor]?.label ?? "", cursor, canAmend);

  return {
    kind: "permission",
    title: norm(head[0] ?? ""),
    body: Arr.map(head.slice(1, -1), Str.trim),
    question,
    options: plainOptions(options),
    cursor,
    amend,
    amendText,
    canAmend,
  };
}

export const TIP = /^\s*Tip: /;

/** The note line: which answer it is open on, and what is typed in it. */
export interface AmendState {
  readonly amend: Amend | null;
  readonly amendText: string;
}

/** The note line under the cursor (Tab): empty, Claude shows its placeholder
 *  as the option ("Yes, and tell Claude what to do next"); with text typed,
 *  the option reads "Yes, <text>" / "No, <text>" (Claude Code 2.1.322), and
 *  the footer has no "Tab to amend" while it's open. */
export function amendOf(label: string, cursor: number, canAmend: boolean): AmendState {
  if (/^Yes, and tell Claude what to do next$/.test(label)) return { amend: "yes", amendText: "" };

  if (/^No, and tell Claude what to do differently$/.test(label)) return { amend: "no", amendText: "" };

  if (!canAmend && cursor === 0 && Str.startsWith("Yes, ")(label)) return { amend: "yes", amendText: Str.slice(5)(label) };

  if (!canAmend && cursor > 0 && Str.startsWith("No, ")(label) && !Str.endsWith("(esc)")(label)) return { amend: "no", amendText: Str.slice(4)(label) };

  return { amend: null, amendText: "" };
}

/** A question's option row while its description is read. */
export interface OptionRow {
  readonly kind: "option" | "chat";
  readonly n: number;
  readonly label: string;
  desc: string;
  readonly checked: boolean | null;
}

/** A header of a question block's headers row (☐ Color ☒ Pets ✔ Submit): its mark and words. */
const HEADER = /([☐☒✔])\s+(.+?)(?=\s+[☐☒✔]\s|$)/g;

/** An option's label and its box (null without one). */
function boxOf(text: string): { readonly label: string; readonly checked: boolean | null } {
  const label = Str.trim(text);

  return Option.match(Str.match(/^\[([ ✔])\]\s?(.*)$/)(label), {
    onNone: () => ({ label, checked: null }),
    onSome: (box) => ({ label: Str.trim(box[2] ?? ""), checked: box[1] === "✔" }),
  });
}

export function parseQuestion(ls: readonly string[], foot: number): QuestionScreen | null {
  // The block starts at the line of headers (☐ Color ☐ Pets ✔ Submit) after the last full rule.
  const h = lastIndex(ls, /^\s*(←\s+)?[☐☒]\s/, foot);

  if (h < 0 || foot - h > 60) return null;

  const headLine = Str.replace(/\s+→\s*$/, "")(Str.replace(/^\s*←\s+/, "")(ls[h] ?? ""));
  const parts = Arr.fromIterable(Str.matchAll(HEADER)(headLine));
  const submit = Arr.some(parts, (p) => p[1] === "✔");
  const headers = Arr.flatMap(parts, (p) => (p[1] === "✔" ? [] : [{ header: Str.trim(p[2] ?? ""), done: p[1] === "☒" }]));
  // The question: the lines after the headers up to the first option.
  let i = h + 1;
  const q: string[] = [];

  for (; i < foot; i++) {
    const l = ls[i] ?? "";

    if (OPTION.test(l)) break;

    if (!blankLine(l)) q.push(Str.trim(l));
  }

  const rows: (OptionRow | { readonly kind: "next" })[] = [];
  let cursor = -1;

  for (; i < foot; i++) {
    const l = ls[i] ?? "";

    if (blankLine(l) || RULE.test(l)) continue;

    const m = Option.getOrNull(Str.match(OPTION)(l));

    if (m !== null) {
      const { label, checked } = boxOf(m[5] ?? "");

      rows.push({ kind: /^Chat about this$/.test(label) ? "chat" : "option", n: Number(m[4]), label, desc: "", checked });

      if (m[2] !== undefined) cursor = rows.length - 1;

      continue;
    }

    const next = Option.getOrNull(Str.match(/^(❯)?\s+(Next|Submit)$/)(l));

    if (next !== null) {
      rows.push({ kind: "next" });

      if (next[1] !== undefined) cursor = rows.length - 1;

      continue;
    }

    const last = rows.at(-1);

    if (last?.kind === "option") last.desc = norm(`${last.desc} ${l}`);
  }

  if (rows.length === 0) return null;

  return { kind: "question", headers: headers.length > 0 ? headers : null, submit, question: norm(Arr.join(q, " ")), rows, cursor };
}

export function parseReview(ls: readonly string[], foot: number): ReviewScreen | null {
  const { options } = optionsAbove(ls, foot);
  const start = lastIndex(ls, /^\s*Review your answers\s*$/, foot);

  if (start < 0 || options.length === 0) return null;

  const answers: { question: string; answer: string }[] = [];

  for (let i = start + 1; i < foot; i++) {
    const l = ls[i] ?? "";
    const q = Option.getOrNull(Str.match(/^\s*●\s+(.*)$/)(l));

    if (q !== null) {
      answers.push({ question: norm(q[1]), answer: "" });

      continue;
    }

    const a = Option.getOrNull(Str.match(/^\s*→\s+(.*)$/)(l));
    const last = answers.at(-1);

    if (a !== null && last !== undefined) last.answer = norm(a[1]);
    else if (last !== undefined && Str.isEmpty(last.answer) && !blankLine(l) && !/Ready to submit/.test(l) && !OPTION.test(l)) last.question = norm(`${last.question} ${l}`);
  }

  return { kind: "review", answers, options: plainOptions(options), cursor: cursorOf(options) };
}
