// What a Claude Code terminal asks, as an item: the hook record's payload
// (bin/claude-hook) proven, the request it holds (a permission, questions),
// described in a line, and matched against the screen (screen.ts) so a
// dialog is answered only while it shows. Pure.

import { Array as Arr, Option, Schema, String as Str } from "effect";
import type { ScreenOption, PermissionScreen, QuestionScreen, ReviewScreen } from "./screen.ts";
import { parseScreen, norm } from "./screen.ts";

/** Left out, null, or an `A`. */
const maybe = <A, I>(s: Schema.Codec<A, I>) => Schema.optionalKey(Schema.NullOr(s));

const maybeString = maybe(Schema.String);

// ---- the hook record: bin/claude-hook's file (engine.ts reads it, decoded here)

/** An option of a question as Claude sent it. */
export const HookOptionSchema = Schema.Struct({ label: maybeString, description: maybeString });

/** A question of an AskUserQuestion block as Claude sent it. */
export const HookQuestionSchema = Schema.Struct({ header: maybeString, question: maybeString, multiSelect: maybe(Schema.Boolean), options: maybe(Schema.Array(HookOptionSchema)) });

/** A tool call's input, the fields read here: what it runs or touches (toolLine), what it
 *  says it does, a file's content or an edit's strings (the overview shows them). */
export const INPUT_FIELDS = {
  command: maybeString,
  file_path: maybeString,
  notebook_path: maybeString,
  path: maybeString,
  url: maybeString,
  pattern: maybeString,
  query: maybeString,
  prompt: maybeString,
  description: maybeString,
  content: maybeString,
  old_string: maybeString,
  new_string: maybeString,
};

export const INPUT_KEYS = ["command", "file_path", "notebook_path", "path", "url", "pattern", "query", "prompt", "description", "content", "old_string", "new_string"] as const;

export const ToolInputSchema = Schema.Struct(INPUT_FIELDS);

/** A permission's tool input, as far as it is read (an item keeps it, long strings cut). */
export type ToolInput = typeof ToolInputSchema.Type;

/** The hook's tool input: those fields, and an AskUserQuestion block's questions. */
export const HookInputSchema = Schema.Struct({ ...INPUT_FIELDS, questions: Schema.optionalKey(Schema.Array(HookQuestionSchema)) });

export type HookInput = typeof HookInputSchema.Type;

/** What Claude Code's PermissionRequest hook sent: the tool and its input. */
export const HookPayloadSchema = Schema.Struct({ tool_name: Schema.String, tool_input: Schema.optionalKey(HookInputSchema) });

export type HookPayload = typeof HookPayloadSchema.Type;

/** A hook record: when the hook wrote it, and what Claude sent. */
export interface HookRecord {
  readonly at: number;
  readonly payload: HookPayload;
}

// ---- the request, as an item

/** A short line for a tool call: the command, the path, the URL. */
export function toolLine(input: ToolInput = {}): string {
  const v = input.command ?? input.file_path ?? input.notebook_path ?? input.path ?? input.url ?? input.pattern ?? input.query ?? input.prompt ?? "";

  return Str.split(v, "\n")[0];
}

/** What an option answers: "yes" | "always" | "auto" | "no". */
export const OptionKindSchema = Schema.Literals(["yes", "always", "auto", "no"]);

export type OptionKind = typeof OptionKindSchema.Type;

/** A permission's option, as an item lists it. */
export interface PermissionOption extends ScreenOption {
  readonly kind: OptionKind;
}

/** A permission request: the tool, its line (command, path, URL) and input (from the hook),
 *  its words on the screen, the options; `from`: "hook" when the record matches the screen. */
export const PermissionRequestSchema = Schema.Struct({
  type: Schema.Literal("permission"),
  tool: Schema.String,
  line: Schema.String,
  input: Schema.NullOr(ToolInputSchema),
  description: Schema.String,
  title: Schema.String,
  question: Schema.String,
  options: Schema.Array(Schema.Struct({ n: Schema.Finite, label: Schema.String, kind: OptionKindSchema })),
  canAmend: Schema.Boolean,
  from: Schema.Literals(["hook", "screen"]),
});

export type PermissionRequest = typeof PermissionRequestSchema.Type;

/** An option of a question. */
export const QuestionOptionSchema = Schema.Struct({ label: Schema.String, description: Schema.String });

export type QuestionOption = typeof QuestionOptionSchema.Type;

/** A question of a block. */
export const QuestionSchema = Schema.Struct({ header: Schema.String, question: Schema.String, multiSelect: Schema.Boolean, options: Schema.Array(QuestionOptionSchema) });

export type Question = typeof QuestionSchema.Type;

/** A block of questions (AskUserQuestion), from the hook. */
export const QuestionRequestSchema = Schema.Struct({ type: Schema.Literal("question"), questions: Schema.Array(QuestionSchema), from: Schema.Literal("hook") });

