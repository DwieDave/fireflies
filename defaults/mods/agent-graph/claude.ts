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
// Nothing here writes; reads go through `sh` (Exec) and the workflow scripts
// through Files. A read that can't run is an ExecError: snapshot() hands it on
// (the pane says it), the smaller reads say what they leave out instead.

import { Array as Arr, Clock, DateTime, Effect, Number as Num, Option, Schema, String as Str } from "effect";
import { Exec, Files, decodeJsonOption } from "@fireflies/kit";
import type { ExecError } from "@fireflies/kit";

// An agent whose transcript changed this recently counts as working even
// between turns (a long tool call writes nothing until it returns).
const QUIET_MS = 90_000;

const SNAPSHOT = String.raw`
sid="$1"
main=$(ls "$HOME"/.claude/projects/*/"$sid".jsonl 2>/dev/null | head -1)
[ -n "$main" ] || exit 3
S=$(printf %s "$main" | sed 's/\.jsonl$//')
# When a file last changed (s): GNU stat first (its -f is file-system status, several lines on
# stdout), then BSD's; 0 when neither can say.
mt() { stat -c %Y "$1" 2>/dev/null || stat -f %m "$1" 2>/dev/null || echo 0; }
echo "@main	$main	$(mt "$main")	$(grep -m 1 -o '"timestamp":"[^"]*"' "$main" | cut -d'"' -f4)"
if [ -d "$S/subagents" ]; then
  cd "$S/subagents"
  find . -name '*.meta.json' | while read -r f; do
    j=$(printf %s "$f" | sed 's/\.meta\.json$/.jsonl/')
    stop=$(tail -c 8000 "$j" 2>/dev/null | grep -o '"stop_reason":"[a-z_]*"' | tail -1 | cut -d'"' -f4)
    t0=$(head -n 1 "$j" 2>/dev/null | grep -o '"timestamp":"[^"]*"' | head -1 | cut -d'"' -f4)
    printf '@agent\t%s\t%s\t%s\t%s\t' "$f" "$(mt "$j")" "$stop" "$t0"
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
export const SessionFileSchema = Schema.Struct({
  sessionId: Schema.String,
  name: Schema.optionalKey(Schema.NullOr(Schema.String)),
  cwd: Schema.optionalKey(Schema.NullOr(Schema.String)),
});

export type SessionFile = typeof SessionFileSchema.Type;

const readSessionFile = decodeJsonOption(SessionFileSchema);

/** The session a Claude Code process runs, from ~/.claude/sessions/<pid>.json; none until
 *  Claude Code has written it (or when it can't be read: the next poll asks again). */
export const sessionOf = (pid: number): Effect.Effect<Option.Option<SessionFile>, never, Exec> =>
  Exec.use((x) => x.run("sh", ["-c", 'cat "$HOME/.claude/sessions/$1.json"', "sh", String(pid)])).pipe(
    Effect.map((r) => (r.code === 0 ? readSessionFile(r.stdout) : Option.none())),
    Effect.catchTag("ExecError", () => Effect.succeed(Option.none<SessionFile>())),
  );

const phaseCache = new Map<string, readonly string[]>(); // script path -> titles

/** A workflow script's meta.phases titles, in order. */
export function phaseTitles(text: string): readonly string[] {
  const block = Option.getOrElse(Option.flatMap(Str.match(/phases\s*:\s*\[([\s\S]*?)\]\s*,?\s*\}/)(text), (m) => Option.fromUndefinedOr(m[1])), () => "");

  return Arr.map(Arr.fromIterable(Str.matchAll(/title\s*:\s*(['"`])((?:\\.|(?!\1).)*)\1/g)(block)), (m) => m[2] ?? "");
}

