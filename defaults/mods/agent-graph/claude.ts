// What a Claude Code session is doing, read from its files under ~/.claude
// (this machine only):
//
//   sessions/<pid>.json                      the process's session id
//   projects/<dir>/<session>.jsonl           the main transcript; workflow
//                                            launches are recorded there
//   projects/<dir>/<session>/subagents/      agent-<id>.meta.json + .jsonl per
//                                            subagent (spawnDepth 1 = the main
//                                            session's own, deeper = an agent's)
//   .../subagents/workflows/<run>/           journal.jsonl (started / result per
//                                            agent, with label and phase) and
//                                            each workflow agent's files
//   .../workflows/<run>.json                 written when a run ends: status
//   .../workflows/scripts/<name>[-<run>].js  the script: its meta.phases
//
// Nothing here writes; reads go through one `sh` per poll.

import { exec, readTextFile, home } from "herdr";
import type { Guard, Guarded } from "./guard.ts";
import { arrayOf, isBoolean, isNull, isNumber, isString, literal, nullable, object, oneOf, parseJson } from "./guard.ts";

// An agent whose transcript changed this recently counts as working even
// between turns (a long tool call writes nothing until it returns).
const QUIET_MS = 90_000;

const SNAPSHOT = String.raw`
sid="$1"
main=$(ls "$HOME"/.claude/projects/*/"$sid".jsonl 2>/dev/null | head -1)
[ -n "$main" ] || exit 3
S=$(printf %s "$main" | sed 's/\.jsonl$//')
echo "@main	$main	$(stat -f %m "$main")	$(grep -m 1 -o '"timestamp":"[^"]*"' "$main" | cut -d'"' -f4)"
if [ -d "$S/subagents" ]; then
  cd "$S/subagents"
  find . -name '*.meta.json' | while read -r f; do
    j=$(printf %s "$f" | sed 's/\.meta\.json$/.jsonl/')
    stop=$(tail -c 8000 "$j" 2>/dev/null | grep -o '"stop_reason":"[a-z_]*"' | tail -1 | cut -d'"' -f4)
    t0=$(head -n 1 "$j" 2>/dev/null | grep -o '"timestamp":"[^"]*"' | head -1 | cut -d'"' -f4)
    printf '@agent\t%s\t%s\t%s\t%s\t' "$f" "$(stat -f %m "$j" 2>/dev/null || echo 0)" "$stop" "$t0"
    tr -d '\n' < "$f"; echo
  done
  for j in workflows/*/journal.jsonl; do
    [ -f "$j" ] || continue
    run=$(basename "$(dirname "$j")")
    grep -v '"type":"result"' "$j" | sed "s/^/@journal	$run	/"
    grep '"type":"result"' "$j" | grep -o '"agentId":"[^"]*"' | sed "s/^/@result	$run	/"
  done
fi
for w in "$S"/workflows/wf_*.json; do
  [ -f "$w" ] || continue
  printf '@ended\t%s\t%s\n' "$(basename "$w" .json)" "$(grep -o '"status":"[a-z]*","startTime"' "$w" | head -1 | cut -d'"' -f4)"
done
grep -o '"taskType":"local_workflow","workflowName":"[^"]*","runId":"[^"]*","summary":"[^"]*"' "$main" | sed 's/^/@run	/'
`;

/** ~/.claude/sessions/<pid>.json, the fields read here. */
const isSessionFile = object({ sessionId: isString }, { name: nullable(isString), cwd: nullable(isString) });

export type SessionFile = Guarded<typeof isSessionFile>;

/** The session a Claude Code process runs, from ~/.claude/sessions/<pid>.json. */
export async function sessionOf(pid: number | null): Promise<SessionFile | null> {
  if (!pid) return null;

  const text = await readTextFile(`${home()}/.claude/sessions/${pid}.json`).catch(() => null);

  return text ? parseJson(text, isSessionFile) ?? null : null;
}

const phaseCache = new Map<string, readonly string[]>(); // script path -> titles

