// The Claude account's usage limits, as Claude Code's /usage shows them: the
// 5-hour session window, the weekly one, and any weekly limit scoped to one
// model. Read from the same endpoint /usage asks, with Claude Code's own
// login (the macOS keychain's "Claude Code-credentials", or
// ~/.claude/.credentials.json where there is no keychain).
//
// Read-only: the login is never refreshed here (Claude Code renews it when it
// runs; refreshing from two places would race its refresh token). The token
// stays inside the shell: printf is a builtin and curl reads the header from
// stdin, so it is never in a process's arguments.
//
// Two mods show it (Nocturne's sidebar and the nocturne-usage pane), and a
// mod can't import another's files: this file is in both, byte for byte.
// Edit one, copy it over the other. They share one reading through shared():
// whoever is shown asks when the last answer is old, the rest just draw it.

import { exec, shared, setShared } from "herdr";

/** The last good answer ({ state: "ok", session, week, scoped, plan, at }). */
export const CACHE = "nocturne-usage.last";
/** The latest read's problem ({ state, message? }), null after a good one. */
export const NOTE = "nocturne-usage.note";
/** When some copy started asking (ms), so two copies don't ask at once. */
const ASKING = "nocturne-usage.asking";
/** The endpoint is shared with Claude Code's own /usage: ask gently. */
export const POLL = 180_000;

export const lastUsage = () => shared(CACHE) ?? null;
export const usageNote = () => shared(NOTE) ?? null;
export const asking = () => Date.now() - (Number(shared(ASKING)) || 0) < 30_000;

/**
 * Reads again if the last answer is older than POLL (or `force`), unless
 * another copy is already asking. Call it from a timer; it never throws.
 */
export async function refreshUsage(force = false) {
  const last = lastUsage(), note = usageNote();
  const age = Date.now() - Math.max(last?.at ?? 0, note?.at ?? 0);
  if (asking() || (!force && age < POLL)) return;
  setShared(ASKING, Date.now());
  let r;
  try { r = await readUsage(); } catch (e) { r = { state: "error", message: String(e?.message ?? e) }; }
  if (r.state === "ok") { setShared(CACHE, r); setShared(NOTE, null); }
  else setShared(NOTE, { ...r, at: Date.now() });
  setShared(ASKING, 0);
}

const SCRIPT = String.raw`
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
function planName(sub, tier) {
  const max = /max_(\d+x)/.exec(tier ?? "")?.[1];
  if (max) return `max ${max}`;
  return sub && sub !== "null" ? sub : null;
}

const when = (s) => (s ? Date.parse(s) : null);

/** The API's answer as the windows this pane draws. `used` is 0–100. */
function windows(d) {
  const win = (x) => (x && typeof x.utilization === "number" ? { used: x.utilization, resets: when(x.resets_at) } : null);
  const scoped = [];
  for (const l of d.limits ?? []) {
    const name = l.kind === "weekly_scoped" && l.scope?.model?.display_name;
    if (name && typeof l.percent === "number") scoped.push({ name, used: l.percent, resets: when(l.resets_at) });
  }
  // Older answers name the model windows as fields instead.
  for (const [key, name] of [["seven_day_opus", "Opus"], ["seven_day_sonnet", "Sonnet"]]) {
    const w = win(d[key]);
    if (w && !scoped.some((s) => s.name === name)) scoped.push({ name, ...w });
  }
  return { session: win(d.five_hour), week: win(d.seven_day), scoped };
}

/**
 * One read. Resolves { state, ... }:
 *   ok        { session, week, scoped, plan, at }
 *   nologin   no Claude Code login on this machine
 *   expired   the login's token ran out (Claude Code renews it when it next runs)
 *   busy      the endpoint asked us to slow down
 *   error     { message }
 */
export async function readUsage() {
  const r = await exec("sh", ["-c", SCRIPT]);
  if (r.code === 3) return { state: "nologin" };
  if (r.code === 4) return { state: "expired" };
  const lines = r.stdout.split("\n");
  const plan = lines.find((l) => l.startsWith("@plan\t"))?.split("\t") ?? [];
  const code = Number(lines.find((l) => l.startsWith("@code\t"))?.split("\t")[1]);
  const body = lines.filter((l) => !l.startsWith("@")).join("\n").trim();
  if (r.code !== 0 || !code) return { state: "error", message: (r.stderr || body || `curl exited ${r.code}`).trim().split("\n").pop() };
  if (code === 401) return { state: "expired" };
  if (code === 429) return { state: "busy" };
  if (code !== 200) return { state: "error", message: `the usage endpoint answered ${code}` };
  try {
    return { state: "ok", ...windows(JSON.parse(body)), plan: planName(plan[1], plan[2]), at: Date.now() };
  } catch {
    return { state: "error", message: "the usage endpoint's answer wasn't JSON" };
  }
}