/** A workflow script's meta.phases titles (cached per script); none when neither script can be read. */
const scriptPhases = (dir: string, name: string, runId: string): Effect.Effect<readonly string[], never, Files> => {
  const paths = [`${dir}/workflows/scripts/${name}-${runId}.js`, `${dir}/workflows/scripts/${name}.js`];

  const one = (path: string): Effect.Effect<Option.Option<readonly string[]>, never, Files> => {
    const cached = phaseCache.get(path);

    if (cached !== undefined) return Effect.succeedSome(cached);

    return Files.use((f) => f.read(path)).pipe(
      // Unreadable: as if it weren't there (the run shows the phases its journal names).
      Effect.catchTag("FileError", () => Effect.succeed(Option.none<string>())),
      Effect.map(Option.map((text) => {
        const titles = phaseTitles(text);

        phaseCache.set(path, titles);

        return titles;
      })),
    );
  };

  return Effect.map(
    Effect.findFirst(paths, (path) => Effect.map(one(path), Option.isSome)),
    (found) => Option.getOrElse(Option.flatMap(found, (path) => Option.fromUndefinedOr(phaseCache.get(path))), (): readonly string[] => []),
  );
};

const parentCache = new Map<string, string>(); // toolUseId -> agentId | "main"

const PARENTS = String.raw`
cd "$1/subagents" || exit 0
shift
for id in "$@"; do
  f=$(grep -l -F "\"id\":\"$id\"" $(find . -name '*.jsonl' ! -name journal.jsonl) 2>/dev/null | head -1)
  printf '%s\t%s\n' "$id" "$f"
done`;

/** PARENTS' answer: each tool call id and the agent whose transcript holds it ("main": none). */
export function parentsOf(stdout: string): readonly (readonly [string, string])[] {
  return Arr.flatMap(Str.split(stdout, "\n"), (line) => {
    const [id = "", file = ""] = Str.split(line, "\t");

    if (Str.isEmpty(id)) return [];

    const agent = Option.flatMap(Str.match(/agent-([a-z0-9]+)\.jsonl$/)(file), (m) => Option.fromUndefinedOr(m[1]));

    const pair: readonly [string, string] = [id, Option.getOrElse(agent, () => "main")];

    return [pair];
  });
}

/** Which transcript holds the tool call that spawned a nested agent. Unreadable: they stay
 *  under the session this time, and the next poll asks again. */
const findParents = (dir: string, nested: readonly Agent[]): Effect.Effect<void, never, Exec> => {
  const ask = Arr.flatMap(nested, (a) => (a.toolUseId !== null && !parentCache.has(a.toolUseId) ? [a.toolUseId] : []));

  if (!Arr.isArrayNonEmpty(ask)) return Effect.void;

  return Exec.use((x) => x.run("sh", ["-c", PARENTS, "sh", dir, ...ask])).pipe(
    Effect.map((r) => {
      for (const [id, parent] of parentsOf(r.stdout)) parentCache.set(id, parent);
    }),
    Effect.catchTag("ExecError", () => Effect.void),
  );
};

/** A subagent's status: working, quiet with a tool call open, done, or stopped with its run. */
export const AgentStatusSchema = Schema.Literals(["working", "idle", "done", "stopped"]);

export type AgentStatus = typeof AgentStatusSchema.Type;

/** One subagent (also as kept in the shared cache, so it has a schema). `parent` is "main",
 *  another agent's id or its workflow run's id. */
export const AgentSchema = Schema.Struct({
  id: Schema.String,
  run: Schema.NullOr(Schema.String),
  file: Schema.String,
  changed: Schema.Finite,
  started: Schema.Finite,
  rel: Schema.String,
  label: Schema.String,
  type: Schema.String,
  depth: Schema.Finite,
  toolUseId: Schema.NullOr(Schema.String),
  phase: Schema.NullOr(Schema.String),
  model: Schema.NullOr(Schema.String),
  background: Schema.Boolean,
  status: AgentStatusSchema,
  parent: Schema.String,
});

export type Agent = typeof AgentSchema.Type;

