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
// Edit one, copy it over the other. They share one reading per provider
// through shared(): whoever is shown asks when the last answer is old, the
// rest just draw it.

import { exec, shared, setShared } from "herdr";

/** The providers, in switch order. `agent`: the program whose login it reads; `logo`: Nocturne's art/logo-<logo>.svg. */
export const PROVIDERS = [
  { id: "claude", name: "Claude", agent: "Claude Code", logo: "claude" },
  { id: "codex", name: "Codex", agent: "Codex", logo: "codex" },
];

/** The picked provider's id. */
const PICK = "nocturne-usage.provider";
/** The last good answer ({ state: "ok", session, week, scoped, plan, at }). Claude's keys keep their old names. */
export const CACHE = "nocturne-usage.last";
/** The latest read's problem ({ state, message? }), null after a good one. */
export const NOTE = "nocturne-usage.note";
/** When some copy started asking (ms), so two copies don't ask at once. */
const ASKING = "nocturne-usage.asking";
/** The endpoints are shared with the agents' own usage views: ask gently. */
export const POLL = 180_000;

const key = (base, p) => (p === "claude" ? base : `${base}.${p}`);

/** The picked provider ({ id, name, agent, logo }). */
export const provider = () => PROVIDERS.find((p) => p.id === shared(PICK)) ?? PROVIDERS[0];
/** Picks a provider by id; every copy redraws. */
export const pickProvider = (id) => setShared(PICK, id);

/** The last good answer; none while usage is off (a scratch app keeps no stale numbers on show). */
export const lastUsage = (p = provider().id) => (usageNote(p)?.state === "off" ? null : shared(key(CACHE, p)) ?? null);
export const usageNote = (p = provider().id) => shared(key(NOTE, p)) ?? null;
export const asking = (p = provider().id) => Date.now() - (Number(shared(key(ASKING, p))) || 0) < 30_000;

/**
 * Reads provider `p` again if its last answer is older than POLL (or
 * `force`), unless another copy is already asking. Call it from a timer; it
 * never throws.
 */
export async function refreshUsage(force = false, p = provider().id) {
  const last = lastUsage(p), note = usageNote(p);
  const age = Date.now() - Math.max(last?.at ?? 0, note?.at ?? 0);
  if (asking(p) || (!force && age < POLL)) return;
  setShared(key(ASKING, p), Date.now());
  let r;
  try { r = await readUsage(p); } catch (e) { r = { state: "error", message: String(e?.message ?? e) }; }
  if (r.state === "ok") { setShared(key(CACHE, p), r); setShared(key(NOTE, p), null); }
  else setShared(key(NOTE, p), { ...r, at: Date.now() });
  setShared(key(ASKING, p), 0);
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
printf 'Authorization: Bearer %s\n' "$tok" | curl -sS -m 20 -w '\n@code\t%{http_code}' \
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
  curl -sS -m 20 -w '\n@code\t%{http_code}' -H @- -H "User-Agent: codex_cli_rs" \
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
 *   busy      the endpoint asked us to slow down
 *   error     { message }
 */
export async function readUsage(p = provider().id) {
  const [script, windows] = READERS[p] ?? READERS.claude;
  const r = await exec("sh", ["-c", script]);
  if (r.code === 5) return { state: "off" };
  if (r.code === 3) return { state: "nologin" };
  if (r.code === 4) return { state: "expired" };
  const lines = r.stdout.split("\n");
  const plan = lines.find((l) => l.startsWith("@plan\t"))?.split("\t") ?? [];
  const code = Number(lines.find((l) => l.startsWith("@code\t"))?.split("\t")[1]);
  const body = lines.filter((l) => !l.startsWith("@")).join("\n").trim();
  if (r.code !== 0 || !code) return { state: "error", message: (r.stderr || body || `curl exited ${r.code}`).trim().split("\n").pop() };
  if (code === 401 || code === 403) return { state: "expired" };
  if (code === 429) return { state: "busy" };
  if (code !== 200) return { state: "error", message: `the usage endpoint answered ${code}` };
  try {
    return { state: "ok", ...windows(JSON.parse(body), plan), at: Date.now() };
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
