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
// token stays inside the shell: printf is a builtin and curl reads the header
// from stdin, so it is never in a process's arguments.
//
// Off in a scratch app (HERDR_APP_HOME set to another home than the default
// ~/.config/herdr-app): its login is still this machine's, so every scratch
// app would ask the same account's endpoint on top of the real app's.
// HERDR_APP_USAGE=1 turns it on there. Checked by the scripts themselves,
// before the login is read: no request leaves a scratch app.
//
// Two mods show it (Nocturne's sidebar and the nocturne-usage pane), and a
// mod can't import another's files: this file is in both, byte for byte.
// Edit one, copy it over the other (scripts/nocturne-usage-limits.test.ts
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
// above 0, else 5, 10, 20, … min up to 2 h; refresh waits it out too. The
// last good answer stays on show meanwhile, with its age.

import { exec, shared, setShared, window as appWindow, terminals, panes, spaces } from "herdr";
import type { Guard, Guarded } from "./guard.ts";
import { arrayOf, isNumber, isString, literal, nullable, object, oneOf, parseJson, readShared, sharedKey, writeShared } from "./guard.ts";

/** What the module asks the app for; tests stand in for it (setHost). */
interface Host {
  readonly exec: typeof exec;
  readonly shared: typeof shared;
  readonly setShared: typeof setShared;
  readonly appWindow: typeof appWindow;
  readonly terminals: typeof terminals;
  readonly panes: typeof panes;
  readonly spaces: typeof spaces;
  readonly now: () => number;
}

let host: Host = { exec, shared, setShared, appWindow, terminals, panes, spaces, now: () => Date.now() };

export const setHost = (h: Partial<Host>) => { host = { ...host, ...h }; };

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

const isProviderId = literal("claude", "codex");

/** One limit window: `used` 0–100, `resets` and `length` in ms. */
const isWindow = object({ used: isNumber, resets: nullable(isNumber), length: nullable(isNumber) });

export type UsageWindow = Guarded<typeof isWindow>;

const isScoped = object({ name: isString, used: isNumber, resets: nullable(isNumber), length: nullable(isNumber) });

export type ScopedWindow = Guarded<typeof isScoped>;

/** A good answer, as the views draw it. */
const isUsage = object({
  state: literal("ok"),
  session: nullable(isWindow),
  week: nullable(isWindow),
  scoped: arrayOf(isScoped),
  plan: nullable(isString),
  at: isNumber,
});

export type Usage = Guarded<typeof isUsage>;

/** A read that gave no numbers. `local`: decided before any request (nothing reached the endpoint). */
const isLocalProblem = object({ state: literal("off", "nologin", "expired"), local: literal(true) });
const isRefused = object({ state: literal("expired") });
const isBusy = object({ state: literal("busy"), retry: isNumber });
const isFailed = object({ state: literal("error"), message: isString });

export type Problem = Guarded<typeof isLocalProblem> | Guarded<typeof isRefused> | Guarded<typeof isBusy> | Guarded<typeof isFailed>;

/** What one read resolves to (see readUsage). */
export type Reading = Usage | Problem;

/** When a problem came, and until when its back-off lasts. */
const isWhen = object({ at: isNumber }, { until: isNumber });

/** A problem as kept (shared() and the machine's record). */
export type Note = Problem & Guarded<typeof isWhen>;

const isNote: Guard<Note> = (value: unknown): value is Note =>
  isWhen(value) && oneOf(isLocalProblem, isRefused, isBusy, isFailed)(value);

/** The machine's record (see the top). */
const isMachineRecord = object({}, { answer: nullable(isUsage), note: nullable(isNote), tried: isNumber, until: isNumber, fails: isNumber });

export type MachineRecord = Guarded<typeof isMachineRecord>;

/** This app's copy of the machine's record: when it was last tried, the back-off. */
const isPace = object({}, { tried: isNumber, until: isNumber, fails: isNumber });