/** A workflow run: its status is "running" until its record says how it ended
 *  ("completed", "failed", "killed" …). */
export const RunSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  summary: Schema.String,
  phases: Schema.Array(Schema.String),
  agents: Schema.Array(Schema.String),
  status: Schema.String,
  started: Schema.Finite,
  ended: Schema.NullOr(Schema.Finite),
});

export type Run = typeof RunSchema.Type;

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

const optionalText = Schema.optionalKey(Schema.NullOr(Schema.String));

/** An agent's .meta.json, the fields read here. */
const AgentMetaSchema = Schema.Struct({
  description: optionalText,
  agentType: optionalText,
  spawnDepth: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
  toolUseId: optionalText,
  workflowPhase: optionalText,
  pickedEffortModel: optionalText,
  "requestShape": optionalText,
});

type AgentMeta = typeof AgentMetaSchema.Type;

const readMeta = decodeJsonOption(AgentMetaSchema);

/** A workflow journal's line, the fields read here. */
const JournalLineSchema = Schema.Struct({
  type: Schema.optionalKey(Schema.String),
  agentId: Schema.optionalKey(Schema.String),
  label: optionalText,
  phase: optionalText,
});

type JournalLine = typeof JournalLineSchema.Type & { readonly run: string };

const readJournal = decodeJsonOption(JournalLineSchema);

/** A run as the transcript or a journal first names it. */
const newRun = (id: string, name: string, summary: string): Draft<Run> => ({ id, name, summary, phases: [], agents: [], status: "running", started: 0, ended: null });

/** An ISO time (a transcript's "timestamp") in ms; none when it isn't one. */
const isoMs = (text: string): Option.Option<number> => Option.map(DateTime.make(text), DateTime.toEpochMillis);

/** A non-empty text, else none ("" and null alike, as `||` took them). */
const filled = (text: string | null | undefined): Option.Option<string> => Option.filter(Option.fromNullishOr(text), Str.isNonEmpty);

/** The first capture of `re` in `text`, if it matches. */
const capture = (re: RegExp, text: string): Option.Option<string> => Option.flatMap(Str.match(re)(text), (m) => Option.fromUndefinedOr(m[1]));

/** An `@agent` record of the snapshot script: the subagent its meta file
 *  describes (half-written, no meta yet: its id and times only), or none when
 *  the path names none. */
