// The subscription usage limits of each coding agent's account, as its own
// usage view shows them: a short window (5 hours), the weekly one, and any
// weekly limit scoped to one model. One provider is picked at a time (the
// sidebar's usage section and the usage pane switch it together).
//
//   claude  Claude Code's /usage: its endpoint, with Claude Code's own login
//           (the macOS keychain's "Claude Code-credentials", or
//           ~/.claude/.credentials.json where there is no keychain)
//   codex   Codex's /status: the ChatGPT backend's usage endpoint, with
//           Codex's ChatGPT login (~/.codex/auth.json, or $CODEX_HOME)
//
// Read-only: a login is never refreshed here (each agent renews its own when
// it runs; refreshing from two places would race its refresh token). The
// token stays inside the shell: the request goes through curl
// (@fireflies/kit `curlClient`), its Authorization header read from the
// login by a shell fragment and handed to curl on stdin, so it is never in a
// process's arguments and never in this mod's memory.
//
// Off in a scratch app (HERDR_APP_HOME set to another home than the default
// ~/.config/herdr-app): its login is still this machine's, so every scratch
// app would ask the same account's endpoint on top of the real app's.
// HERDR_APP_USAGE=1 turns it on there. Checked before the login is read: no
// request leaves a scratch app, and a check that can't run counts as one
// (nothing is asked). It also stays out of the machine's record below.
//
// Two mods show it (Nocturne's sidebar and the usage pane), and a
// mod can't import another's files: this file is in both, byte for byte.
// Edit one, copy it over the other (scripts/usage-limits.test.ts
// checks they match).
//
// One reading per machine, not per copy, window or app: every copy draws the
// shared() answer, and before asking reads a small file all apps on this
// machine share (~/.cache/herdr-app/usage-<provider>.json: the last good
// answer, the last problem, when it was last tried, the back-off). A lock
// beside it (a directory, made atomically) lets one copy of one app ask at a
// time; the others adopt what it wrote.
//
// How often (PACE): every 3 min while a usage pane is shown in the active
// window, every 10 min while an agent works or the window is active, every
// 30 min otherwise. Opening a pane reads at once when the last try is over a
// minute old; refresh (r) at most every 10 s. A failed request (429, another
// HTTP error, no answer) backs off: Retry-After when the endpoint gives one
// (seconds or a date), else 5, 10, 20, … min up to 2 h; refresh waits it out
// too. Inside one reading, a request that failed in transport or answered
// 5xx is tried again twice (1 s, then 2 s, jittered); a 429 is not: the
// machine's back-off above is its answer. The last good answer stays on show
// meanwhile, with its age.
//
// Everything here is an Effect over @fireflies/kit's services (Exec, Shared,
// Workspace, the clock) and this file's `UsageEndpoint`: the app provides
// them live, a test provides fakes (no module mocked, no real login, no
// real request).

import { Array as Arr, Clock, Context, Duration, Effect, Layer, Match, Option, Predicate, Schema, String as Str } from "effect";
import { HttpClientRequest, HttpClientResponse } from "effect/http";
import type { HttpClient, HttpClientError } from "effect/http";
import { Exec, Shared, Workspace, curlClient, decodeJson, encodeJson, lastLine, policy, retryAfter, sharedKey, sharedOr } from "@fireflies/kit";
import type { ExecError, SharedKey } from "@fireflies/kit";

export type ProviderId = "claude" | "codex";

export interface Provider {
  readonly id: ProviderId;
  readonly name: string;
  readonly agent: string;
  readonly logo: string;
}

/** The providers, in switch order. `agent`: the program whose login it reads; `logo`: Nocturne's art/logo-<logo>.svg. */
export const PROVIDERS: readonly [Provider, ...Provider[]] = [
  { id: "claude", name: "Claude", agent: "Claude Code", logo: "claude" },
  { id: "codex", name: "Codex", agent: "Codex", logo: "codex" },
];

const ProviderIdSchema = Schema.Literals(["claude", "codex"]);

const Millis = Schema.Finite;

/** One limit window: `used` 0–100, `resets` and `length` in ms. */
const UsageWindowSchema = Schema.Struct({ used: Millis, resets: Schema.NullOr(Millis), length: Schema.NullOr(Millis) });

export type UsageWindow = typeof UsageWindowSchema.Type;