/** Why a refresh asks: a timer's tick, a pane opening, refresh (r). */
export type Why = "tick" | "open" | "force";

/** The picked provider's id. */
const PICK = sharedKey("nocturne-usage.provider", nullable(isProviderId));

/** The last good answer ({ state: "ok", session, week, scoped, plan, at }). Claude's keys keep their old names. */
export const CACHE = "nocturne-usage.last";

/** The latest read's problem ({ state, message?, at, until? }), null after a good one. */
export const NOTE = "nocturne-usage.note";

/** When some copy in this app started asking (ms), so two copies don't ask at once. */
const ASKING = "nocturne-usage.asking";

/** This app's copy of the machine's record: { tried, until, fails } (see the top). */
const STATE = "nocturne-usage.state";

const key = (base: string, p: ProviderId) => (p === "claude" ? base : `${base}.${p}`);
const cacheKey = (p: ProviderId) => sharedKey(key(CACHE, p), nullable(isUsage));
const noteKey = (p: ProviderId) => sharedKey(key(NOTE, p), nullable(isNote));
const askingKey = (p: ProviderId) => sharedKey(key(ASKING, p), isNumber);
const stateKey = (p: ProviderId) => sharedKey(key(STATE, p), nullable(isPace));

/** How often to ask (ms): someone looks at a usage pane; an agent works or the window is active; nothing happens. */
export const PACE = { looking: 3 * 60_000, active: 10 * 60_000, idle: 30 * 60_000 };

/** Opening a pane asks when the last try is older than this; refresh, when older than FORCE. */
export const OPEN = 60_000, FORCE = 10_000;

/** The back-off after a failed request: BACKOFF, doubled each time, up to CAP. */
export const BACKOFF = 5 * 60_000, CAP = 2 * 3600_000;

/** A lock older than this was left by an app that stopped mid-read. */
const STALE_LOCK_MIN = 2;

/** The picked provider ({ id, name, agent, logo }). */
export const provider = (): Provider => {
  const id = readShared(host.shared, PICK, null);

  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];
};

/** Picks a provider by id; every copy redraws. */
export const pickProvider = (id: ProviderId) => writeShared(host.setShared, PICK, id);

/** The last good answer; none while usage is off (a scratch app keeps no stale numbers on show). */
export const lastUsage = (p: ProviderId = provider().id): Usage | null =>
  (usageNote(p)?.state === "off" ? null : readShared(host.shared, cacheKey(p), null));

export const usageNote = (p: ProviderId = provider().id): Note | null => readShared(host.shared, noteKey(p), null);

export const asking = (p: ProviderId = provider().id) => host.now() - readShared(host.shared, askingKey(p), 0) < 30_000;

/** When the next request may go at the earliest (ms), during a back-off; else 0. */
export const backoffUntil = (p: ProviderId = provider().id) => readShared(host.shared, stateKey(p), null)?.until ?? 0;

/** A terminal as the pace reads it (terminals() is herdr-core's listing): its status word, or its agent's report. */
const isTerminalStatus = object({}, { status: nullable(isString), report: nullable(object({}, { state: isString })) });

/** How often to ask from here now (one of PACE). */
export function pace(): number {
  try {
    const active = host.appWindow().active;
    const space = host.spaces().find((s) => s.active);
    const tab = space?.tabs.find((t) => t.active)?.id;

    if (active && host.panes().some((p) => p.mod === "nocturne-usage" && p.tab === tab && !p.parked)) return PACE.looking;

    if (active || host.terminals().some((t) => isTerminalStatus(t) && (t.report?.state ?? t.status) === "working")) return PACE.active;
  } catch { /* not drawing yet */ }

  return PACE.idle;
}

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

  return since >= (why === "force" ? FORCE : why === "open" ? Math.min(OPEN, every) : every);
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

// The machine's record: op read | lock | write <json> | unlock, for provider $2.
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

