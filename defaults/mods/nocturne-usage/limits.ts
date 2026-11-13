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
// Edit one, copy it over the other.
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

/** What the module asks the app for; tests stand in for it (setHost). */
let host = { exec, shared, setShared, appWindow, terminals, panes, spaces, now: () => Date.now() };
export const setHost = (h) => { host = { ...host, ...h }; };

/** The providers, in switch order. `agent`: the program whose login it reads; `logo`: Nocturne's art/logo-<logo>.svg. */
export const PROVIDERS = [
  { id: "claude", name: "Claude", agent: "Claude Code", logo: "claude" },
  { id: "codex", name: "Codex", agent: "Codex", logo: "codex" },
];

/** The picked provider's id. */
const PICK = "nocturne-usage.provider";
/** The last good answer ({ state: "ok", session, week, scoped, plan, at }). Claude's keys keep their old names. */
export const CACHE = "nocturne-usage.last";
/** The latest read's problem ({ state, message?, at, until? }), null after a good one. */
export const NOTE = "nocturne-usage.note";
/** When some copy in this app started asking (ms), so two copies don't ask at once. */
const ASKING = "nocturne-usage.asking";
/** This app's copy of the machine's record: { tried, until, fails } (see the top). */
const STATE = "nocturne-usage.state";

/** How often to ask (ms): someone looks at a usage pane; an agent works or the window is active; nothing happens. */
export const PACE = { looking: 3 * 60_000, active: 10 * 60_000, idle: 30 * 60_000 };
/** Opening a pane asks when the last try is older than this; refresh, when older than FORCE. */
export const OPEN = 60_000, FORCE = 10_000;
/** The back-off after a failed request: BACKOFF, doubled each time, up to CAP. */
export const BACKOFF = 5 * 60_000, CAP = 2 * 3600_000;
/** A lock older than this was left by an app that stopped mid-read. */
const STALE_LOCK_MIN = 2;

const key = (base, p) => (p === "claude" ? base : `${base}.${p}`);

/** The picked provider ({ id, name, agent, logo }). */
export const provider = () => PROVIDERS.find((p) => p.id === host.shared(PICK)) ?? PROVIDERS[0];
/** Picks a provider by id; every copy redraws. */
export const pickProvider = (id) => host.setShared(PICK, id);

/** The last good answer; none while usage is off (a scratch app keeps no stale numbers on show). */
export const lastUsage = (p = provider().id) => (usageNote(p)?.state === "off" ? null : host.shared(key(CACHE, p)) ?? null);
export const usageNote = (p = provider().id) => host.shared(key(NOTE, p)) ?? null;
export const asking = (p = provider().id) => host.now() - (Number(host.shared(key(ASKING, p))) || 0) < 30_000;
/** When the next request may go at the earliest (ms), during a back-off; else 0. */
export const backoffUntil = (p = provider().id) => Number(host.shared(key(STATE, p))?.until) || 0;

/** How often to ask from here now (one of PACE). */
export function pace() {
  try {
    const active = Boolean(host.appWindow()?.active);
    const space = host.spaces().find((s) => s.active);
    const tab = space?.tabs.find((t) => t.active)?.id;
    if (active && host.panes().some((p) => p.mod === "nocturne-usage" && p.tab === tab && !p.parked)) return PACE.looking;
    if (active || host.terminals().some((t) => (t.report?.state ?? t.status) === "working")) return PACE.active;
  } catch { /* not drawing yet */ }
  return PACE.idle;
}

/** How long to wait after the `fails`th failed request in a row (Retry-After in s, when above 0, wins). */
export const backoff = (fails, retry = 0) => (retry > 0 ? retry * 1000 : Math.min(CAP, BACKOFF * 2 ** Math.max(0, fails - 1)));

/**
 * Whether to ask now, given the machine's record ({ tried, until, fails })
 * and why: "tick" (every PACE), "open" (a pane opened), "force" (refresh).
 * Nothing goes during a back-off, whatever the reason.
 */
export function due(rec, why, now, every) {
  if (now < (rec?.until ?? 0)) return false;
  const since = now - (rec?.tried ?? 0);
  return since >= (why === "force" ? FORCE : why === "open" ? Math.min(OPEN, every) : every);
}