const ScopedWindowSchema = Schema.Struct({ name: Schema.String, used: Millis, resets: Schema.NullOr(Millis), length: Schema.NullOr(Millis) });

export type ScopedWindow = typeof ScopedWindowSchema.Type;

/** A good answer, as the views draw it. */
const UsageSchema = Schema.Struct({
  state: Schema.Literal("ok"),
  session: Schema.NullOr(UsageWindowSchema),
  week: Schema.NullOr(UsageWindowSchema),
  scoped: Schema.Array(ScopedWindowSchema),
  plan: Schema.NullOr(Schema.String),
  at: Millis,
});

export type Usage = typeof UsageSchema.Type;

/** When a problem came (`at`), and until when its back-off lasts. */
const when = { at: Millis, until: Schema.optionalKey(Millis) };

/** A read that gave no numbers, decided before any request (nothing reached the endpoint). */
const LocalFields = { state: Schema.Literals(["off", "nologin", "expired"]), local: Schema.Literal(true) };
const RefusedFields = { state: Schema.Literal("expired") };
const BusyFields = { state: Schema.Literal("busy"), retry: Millis };
const FailedFields = { state: Schema.Literal("error"), message: Schema.String };

const ProblemSchema = Schema.Union([Schema.Struct(LocalFields), Schema.Struct(RefusedFields), Schema.Struct(BusyFields), Schema.Struct(FailedFields)]);

/** A read that gave no numbers. `local`: decided before any request. `busy`'s `retry`: the wait the endpoint asked for, s (0: none). */
export type Problem = typeof ProblemSchema.Type;

/** What one read resolves to (see readUsage). */
export type Reading = Usage | Problem;

/** A problem as kept (shared() and the machine's record): the problem and when. */
const NoteSchema = Schema.Union([
  Schema.Struct({ ...LocalFields, ...when }),
  Schema.Struct({ ...RefusedFields, ...when }),
  Schema.Struct({ ...BusyFields, ...when }),
  Schema.Struct({ ...FailedFields, ...when }),
]);

export type Note = typeof NoteSchema.Type;

/** The machine's record (see the top). */
const MachineRecordSchema = Schema.Struct({
  answer: Schema.optionalKey(Schema.NullOr(UsageSchema)),
  note: Schema.optionalKey(Schema.NullOr(NoteSchema)),
  tried: Schema.optionalKey(Millis),
  until: Schema.optionalKey(Millis),
  fails: Schema.optionalKey(Millis),
});

export type MachineRecord = typeof MachineRecordSchema.Type;

/** This app's copy of the machine's record: when it was last tried, the back-off. */
const PaceSchema = Schema.Struct({ tried: Schema.optionalKey(Millis), until: Schema.optionalKey(Millis), fails: Schema.optionalKey(Millis) });

type Pace = typeof PaceSchema.Type;

/** Why a refresh asks: a timer's tick, a pane opening, refresh (r). */
export type Why = "tick" | "open" | "force";

/** The picked provider's id. */
const PICK = sharedKey("usage.provider", ProviderIdSchema);

/** The last good answer ({ state: "ok", session, week, scoped, plan, at }). Claude's keys keep their old names. */
export const CACHE = "usage.last";

/** The latest read's problem ({ state, message?, at, until? }), null after a good one. */
export const NOTE = "usage.note";

/** When some copy in this app started asking (ms), so two copies don't ask at once. */
const ASKING = "usage.asking";

/** This app's copy of the machine's record: { tried, until, fails } (see the top). */
const STATE = "usage.state";

const key = (base: string, p: ProviderId) => (p === "claude" ? base : `${base}.${p}`);

/** The keys of provider `p`, made once each. */
interface Keys {
  readonly cache: SharedKey<Usage | null, typeof UsageSchema.Encoded | null>;
  readonly note: SharedKey<Note | null, typeof NoteSchema.Encoded | null>;
  readonly asking: SharedKey<number>;
  readonly state: SharedKey<Pace | null, typeof PaceSchema.Encoded | null>;
}

const keysOf = (p: ProviderId): Keys => ({
  cache: sharedKey(key(CACHE, p), Schema.NullOr(UsageSchema)),
  note: sharedKey(key(NOTE, p), Schema.NullOr(NoteSchema)),
  asking: sharedKey(key(ASKING, p), Millis),
  state: sharedKey(key(STATE, p), Schema.NullOr(PaceSchema)),
});