/** One step on the machine's record file; false when it failed (or the lock is taken). */
async function fileStep(op: "lock" | "write" | "unlock", p: ProviderId, arg: string | number = ""): Promise<boolean> {
  const r = await host.exec("sh", ["-c", FILE, "sh", op, p, String(arg)]).catch(() => ({ code: 1 }));

  return r.code === 0;
}

/** The machine's record, or null (none yet, or not one). */
async function readRecord(p: ProviderId): Promise<MachineRecord | null> {
  const r = await host.exec("sh", ["-c", FILE, "sh", "read", p, ""]).catch(() => ({ stdout: "" }));

  return parseJson(r.stdout, isMachineRecord) ?? null;
}

/** Shows the machine's record here (every copy of this app redraws). */
function adopt(p: ProviderId, rec: MachineRecord | null) {
  if (!rec) return;

  if (rec.answer) writeShared(host.setShared, cacheKey(p), rec.answer);
  writeShared(host.setShared, noteKey(p), rec.note ?? null);
  writeShared(host.setShared, stateKey(p), { tried: rec.tried ?? 0, until: rec.until ?? 0, fails: rec.fails ?? 0 });
}

/**
 * Reads provider `p` again when it's due (see `due`): "tick" from a timer,
 * "open" when a pane opens, "force" (or true) for refresh. One copy of this
 * app goes at a time, and it asks only if no app on this machine asked
 * lately (the shared file). It never throws.
 */
export async function refreshUsage(asked: Why | boolean | null = "tick", p: ProviderId = provider().id): Promise<void> {
  const why: Why = asked === true ? "force" : asked === false || asked === null ? "tick" : asked;
  const now = host.now(), every = pace();

  // This app's own copy of the record first: no exec while it isn't due.
  if (asking(p) || !due(readShared(host.shared, stateKey(p), null), why, now, every)) return;
  writeShared(host.setShared, askingKey(p), now);

  try {
    let rec = await readRecord(p);

    adopt(p, rec);

    if (!due(rec, why, host.now(), every)) return;

    if (!(await fileStep("lock", p, STALE_LOCK_MIN))) return; // another app is asking: its answer comes through the file

    try {
      rec = await readRecord(p); // it may have just finished

      if (!due(rec, why, host.now(), every)) return adopt(p, rec);

      let r: Reading;

      try { r = await readUsage(p); } catch (e) { r = { state: "error", message: e instanceof Error ? e.message : String(e) }; }

      rec = after(rec, r, host.now());
      await fileStep("write", p, JSON.stringify(rec));
      adopt(p, rec);
    } finally {
      await fileStep("unlock", p);
    }
  } finally {
    writeShared(host.setShared, askingKey(p), 0);
  }
}

const HOUR = 3600_000, DAY = 24 * HOUR;

// ---- Claude

// Exit 5: a scratch app (see the top), nothing read, nothing asked.
const OFF = String.raw`
def=$XDG_CONFIG_HOME; [ -n "$def" ] || def=$HOME/.config; def=$def/herdr-app
here=$(printf %s "$HERDR_APP_HOME" | sed 's:/*$::')
if [ -n "$here" ] && [ "$here" != "$def" ] && [ "$HERDR_APP_USAGE" != 1 ]; then exit 5; fi
`;

const CLAUDE = OFF + String.raw`
creds=$(security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null)
[ -n "$creds" ] || creds=$(cat "$HOME/.claude/.credentials.json" 2>/dev/null)
oauth=$(printf %s "$creds" | tr -d '\n' | sed 's/.*"claudeAiOauth"[[:space:]]*:[[:space:]]*{//')
field() { printf %s "$oauth" | grep -o "\"$1\"[[:space:]]*:[[:space:]]*\"*[^\",}]*" | head -1 | sed 's/.*:[[:space:]]*"*//'; }
tok=$(field accessToken)
[ -n "$tok" ] || exit 3
printf '@plan\t%s\t%s\n' "$(field subscriptionType)" "$(field rateLimitTier)"
exp=$(field expiresAt)
if [ -n "$exp" ] && [ "$exp" -lt "$(($(date +%s) * 1000))" ]; then exit 4; fi
printf 'Authorization: Bearer %s\n' "$tok" | curl -sS -m 20 -w '\n@code\t%{http_code}\n@retry\t%header{retry-after}' \
  -H @- -H "anthropic-beta: oauth-2025-04-20" -H "Content-Type: application/json" \
  https://api.anthropic.com/api/oauth/usage
`;

