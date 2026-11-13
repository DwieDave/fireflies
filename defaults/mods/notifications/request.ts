// What a Claude Code terminal asks, as an item: the hook record's payload
// (bin/claude-hook) proven, the request it holds (a permission, questions),
// described in a line, and matched against the screen (screen.ts) so a
// dialog is answered only while it shows. Pure.

import type { Guarded } from "./guard.ts";
import { arrayOf, isBoolean, isNumber, isString, literal, nullable, object, oneOf } from "./guard.ts";
import type { ScreenOption, PermissionScreen, QuestionScreen, ReviewScreen } from "./screen.ts";
import { parseScreen, norm } from "./screen.ts";

// ---- the hook record: bin/claude-hook's file (engine.ts reads it, parsed here)

/** An option of a question as Claude sent it. */
export const isHookOption = object({}, { label: nullable(isString), description: nullable(isString) });

/** A question of an AskUserQuestion block as Claude sent it. */
export const isHookQuestion = object({}, { header: nullable(isString), question: nullable(isString), multiSelect: nullable(isBoolean), options: nullable(arrayOf(isHookOption)) });

/** A tool call's input, the fields read here: what it runs or touches (toolLine), what it
 *  says it does, a file's content or an edit's strings (the overview shows them). */
export const INPUT_FIELDS = {
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

export const INPUT_KEYS = ["command", "file_path", "notebook_path", "path", "url", "pattern", "query", "prompt", "description", "content", "old_string", "new_string"] as const;

export const isToolInput = object({}, INPUT_FIELDS);

/** A permission's tool input, as far as it is read (an item keeps it, long strings cut). */
export type ToolInput = Guarded<typeof isToolInput>;

/** The hook's tool input: those fields, and an AskUserQuestion block's questions. */
export const isHookInput = object({}, { ...INPUT_FIELDS, questions: arrayOf(isHookQuestion) });

export type HookInput = Guarded<typeof isHookInput>;

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

export const isPermissionRequest = object({
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

export const isQuestionRequest = object({
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
export function trimInput(input: HookInput | undefined): ToolInput | null {
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
export function permissionMatches(s: PermissionScreen, p: HookPayload): boolean {
  const line = norm(toolLine(p.tool_input));

  if (!line) return true;

  const shown = norm([s.title, ...s.body, s.question].join(" "));
  const name = line.split("/").pop();

  return shown.includes(line.slice(0, 60)) || Boolean(name && shown.includes(name));
}

/** A question as either side has it (the hook's fields may be missing). */
export interface Asked {
  readonly header?: string | null;
  readonly question?: string | null;
}

/** The question on screen is one of the block's, and the headers are the block's. */
export function questionMatches(s: QuestionScreen | ReviewScreen, qs: readonly Asked[]): boolean {
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