const KEYS = new Map<ProviderId, Keys>(Arr.map(PROVIDERS, (p) => [p.id, keysOf(p.id)]));

const keys = (p: ProviderId): Keys => KEYS.get(p) ?? keysOf(p);

/** How often to ask (ms): someone looks at a usage pane; an agent works or the window is active; nothing happens. */
export const PACE = { looking: 3 * 60_000, active: 10 * 60_000, idle: 30 * 60_000 };

/** Opening a pane asks when the last try is older than this; refresh, when older than FORCE. */
export const OPEN = 60_000, FORCE = 10_000;

/** The back-off after a failed request: BACKOFF, doubled each time, up to CAP. */
export const BACKOFF = 5 * 60_000, CAP = 2 * 3600_000;

/** A lock older than this was left by an app that stopped mid-read. */
const STALE_LOCK_MIN = 2;

/** The picked provider ({ id, name, agent, logo }). */
export const provider: Effect.Effect<Provider, never, Shared> = Effect.map(sharedOr(PICK, PROVIDERS[0].id), (id) => Option.getOrElse(Arr.findFirst(PROVIDERS, (p) => p.id === id), () => PROVIDERS[0]));

/** Picks a provider by id; every copy redraws. */
export const pickProvider = (id: ProviderId) => Shared.use((s) => s.set(PICK, id));

const picked = (p: ProviderId | undefined) => (p === undefined ? Effect.map(provider, (x) => x.id) : Effect.succeed(p));

/** The problem kept for provider `p` (the picked one by default). */
export const usageNote = (p?: ProviderId): Effect.Effect<Note | null, never, Shared> =>
  Effect.flatMap(picked(p), (id) => sharedOr(keys(id).note, null));

/** The last good answer; none while usage is off (a scratch app keeps no stale numbers on show). */
export const lastUsage = (p?: ProviderId): Effect.Effect<Usage | null, never, Shared> => Effect.gen(function* () {
  const id = yield* picked(p);
  const note = yield* usageNote(id);

  return note?.state === "off" ? null : yield* sharedOr(keys(id).cache, null);
});

/** Whether a copy of this app is asking now. */
export const asking = (p?: ProviderId): Effect.Effect<boolean, never, Shared> => Effect.gen(function* () {
  const id = yield* picked(p);
  const since = yield* sharedOr(keys(id).asking, 0);

  return (yield* Clock.currentTimeMillis) - since < 30_000;
});

/** When the next request may go at the earliest (ms), during a back-off; else 0. */
export const backoffUntil = (p?: ProviderId): Effect.Effect<number, never, Shared> =>
  Effect.flatMap(picked(p), (id) => Effect.map(sharedOr(keys(id).state, null), (s) => s?.until ?? 0));

/** A terminal as the pace reads it (terminals() is herdr-core's listing): its status word, or its agent's report. */
const TerminalStatus = Schema.Struct({
  status: Schema.optionalKey(Schema.NullOr(Schema.String)),
  report: Schema.optionalKey(Schema.NullOr(Schema.Struct({ state: Schema.optionalKey(Schema.String) }))),
});

const terminalState = Schema.decodeUnknownOption(TerminalStatus);

/** How often to ask from here now (one of PACE). */
export const pace: Effect.Effect<number, never, Workspace> = Effect.gen(function* () {
  const w = yield* Workspace;
  const active = (yield* w.window).active;
  const spaces = yield* w.spaces;
  const tab = Option.getOrUndefined(Option.map(Option.flatMap(Arr.findFirst(spaces, (s) => s.active), (s) => Arr.findFirst(s.tabs, (t) => t.active)), (t) => t.id));
  const panes = yield* w.panes;

  if (active && Arr.some(panes, (p) => p.mod === "usage" && p.tab === tab && p.parked !== true)) return PACE.looking;

  const terminals = yield* w.terminals;
  const working = Arr.some(terminals, (t) => Option.exists(terminalState(t), (s) => (s.report?.state ?? s.status) === "working"));

  return active || working ? PACE.active : PACE.idle;
}).pipe(Effect.catchDefect(() => Effect.succeed(PACE.idle))); // not drawing yet