/** The record after read `r` at `now` (r: readUsage's answer). */
export function after(rec, r, now) {
  const answer = r.state === "ok" ? r : rec?.answer ?? null;
  if (r.state === "ok") return { answer, note: null, tried: now, until: 0, fails: 0 };
  const note = { ...r, at: now };
  // A login that's missing, out of date or off never reached the endpoint: ask again at the usual pace.
  if (r.local) return { answer, note, tried: now, until: 0, fails: 0 };
  const fails = (rec?.fails ?? 0) + 1;
  const until = now + backoff(fails, r.retry ?? 0);
  return { answer, note: { ...note, until }, tried: now, until, fails };
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

async function file(op, p, arg = "") {
  const r = await host.exec("sh", ["-c", FILE, "sh", op, p, String(arg)]).catch(() => ({ code: 1, stdout: "" }));
  if (op !== "read") return r.code === 0;
  try { return JSON.parse(r.stdout) ?? null; } catch { return null; }
}

/** Shows the machine's record here (every copy of this app redraws). */
function adopt(p, rec) {
  if (!rec) return;
  if (rec.answer) host.setShared(key(CACHE, p), rec.answer);
  host.setShared(key(NOTE, p), rec.note ?? null);
  host.setShared(key(STATE, p), { tried: rec.tried ?? 0, until: rec.until ?? 0, fails: rec.fails ?? 0 });
}

/**
 * Reads provider `p` again when it's due (see `due`): "tick" from a timer,
 * "open" when a pane opens, "force" (or true) for refresh. One copy of this
 * app goes at a time, and it asks only if no app on this machine asked
 * lately (the shared file). It never throws.
 */
export async function refreshUsage(why = "tick", p = provider().id) {
  if (why === true) why = "force";
  else if (why === false || why == null) why = "tick";
  const now = host.now(), every = pace();
  // This app's own copy of the record first: no exec while it isn't due.
  if (asking(p) || !due(host.shared(key(STATE, p)), why, now, every)) return;
  host.setShared(key(ASKING, p), now);
  try {
    let rec = await file("read", p);
    adopt(p, rec);
    if (!due(rec, why, host.now(), every)) return;
    if (!(await file("lock", p, STALE_LOCK_MIN))) return; // another app is asking: its answer comes through the file
    try {
      rec = await file("read", p); // it may have just finished
      if (!due(rec, why, host.now(), every)) return adopt(p, rec);
      let r;
      try { r = await readUsage(p); } catch (e) { r = { state: "error", message: String(e?.message ?? e) }; }
      rec = after(rec, r, host.now());
      await file("write", p, JSON.stringify(rec));
      adopt(p, rec);
    } finally {
      await file("unlock", p);
    }
  } finally {
    host.setShared(key(ASKING, p), 0);
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
function claudePlan(sub, tier) {
  const max = /max_(\d+x)/.exec(tier ?? "")?.[1];
  if (max) return `max ${max}`;
  return sub && sub !== "null" ? sub : null;
}

const when = (s) => (s ? Date.parse(s) : null);

/** Claude's answer as the windows the views draw. `used` is 0–100, `length` ms. */
function claudeWindows(d, plan) {
  const win = (x, length) => (x && typeof x.utilization === "number" ? { used: x.utilization, resets: when(x.resets_at), length } : null);
  const scoped = [];
  for (const l of d.limits ?? []) {
    const name = l.kind === "weekly_scoped" && l.scope?.model?.display_name;
    if (name && typeof l.percent === "number") scoped.push({ name, used: l.percent, resets: when(l.resets_at), length: 7 * DAY });
  }
  // Older answers name the model windows as fields instead.
  for (const [k, name] of [["seven_day_opus", "Opus"], ["seven_day_sonnet", "Sonnet"]]) {
    const w = win(d[k], 7 * DAY);
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

/** Codex's answer as the windows the views draw: its primary window is the short one, the secondary the week. */
function codexWindows(d) {
  const win = (x) => (x && typeof x.used_percent === "number"
    ? { used: x.used_percent, resets: x.reset_at ? x.reset_at * 1000 : null, length: (x.limit_window_seconds ?? 0) * 1000 || null }
    : null);
  const rl = d.rate_limit ?? {};
  return { session: win(rl.primary_window), week: win(rl.secondary_window), scoped: [], plan: d.plan_type ?? null };
}

// ---- reading

const READERS = { claude: [CLAUDE, claudeWindows], codex: [CODEX, codexWindows] };

/**
 * One read of provider `p`. Resolves { state, ... }:
 *   ok        { session, week, scoped, plan, at }
 *   off       a scratch app: usage isn't asked there (see the top)
 *   nologin   no login for it on this machine
 *   expired   the login's token ran out (the agent renews it when it next runs)
 *   busy      the endpoint asked us to slow down ({ retry }: its Retry-After, s, 0 when none)
 *   error     { message }
 */
export async function readUsage(p = provider().id) {
  const [script, windows] = READERS[p] ?? READERS.claude;
  const r = await host.exec("sh", ["-c", script]);
  // Exits 3–5 are decided before any request: nothing reached the endpoint.
  if (r.code === 5) return { state: "off", local: true };
  if (r.code === 3) return { state: "nologin", local: true };
  if (r.code === 4) return { state: "expired", local: true };
  const lines = r.stdout.split("\n");
  const plan = lines.find((l) => l.startsWith("@plan\t"))?.split("\t") ?? [];
  const code = Number(lines.find((l) => l.startsWith("@code\t"))?.split("\t")[1]);
  const retry = Number(lines.find((l) => l.startsWith("@retry\t"))?.split("\t")[1]) || 0;
  const body = lines.filter((l) => !l.startsWith("@")).join("\n").trim();
  if (r.code !== 0 || !code) return { state: "error", message: (r.stderr || body || `curl exited ${r.code}`).trim().split("\n").pop() };
  if (code === 401 || code === 403) return { state: "expired" };
  if (code === 429) return { state: "busy", retry };
  if (code !== 200) return { state: "error", message: `the usage endpoint answered ${code}` };
  try {
    return { state: "ok", ...windows(JSON.parse(body), plan), at: host.now() };
  } catch {
    return { state: "error", message: "the usage endpoint's answer wasn't JSON" };
  }
}

/** A window's short name from its length: "5h", "week", "30d". */
export function windowName(w, fallback) {
  const l = w?.length;
  if (!l) return fallback;
  if (Math.abs(l - 7 * DAY) < HOUR) return "week";
  return l < DAY ? `${Math.round(l / HOUR)}h` : `${Math.round(l / DAY)}d`;
}
