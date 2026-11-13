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
// Pure: no herdr imports, so it is tested with captured screens and hook
// payloads (scripts/fixtures/notifications).

import type { Guarded } from "./guard.ts";
import { arrayOf, isBoolean, isNumber, isString, literal, nullable, object, oneOf } from "./guard.ts";

/** The terminal's text as lines, without trailing blanks. */
function lines(screen: string): string[] {
  return screen.replace(/\r/g, "").split("\n").map((l) => l.replace(/\s+$/, ""));
}

const RULE = /^[─━]{8,}$/; // the full-width rule above Claude's input and dialogs
const DASH = /^\s*[╌]{8,}$/; // the dashed rules around a command or a diff
const OPTION = /^(\s*)(❯\s+)?(\s*)(\d+)\.\s(.*)$/;
const norm = (s: string | null | undefined): string => (s ?? "").replace(/\s+/g, " ").trim();

/** The index of the last line matching `re`, else -1. */
function lastIndex(ls: readonly string[], re: RegExp, before = ls.length): number {
  for (let i = Math.min(before, ls.length) - 1; i >= 0; i--) if (re.test(ls[i] ?? "")) return i;

  return -1;
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

/** The dialog at the bottom of a Claude Code screen, or null. */
export function parseScreen(screen: string | null): ScreenDialog | null {
  const ls = lines(screen ?? "");

  while (ls.length && !ls.at(-1)?.trim()) ls.pop();

  // Claude's review of a question block: "Ready to submit your answers?" over
  // its options at the bottom (drawn with or without a key line under them).
  const ready = lastIndex(ls, /^\s*Ready to submit your answers\?\s*$/);

  if (ready >= 0 && ls.length - ready < 10 && ls.slice(ready + 1).every((l) => !l.trim() || OPTION.test(l) || /Esc to cancel/.test(l))) {
    const end = ls.findIndex((l, i) => i > ready && /Esc to cancel/.test(l));

    return parseReview(ls, end < 0 ? ls.length : end);
  }

  const foot = lastIndex(ls, /Esc to cancel/);

  if (foot < 0 || ls.length - foot > 4) return null;

  const footer = ls[foot] ?? "";

  if (/Enter to select/.test(footer)) return parseQuestion(ls, foot);

  return parsePermission(ls, foot, /Tab to amend/.test(footer));
}

/** An option as read off the screen, with whether the cursor is on it. */
interface ReadOption {
  readonly n: number;
  label: string;
  readonly cursor: boolean;
}

/** A block of options and the line above it. */
interface OptionsBlock {
  readonly options: readonly ReadOption[];
  readonly top: number;
}

/** Numbered options ending just above `end`; continuation lines (deeper indent) join their option. */
function optionsAbove(ls: readonly string[], end: number): OptionsBlock {
  const out: ReadOption[] = [];
  let i = end - 1;

  while (i >= 0 && !ls[i]?.trim()) i--;

  const block: string[] = [];

  for (; i >= 0; i--) {
    const l = ls[i] ?? "";

    if (!l.trim()) break;

    block.unshift(l);

    if (OPTION.test(l) && /^\s*(❯\s+)?1\.\s/.test(l)) break;
  }

  let start = -1;

  for (const l of block) {
    const m = l.match(OPTION);
    const last = out.at(-1);

    if (m) {
      out.push({ n: Number(m[4]), label: (m[5] ?? "").trim(), cursor: Boolean(m[2]) });
      start = out.length;
    } else if (start > 0 && last) last.label += ` ${l.trim()}`;
  }

  return { options: out, top: i };
}

function parsePermission(ls: readonly string[], foot: number, canAmend: boolean): PermissionScreen | null {
  const { options, top } = optionsAbove(ls, foot);

  if (options[0]?.n !== 1) return null;

  const cursor = options.findIndex((o) => o.cursor);
  const rule = lastIndex(ls, RULE, top + 1);

  if (rule < 0) return null;

  // Claude's own "Tip: …" line (auto mode) isn't part of the request.
  const head = ls.slice(rule + 1, top).filter((l) => l.trim() && !DASH.test(l) && !TIP.test(l));
  const question = norm(head.at(-1) ?? "");
  const { amend, amendText } = amendOf(options[cursor]?.label ?? "", cursor, canAmend);

  return {
    kind: "permission",
    title: norm(head[0] ?? ""),
    body: head.slice(1, -1).map((l) => l.trim()),
    question,
    options: options.map(({ n, label }) => ({ n, label })),
    cursor,
    amend,
    amendText,
    canAmend,
  };
}

const TIP = /^\s*Tip: /;

/** The note line: which answer it is open on, and what is typed in it. */
interface AmendState {
  readonly amend: Amend | null;
  readonly amendText: string;
}

/** The note line under the cursor (Tab): empty, Claude shows its placeholder
 *  as the option ("Yes, and tell Claude what to do next"); with text typed,
 *  the option reads "Yes, <text>" / "No, <text>" (Claude Code 2.1.322), and
 *  the footer has no "Tab to amend" while it's open. */
function amendOf(label: string, cursor: number, canAmend: boolean): AmendState {
  if (/^Yes, and tell Claude what to do next$/.test(label)) return { amend: "yes", amendText: "" };

  if (/^No, and tell Claude what to do differently$/.test(label)) return { amend: "no", amendText: "" };

  if (!canAmend && cursor === 0 && label.startsWith('Yes, ')) return { amend: "yes", amendText: label.slice(5) };

  if (!canAmend && cursor > 0 && label.startsWith('No, ') && !label.endsWith('(esc)')) return { amend: "no", amendText: label.slice(4) };

  return { amend: null, amendText: "" };
}

/** A question's option row while its description is read. */
interface OptionRow {
  readonly kind: "option" | "chat";
  readonly n: number;
  readonly label: string;
  desc: string;
  readonly checked: boolean | null;
}

function parseQuestion(ls: readonly string[], foot: number): QuestionScreen | null {
  // The block starts at the line of headers (☐ Color ☐ Pets ✔ Submit) after the last full rule.
  const h = lastIndex(ls, /^\s*(←\s+)?[☐☒]\s/, foot);

  if (h < 0 || foot - h > 60) return null;

  const parts = [...(ls[h] ?? "").replace(/^\s*←\s+/, "").replace(/\s+→\s*$/, "").matchAll(/([☐☒✔])\s+(.+?)(?=\s+[☐☒✔]\s|$)/g)];
  const submit = parts.some((p) => p[1] === "✔");
  const headers = parts.flatMap((p) => (p[1] === "✔" ? [] : [{ header: (p[2] ?? "").trim(), done: p[1] === "☒" }]));
  // The question: the lines after the headers up to the first option.
  let i = h + 1;
  const q: string[] = [];

  for (; i < foot; i++) {
    const l = ls[i] ?? "";

    if (OPTION.test(l)) break;

    if (l.trim()) q.push(l.trim());
  }

  const rows: (OptionRow | { readonly kind: "next" })[] = [];
  let cursor = -1;

  for (; i < foot; i++) {
    const l = ls[i] ?? "";

    if (!l.trim() || RULE.test(l)) continue;

    const m = l.match(OPTION);

    if (m) {
      let label = (m[5] ?? "").trim();
      let checked: boolean | null = null;
      const box = label.match(/^\[([ ✔])\]\s?(.*)$/);

      if (box) {
        checked = box[1] === "✔";
        label = (box[2] ?? "").trim();
      }

      rows.push({ kind: /^Chat about this$/.test(label) ? "chat" : "option", n: Number(m[4]), label, desc: "", checked });

      if (m[2]) cursor = rows.length - 1;

      continue;
    }

    const next = l.match(/^(❯)?\s+(Next|Submit)$/);

    if (next) {
      rows.push({ kind: "next" });

      if (next[1]) cursor = rows.length - 1;

      continue;
    }

    const last = rows.at(-1);

    if (last?.kind === "option") last.desc = norm(`${last.desc} ${l}`);
  }

  if (!rows.length) return null;

  return { kind: "question", headers: headers.length ? headers : null, submit, question: norm(q.join(" ")), rows, cursor };
}

function parseReview(ls: readonly string[], foot: number): ReviewScreen | null {
  const { options } = optionsAbove(ls, foot);
  const start = lastIndex(ls, /^\s*Review your answers\s*$/, foot);

  if (start < 0 || !options.length) return null;

  const answers: { question: string; answer: string }[] = [];

  for (let i = start + 1; i < foot; i++) {
    const l = ls[i] ?? "";
    const q = l.match(/^\s*●\s+(.*)$/);

    if (q) {
      answers.push({ question: norm(q[1]), answer: "" });

      continue;
    }

    const a = l.match(/^\s*→\s+(.*)$/);
    const last = answers.at(-1);

    if (a && last) last.answer = norm(a[1]);
    else if (last && !last.answer && l.trim() && !/Ready to submit/.test(l) && !OPTION.test(l)) last.question = norm(`${last.question} ${l}`);
  }

  return { kind: "review", answers, options: options.map(({ n, label }) => ({ n, label })), cursor: options.findIndex((o) => o.cursor) };
}

// ---- the hook record: bin/claude-hook's file (engine.ts reads it, parsed here)

/** An option of a question as Claude sent it. */
const isHookOption = object({}, { label: nullable(isString), description: nullable(isString) });

/** A question of an AskUserQuestion block as Claude sent it. */
const isHookQuestion = object({}, { header: nullable(isString), question: nullable(isString), multiSelect: nullable(isBoolean), options: nullable(arrayOf(isHookOption)) });

/** A tool call's input, the fields read here: what it runs or touches (toolLine), what it
 *  says it does, a file's content or an edit's strings (the overview shows them). */
const INPUT_FIELDS = {
  command: nullable(isString),
  file_path: nullable(isString),
  notebook_path: nullable(isString),
  path: nullable(isString),
  url: nullable(isString),
  pattern: nullable(isString),
  query: nullable(isString),
  prompt: nullable(isString),
  description: nullable(isString),
  content: nullable(isString),
  old_string: nullable(isString),
  new_string: nullable(isString),
};

const INPUT_KEYS = ["command", "file_path", "notebook_path", "path", "url", "pattern", "query", "prompt", "description", "content", "old_string", "new_string"] as const;

const isToolInput = object({}, INPUT_FIELDS);

/** A permission's tool input, as far as it is read (an item keeps it, long strings cut). */
export type ToolInput = Guarded<typeof isToolInput>;

/** The hook's tool input: those fields, and an AskUserQuestion block's questions. */
const isHookInput = object({}, { ...INPUT_FIELDS, questions: arrayOf(isHookQuestion) });

type HookInput = Guarded<typeof isHookInput>;

/** What Claude Code's PermissionRequest hook sent: the tool and its input. */
export const isHookPayload = object({ tool_name: isString }, { tool_input: isHookInput });

export type HookPayload = Guarded<typeof isHookPayload>;

/** A hook record: when the hook wrote it, and what Claude sent. */
export interface HookRecord {
  readonly at: number;
  readonly payload: HookPayload;
}

// ---- the request, as an item

/** A short line for a tool call: the command, the path, the URL. */
export function toolLine(input: ToolInput = {}): string {
  const v = input.command ?? input.file_path ?? input.notebook_path ?? input.path ?? input.url ?? input.pattern ?? input.query ?? input.prompt ?? "";

  return v.split("\n")[0] ?? "";
}

/** What an option answers: "yes" | "always" | "auto" | "no". */
export type OptionKind = "yes" | "always" | "auto" | "no";

/** A permission's option, as an item lists it. */
export interface PermissionOption extends ScreenOption {
  readonly kind: OptionKind;
}

/** A permission request: the tool, its line (command, path, URL) and input (from the hook),
 *  its words on the screen, the options; `from`: "hook" when the record matches the screen. */
export interface PermissionRequest {
  readonly type: "permission";
  readonly tool: string;
  readonly line: string;
  readonly input: ToolInput | null;
  readonly description: string;
  readonly title: string;
  readonly question: string;
  readonly options: readonly PermissionOption[];
  readonly canAmend: boolean;
  readonly from: "hook" | "screen";
}

/** An option of a question. */
export interface QuestionOption {
  readonly label: string;
  readonly description: string;
}

/** A question of a block. */
export interface Question {
  readonly header: string;
  readonly question: string;
  readonly multiSelect: boolean;
  readonly options: readonly QuestionOption[];
}

/** A block of questions (AskUserQuestion), from the hook. */
export interface QuestionRequest {
  readonly type: "question";
  readonly questions: readonly Question[];
  readonly from: "hook";
}

/** What an agent asks. */
export type Request = PermissionRequest | QuestionRequest;

const isPermissionRequest = object({
  type: literal("permission"),
  tool: isString,
  line: isString,
  input: nullable(isToolInput),
  description: isString,
  title: isString,
  question: isString,
  options: arrayOf(object({ n: isNumber, label: isString, kind: literal("yes", "always", "auto", "no") })),
  canAmend: isBoolean,
  from: literal("hook", "screen"),
});

const isQuestionRequest = object({
  type: literal("question"),
  questions: arrayOf(object({ header: isString, question: isString, multiSelect: isBoolean, options: arrayOf(object({ label: isString, description: isString })) })),
  from: literal("hook"),
});

/** A request as the items record (shared notifications.items) keeps it. */
export const isRequest = oneOf(isPermissionRequest, isQuestionRequest);

/**
 * What a Claude Code terminal asks, from its screen and (optionally) its hook
 * record, or null when its screen shows no dialog. `from`: "hook" when the
 * record matches the screen, else "screen".
 */
export function describe(screen: string | null, record: HookRecord | null): Request | null {
  const s = parseScreen(screen);

  if (!s) return null;

  const p = record?.payload ?? null;

  if (s.kind === "permission") {
    const hook = p && p.tool_name !== "AskUserQuestion" && permissionMatches(s, p) ? p : null;

    return {
      type: "permission",
      tool: hook?.tool_name ?? s.title,
      line: hook ? toolLine(hook.tool_input) : s.body.join(" "),
      input: hook ? trimInput(hook.tool_input) : null,
      description: hook?.tool_input?.description ?? "",
      title: s.title,
      question: s.question,
      options: s.options.map((o, i) => ({ ...o, label: i === s.cursor && s.amend ? (s.amend === "yes" ? "Yes" : "No") : o.label, kind: optionKind(o.label) })),
      canAmend: s.canAmend || Boolean(s.amend),
      from: hook ? "hook" : "screen",
    };
  }

  const qs = p?.tool_name === "AskUserQuestion" ? p.tool_input?.questions : undefined;

  if (qs && questionMatches(s, qs)) {
    return {
      type: "question",
      questions: qs.map((q) => ({ header: q.header ?? "", question: q.question ?? "", multiSelect: Boolean(q.multiSelect), options: (q.options ?? []).map((o) => ({ label: o.label ?? "", description: o.description ?? "" })) })),
      from: "hook",
    };
  }

  return null;
}

/** A tool's input with long strings cut (a file's whole content isn't needed to decide). */
function trimInput(input: HookInput | undefined): ToolInput | null {
  if (!input) return null;

  const out: { -readonly [K in keyof ToolInput]: ToolInput[K] } = {};

  for (const key of INPUT_KEYS) {
    const v = input[key];

    if (v !== undefined) out[key] = v && v.length > 4000 ? `${v.slice(0, 4000)}…` : v;
  }

  return out;
}

/** The hook record a request was made from (what step() checks the screen against). */
export function recordOf(request: Request): HookRecord | null {
  if (request.type === "permission" && request.from === "hook") return { at: 0, payload: { tool_name: request.tool, tool_input: request.input ?? {} } };

  if (request.type === "question") return { at: 0, payload: { tool_name: "AskUserQuestion", tool_input: { questions: request.questions } } };

  return null;
}

/** "yes" | "always" | "auto" | "no", from an option's words. */
export function optionKind(label: string): OptionKind {
  if (/^No\b/.test(label)) return "no";

  if (/switch to auto mode|switch to accept edits|bypass/i.test(label)) return "auto";

  if (/^Yes, (and|allow) (don't ask again|always)|always allow|don't ask again/i.test(label)) return "always";

  return "yes";
}

/** The hook's request is the one on screen: its command or path is shown there. */
function permissionMatches(s: PermissionScreen, p: HookPayload): boolean {
  const line = norm(toolLine(p.tool_input));

  if (!line) return true;

  const shown = norm([s.title, ...s.body, s.question].join(" "));
  const name = line.split("/").pop();

  return shown.includes(line.slice(0, 60)) || Boolean(name && shown.includes(name));
}

/** A question as either side has it (the hook's fields may be missing). */
interface Asked {
  readonly header?: string | null;
  readonly question?: string | null;
}

/** The question on screen is one of the block's, and the headers are the block's. */
function questionMatches(s: QuestionScreen | ReviewScreen, qs: readonly Asked[]): boolean {
  if (s.kind === "review") return s.answers.length === qs.length && s.answers.every((a, i) => a.question === norm(qs[i]?.question));

  if (!qs.some((q) => norm(q.question) === s.question)) return false;

  if (s.headers && (s.headers.length !== qs.length || s.headers.some((h, i) => !norm(qs[i]?.header).startsWith(norm(h.header).replace(/…$/, ""))))) return false;

  return true;
}

/** The dialog as drawn, as one string: it changes when a key changed the
 *  dialog, not when the rest of a busy screen (a spinner, a status line) did. */
export function dialog(screen: string): string {
  return JSON.stringify(parseScreen(screen));
}

/** Same request: what an answer was made for is still what the screen asks. */
export function sameRequest(a: Request | null, b: Request | null): boolean {
  if (!a || !b) return false;

  if (a.type === "permission") return b.type === "permission" && a.line === b.line && a.title === b.title && a.options.length === b.options.length && a.options.every((o, i) => o.label === b.options[i]?.label);

  return b.type === "question" && JSON.stringify(a.questions) === JSON.stringify(b.questions);
}

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

  return Array.from({ length: Math.abs(to - from) }, () => (to > from ? "down" : "up"));
}

function permissionStep(goal: PermissionGoal, screen: string, state: StepState): Step {
  const now = describe(screen, goal.record ?? null);
  const s = parseScreen(screen);

  if (state.sent) {
    // Answered: done once the screen no longer shows this request.
    if (!now || !sameRequest(now, goal.request)) return { done: true };

    if (goal.amend !== undefined && s?.kind === "permission" && s.amend) {
      // The note is in the line but its Enter didn't land: press it, once.
      if (norm(s.amendText) === norm(oneLine(goal.amend))) {
        state.waited = (state.waited ?? 0) + 1;

        if (state.waited >= 2 && !state.entered) {
          state.entered = true;

          return { keys: ["enter"] };
        }

        return { wait: true, reason: "The note is typed in the terminal but wasn't sent: press enter there." };
      }

      if (!s.amendText) return { wait: true, reason: "The note didn't arrive in the terminal: nothing was sent." };
    }

    return { wait: true, reason: "Sent, but the request is still showing: look at the terminal." };
  }

  if (!now || now.type !== "permission" || s?.kind !== "permission") return { refuse: "The request is gone: it was answered or withdrawn." };

  if (!sameRequest(now, goal.request)) return { refuse: "The request changed: look at it again." };

  const t = s.options.findIndex((o) => o.n === goal.option);
  const want = goal.request.options.find((o) => o.n === goal.option);

  if (t < 0 || !want || now.options[t]?.label !== want.label) return { refuse: "That option isn't there any more." };

  if (s.cursor !== t) {
    // An amend field open on another option: moving would carry its text, so stop.
    if (s.amend) return { refuse: "Someone is typing in that request: answer it there." };

    return { keys: move(s.cursor, t) ?? [] };
  }

  if (goal.amend !== undefined) {
    const kind = want.kind === "no" ? "no" : t === 0 ? "yes" : null;

    if (!kind) return { refuse: "Only Yes and No take a note." };

    if (s.amend !== kind) {
      if (s.amend) return { refuse: "Someone is typing in that request: answer it there." };

      // Tab opens the note line and closes it again: pressed once, then
      // waited for (another change on the screen may draw first).
      if (state.tabbed) return { wait: true, reason: "The note line didn't open in the terminal: nothing was sent." };

      if (!s.canAmend) return { refuse: "This request doesn't take a note." };

      state.tabbed = true;

      return { keys: ["tab"] };
    }

    if (s.amendText) return { refuse: "Someone is typing in that request: answer it there." };

    state.sent = true;

    return { paste: oneLine(goal.amend) };
  }

  if (s.amend) return { refuse: "Someone is typing in that request: answer it there." };

  state.sent = true;

  return { keys: ["enter"] };
}

/** A control character (below space, or delete): typed text leaves them out. */
const isControl = (c: string) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f;

export const oneLine = (s: string | null | undefined): string => [...(s ?? "").replace(/[\r\n\t]+/g, " ")].filter((c) => !isControl(c)).join("").trim();

/** How Claude's review shows an answer: picked labels in option order, then typed text. */
export function reviewText(q: Question, a: Answer): string {
  const words = [...a.picked].sort((x, y) => x - y).map((i) => q.options[i]?.label);

  if (a.other) words.push(oneLine(a.other));

  return words.join(", ");
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

function questionStep(goal: QuestionGoal, screen: string, state: StepState): Step {
  const qs = goal.request.questions;
  const s = parseScreen(screen);
  const ours = s !== null && s.kind !== "permission" && questionMatches(s, qs);

  if (state.sent) return ours ? { wait: true } : { done: true };

  if (!ours) return { refuse: state.started ? "The questions changed or went away while answering: nothing was submitted." : "The questions are gone: they were answered or withdrawn." };

  state.started = true;

  const at = state.q ?? 0;

  state.q = at;

  const single = qs.length === 1;

  if (s.kind === "review") {
    if (at < qs.length) return { keys: ["shift+tab"] };

    // Every answer as Claude will send it, before submitting.
    for (const [i, q] of qs.entries()) {
      const want = reviewText(q, goal.answers[i] ?? NO_ANSWER);

      if (s.answers[i]?.answer !== norm(want)) return { refuse: `Claude's review shows “${s.answers[i]?.answer ?? ""}” for “${q.question}”, not “${want}”: nothing was submitted.` };
    }

    const t = s.options.findIndex((o) => /^Submit answers$/.test(o.label));

    if (t < 0) return { refuse: "No submit button on Claude's review." };

    if (s.cursor !== t) return { keys: move(s.cursor, t) ?? [] };

    state.sent = true;

    return { keys: ["enter"] };
  }

  const qi = qs.findIndex((q) => norm(q.question) === s.question);

  // All answered and still on a question: on to the review.
  if (at >= qs.length) return single ? { refuse: "The question is still open after answering." } : { keys: ["tab"] };

  if (qi !== at) return { keys: [qi < at ? "tab" : "shift+tab"] };

  const q = qs[qi];
  const a = goal.answers[qi] ?? NO_ANSWER;

  if (!q) return { refuse: "The options on screen aren't the question's." };

  const n = q.options.length;
  const opts = s.rows.flatMap((r) => (r.kind === "option" ? [r] : []));
  const other = opts[n];

  if (!other) return { refuse: "The options on screen aren't the question's." };

  for (let i = 0; i < n; i++) if (norm(opts[i]?.label) !== norm(q.options[i]?.label)) return { refuse: "The options on screen aren't the question's." };

  const otherRow = s.rows.indexOf(other);
  const otherText = /^Type something\.?$/.test(other.label) ? "" : other.label;
  const last = at === qs.length - 1;

  const advance = () => {
    state.q = at + 1;

    if (single || (last && !s.submit)) state.sent = true;
  };

  if (!q.multiSelect) {
    if (a.other) {
      if (s.cursor !== otherRow) return { keys: move(s.cursor, otherRow) ?? [] };

      if (otherText && otherText !== oneLine(a.other)) return { refuse: "There's other text typed in that answer already: answer it in the terminal." };

      if (otherText) {
        advance();

        return { keys: ["enter"] };
      }

      const p = pasteOnce(state, a.other);

      if ("paste" in p) advance();

      return p;
    }

    const picked = opts[a.picked[0] ?? -1];
    const t = picked ? s.rows.indexOf(picked) : -1;

    if (s.cursor !== t) return { keys: move(s.cursor, t) ?? [] };

    advance();

    return { keys: ["enter"] };
  }

  // multiSelect: every box as wanted, one at a time, then Next.
  for (let i = 0; i < n; i++) {
    const want = a.picked.includes(i);
    const box = opts[i];

    if (box && box.checked !== want) {
      const t = s.rows.indexOf(box);

      if (s.cursor !== t) return { keys: move(s.cursor, t) ?? [] };

      return { keys: ["space"] };
    }
  }

  const wantOther = Boolean(a.other);

  if (a.other && otherText !== oneLine(a.other)) {
    if (otherText) return { refuse: "There's other text typed in that answer already: answer it in the terminal." };

    if (s.cursor !== otherRow) return { keys: move(s.cursor, otherRow) ?? [] };

    return pasteOnce(state, a.other);
  }

  if (other.checked !== wantOther) {
    if (s.cursor !== otherRow) return { keys: move(s.cursor, otherRow) ?? [] };

    // Enter toggles the typed answer (space would type a space into it).
    return { keys: ["enter"] };
  }

  const next = s.rows.findIndex((r) => r.kind === "next");

  if (next < 0) return { refuse: "No Next on screen." };

  if (s.cursor !== next) return { keys: move(s.cursor, next) ?? [] };

  advance();

  return { keys: ["enter"] };
}