/** How long to wait after the `fails`th failed request in a row (Retry-After in s, when above 0, wins). */
export const backoff = (fails: number, retry = 0) => (retry > 0 ? retry * 1000 : Math.min(CAP, BACKOFF * 2 ** Math.max(0, fails - 1)));

/**
 * Whether to ask now, given the machine's record ({ tried, until, fails })
 * and why: "tick" (every PACE), "open" (a pane opened), "force" (refresh).
 * Nothing goes during a back-off, whatever the reason.
 */
export function due(rec: { readonly tried?: number; readonly until?: number } | null, why: Why, now: number, every: number): boolean {
  if (now < (rec?.until ?? 0)) return false;

  const since = now - (rec?.tried ?? 0);

  const wait = Match.value(why).pipe(
    Match.when("force", () => FORCE),
    Match.when("open", () => Math.min(OPEN, every)),
    Match.when("tick", () => every),
    Match.exhaustive,
  );

  return since >= wait;
}

/** The record after read `r` at `now` (r: readUsage's answer). */
export function after(rec: MachineRecord | null, r: Reading, now: number): MachineRecord {
  if (r.state === "ok") return { answer: r, note: null, tried: now, until: 0, fails: 0 };

  const answer = rec?.answer ?? null;

  // A login that's missing, out of date or off never reached the endpoint: ask again at the usual pace.
  if ("local" in r) return { answer, note: { ...r, at: now }, tried: now, until: 0, fails: 0 };

  const fails = (rec?.fails ?? 0) + 1;
  const until = now + backoff(fails, r.state === "busy" ? r.retry : 0);

  return { answer, note: { ...r, at: now, until }, tried: now, until, fails };
}

// ---- the machine's record: op read | lock | write <json> | unlock, for provider $2

const FILE = String.raw`
dir=$HERDR_USAGE_DIR
if [ -z "$dir" ]; then dir=$XDG_CACHE_HOME; [ -n "$dir" ] || dir=$HOME/.cache; dir=$dir/herdr-app; fi
mkdir -p "$dir" 2>/dev/null
f=$dir/usage-$2.json
case $1 in
  read) cat "$f" 2>/dev/null; exit 0 ;;
  lock)
    mkdir "$f.lock" 2>/dev/null && exit 0
    if [ -n "$(find "$f.lock" -maxdepth 0 -mmin +$3 2>/dev/null)" ]; then rmdir "$f.lock" 2>/dev/null; mkdir "$f.lock" 2>/dev/null && exit 0; fi
    exit 1 ;;
  write) t=$f.$$; printf %s "$3" > "$t" && mv -f "$t" "$f" ;;
  unlock) rmdir "$f.lock" 2>/dev/null; exit 0 ;;
esac
`;

const writeRecord = encodeJson(MachineRecordSchema, "the machine's usage record");

const readRecordText = decodeJson(MachineRecordSchema, "the machine's usage record");

/** One step on the machine's record file: whether it went (a lock taken by another app is false). */
const fileStep = (op: "lock" | "write" | "unlock", p: ProviderId, arg: string | number = ""): Effect.Effect<boolean, ExecError, Exec> =>
  Effect.map(Exec.use((e) => e.run("sh", ["-c", FILE, "sh", op, p, String(arg)])), (r) => r.code === 0);

/** The machine's record, or null (none yet, or not one: a file in another shape is written over). */
const readRecord = (p: ProviderId): Effect.Effect<MachineRecord | null, ExecError, Exec> => Effect.gen(function* () {
  const r = yield* Exec.use((e) => e.run("sh", ["-c", FILE, "sh", "read", p, ""]));
  const rec = Str.isEmpty(Str.trim(r.stdout)) ? null : yield* readRecordText(r.stdout).pipe(Effect.orElseSucceed(() => null));

  // An "off" in the file is a scratch app's (one from before they kept out of
  // it), not this machine's reading: dropped, and the last try is the last
  // answer's, so the real app asks at its own pace again.
  return rec?.note?.state === "off" ? { ...rec, note: null, tried: rec.answer?.at ?? 0 } : rec;
});

// Exit 5: a scratch app (see the top), nothing read, nothing asked.
const OFF = String.raw`
def=$XDG_CONFIG_HOME; [ -n "$def" ] || def=$HOME/.config; def=$def/herdr-app
here=$(printf %s "$HERDR_APP_HOME" | sed 's:/*$::')
if [ -n "$here" ] && [ "$here" != "$def" ] && [ "$HERDR_APP_USAGE" != 1 ]; then exit 5; fi
`;