export type QuestionRequest = typeof QuestionRequestSchema.Type;

/** A request as the items record (shared notifications.items) keeps it. */
export const RequestSchema = Schema.Union([PermissionRequestSchema, QuestionRequestSchema]);

/** What an agent asks. */
export type Request = typeof RequestSchema.Type;

/**
 * What a Claude Code terminal asks, from its screen and (optionally) its hook
 * record, or null when its screen shows no dialog. `from`: "hook" when the
 * record matches the screen, else "screen".
 */
export function describe(screen: string | null, record: HookRecord | null): Request | null {
  const s = parseScreen(screen);

  if (s === null) return null;

  const p = record?.payload ?? null;

  if (s.kind === "permission") {
    const hook = p !== null && p.tool_name !== "AskUserQuestion" && permissionMatches(s, p) ? p : null;

    return {
      type: "permission",
      tool: hook?.tool_name ?? s.title,
      line: hook === null ? Arr.join(s.body, " ") : toolLine(hook.tool_input),
      input: hook === null ? null : trimInput(hook.tool_input),
      description: hook?.tool_input?.description ?? "",
      title: s.title,
      question: s.question,
      options: Arr.map(s.options, (o, i) => ({ ...o, label: i === s.cursor && s.amend !== null ? (s.amend === "yes" ? "Yes" : "No") : o.label, kind: optionKind(o.label) })),
      canAmend: s.canAmend || s.amend !== null,
      from: hook === null ? "screen" : "hook",
    };
  }

  const qs = p?.tool_name === "AskUserQuestion" ? p.tool_input?.questions : undefined;

  if (qs !== undefined && questionMatches(s, qs)) {
    return {
      type: "question",
      questions: Arr.map(qs, (q) => ({
        header: q.header ?? "",
        question: q.question ?? "",
        multiSelect: q.multiSelect === true,
        options: Arr.map(q.options ?? [], (o) => ({ label: o.label ?? "", description: o.description ?? "" })),
      })),
      from: "hook",
    };
  }

  return null;
}

/** A field of a tool's input, a long one cut (a file's whole content isn't needed to decide). */
const cut = (v: string | null): string | null => (v !== null && v.length > 4000 ? `${Str.slice(0, 4000)(v)}…` : v);

/** A tool's input with long strings cut. */
export function trimInput(input: HookInput | undefined): ToolInput | null {
  if (input === undefined) return null;

  const out: { -readonly [K in keyof ToolInput]: ToolInput[K] } = {};

  for (const key of INPUT_KEYS) {
    const v = input[key];

    if (v !== undefined) out[key] = cut(v);
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

  if (Str.isEmpty(line)) return true;

  const shown = norm(Arr.join([s.title, ...s.body, s.question], " "));
  const name = Arr.last(Str.split(line, "/"));

  return Str.includes(Str.slice(0, 60)(line))(shown) || Option.exists(name, (n) => Str.isNonEmpty(n) && Str.includes(n)(shown));
}

/** A question as either side has it (the hook's fields may be missing). */
export interface Asked {
  readonly header?: string | null;
  readonly question?: string | null;
}

/** The headers on screen are the block's, in order (a cut one ends in …). */
const headersMatch = (headers: readonly { readonly header: string }[], qs: readonly Asked[]): boolean =>
  headers.length === qs.length && Arr.every(headers, (h, i) => Str.startsWith(Str.replace(/…$/, "")(norm(h.header)))(norm(qs[i]?.header)));

/** The question on screen is one of the block's, and the headers are the block's. */
export function questionMatches(s: QuestionScreen | ReviewScreen, qs: readonly Asked[]): boolean {
  if (s.kind === "review") return s.answers.length === qs.length && Arr.every(s.answers, (a, i) => a.question === norm(qs[i]?.question));

  if (!Arr.some(qs, (q) => norm(q.question) === s.question)) return false;

  return s.headers === null || headersMatch(s.headers, qs);
}

/** The dialog as drawn, as one string: it changes when a key changed the
 *  dialog, not when the rest of a busy screen (a spinner, a status line) did. */
export function dialog(screen: string): string {
  return Option.getOrElse(asJson(parseScreen(screen)), () => "");
}

/** A dialog as JSON text (what dialog() compares). */
const asJson = Schema.encodeOption(Schema.fromJsonString(Schema.Unknown));

/** Two question blocks are the same, field by field. */
const sameQuestions = Schema.toEquivalence(Schema.Array(QuestionSchema));

/** Same request: what an answer was made for is still what the screen asks. */
export function sameRequest(a: Request | null, b: Request | null): boolean {
  if (a === null || b === null) return false;

  if (a.type === "permission") return b.type === "permission" && a.line === b.line && a.title === b.title && a.options.length === b.options.length && Arr.every(a.options, (o, i) => o.label === b.options[i]?.label);

  return b.type === "question" && sameQuestions(a.questions, b.questions);
}