/** A workflow script's meta.phases titles, in order (cached per script). */
async function scriptPhases(dir: string, name: string, runId: string): Promise<readonly string[]> {
  for (const path of [`${dir}/workflows/scripts/${name}-${runId}.js`, `${dir}/workflows/scripts/${name}.js`]) {
    const cached = phaseCache.get(path);

    if (cached) return cached;

    const text = await readTextFile(path).catch(() => null);

    if (!text) continue;

    const block = text.match(/phases\s*:\s*\[([\s\S]*?)\]\s*,?\s*\}/)?.[1] ?? "";
    const titles = [...block.matchAll(/title\s*:\s*(['"`])((?:\\.|(?!\1).)*)\1/g)].map((m) => m[2] ?? "");

    phaseCache.set(path, titles);

    return titles;
  }

  return [];
}

const parentCache = new Map<string, string>(); // toolUseId -> agentId | "main"

/** Which transcript holds the tool call that spawned a nested agent. */
async function findParents(dir: string, nested: readonly Agent[]): Promise<void> {
  const ask = nested.flatMap((a) => (a.toolUseId && !parentCache.has(a.toolUseId) ? [a.toolUseId] : []));

  if (!ask.length) return;

  const r = await exec("sh", ["-c", String.raw`
cd "$1/subagents" || exit 0
shift
for id in "$@"; do
  f=$(grep -l -F "\"id\":\"$id\"" $(find . -name '*.jsonl' ! -name journal.jsonl) 2>/dev/null | head -1)
  printf '%s\t%s\n' "$id" "$f"
done`, "sh", dir, ...ask]).catch(() => null);

  for (const line of (r?.stdout ?? "").split("\n")) {
    const [id, file] = line.split("\t");

    if (!id) continue;

    parentCache.set(id, file ? file.match(/agent-([a-z0-9]+)\.jsonl$/)?.[1] ?? "main" : "main");
  }
}

/** A subagent's status: working, quiet with a tool call open, done, or stopped with its run. */
const isAgentStatus = literal("working", "idle", "done", "stopped");

export type AgentStatus = Guarded<typeof isAgentStatus>;

/** One subagent (also as kept in the shared cache, so it has a guard). `parent` is "main",
 *  another agent's id or its workflow run's id. */
const isAgent = object({
  id: isString,
  run: nullable(isString),
  file: isString,
  changed: isNumber,
  started: isNumber,
  rel: isString,
  label: isString,
  type: isString,
  depth: isNumber,
  toolUseId: nullable(isString),
  phase: nullable(isString),
  model: nullable(isString),
  background: isBoolean,
  status: isAgentStatus,
  parent: isString,
});

export type Agent = Guarded<typeof isAgent>;

/** A workflow run: its status is "running" until its record says how it ended
 *  ("completed", "failed", "killed" …). */
const isRun = object({
  id: isString,
  name: isString,
  summary: isString,
  phases: arrayOf(isString),
  agents: arrayOf(isString),
  status: isString,
  started: isNumber,
  ended: nullable(isNumber),
});

export type Run = Guarded<typeof isRun>;

/** Everything the graph shows for one session. */
export interface Snapshot {
  readonly dir: string;
  readonly main: string;
  readonly mainChanged: number;
  readonly mainStarted: number;
  readonly agents: ReadonlyMap<string, Agent>;
  readonly runs: readonly Run[];
}

/** A record being filled in. */
type Draft<T> = { -readonly [K in keyof T]: T[K] };

/** An agent's .meta.json, the fields read here. */
const isAgentMeta = object({}, {
  description: nullable(isString),
  agentType: nullable(isString),
  spawnDepth: nullable(isNumber),
  toolUseId: nullable(isString),
  workflowPhase: nullable(isString),
  pickedEffortModel: nullable(isString),
  "requestShape": nullable(isString),
});

/** A workflow journal's line, the fields read here. */
const isJournalLine = object({}, { type: isString, agentId: isString, label: nullable(isString), phase: nullable(isString) });

type JournalLine = Guarded<typeof isJournalLine> & { readonly run: string };

/** A run as the transcript or a journal first names it. */
const newRun = (id: string, name: string, summary: string): Draft<Run> => ({ id, name, summary, phases: [], agents: [], status: "running", started: 0, ended: null });

/** An `@agent` record of the snapshot script: the subagent its meta file
 *  describes (half-written, no meta yet: its id and times only), or null when
 *  the path names none. */
function agentOf(f: readonly string[], now: number): Draft<Agent> | null {
  const [rel = "", mtime = "", stop = "", t0 = "", json = ""] = f;
  // Half-written: no meta yet.
  const meta = parseJson(json, isAgentMeta) ?? {};
  const id = rel.match(/agent-([a-z0-9]+)\.meta\.json$/)?.[1];

  if (!id) return null;

  const run = rel.match(/workflows\/(wf_[^/]+)\//)?.[1] ?? null;
  const changed = Number(mtime) * 1000;

  return {
    id, run, file: "", changed,
    // When it started: its transcript's first line (else when it last wrote).
    started: Date.parse(t0) || Number(mtime) * 1000,
    rel: rel.replace(/\.meta\.json$/, ".jsonl").replace(/^\.\//, ""),
    label: meta.description || meta.agentType || id,
    type: meta.agentType ?? "agent",
    depth: meta.spawnDepth ?? 1,
    toolUseId: meta.toolUseId ?? null,
    phase: meta.workflowPhase ?? null,
    model: meta.pickedEffortModel ?? null,
    background: meta.requestShape === "background",
    // Finished: its last turn ended, or long quiet with no tool call open.
    status: now - changed < (stop === "end_turn" ? 4000 : QUIET_MS) ? "working" : stop === "tool_use" ? "idle" : "done",
    // Set below, once every agent and run is known.
    parent: "main",
  };
}

/**
 * Everything the graph shows, for one session id: the main transcript, each
 * subagent (its parent "main", an agentId or a run id) and each workflow run.
 */
export async function snapshot(sessionId: string): Promise<Snapshot | null> {
  const r = await exec("sh", ["-c", SNAPSHOT, "sh", sessionId]);

  if (r.code !== 0) return null;

  const now = Date.now();
  let main: string | null = null, mainChanged = 0, mainStarted = 0;
  const agents = new Map<string, Draft<Agent>>(), runs = new Map<string, Draft<Run>>(), ended = new Map<string, string>(), results = new Set<string>();
  const journal: JournalLine[] = [];

  for (const line of r.stdout.split("\n")) {
    const [tag, ...f] = line.split("\t");

    if (tag === "@main") {
      main = f[0] ?? null;
      mainChanged = Number(f[1]) * 1000;
      mainStarted = Date.parse(f[2] ?? "") || mainChanged;
    } else if (tag === "@agent") {
      const a = agentOf(f, now);

      if (a) agents.set(a.id, a);
    } else if (tag === "@journal") {
      // A partial line is left out.
      const e = parseJson(f.slice(1).join("\t"), isJournalLine);

      if (e) journal.push({ ...e, run: f[0] ?? "" });
    } else if (tag === "@result") {
      const id = (f[1] ?? "").split('"')[3];

      if (id !== undefined) results.add(id);
    } else if (tag === "@ended") ended.set(f[0] ?? "", f[1] || "completed");
    else if (tag === "@run") {
      const m = line.match(/"workflowName":"([^"]*)","runId":"([^"]*)","summary":"((?:\\.|[^"])*)"/);

      if (m?.[1] !== undefined && m[2] !== undefined && m[3] !== undefined) runs.set(m[2], newRun(m[2], m[1], m[3].replace(/\\"/g, '"')));
    }
  }

  if (!main) return null;

  const dir = main.replace(/\.jsonl$/, "");

  for (const a of agents.values()) a.file = `${dir}/subagents/${a.rel}`;

  // Workflow runs: launched ones from the transcript, plus any journal seen.
  for (const e of journal) {
    const run = runs.get(e.run) ?? newRun(e.run, e.run, "");

    runs.set(e.run, run);

    if (e.type === "started" && e.agentId) {
      if (!run.agents.includes(e.agentId)) run.agents = [...run.agents, e.agentId];

      if (e.phase && !run.phases.includes(e.phase)) run.phases = [...run.phases, e.phase];

      const a = agents.get(e.agentId);

      if (a) {
        a.label = e.label || a.label;
        a.phase = e.phase ?? a.phase;
      }
    }
  }

  for (const run of runs.values()) {
    run.status = ended.get(run.id) ?? "running";
    // A run starts with its first agent (a run with none yet: now, so it sorts last).
    run.started = Math.min(...run.agents.map((id) => agents.get(id)?.started ?? Infinity));

    if (!Number.isFinite(run.started)) run.started = now;

    // The script's plan first (phases not reached yet show too), then any the journal adds.
    const plan = await scriptPhases(dir, run.name, run.id);

    run.phases = [...plan, ...run.phases.filter((p) => !plan.includes(p))];

    for (const id of run.agents) {
      const a = agents.get(id);

      if (!a) continue;

      a.parent = run.id;
      // Started, no result yet, run going: working, even if its transcript is
      // quiet (a long tool call writes nothing until it returns).
      a.status = results.has(id) ? "done" : run.status === "running" ? "working" : "stopped";
    }
  }

  // Plain subagents: the main session's, or (deeper) another agent's.
  const nested = [...agents.values()].filter((a) => !a.run && a.depth > 1);

  await findParents(dir, nested);

  for (const a of agents.values()) {
    if (a.run) continue;

    const p = a.depth > 1 && a.toolUseId !== null ? parentCache.get(a.toolUseId) : "main";

    a.parent = p && p !== "main" && agents.has(p) ? p : "main";
  }

  for (const run of runs.values()) {
    // A run that's over ended when its last agent last wrote.
    run.ended = run.status === "running" ? null : Math.max(run.started, ...run.agents.map((id) => agents.get(id)?.changed ?? 0));
  }

  return { dir, main, mainChanged, mainStarted, agents, runs: [...runs.values()] };
}

/** A snapshot as JSON-safe values (shared() keeps plain data): the agents as [id, agent] pairs. */
export interface PackedSnapshot extends Omit<Snapshot, "agents"> {
  readonly agents: readonly (readonly [string, Agent])[];
}

const isAgentEntry = (value: unknown): value is readonly [string, Agent] => Array.isArray(value) && value.length === 2 && isString(value[0]) && isAgent(value[1]);

export const isPackedSnapshot: Guard<PackedSnapshot> = object({
  dir: isString,
  main: isString,
  mainChanged: isNumber,
  mainStarted: isNumber,
  agents: arrayOf(isAgentEntry),
  runs: arrayOf(isRun),
});

export const pack = (d: Snapshot): PackedSnapshot => ({ ...d, agents: [...d.agents.entries()] });

export const unpack = (d: PackedSnapshot): Snapshot => ({ ...d, agents: new Map(d.agents) });

// ---- a transcript, line by line

/** One step of the feed. */
export type FeedItem =
  | { readonly kind: "text" | "prompt"; readonly text: string }
  | { readonly kind: "tool"; readonly name: string; readonly text: string }
  | { readonly kind: "result"; readonly text: string; readonly error: boolean };

const isList = (value: unknown): value is readonly unknown[] => Array.isArray(value);

/** A transcript line, the fields read here: who wrote it and its message. */
const isTranscriptLine = object({}, {
  type: isString,
  message: object({}, { content: oneOf(isString, isList), model: nullable(isString) }),
});

type TranscriptLine = Guarded<typeof isTranscriptLine>;

/** The parts of a message's content shown (others, like thinking, are left out). */
const isTextBlock = object({ type: literal("text"), text: isString });

/** A tool call's input: the field that says what it does, whichever the tool has. */
const isToolInput = object({}, { description: isString, command: isString, file_path: isString, pattern: isString, prompt: isString, url: isString, query: isString });

const isToolUse = object({ type: literal("tool_use"), name: isString }, { input: isToolInput });

const isToolResult = object({ type: literal("tool_result") }, {
  content: oneOf(isString, isNull, arrayOf(object({}, { text: isString }))),
  is_error: nullable(isBoolean),
});

/** One transcript line, short, or null when it isn't a message with content. */
function feedItem(entry: TranscriptLine): FeedItem[] | null {
  const content = entry.message?.content;

  if (entry.type === "user" && isString(content)) return [{ kind: "prompt", text: content }];

  if (content === undefined || isString(content)) return null;

  const out: FeedItem[] = [];

  for (const c of content) {
    if (isTextBlock(c)) {
      if (c.text.trim()) out.push({ kind: entry.type === "user" ? "prompt" : "text", text: c.text.trim() });
    } else if (isToolUse(c)) {
      const i = c.input ?? {};
      const what = i.description || i.command || i.file_path || i.pattern || i.prompt || i.url || i.query || "";

      out.push({ kind: "tool", name: c.name, text: what.split("\n")[0] ?? "" });
    } else if (isToolResult(c)) {
      const body = isList(c.content) ? c.content.map((x) => x.text ?? "").join(" ") : c.content ?? "";

      out.push({ kind: "result", text: body.trim().split("\n")[0] ?? "", error: Boolean(c.is_error) });
    }
  }

  return out;
}

/** An agent's task (its first prompt), its latest steps and its model. */
export interface Feed {
  readonly task: string;
  readonly items: readonly FeedItem[];
  readonly model: string | null;
}

/** The agent's task (its first prompt) and its latest steps, newest last. */
export async function feed(file: string, lines = 80): Promise<Feed | null> {
  const r = await exec("sh", ["-c", 'head -n 1 "$1"; echo "@@tail"; tail -n "$2" "$1"', "sh", file, String(lines)]).catch(() => null);

  if (!r || r.code !== 0) return null;

  const [head = "", tail = ""] = r.stdout.split("\n@@tail\n");
  const first = parseJson(head, isTranscriptLine);
  // Not a message line: no task.
  const task = (first && feedItem(first)?.find((x) => x.kind === "prompt")?.text) ?? "";
  const items: FeedItem[] = [];
  let model: string | null = null;

  for (const line of tail.split("\n")) {
    if (!line.trim()) continue;

    // A partial last line is left out.
    const e = parseJson(line, isTranscriptLine);

    if (!e) continue;

    if (e.message?.model) model = e.message.model;

    const got = feedItem(e);

    if (got) items.push(...got);
  }

  return { task, items, model };
}

// ---- time and tokens

/** How long something ran: start to now while it works, else to its last write (ms). */
export function ranFor(a: Agent, now = Date.now()): number {
  if (!a.started) return 0;

  const end = a.status === "working" ? now : a.changed;

  return Math.max(0, end - a.started);
}

/** "42s", "4m 12s", "1h 05m". */
export function span(ms: number): string {
  const s = Math.round(ms / 1000);

  if (s < 60) return `${s}s`;

  const m = Math.floor(s / 60);

  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;

  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

/** "812", "41.2k", "2.31M". */
export function count(n: number): string {
  if (n < 1000) return String(n);

  if (n < 1e6) return `${(n / 1000).toFixed(n < 1e4 ? 1 : 0)}k`;

  return `${(n / 1e6).toFixed(2)}M`;
}

// Anthropic's API list prices, $ per million tokens: [input, output, cache read].
// A cache write costs 1.25x input (5 minutes) or 2x (1 hour). First match wins,
// so the specific names come before their families. On a subscription this is
// what the same work would cost at API rates, not a bill.
const PRICES: readonly (readonly [RegExp, number, number, number])[] = [
  [/fable-5-1|mythos-5-1/, 10, 50, 0.25],
  [/fable-5|mythos-5/, 10, 50, 1],
  [/opus-5-5/, 4, 20, 0.2],
  [/opus-5|opus-4-[5-9]/, 5, 25, 0.5],
  [/opus-4|opus-3/, 15, 75, 1.5],
  [/sonnet-5/, 2, 10, 0.2],
  [/sonnet-4|sonnet-3/, 3, 15, 0.3],
  [/haiku-5-5/, 0.1, 0.5, 0.01],
  [/haiku-4-5/, 1, 5, 0.1],
  [/haiku-3-5/, 0.8, 4, 0.08],
];

/** One model's token counts. */
export interface Tokens {
  readonly input: number;
  readonly output: number;
  readonly cache5m: number;
  readonly cache1h: number;
  readonly cacheRead: number;
}

/** Dollars for one model's token totals, or null for a model with no price here. */
export function cost(model: string | null, u: Tokens): number | null {
  const p = PRICES.find(([re]) => re.test(model ?? ""));

  if (!p) return null;

  const [, i, o, r] = p;

  return (u.input * i + u.output * o + u.cache5m * i * 1.25 + u.cache1h * i * 2 + u.cacheRead * r) / 1e6;
}

/** A usage total: the token counts, all of them together, their cost, and whether a model had no price. */
export interface Usage extends Draft<Tokens> {
  tokens: number;
  cost: number;
  unpriced: boolean;
}

/** A usage total of nothing. */
export function emptyUsage(): Usage {
  return { input: 0, output: 0, cache5m: 0, cache1h: 0, cacheRead: 0, tokens: 0, cost: 0, unpriced: false };
}

const SUMMED = ["input", "output", "cache5m", "cache1h", "cacheRead", "tokens", "cost"] as const;

/** Adds b into a (both usage totals). */
export function addUsage(a: Usage, b: Readonly<Usage> | null | undefined): Usage {
  if (!b) return a;

  for (const k of SUMMED) a[k] += b[k];

  a.unpriced ||= b.unpriced;

  return a;
}

// Sums each transcript's usage per model, counting a message once (its
// content blocks are written as separate lines that repeat the same usage).
const USAGE = String.raw`
for f in "$@"; do
  awk -v F="$f" '
    function num(s, k,   r) { if (match(s, "\"" k "\":[0-9]+")) { r = substr(s, RSTART, RLENGTH); sub(/.*:/, "", r); return r + 0 } return 0 }
    /"usage":\{/ && /"type":"assistant"/ {
      u = substr($0, index($0, "\"usage\":{"))
      id = NR; if (match($0, /"id":"msg_[^"]*"/)) id = substr($0, RSTART + 6, RLENGTH - 7)
      m = "?"; if (match($0, /"model":"[^"]*"/)) m = substr($0, RSTART + 9, RLENGTH - 10)
      c5 = num(u, "ephemeral_5m_input_tokens"); c1 = num(u, "ephemeral_1h_input_tokens")
      if (c5 + c1 == 0) c5 = num(u, "cache_creation_input_tokens")
      M[id] = m; I[id] = num(u, "input_tokens"); O[id] = num(u, "output_tokens"); R[id] = num(u, "cache_read_input_tokens"); A[id] = c5; B[id] = c1
    }
    END {
      for (id in M) { k = M[id]; i[k] += I[id]; o[k] += O[id]; r[k] += R[id]; a[k] += A[id]; b[k] += B[id]; seen[k] = 1 }
      for (k in seen) printf "%s\t%s\t%.0f\t%.0f\t%.0f\t%.0f\t%.0f\n", F, k, i[k], o[k], a[k], b[k], r[k]
    }' "$f" 2>/dev/null
done
`;

/** A transcript and when it last changed. */
export interface Transcript {
  readonly file: string;
  readonly changed: number;
}

const usageCache = new Map<string, { readonly changed: number; readonly at: number; readonly usage: Usage | null }>();

// A transcript that keeps changing is summed again at most this often.
const USAGE_EVERY = 10_000;

/**
 * Token totals for transcripts: [{ file, changed }] -> Map(file -> usage total).
 * Each file is read again only once it changed (and not more than every 10 s).
 */
export async function usageOf(list: readonly Transcript[]): Promise<Map<string, Usage | null>> {
  const now = Date.now();

  const stale = list.filter(({ file, changed }) => {
    const c = usageCache.get(file);

    return !c || (c.changed !== changed && now - c.at > USAGE_EVERY);
  });

  if (stale.length) {
    const r = await exec("sh", ["-c", USAGE, "sh", ...stale.map((x) => x.file)]).catch(() => null);
    const fresh = new Map(stale.map((x) => [x.file, emptyUsage()]));

    for (const line of (r?.stdout ?? "").split("\n")) {
      const [file = "", model = "", ...n] = line.split("\t");
      const u = fresh.get(file);

      if (!u || n.length < 5) continue;

      const [input = 0, output = 0, cache5m = 0, cache1h = 0, cacheRead = 0] = n.map(Number);
      const one = { input, output, cache5m, cache1h, cacheRead };
      const dollars = model === "<synthetic>" ? 0 : cost(model, one);

      addUsage(u, { ...one, tokens: input + output + cache5m + cache1h + cacheRead, cost: dollars ?? 0, unpriced: dollars === null && input + output > 0 });
    }

    for (const x of stale) usageCache.set(x.file, { changed: x.changed, at: now, usage: fresh.get(x.file) ?? null });
  }

  return new Map(list.map(({ file }) => [file, usageCache.get(file)?.usage ?? null]));
}