/** Whether this is a scratch app. A check that can't run counts as one: nothing is asked then. */
const scratchApp: Effect.Effect<boolean, never, Exec> = Exec.use((e) => e.run("sh", ["-c", OFF])).pipe(
  Effect.map((r) => r.code === 5),
  Effect.orElseSucceed(() => true),
);

/** Off, in this app only: its note and its pace, nothing in the machine's record. */
const offHere = (p: ProviderId, now: number) => Shared.use((s) => Effect.andThen(
  s.set(keys(p).note, { state: "off", local: true, at: now }),
  s.set(keys(p).state, { tried: now, until: 0, fails: 0 }),
));

/** Shows the machine's record here (every copy of this app redraws). */
const adopt = (p: ProviderId, rec: MachineRecord | null) => Effect.gen(function* () {
  if (rec === null) return;

  const s = yield* Shared;

  if (rec.answer !== undefined && rec.answer !== null) yield* s.set(keys(p).cache, rec.answer);

  yield* s.set(keys(p).note, rec.note ?? null);
  yield* s.set(keys(p).state, { tried: rec.tried ?? 0, until: rec.until ?? 0, fails: rec.fails ?? 0 });
});

/**
 * Reads provider `p` again when it's due (see `due`): "tick" from a timer,
 * "open" when a pane opens, "force" (or true) for refresh. One copy of this
 * app goes at a time, and it asks only if no app on this machine asked
 * lately (the shared file). It never fails: what went wrong is the note.
 */
export const refreshUsage = (asked: Why | boolean | null = "tick", p?: ProviderId) => Effect.gen(function* () {
  const why: Why = asked === true ? "force" : asked === false || asked === null ? "tick" : asked;
  const id = yield* picked(p);
  const now = yield* Clock.currentTimeMillis;
  const every = yield* pace;
  const s = yield* Shared;

  // This app's own copy of the record first: no exec while it isn't due.
  const busy = yield* asking(id);
  const kept = yield* sharedOr(keys(id).state, null);

  if (busy || !due(kept, why, now, every)) return;

  yield* s.set(keys(id).asking, now);
  yield* readWhenDue(id, why, every).pipe(
    // A program that couldn't run (the record's script, its lock) is this reading's problem, shown as one.
    Effect.catchTag("ExecError", (e) => Effect.flatMap(Clock.currentTimeMillis, (at) => s.set(keys(id).note, { state: "error", message: e.message, at }))),
    Effect.ensuring(s.set(keys(id).asking, 0)),
  );
});

/** The machine-wide part of a refresh: the record, the lock, the reading. */
const readWhenDue = (p: ProviderId, why: Why, every: number) => Effect.gen(function* () {
  // A scratch app stays out of the machine's record: it shows none of its
  // numbers and never writes its own "off" there for the real app to adopt.
  const scratch = yield* scratchApp;

  if (scratch) return yield* Effect.flatMap(Clock.currentTimeMillis, (now) => offHere(p, now));

  const rec = yield* readRecord(p);

  yield* adopt(p, rec);

  const now = yield* Clock.currentTimeMillis;

  if (!due(rec, why, now, every)) return;

  const locked = yield* fileStep("lock", p, STALE_LOCK_MIN);

  if (!locked) return; // another app is asking: its answer comes through the file

  yield* Effect.ensuring(readLocked(p, why, every), Effect.ignore(fileStep("unlock", p)));
});

/** Holding the machine's lock: read the record again (another app may have just finished), ask, write, adopt. */
const readLocked = (p: ProviderId, why: Why, every: number) => Effect.gen(function* () {
  const rec = yield* readRecord(p);
  const now = yield* Clock.currentTimeMillis;

  if (!due(rec, why, now, every)) return yield* adopt(p, rec);

  const reading = yield* readUsage(p);
  const then = yield* Clock.currentTimeMillis;
  const next = after(rec, reading, then);
  const text = yield* writeRecord(next).pipe(Effect.orDie); // the record's own schema encodes what `after` made

  yield* fileStep("write", p, text);
  yield* adopt(p, next);
});

const HOUR = 3600_000, DAY = 24 * HOUR;

// ---- Claude

