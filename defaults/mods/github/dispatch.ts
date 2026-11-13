// Running a workflow by hand (workflow_dispatch), as plain functions: no
// herdr imports, so scripts/ tests them. dispatchForm.ts draws the form and
// talks to gh; this reads a workflow file's `on:` (a small YAML reader: block
// maps and lists, flow lists and maps, quoted and block scalars, comments),
// turns its inputs into form fields, checks the answers, builds
// `gh workflow run` and finds the run it started.

import type { Guarded } from "./guard.ts";
import { isString, literal } from "./guard.ts";
import type { Run } from "./model.ts";

// ---- a small YAML reader (what workflow files use)

/** A YAML scalar as the core schema reads it. */
export type Scalar = string | number | boolean | null;

/** A YAML value: a scalar, a list, or a mapping (its keys as written). */
export type Yaml = Scalar | readonly Yaml[] | YamlMap;

/** A YAML mapping: keys are data (a job's name, an input's). */
export type YamlMap = ReadonlyMap<string, Yaml>;

export const isYamlMap = (v: Yaml | undefined): v is YamlMap => v instanceof Map;

export const isYamlList = (v: Yaml | undefined): v is readonly Yaml[] => Array.isArray(v);

/** Splits a line at its comment (a # after a space, outside quotes). */
function uncomment(line: string): string {
  let q: string | null = null;

  for (let i = 0; i < line.length; i++) {
    const c = line.charAt(i), before = line.charAt(i - 1);

    if (q) {
      if (c === q && (q === "'" || before !== "\\")) q = null;

      continue;
    }

    if (c === '"' || c === "'") {
      if (i === 0 || /[\s:[{,-]/.test(before)) q = c;

      continue;
    }

    if (c === "#" && (i === 0 || /\s/.test(before))) return line.slice(0, i).replace(/\s+$/, "");
  }

  return line.replace(/\s+$/, "");
}

const ESCAPES = new Map([["n", "\n"], ["t", "\t"]]);

/** A plain or quoted scalar as YAML 1.2's core schema reads it. */
export function scalar(raw: string | null | undefined): Scalar {
  const s = (raw ?? "").trim();

  if (!s) return null;

  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
    return s.slice(1, -1).replace(/\\(["\\/nt])/g, (_m, c: string) => ESCAPES.get(c) ?? c);
  }

  if (s.startsWith("'") && s.endsWith("'") && s.length >= 2) return s.slice(1, -1).replace(/''/g, "'");

  if (/^(true|True|TRUE)$/.test(s)) return true;

  if (/^(false|False|FALSE)$/.test(s)) return false;

  if (/^(null|Null|NULL|~)$/.test(s)) return null;

  if (/^[-+]?\d+$/.test(s)) return Number(s);

  if (/^[-+]?(\d+\.\d*|\.\d+)([eE][-+]?\d+)?$/.test(s)) return Number(s);

  return s;
}

/** A flow list or map (`[a, b]`, `{ a: 1 }`), one level of nesting deep enough for workflows. */
function flow(s: string): Yaml {
  let i = 0;

  const ws = () => {
    while (i < s.length && /\s/.test(s.charAt(i))) i++;
  };

  const atom = (stops: string): Scalar => {
    ws();

    const q = s.charAt(i);

    if (q === '"' || q === "'") {
      let j = i + 1;

      while (j < s.length && !(s.charAt(j) === q && (q === "'" ? s.charAt(j + 1) !== "'" : s.charAt(j - 1) !== "\\"))) j += q === "'" && s.charAt(j) === "'" ? 2 : 1;

      const raw = s.slice(i, j + 1);

      i = j + 1;

      return scalar(raw);
    }

    let j = i;

    while (j < s.length && !stops.includes(s.charAt(j))) j++;

    const raw = s.slice(i, j);

    i = j;

    return scalar(raw);
  };

  const value = (): Yaml => {
    ws();

    if (s.charAt(i) === "[") {
      i++;

      const out: Yaml[] = [];

      for (;;) {
        ws();

        if (s.charAt(i) === "]" || i >= s.length) {
          i++;

          return out;
        }

        out.push(value());
        ws();

        if (s.charAt(i) === ",") i++;
      }
    }

    if (s.charAt(i) === "{") {
      i++;

      const out = new Map<string, Yaml>();

      for (;;) {
        ws();

        if (s.charAt(i) === "}" || i >= s.length) {
          i++;

          return out;
        }

        const k = atom(":,}");

        ws();

        let v: Yaml = null;

        if (s.charAt(i) === ":") {
          i++;
          v = value();
        }

        out.set(String(k), v);
        ws();

        if (s.charAt(i) === ",") i++;
      }
    }

    return atom(",]}");
  };

  return value();
}

/** A line of the file: as written, its indent, its text without the comment. */
interface Line {
  readonly raw: string;
  readonly pad: number;
  readonly text: string;
}

/** Reads YAML text (the subset workflow files use) into plain values. Never throws: what it can't read is null. */
export function parseYaml(text: string | null | undefined): Yaml {
  const lines: Line[] = [];

  for (const raw of (text ?? "").replace(/\t/g, "  ").split(/\r?\n/)) {
    if (/^\s*(---|\.\.\.)\s*$/.test(raw)) continue;

    lines.push({ raw, pad: raw.length - raw.trimStart().length, text: uncomment(raw).trim() });
  }

  const reader = new YamlLines(lines);

  try {
    reader.skip();

    const first = lines[reader.at];

    return first ? reader.node(first.pad) : null;
  } catch {
    return null;
  }
}

/** A key line: `key:` (quoted or not), then what follows on the line. */
const KEY = /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s"'#][^:]*?)\s*:(?:\s+(.*)|$)/;

/** A flow value (`[…]`, `{…}`) or a scalar, as written on one line. */
const inline = (text: string): Yaml => (text.startsWith("[") || text.startsWith("{") ? flow(text) : scalar(text));

/** parseYaml's walk over the file's lines, block by block: `at` is the line it reads next. */
class YamlLines {
  readonly lines: Line[];
  at = 0;

  constructor(lines: Line[]) {
    this.lines = lines;
  }

  /** Past blank and comment-only lines. */
  skip(): void {
    while (this.at < this.lines.length && !this.lines[this.at]?.text) this.at++;
  }

  /** A block scalar's lines (| keeps newlines, > folds them), from the next line deeper than `pad`. */
  block(style: string, pad: number): string {
    const out: string[] = [];
    let indent: number | null = null;

    for (let l = this.lines[this.at]; l; l = this.lines[this.at]) {
      if (l.raw.trim() && l.pad <= pad) break;

      if (l.raw.trim()) indent ??= l.pad;

      out.push(l.raw.trim() ? l.raw.slice(indent ?? 0) : "");
      this.at++;
    }

    while (out.length && !out[out.length - 1]) out.pop();

    const keep = style.includes("+"), strip = style.includes("-");
    const body = style.startsWith(">") ? out.join("\n").replace(/([^\n])\n(?=[^\n])/g, "$1 ") : out.join("\n");

    return strip ? body : body + (keep ? "\n" : body ? "\n" : "");
  }

  /** The value after `key:` or `- ` on the same line, or the block under it. */
  after(rest: string, pad: number): Yaml {
    const r = rest.trim();

    if (/^[|>][-+0-9]*$/.test(r)) {
      this.at++;

      return this.block(r, pad);
    }

    this.at++;

    if (r) return inline(r);

    this.skip();

    const next = this.lines[this.at];

    if (next && (next.pad > pad || (next.pad === pad && next.text.startsWith("- ")))) return this.node(next.pad);

    return null;
  }

  /** The block at `pad`: a list, a map or a lone value. */
  node(pad: number): Yaml {
    this.skip();

    const first = this.lines[this.at];

    if (!first) return null;

    if (first.text === "-" || first.text.startsWith("- ")) return this.list(pad);

    if (KEY.test(first.text)) return this.map(pad);

    this.at++;

    return inline(first.text);
  }

  /** `- ` items at `pad`. */
  list(pad: number): Yaml[] {
    const out: Yaml[] = [];

    while (this.at < this.lines.length) {
      this.skip();

      const l = this.lines[this.at];

      if (!l || l.pad !== pad || !(l.text === "-" || l.text.startsWith("- "))) break;

      const rest = l.text.slice(1).trimStart();

      if (KEY.test(rest) && !rest.startsWith("[") && !rest.startsWith("{")) {
        // `- key: v` starts a map whose keys sit where `key` does.
        const inner = pad + (l.text.length - rest.length);

        this.lines[this.at] = { ...l, pad: inner, text: rest };
        out.push(this.map(inner));
      } else {
        out.push(this.after(rest, pad));
      }
    }

    return out;
  }

  /** `key: value` lines at `pad`. */
  map(pad: number): YamlMap {
    const out = new Map<string, Yaml>();

    while (this.at < this.lines.length) {
      this.skip();

      const l = this.lines[this.at];

      if (!l || l.pad !== pad) break;

      const [, key, rest] = KEY.exec(l.text) ?? [];

      if (key === undefined) {
        this.at++;

        continue;
      }

      out.set(String(scalar(key) ?? key), this.after(rest ?? "", pad));
    }

    return out;
  }
}

// ---- workflow_dispatch

/** A workflow file's `on:` as GitHub reads it: a word, a list of words, or a map (YAML 1.1 reads a bare `on` key as true). */
function triggers(doc: Yaml): Yaml {
  if (!isYamlMap(doc)) return null;

  return doc.get("on") ?? doc.get("true") ?? doc.get('"on"') ?? null;
}

/** The kinds of input a workflow_dispatch declares. */
export const isInputType = literal("string", "choice", "boolean", "number", "environment");

export type InputType = Guarded<typeof isInputType>;

/** A workflow_dispatch input as the file declares it. */
export interface Input {
  readonly name: string;
  readonly type: InputType;
  readonly options: readonly string[];
  readonly description: string;
  readonly required: boolean;
  readonly default: Yaml;
}

/** What a workflow file says about being run by hand: its inputs. */
export interface Dispatch {
  readonly inputs: readonly Input[];
}

/** One input's declaration. */
function inputOf(name: string, spec: Yaml): Input {
  const s = isYamlMap(spec) ? spec : new Map<string, Yaml>();
  const declared = s.get("type");
  const type = isInputType(declared) ? declared : "string";
  const options = s.get("options");
  const description = s.get("description");
  const required = s.get("required");

  return {
    name, type,
    options: type === "choice" && isYamlList(options) ? options.map((o) => String(o)) : [],
    description: description === undefined || description === null ? "" : String(description).trim(),
    required: required === true || required === "true",
    default: s.get("default") ?? null,
  };
}

/** Whether a workflow file can be run by hand, and its inputs: { inputs: [...] }, or null when it has no workflow_dispatch. */
export function dispatchOf(yaml: string): Dispatch | null {
  const on = triggers(parseYaml(yaml));

  if (on === "workflow_dispatch") return { inputs: [] };

  if (isYamlList(on)) return on.includes("workflow_dispatch") ? { inputs: [] } : null;

  if (!isYamlMap(on) || !on.has("workflow_dispatch")) return null;

  const dispatch = on.get("workflow_dispatch");
  const raw = isYamlMap(dispatch) ? dispatch.get("inputs") : undefined;

  return { inputs: isYamlMap(raw) ? [...raw].map(([name, spec]) => inputOf(name, spec)) : [] };
}

/** An input's starting answer: its default, else what GitHub's form starts with (a choice's first option, off, empty). */
export function startValue(input: Input): string | boolean {
  const d = input.default;

  if (input.type === "boolean") return d === true || d === "true";

  if (input.type === "choice") return d !== null && input.options.includes(String(d)) ? String(d) : input.options[0] ?? "";

  return d === null ? "" : String(d);
}

/** What's wrong with an answer, or "" (required ones filled, numbers numeric, choices among the options). */
export function inputError(input: Input, value: string | boolean | null | undefined, envs: readonly string[] | null = null): string {
  const v = isString(value) ? value.trim() : value;

  if (input.type === "boolean") return "";

  if (input.required && (v === "" || v === null || v === undefined)) return "Required.";

  if (v === "" || v === null || v === undefined) return "";

  const s = String(v);

  if (input.type === "number" && !/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s)) return "A number.";

  if (input.type === "choice" && !input.options.includes(s)) return `One of: ${input.options.join(", ")}.`;

  if (input.type === "environment" && envs && envs.length && !envs.includes(s)) return `An environment of the repo: ${envs.join(", ")}.`;

  return "";
}

/** The file name gh's workflow run takes (`.github/workflows/ci.yml` -> `ci.yml`). */
export const workflowFile = (path: string | null | undefined): string => (path ?? "").split("/").pop() ?? "";

/** What dispatchArgs reads of a workflow. */
export interface Runnable {
  readonly id: number;
  readonly path: string;
}

/** `gh workflow run` argv (without -R): the workflow, the ref, every input as -f name=value (`values` by input name). */
export function dispatchArgs(workflow: Runnable, ref: string, inputs: readonly Input[], values: ReadonlyMap<string, string | boolean>): string[] {
  const args = ["workflow", "run", workflowFile(workflow.path) || String(workflow.id), "--ref", ref];

  for (const i of inputs) {
    const v = values.get(i.name);

    args.push("-f", `${i.name}=${i.type === "boolean" ? (v ? "true" : "false") : String(v ?? "").trim()}`);
  }

  return args;
}

/** What newRun looks for: the ref, when the dispatch was sent, the runs there before it. */
export interface Sent {
  readonly ref: string;
  readonly since: number;
  readonly known?: readonly number[];
}

const when = (v: string | null | undefined) => Date.parse(v ?? "0");

/** The run a dispatch started: the newest workflow_dispatch run of that
 *  workflow on that ref made since `since` (ms, a little slack for clocks)
 *  that wasn't there before (`known`: ids), or null. */
export function newRun(runs: readonly Run[] | null | undefined, { ref, since, known = [] }: Sent): Run | null {
  const seen = new Set(known);

  const fresh = (runs ?? []).filter((r) => !seen.has(r.id) && (r.event ?? "workflow_dispatch") === "workflow_dispatch"
    && (!ref || r.head_branch === ref) && when(r.created_at ?? r.run_started_at) >= since - 15000);

  fresh.sort((a, b) => when(b.created_at) - when(a.created_at));

  return fresh[0] ?? null;
}

// ---- shared with the pull request form

/** One argv as a shell line a person can read and paste. */
export function shellLine(cmd: string, args: readonly string[]): string {
  const q = (a: string) => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`);

  return [cmd, ...args].map(q).join(" ");
}