/** "default_claude_max_5x" -> "max 5x"; else the subscription's name. */
function claudePlan(sub: string | undefined, tier: string | undefined): string | null {
  const max = /max_(\d+x)/.exec(tier ?? "")?.[1];

  if (max) return `max ${max}`;

  return sub && sub !== "null" ? sub : null;
}

const when = (s: string | null | undefined) => (s ? Date.parse(s) : null);

/** The numbers of a good answer: what a provider's reader makes of its endpoint's JSON. */
type Windows = Pick<Usage, "session" | "week" | "scoped" | "plan">;

/** Claude's endpoint's answer, the fields read here. */
const isClaudeWindow = object({}, { utilization: isNumber, resets_at: nullable(isString) });

type ClaudeWindow = Guarded<typeof isClaudeWindow>;

const isClaudeLimit = object({}, {
  kind: isString,
  percent: isNumber,
  resets_at: nullable(isString),
  scope: object({}, { model: object({}, { display_name: isString }) }),
});

const isClaudeAnswer = object({}, {
  five_hour: nullable(isClaudeWindow),
  seven_day: nullable(isClaudeWindow),
  seven_day_opus: nullable(isClaudeWindow),
  seven_day_sonnet: nullable(isClaudeWindow),
  limits: arrayOf(isClaudeLimit),
});

/** Claude's answer as the windows the views draw. `used` is 0–100, `length` ms. */
function claudeWindows(d: Guarded<typeof isClaudeAnswer>, plan: readonly string[]): Windows {
  const win = (x: ClaudeWindow | null | undefined, length: number): UsageWindow | null =>
    (x?.utilization !== undefined ? { used: x.utilization, resets: when(x.resets_at), length } : null);

  const scoped: ScopedWindow[] = [];

  for (const l of d.limits ?? []) {
    const name = l.kind === "weekly_scoped" ? l.scope?.model?.display_name : undefined;

    if (name !== undefined && l.percent !== undefined) scoped.push({ name, used: l.percent, resets: when(l.resets_at), length: 7 * DAY });
  }

  // Older answers name the model windows as fields instead.
  for (const [w, name] of [[win(d.seven_day_opus, 7 * DAY), "Opus"], [win(d.seven_day_sonnet, 7 * DAY), "Sonnet"]] as const) {
    if (w && !scoped.some((s) => s.name === name)) scoped.push({ name, ...w });
  }

  return { session: win(d.five_hour, 5 * HOUR), week: win(d.seven_day, 7 * DAY), scoped, plan: claudePlan(plan[1], plan[2]) };
}

// ---- Codex

const CODEX = OFF + String.raw`
home=$CODEX_HOME; [ -n "$home" ] || home=$HOME/.codex
auth=$(tr -d '\n' < "$home/auth.json" 2>/dev/null)
field() { printf %s "$auth" | grep -o "\"$1\"[[:space:]]*:[[:space:]]*\"[^\"]*" | head -1 | sed 's/.*"//'; }
tok=$(field access_token)
[ -n "$tok" ] || exit 3
acct=$(field account_id)
{ printf 'Authorization: Bearer %s\n' "$tok"; [ -z "$acct" ] || printf 'ChatGPT-Account-Id: %s\n' "$acct"; } |
  curl -sS -m 20 -w '\n@code\t%{http_code}\n@retry\t%header{retry-after}' -H @- -H "User-Agent: codex_cli_rs" \
  https://chatgpt.com/backend-api/wham/usage
`;