/** The login's state: exit 3 none, 4 expired; else prints `@plan<TAB>subscription<TAB>tier`. Never prints the token. */
const CLAUDE_LOGIN = String.raw`
creds=$(security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null)
[ -n "$creds" ] || creds=$(cat "$HOME/.claude/.credentials.json" 2>/dev/null)
oauth=$(printf %s "$creds" | tr -d '\n' | sed 's/.*"claudeAiOauth"[[:space:]]*:[[:space:]]*{//')
field() { printf %s "$oauth" | grep -o "\"$1\"[[:space:]]*:[[:space:]]*\"*[^\",}]*" | head -1 | sed 's/.*:[[:space:]]*"*//'; }
`;

const CLAUDE_STATE = CLAUDE_LOGIN + String.raw`
[ -n "$(field accessToken)" ] || exit 3
printf '@plan\t%s\t%s\n' "$(field subscriptionType)" "$(field rateLimitTier)"
exp=$(field expiresAt)
if [ -n "$exp" ] && [ "$exp" -lt "$(($(date +%s) * 1000))" ]; then exit 4; fi
`;

/** The request's headers (curlClient `headersFrom`): the token goes to curl's stdin, nowhere else. */
const CLAUDE_HEADERS = CLAUDE_LOGIN + String.raw`
tok=$(field accessToken)
[ -n "$tok" ] || exit 3
printf 'Authorization: Bearer %s\n' "$tok"
printf 'anthropic-beta: oauth-2025-04-20\nContent-Type: application/json\n'
`;

/** "default_claude_max_5x" -> "max 5x"; else the subscription's name. */
function claudePlan(sub: string | undefined, tier: string | undefined): string | null {
  const max = /max_(\d+x)/.exec(tier ?? "")?.[1];

  if (max !== undefined) return `max ${max}`;

  return sub !== undefined && Str.isNonEmpty(sub) && sub !== "null" ? sub : null;
}

/** An ISO time as ms (null for none, or one that doesn't parse). */
const instant = (s: string | null | undefined): number | null => {
  if (s === null || s === undefined) return null;

  const ms = Date.parse(s);

  return Number.isNaN(ms) ? null : ms;
};

/** The numbers of a good answer: what a provider's reader makes of its endpoint's JSON. */
type Windows = Pick<Usage, "session" | "week" | "scoped" | "plan">;

/** A field the endpoint may leave out or send as null (it sends null for what doesn't apply). */
const maybe = <A, I>(s: Schema.Codec<A, I>) => Schema.optionalKey(Schema.NullOr(s));

/** Claude's endpoint's answer, the fields read here. One field in another shape must not cost the whole reading. */
const ClaudeWindow = Schema.Struct({ utilization: maybe(Schema.Finite), resets_at: maybe(Schema.String) });

type ClaudeWindow = typeof ClaudeWindow.Type;

const ClaudeLimit = Schema.Struct({
  kind: maybe(Schema.String),
  percent: maybe(Schema.Finite),
  resets_at: maybe(Schema.String),
  scope: maybe(Schema.Struct({ model: maybe(Schema.Struct({ display_name: maybe(Schema.String) })) })),
});

const ClaudeAnswer = Schema.Struct({
  five_hour: maybe(ClaudeWindow),
  seven_day: maybe(ClaudeWindow),
  seven_day_opus: maybe(ClaudeWindow),
  seven_day_sonnet: maybe(ClaudeWindow),
  limits: maybe(Schema.Array(ClaudeLimit)),
});

/** Claude's answer as the windows the views draw. `used` is 0–100, `length` ms. */
function claudeWindows(d: typeof ClaudeAnswer.Type, plan: readonly string[]): Windows {
  const win = (x: ClaudeWindow | null | undefined, length: number): UsageWindow | null => {
    const used = x?.utilization;

    return used === undefined || used === null ? null : { used, resets: instant(x?.resets_at), length };
  };

  const scoped: ScopedWindow[] = [];

  for (const l of d.limits ?? []) {
    const name = l.kind === "weekly_scoped" ? l.scope?.model?.display_name : undefined;
    const used = l.percent;

    if (name !== undefined && name !== null && used !== undefined && used !== null) scoped.push({ name, used, resets: instant(l.resets_at), length: 7 * DAY });
  }

  // Older answers name the model windows as fields instead.
  for (const [w, name] of [[win(d.seven_day_opus, 7 * DAY), "Opus"], [win(d.seven_day_sonnet, 7 * DAY), "Sonnet"]] as const) {
    if (w !== null && !Arr.some(scoped, (s) => s.name === name)) scoped.push({ name, ...w });
  }

  return { session: win(d.five_hour, 5 * HOUR), week: win(d.seven_day, 7 * DAY), scoped, plan: claudePlan(plan[1], plan[2]) };
}