function agentOf(f: readonly string[], now: number): Option.Option<Draft<Agent>> {
  const [rel = "", mtime = "", stop = "", t0 = "", json = ""] = f;
  // Half-written: no meta yet.
  const meta: AgentMeta = Option.getOrElse(readMeta(json), () => ({}));

  return Option.map(capture(/agent-([a-z0-9]+)\.meta\.json$/, rel), (id): Draft<Agent> => {
    const changed = Num.parse(mtime).pipe(Option.getOrElse(() => 0)) * 1000;

    return {
      id, run: Option.getOrNull(capture(/workflows\/(wf_[^/]+)\//, rel)), file: "", changed,
      // When it started: its transcript's first line (else when it last wrote).
      started: Option.getOrElse(Option.filter(isoMs(t0), (ms) => ms !== 0), () => changed),
      rel: Str.replace(/^\.\//, "")(Str.replace(/\.meta\.json$/, ".jsonl")(rel)),
      label: Option.getOrElse(Option.orElse(filled(meta.description), () => filled(meta.agentType)), () => id),
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
  });
}

/** What the snapshot script printed, read into its parts (before the phases and parents are known). */
export interface Reading {
  readonly main: string;
  readonly mainChanged: number;
  readonly mainStarted: number;
  readonly agents: Map<string, Draft<Agent>>;
  readonly runs: Map<string, Draft<Run>>;
  readonly ended: ReadonlyMap<string, string>;
  readonly results: ReadonlySet<string>;
  readonly journal: readonly JournalLine[];
}

/** The snapshot script's lines (SNAPSHOT), at `now`; none without a main transcript. */
export function readSnapshot(stdout: string, now: number): Option.Option<Reading> {
  let main: string | null = null, mainChanged = 0, mainStarted = 0;
  const agents = new Map<string, Draft<Agent>>(), runs = new Map<string, Draft<Run>>(), ended = new Map<string, string>(), results = new Set<string>();
  const journal: JournalLine[] = [];

  for (const line of Str.split(stdout, "\n")) {
    const [tag = "", ...f] = Str.split(line, "\t");

    if (tag === "@main") {
      main = f[0] ?? null;
      mainChanged = Option.getOrElse(Num.parse(f[1] ?? ""), () => 0) * 1000;
      mainStarted = Option.getOrElse(Option.filter(isoMs(f[2] ?? ""), (ms) => ms !== 0), () => mainChanged);
    } else if (tag === "@agent") {
      Option.map(agentOf(f, now), (a) => agents.set(a.id, a));
    } else if (tag === "@journal") {
      // A partial line is left out.
      Option.map(readJournal(Arr.join(Arr.drop(f, 1), "\t")), (e) => journal.push({ ...e, run: f[0] ?? "" }));
    } else if (tag === "@result") {
      const id = Str.split(f[1] ?? "", '"')[3];

      if (id !== undefined) results.add(id);
    } else if (tag === "@ended") ended.set(f[0] ?? "", Option.getOrElse(filled(f[1]), () => "completed"));
    else if (tag === "@run") {
      Option.map(Str.match(/"workflowName":"([^"]*)","runId":"([^"]*)","summary":"((?:\\.|[^"])*)"/)(line), (m) => {
        const [, name, id, summary] = m;

        if (name !== undefined && id !== undefined && summary !== undefined) runs.set(id, newRun(id, name, Str.replaceAll('\\"', '"')(summary)));
      });
    }
  }

  return main === null ? Option.none() : Option.some({ main, mainChanged, mainStarted, agents, runs, ended, results, journal });
}

/** The journal's agents into their runs (launched ones from the transcript, plus any journal seen). */
function joinJournal(r: Reading): void {
  for (const e of r.journal) {
    const run = r.runs.get(e.run) ?? newRun(e.run, e.run, "");

    r.runs.set(e.run, run);

    const id = e.agentId ?? "";

    if (e.type === "started" && Str.isNonEmpty(id)) {
      if (!run.agents.includes(id)) run.agents = [...run.agents, id];

      const phase = e.phase ?? "";

      if (Str.isNonEmpty(phase) && !run.phases.includes(phase)) run.phases = [...run.phases, phase];

      const a = r.agents.get(id);

      if (a !== undefined) {
        a.label = Option.getOrElse(filled(e.label), () => a.label);
        a.phase = e.phase ?? a.phase;
      }
    }
  }
}

/** A run's status, start, plan and its agents' statuses, once its script's plan is read. */
function settleRun(r: Reading, run: Draft<Run>, plan: readonly string[], now: number): void {
  run.status = r.ended.get(run.id) ?? "running";
  // A run starts with its first agent (a run with none yet: now, so it sorts last).
  run.started = Math.min(...Arr.map(run.agents, (id) => r.agents.get(id)?.started ?? Infinity));

  if (!Number.isFinite(run.started)) run.started = now;

  // The script's plan first (phases not reached yet show too), then any the journal adds.
  run.phases = [...plan, ...Arr.filter(run.phases, (p) => !plan.includes(p))];

  for (const id of run.agents) {
    const a = r.agents.get(id);

    if (a === undefined) continue;

    a.parent = run.id;
    // Started, no result yet, run going: working, even if its transcript is
    // quiet (a long tool call writes nothing until it returns).
    a.status = r.results.has(id) ? "done" : run.status === "running" ? "working" : "stopped";
  }
}

/** The finished snapshot: plain subagents under their parents, each ended run's end. */
function settle(r: Reading, dir: string): Snapshot {
  for (const a of r.agents.values()) {
    if (a.run !== null) continue;

    const p = a.depth > 1 && a.toolUseId !== null ? parentCache.get(a.toolUseId) ?? "main" : "main";

    a.parent = p !== "main" && r.agents.has(p) ? p : "main";
  }

  for (const run of r.runs.values()) {
    // A run that's over ended when its last agent last wrote.
    run.ended = run.status === "running" ? null : Math.max(run.started, ...Arr.map(run.agents, (id) => r.agents.get(id)?.changed ?? 0));
  }

  return { dir, main: r.main, mainChanged: r.mainChanged, mainStarted: r.mainStarted, agents: r.agents, runs: Arr.fromIterable(r.runs.values()) };
}

/**
 * Everything the graph shows, for one session id: the main transcript, each
 * subagent (its parent "main", an agentId or a run id) and each workflow run.
 * None while the session has no transcript.
 */
export const snapshot = Effect.fnUntraced(function* (sessionId: string): Effect.fn.Return<Option.Option<Snapshot>, ExecError, Exec | Files> {
  const r = yield* Exec.use((x) => x.run("sh", ["-c", SNAPSHOT, "sh", sessionId]));

  if (r.code !== 0) return Option.none();

  const now = yield* Clock.currentTimeMillis;
  const found = readSnapshot(r.stdout, now);

  if (Option.isNone(found)) return Option.none();

  const reading = found.value;
  const dir = Str.replace(/\.jsonl$/, "")(reading.main);

  for (const a of reading.agents.values()) a.file = `${dir}/subagents/${a.rel}`;

  joinJournal(reading);

  for (const run of reading.runs.values()) {
    const plan = yield* scriptPhases(dir, run.name, run.id);

    settleRun(reading, run, plan, now);
  }

  // Plain subagents: the main session's, or (deeper) another agent's.
  yield* findParents(dir, Arr.filter(Arr.fromIterable(reading.agents.values()), (a) => a.run === null && a.depth > 1));

  return Option.some(settle(reading, dir));
});

/** A snapshot as JSON-safe values (shared() keeps plain data): the agents as [id, agent] pairs. */
export const PackedSnapshotSchema = Schema.Struct({
  dir: Schema.String,
  main: Schema.String,
  mainChanged: Schema.Finite,
  mainStarted: Schema.Finite,
  agents: Schema.Array(Schema.Tuple([Schema.String, AgentSchema])),
  runs: Schema.Array(RunSchema),
});

export type PackedSnapshot = typeof PackedSnapshotSchema.Type;

export const pack = (d: Snapshot): PackedSnapshot => ({ ...d, agents: Arr.fromIterable(d.agents.entries()) });

export const unpack = (d: PackedSnapshot): Snapshot => ({ ...d, agents: new Map(d.agents) });

// ---- a transcript, line by line

/** One step of the feed. */
export type FeedItem =
  | { readonly kind: "text" | "prompt"; readonly text: string }
  | { readonly kind: "tool"; readonly name: string; readonly text: string }
  | { readonly kind: "result"; readonly text: string; readonly error: boolean };

/** A transcript line, the fields read here: who wrote it and its message. */
const TranscriptLineSchema = Schema.Struct({
  type: Schema.optionalKey(Schema.String),
  message: Schema.optionalKey(Schema.Struct({
    content: Schema.optionalKey(Schema.Union([Schema.String, Schema.Array(Schema.Unknown)])),
    model: optionalText,
  })),
});

type TranscriptLine = typeof TranscriptLineSchema.Type;

const readLine = decodeJsonOption(TranscriptLineSchema);

/** The parts of a message's content shown (others, like thinking, are left out). */
const isTextBlock = Schema.is(Schema.Struct({ type: Schema.Literal("text"), text: Schema.String }));

const toolText = Schema.optionalKey(Schema.String);

/** A tool call's input: the field that says what it does, whichever the tool has. */
const ToolInputSchema = Schema.Struct({
  description: toolText, command: toolText, file_path: toolText, pattern: toolText, prompt: toolText, url: toolText, query: toolText,
});

const isToolUse = Schema.is(Schema.Struct({ type: Schema.Literal("tool_use"), name: Schema.String, input: Schema.optionalKey(ToolInputSchema) }));

const isToolResult = Schema.is(Schema.Struct({
  type: Schema.Literal("tool_result"),
  content: Schema.optionalKey(Schema.Union([Schema.String, Schema.Null, Schema.Array(Schema.Struct({ text: Schema.optionalKey(Schema.String) }))])),
  is_error: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
}));

/** Its first line. */
const firstLine = (text: string): string => Str.split(text, "\n")[0] ?? "";

/** One transcript line, short; none when it isn't a message with content. */
function feedItem(entry: TranscriptLine): Option.Option<readonly FeedItem[]> {
  const content = entry.message?.content;

  if (entry.type === "user" && Str.isString(content)) return Option.some([{ kind: "prompt", text: content }]);

  if (content === undefined || Str.isString(content)) return Option.none();

  return Option.some(Arr.flatMap(content, (c): readonly FeedItem[] => {
    if (isTextBlock(c)) {
      const text = Str.trim(c.text);

      return Str.isNonEmpty(text) ? [{ kind: entry.type === "user" ? "prompt" : "text", text }] : [];
    }

    if (isToolUse(c)) {
      const i = c.input ?? {};
      const what = Arr.findFirst([i.description, i.command, i.file_path, i.pattern, i.prompt, i.url, i.query], (x) => x !== undefined && Str.isNonEmpty(x));

      return [{ kind: "tool", name: c.name, text: firstLine(Option.getOrElse(Option.flatMap(what, Option.fromUndefinedOr), () => "")) }];
    }

    if (isToolResult(c)) {
      const body = c.content ?? "";
      const text = Str.isString(body) ? body : Arr.join(Arr.map(body, (x) => x.text ?? ""), " ");

      return [{ kind: "result", text: firstLine(Str.trim(text)), error: c.is_error === true }];
    }

    return [];
  }));
}

/** An agent's task (its first prompt), its latest steps and its model. */
export interface Feed {
  readonly task: string;
  readonly items: readonly FeedItem[];
  readonly model: string | null;
}

/** What FEED printed: the first line, "@@tail", the last lines. A partial line is left out. */
export function readFeed(stdout: string): Feed {
  const [head = "", tail = ""] = Str.split(stdout, "\n@@tail\n");
  // Not a message line: no task.
  const task = Option.flatMap(Option.flatMap(readLine(head), feedItem), (got) => Arr.findFirst(got, (x) => x.kind === "prompt"));
  const items: FeedItem[] = [];
  let model: string | null = null;

  for (const line of Str.split(tail, "\n")) {
    if (Str.isEmpty(Str.trim(line))) continue;

    Option.map(readLine(line), (e) => {
      const m = e.message?.model ?? null;

      if (m !== null && Str.isNonEmpty(m)) model = m;

      Option.map(feedItem(e), (got) => items.push(...got));
    });
  }

  return { task: Option.getOrElse(Option.map(task, (x) => x.text), () => ""), items, model };
}

const FEED = 'head -n 1 "$1"; echo "@@tail"; tail -n "$2" "$1"';

/** The agent's task (its first prompt) and its latest steps, newest last; none when its
 *  transcript can't be read (gone, or no shell: the next poll asks again). */
export const feed = (file: string, lines = 80): Effect.Effect<Option.Option<Feed>, never, Exec> =>
  Exec.use((x) => x.run("sh", ["-c", FEED, "sh", file, String(lines)])).pipe(
    Effect.map((r) => (r.code === 0 ? Option.some(readFeed(r.stdout)) : Option.none())),
    Effect.catchTag("ExecError", () => Effect.succeed(Option.none<Feed>())),
  );

// ---- time and tokens

/** How long something ran at `now`: start to now while it works, else to its last write (ms). */
export function ranFor(a: Agent, now: number): number {
  if (a.started === 0) return 0;

  const end = a.status === "working" ? now : a.changed;

  return Math.max(0, end - a.started);
}

/** "42s", "4m 12s", "1h 05m". */
export function span(ms: number): string {
  const s = Math.round(ms / 1000);

  if (s < 60) return `${s}s`;

  const m = Math.floor(s / 60);

  if (m < 60) return `${m}m ${Str.padStart(2, "0")(String(s % 60))}s`;

  return `${Math.floor(m / 60)}h ${Str.padStart(2, "0")(String(m % 60))}m`;
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

/** Dollars for one model's token totals; none for a model with no price here. */
export function cost(model: string | null, u: Tokens): Option.Option<number> {
  return Option.map(Arr.findFirst(PRICES, ([re]) => re.test(model ?? "")), ([, i, o, r]) =>
    (u.input * i + u.output * o + u.cache5m * i * 1.25 + u.cache1h * i * 2 + u.cacheRead * r) / 1e6);
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
  if (b === null || b === undefined) return a;

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

/** USAGE's lines into a usage total per file of `files` (each starts at nothing). */
export function readUsage(stdout: string, files: readonly string[]): ReadonlyMap<string, Usage> {
  const fresh = new Map(Arr.map(files, (file) => [file, emptyUsage()] as const));

  for (const line of Str.split(stdout, "\n")) {
    const [file = "", model = "", ...n] = Str.split(line, "\t");
    const u = fresh.get(file);

    if (u === undefined || n.length < 5) continue;

    const [input = 0, output = 0, cache5m = 0, cache1h = 0, cacheRead = 0] = Arr.map(n, (x) => Option.getOrElse(Num.parse(x), () => 0));
    const one = { input, output, cache5m, cache1h, cacheRead };
    const dollars = model === "<synthetic>" ? Option.some(0) : cost(model, one);

    addUsage(u, { ...one, tokens: input + output + cache5m + cache1h + cacheRead, cost: Option.getOrElse(dollars, () => 0), unpriced: Option.isNone(dollars) && input + output > 0 });
  }

  return fresh;
}

const usageCache = new Map<string, { readonly changed: number; readonly at: number; readonly usage: Usage | null }>();

// A transcript that keeps changing is summed again at most this often.
const USAGE_EVERY = 10_000;

/**
 * Token totals for transcripts: [{ file, changed }] -> Map(file -> usage total).
 * Each file is read again only once it changed (and not more than every 10 s).
 * A read that can't run counts nothing this time and is asked again in 10 s.
 */
export const usageOf = Effect.fnUntraced(function* (list: readonly Transcript[]): Effect.fn.Return<ReadonlyMap<string, Usage | null>, never, Exec> {
  const now = yield* Clock.currentTimeMillis;

  const stale = Arr.filter(list, ({ file, changed }) => {
    const c = usageCache.get(file);

    return c === undefined || (c.changed !== changed && now - c.at > USAGE_EVERY);
  });

  if (Arr.isArrayNonEmpty(stale)) {
    const files = Arr.map(stale, (x) => x.file);

    const stdout = yield* Exec.use((x) => x.run("sh", ["-c", USAGE, "sh", ...files])).pipe(
      Effect.map((r) => r.stdout),
      Effect.catchTag("ExecError", () => Effect.succeed("")),
    );

    const fresh = readUsage(stdout, files);

    for (const x of stale) usageCache.set(x.file, { changed: x.changed, at: now, usage: fresh.get(x.file) ?? null });
  }

  return new Map(Arr.map(list, ({ file }) => [file, usageCache.get(file)?.usage ?? null] as const));
});