/** Codex's endpoint's answer, the fields read here. */
const isCodexWindow = object({}, { used_percent: isNumber, reset_at: nullable(isNumber), limit_window_seconds: nullable(isNumber) });

type CodexWindow = Guarded<typeof isCodexWindow>;

const isCodexAnswer = object({}, {
  rate_limit: object({}, { primary_window: nullable(isCodexWindow), secondary_window: nullable(isCodexWindow) }),
  plan_type: nullable(isString),
});

/** Codex's answer as the windows the views draw: its primary window is the short one, the secondary the week. */
function codexWindows(d: Guarded<typeof isCodexAnswer>): Windows {
  const win = (x: CodexWindow | null | undefined): UsageWindow | null => (x?.used_percent !== undefined
    ? { used: x.used_percent, resets: x.reset_at ? x.reset_at * 1000 : null, length: (x.limit_window_seconds ?? 0) * 1000 || null }
    : null);

  const rl = d.rate_limit;

  return { session: win(rl?.primary_window), week: win(rl?.secondary_window), scoped: [], plan: d.plan_type ?? null };
}

// ---- reading

/** A provider's script, and what its endpoint's JSON becomes (undefined: not its answer). */
interface Reader {
  readonly script: string;
  readonly windows: (body: string, plan: readonly string[]) => Windows | undefined;
}

const READERS = {
  claude: {
    script: CLAUDE,
    windows: (body, plan) => {
      const d = parseJson(body, isClaudeAnswer);

      return d && claudeWindows(d, plan);
    },
  },
  codex: {
    script: CODEX,
    windows: (body) => {
      const d = parseJson(body, isCodexAnswer);

      return d && codexWindows(d);
    },
  },
} satisfies { readonly [P in ProviderId]: Reader };

/**
 * One read of provider `p`. Resolves { state, ... }:
 *   ok        { session, week, scoped, plan, at }
 *   off       a scratch app: usage isn't asked there (see the top)
 *   nologin   no login for it on this machine
 *   expired   the login's token ran out (the agent renews it when it next runs)
 *   busy      the endpoint asked us to slow down ({ retry }: its Retry-After, s, 0 when none)
 *   error     { message }
 */
export async function readUsage(p: ProviderId = provider().id): Promise<Reading> {
  const { script, windows } = READERS[p];
  const r = await host.exec("sh", ["-c", script]);

  // Exits 3–5 are decided before any request: nothing reached the endpoint.
  if (r.code === 5) return { state: "off", local: true };

  if (r.code === 3) return { state: "nologin", local: true };

  if (r.code === 4) return { state: "expired", local: true };

  const lines = r.stdout.split("\n");
  const field = (name: string) => lines.find((l) => l.startsWith(`@${name}\t`))?.split("\t") ?? [];
  const plan = field("plan");
  const code = Number(field("code")[1]);
  const retry = Number(field("retry")[1]) || 0;
  const body = lines.filter((l) => !l.startsWith("@")).join("\n").trim();

  if (r.code !== 0 || !code) return { state: "error", message: (r.stderr || body || `curl exited ${r.code}`).trim().split("\n").pop() ?? "" };

  if (code === 401 || code === 403) return { state: "expired" };

  if (code === 429) return { state: "busy", retry };

  if (code !== 200) return { state: "error", message: `the usage endpoint answered ${code}` };

  const w = windows(body, plan);

  return w ? { state: "ok", ...w, at: host.now() } : { state: "error", message: "the usage endpoint's answer wasn't JSON" };
}

/** A window's short name from its length: "5h", "week", "30d". */
export function windowName(w: UsageWindow | null | undefined, fallback: string): string {
  const l = w?.length;

  if (!l) return fallback;

  if (Math.abs(l - 7 * DAY) < HOUR) return "week";

  return l < DAY ? `${Math.round(l / HOUR)}h` : `${Math.round(l / DAY)}d`;
}