// ---- Codex

const CODEX_LOGIN = String.raw`
home=$CODEX_HOME; [ -n "$home" ] || home=$HOME/.codex
auth=$(tr -d '\n' < "$home/auth.json" 2>/dev/null)
field() { printf %s "$auth" | grep -o "\"$1\"[[:space:]]*:[[:space:]]*\"[^\"]*" | head -1 | sed 's/.*"//'; }
`;

const CODEX_STATE = CODEX_LOGIN + String.raw`
[ -n "$(field access_token)" ] || exit 3
`;

const CODEX_HEADERS = CODEX_LOGIN + String.raw`
tok=$(field access_token)
[ -n "$tok" ] || exit 3
acct=$(field account_id)
printf 'Authorization: Bearer %s\n' "$tok"
[ -z "$acct" ] || printf 'ChatGPT-Account-Id: %s\n' "$acct"
printf 'User-Agent: codex_cli_rs\n'
`;

/** Codex's endpoint's answer, the fields read here. */
const CodexWindow = Schema.Struct({ used_percent: Schema.Finite, reset_at: maybe(Schema.Finite), limit_window_seconds: maybe(Schema.Finite) });

type CodexWindow = typeof CodexWindow.Type;

const CodexAnswer = Schema.Struct({
  rate_limit: Schema.optionalKey(Schema.Struct({ primary_window: maybe(CodexWindow), secondary_window: maybe(CodexWindow) })),
  plan_type: maybe(Schema.String),
});

/** Codex's answer as the windows the views draw: its primary window is the short one, the secondary the week. */
function codexWindows(d: typeof CodexAnswer.Type): Windows {
  const win = (x: CodexWindow | null | undefined): UsageWindow | null => {
    if (x === null || x === undefined) return null;

    const reset = x.reset_at ?? 0;
    const length = (x.limit_window_seconds ?? 0) * 1000;

    return { used: x.used_percent, resets: reset > 0 ? reset * 1000 : null, length: length > 0 ? length : null };
  };

  const rl = d.rate_limit;

  return { session: win(rl?.primary_window), week: win(rl?.secondary_window), scoped: [], plan: d.plan_type ?? null };
}

// ---- reading

/** A provider's login check, its request's headers, its endpoint, and what its JSON becomes. */
interface Reader {
  readonly state: string;
  readonly headers: string;
  readonly url: string;
  readonly windows: (response: HttpClientResponse.HttpClientResponse, plan: readonly string[]) => Effect.Effect<Windows, HttpClientError.HttpClientError | Schema.SchemaError>;
}

const READERS = {
  claude: {
    state: CLAUDE_STATE,
    headers: CLAUDE_HEADERS,
    url: "https://api.anthropic.com/api/oauth/usage",
    windows: (response, plan) => Effect.map(HttpClientResponse.schemaBodyJson(ClaudeAnswer)(response), (d) => claudeWindows(d, plan)),
  },
  codex: {
    state: CODEX_STATE,
    headers: CODEX_HEADERS,
    url: "https://chatgpt.com/backend-api/wham/usage",
    windows: (response) => Effect.map(HttpClientResponse.schemaBodyJson(CodexAnswer)(response), codexWindows),
  },
} satisfies { readonly [P in ProviderId]: Reader };

/**
 * The usage endpoints, one HttpClient per provider. Live: curl with the
 * provider's login as headers (see the top). A test provides a fake server.
 */
export class UsageEndpoint extends Context.Service<UsageEndpoint, {
  readonly client: (p: ProviderId) => HttpClient.HttpClient;
}>()("usage/UsageEndpoint") {
  /** curl through `Exec`, each request's Authorization read from the login inside the shell. */
  static readonly layer = Layer.effect(UsageEndpoint, Effect.gen(function* () {
    const exec = yield* Exec;
    const clients = new Map(Arr.map(PROVIDERS, (p) => [p.id, curlClient(exec.run, { headersFrom: READERS[p.id].headers, seconds: 20 })]));

    return UsageEndpoint.of({ client: (p) => clients.get(p) ?? curlClient(exec.run, { headersFrom: READERS[p].headers }) });
  }));
}

/** One attempt 25 s (curl's own 20 s inside); two more after a transport error or a 5xx; a 429 goes to the machine's back-off. */
const endpointPolicy = policy({ timeout: "25 seconds", retries: 2, base: "1 second", statuses: new Set([408, 500, 502, 503, 504]) });


/**
 * One read of provider `p`. Never fails; resolves { state, ... }:
 *   ok        { session, week, scoped, plan, at }
 *   off       a scratch app: usage isn't asked there (see the top)
 *   nologin   no login for it on this machine
 *   expired   the login's token ran out (the agent renews it when it next runs)
 *   busy      the endpoint asked us to slow down ({ retry }: its Retry-After, s, 0 when none)
 *   error     { message }
 */
export const readUsage = (p?: ProviderId): Effect.Effect<Reading, never, Exec | Shared | UsageEndpoint> => Effect.gen(function* () {
  const id = yield* picked(p);
  const reader = READERS[id];
  const login = yield* Exec.use((e) => e.run("sh", ["-c", OFF + reader.state]));

  // Exits 3–5 are decided before any request: nothing reached the endpoint.
  if (login.code === 5) return { state: "off", local: true } as const;

  if (login.code === 3) return { state: "nologin", local: true } as const;

  if (login.code === 4) return { state: "expired", local: true } as const;

  if (login.code !== 0) {
    const said = lastLine(login.stderr);

    return { state: "error", message: Str.isEmpty(said) ? `the login check exited ${login.code}` : said } as const;
  }

  const plan = Option.match(Arr.findFirst(Str.split(login.stdout, "\n"), Str.startsWith("@plan\t")), { onNone: () => [], onSome: (l) => Str.split(l, "\t") });
  const client = endpointPolicy((yield* UsageEndpoint).client(id));
  const response = yield* client.execute(HttpClientRequest.get(reader.url));
  const windows = yield* reader.windows(response, plan);
  const at = yield* Clock.currentTimeMillis;

  return { state: "ok", ...windows, at } as const;
}).pipe(
  Effect.catchTags({
    HttpClientError: (e) => Effect.map(Clock.currentTimeMillis, (now) => fromHttpError(e, now)),
    SchemaError: () => Effect.succeed(UNREAD),
    ExecError: (e: ExecError) => Effect.succeed({ state: "error", message: e.message } as const),
  }),
);

/** An answer of another shape than this build reads. */
const UNREAD = { state: "error", message: "the usage endpoint's answer wasn't in a shape this build reads" } as const;

/** What a failed request means for the reading (at `now`, ms): refused (expired), busy (with its Retry-After), or an error. */
function fromHttpError(e: HttpClientError.HttpClientError, now: number): Problem {
  const reason = e.reason;

  if (!Predicate.isTagged(reason, "StatusCodeError")) {
    if (Predicate.isTagged(reason, "DecodeError")) return UNREAD;

    const cause = Predicate.isTagged(reason, "TransportError") ? reason.cause : undefined;

    return { state: "error", message: lastLine(cause instanceof Error ? cause.message : e.message) };
  }

  const response = reason.response;

  if (response.status === 401 || response.status === 403) return { state: "expired" };

  if (response.status === 429) {
    const wait = retryAfter(response.headers, now);

    return { state: "busy", retry: Option.match(wait, { onNone: () => 0, onSome: (d) => Math.ceil(Duration.toSeconds(d)) }) };
  }

  return { state: "error", message: `the usage endpoint answered ${response.status}` };
}

/** A window's short name from its length: "5h", "week", "30d". */
export function windowName(w: UsageWindow | null | undefined, fallback: string): string {
  const l = w?.length ?? 0;

  if (l <= 0) return fallback;

  if (Math.abs(l - 7 * DAY) < HOUR) return "week";

  return l < DAY ? `${Math.round(l / HOUR)}h` : `${Math.round(l / DAY)}d`;
}

/** What `readUsage` and `refreshUsage` ask of the app. */
export type UsageServices = Exec | Shared | Workspace | UsageEndpoint;
