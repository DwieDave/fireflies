// What the GitHub window knows about runs, jobs, steps, logs and checks, as
// plain functions over gh's JSON: no herdr imports, so scripts/ tests it.

/** A run's, job's, step's or check's state as one of the window's tones. */
export function tone(status, conclusion) {
  const s = String(status ?? "").toLowerCase(), c = String(conclusion ?? "").toLowerCase();
  if (s === "in_progress") return "working";
  if (s && s !== "completed") return "queued"; // queued, waiting, pending, requested
  if (c === "success" || c === "neutral") return "done";
  if (c === "failure" || c === "timed_out" || c === "startup_failure" || c === "action_required") return "failed";
  if (c === "skipped") return "skipped";
  if (c === "cancelled" || c === "stale") return "stopped";
  return s === "completed" ? "done" : "queued";
}

const LIVE = new Set(["queued", "in_progress", "waiting", "pending", "requested"]);
/** Poll fast while anything shown still moves, slowly otherwise. */
export const FAST = 3000, SLOW = 60000;
export function pollEvery(items) {
  return (items ?? []).some((x) => LIVE.has(String(x?.status ?? "").toLowerCase())) ? FAST : SLOW;
}

/** `gh api -i` output: the status line, the ETag and the body. */
export function parseHeaders(text) {
  const s = String(text ?? "");
  const cut = s.search(/\r?\n\r?\n/);
  const head = cut < 0 ? s : s.slice(0, cut);
  const body = cut < 0 ? "" : s.slice(cut).replace(/^\r?\n\r?\n/, "");
  const status = Number(/^HTTP\/[\d.]+ (\d+)/.exec(head)?.[1] ?? 0);
  const etag = /^etag:\s*(.+?)\s*$/im.exec(head)?.[1] ?? null;
  return { status, etag, body };
}

/** The `jobs:` of a workflow file: key -> { name, needs }. A tiny reader for
 *  the shapes GitHub accepts (`needs: a`, `needs: [a, b]`, a block list);
 *  anything it can't read is left out (the graph then falls back to timing). */
export function needsFromWorkflow(yaml) {
  const out = new Map();
  const lines = String(yaml ?? "").split(/\r?\n/);
  const start = lines.findIndex((l) => /^jobs:\s*(#.*)?$/.test(l));
  if (start < 0) return out;
  let indent = null, job = null, list = false;
  const clean = (v) => v.replace(/#.*$/, "").trim().replace(/^["']|["']$/g, "");
  for (const line of lines.slice(start + 1)) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const pad = line.length - line.trimStart().length;
    if (pad === 0) break; // the next top-level key
    indent ??= pad;
    if (pad === indent) {
      const m = /^\s*([A-Za-z0-9_-]+):\s*(#.*)?$/.exec(line);
      job = m ? { name: null, needs: [] } : null;
      if (m) out.set(m[1], job);
      list = false;
      continue;
    }
    if (!job) continue;
    if (pad === indent + 2 || (list && pad <= indent + 2)) list = false;
    const kv = /^\s*(name|needs):\s*(.*)$/.exec(line);
    if (pad === indent + 2 && kv) {
      const v = clean(kv[2]);
      if (kv[1] === "name") job.name = v || null;
      else if (v.startsWith("[")) job.needs = v.slice(1, v.lastIndexOf("]")).split(",").map(clean).filter(Boolean);
      else if (v) job.needs = [v];
      else list = true;
      continue;
    }
    if (list && pad > indent + 2) {
      const item = /^\s*-\s*(.+)$/.exec(line);
      if (item) job.needs.push(clean(item[1]));
    }
  }
  return out;
}

/** Which workflow job an API job is: its key, by `name:` or key, a matrix's " (…)" aside. */
function keyOf(job, needs) {
  const shown = String(job.name ?? "");
  const bare = shown.replace(/ \(.*\)$/, "");
  for (const [key, j] of needs) {
    const name = j.name ?? key;
    if (name === shown || name === bare || key === shown || key === bare) return key;
    // `name: Build ${{ matrix.os }}`: its fixed start.
    const fixed = name.split("${{")[0].trim();
    if (fixed && name.includes("${{") && shown.startsWith(fixed)) return key;
  }
  return null;
}

/** The jobs in columns, left to right: by `needs:` when the workflow says,
 *  else in waves by time (a job that started after every job of a wave
 *  finished starts the next one). Each column keeps the API's order. */
export function jobColumns(jobs, needs) {
  const list = [...(jobs ?? [])];
  if (!list.length) return [];
  const keys = list.map((j) => (needs?.size ? keyOf(j, needs) : null));
  if (keys.some(Boolean)) {
    const memo = new Map();
    const depth = (key, seen = new Set()) => {
      if (memo.has(key)) return memo.get(key);
      if (seen.has(key)) return 0;
      seen.add(key);
      const d = Math.max(-1, ...(needs.get(key)?.needs ?? []).filter((k) => needs.has(k)).map((k) => depth(k, seen))) + 1;
      memo.set(key, d);
      return d;
    };
    const cols = [];
    list.forEach((j, i) => { const d = keys[i] ? depth(keys[i]) : 0; (cols[d] ??= []).push(j); });
    return cols.filter(Boolean);
  }
  const at = (v) => (v ? Date.parse(v) : NaN);
  const byStart = list.map((j, i) => ({ j, i, s: at(j.started_at) })).sort((a, b) => (a.s || Infinity) - (b.s || Infinity) || a.i - b.i);
  const cols = [];
  let wave = [], end = -Infinity;
  for (const x of byStart) {
    if (wave.length && Number.isFinite(x.s) && x.s >= end && Number.isFinite(end)) { cols.push(wave); wave = []; end = -Infinity; }
    wave.push(x);
    const e = at(x.j.completed_at);
    end = Number.isFinite(e) && end !== Infinity ? Math.max(end, e) : Infinity;
  }
  if (wave.length) cols.push(wave);
  return cols.map((c) => c.sort((a, b) => a.i - b.i).map((x) => x.j));
}

// Color codes, real or as gh prints them without a terminal ("^[[36;1m").
const ANSI = /(?:\x1b|\^\[)\[[0-9;?]*[A-Za-z]/g;
const STAMP = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(\.\d+)?Z ?/;
const sec = (v) => (v ? Math.floor(Date.parse(v) / 1000) : NaN);

/**
 * A job's log split into its steps: step number -> lines (no timestamps).
 * `gh run view --job <id> --log` prefixes every line "job\tstep\t" (often
 * "UNKNOWN STEP"), so lines are placed by time and markers: a
 * `##[group]<name>` naming a later step starts it (an action's step is
 * named "Run owner/action@ref", as its group is); a `##[group]Run ...` starts
 * the next step when that one has a name of its own (a `run:` with `name:`)
 * and has begun; a line later than its step's end moves on to the step
 * running then; the runner's "Post job cleanup." and "Cleaning up orphan
 * processes" open the post steps and "Complete job". Skipped steps get nothing.
 */
export function splitLog(text, steps) {
  const out = new Map();
  const live = [...(steps ?? [])].filter((s) => s.conclusion !== "skipped" && s.started_at).sort((a, b) => a.number - b.number);
  if (!live.length) return out;
  for (const s of live) out.set(s.number, []);
  let cur = 0;
  for (let raw of String(text ?? "").split("\n")) {
    raw = raw.replace(/\r$/, "");
    if (!raw) continue;
    const parts = raw.split("\t");
    let line = (parts.length >= 3 ? parts.slice(2).join("\t") : raw).replace(/^\uFEFF/, "");
    const m = STAMP.exec(line);
    const ts = m ? Math.floor(Date.parse(`${m[1]}Z`) / 1000) : NaN;
    line = (m ? line.slice(m[0].length) : line).replace(/^\uFEFF/, "").replace(ANSI, "");
    const strong = line.startsWith("##[group]") ? live.findIndex((s, i) => i > cur && `##[group]${s.name}` === line) : -1;
    // The runner's own lines that open its post steps and the last one.
    const runner = line === "Post job cleanup." ? (s) => s.name.startsWith("Post ")
      : line === "Cleaning up orphan processes" ? (s) => s.name === "Complete job" : null;
    const opens = runner ? live.findIndex((s, i) => i > cur && runner(s)) : -1;
    if (strong >= 0) cur = strong;
    else if (opens >= 0) cur = opens;
    else if (line.startsWith("##[group]Run ")) {
      const next = live[cur + 1];
      if (next && !next.name.startsWith("Run ") && !(ts < sec(next.started_at))) cur++;
    } else if (Number.isFinite(ts)) {
      while (live[cur + 1] && ts > sec(live[cur].completed_at) && ts >= sec(live[cur + 1].started_at)) cur++;
    }
    out.get(live[cur].number).push(line);
  }
  return out;
}

/** How a log line looks: a group's title, an error, a warning, or plain. */
export function logLine(line) {
  if (line.startsWith("##[group]")) return { kind: "group", text: line.slice(9) };
  if (line.startsWith("##[endgroup]")) return null;
  if (line.startsWith("##[error]")) return { kind: "error", text: line.slice(9) };
  if (line.startsWith("##[warning]")) return { kind: "warning", text: line.slice(11) };
  if (line.startsWith("##[notice]")) return { kind: "notice", text: line.slice(10) };
  if (line.startsWith("##[debug]")) return { kind: "debug", text: line.slice(9) };
  return { kind: "plain", text: line.replace(/\t/g, "    ") };
}

/** "12s", "3m 04s", "1h 02m"; "—" before it started. `now` for still running. */
export function duration(start, end, now = Date.now()) {
  const a = start ? Date.parse(start) : NaN;
  if (!Number.isFinite(a)) return "—";
  const b = end ? Date.parse(end) : now;
  const s = Math.max(0, Math.round((b - a) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
}

/** "now", "4m", "3h", "2d": how long ago. */
export function ago(when, now = Date.now()) {
  const t = when ? Date.parse(when) : NaN;
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  return s < 45 ? "now" : s < 3600 ? `${Math.max(1, Math.round(s / 60))}m` : s < 86400 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 86400)}d`;
}

/** A PR's checks (gh's statusCheckRollup) as rows: name, tone, the run it's in. */
export function checkRows(rollup) {
  return (rollup ?? []).map((c) => {
    const status = c.__typename === "StatusContext" ? (c.state === "PENDING" || c.state === "EXPECTED" ? "pending" : "completed") : c.status;
    const conclusion = c.__typename === "StatusContext" ? c.state : c.conclusion;
    const url = c.detailsUrl ?? c.targetUrl ?? null;
    const run = /\/actions\/runs\/(\d+)/.exec(url ?? "");
    const job = /\/job\/(\d+)/.exec(url ?? "");
    return {
      name: c.name ?? c.context ?? "check", workflow: c.workflowName ?? null,
      tone: tone(status, conclusion), status: String(status ?? "").toLowerCase(),
      runId: run ? Number(run[1]) : null, jobId: job ? Number(job[1]) : null, url,
      started: c.startedAt ?? null, ended: c.completedAt ?? null,
    };
  });
}

/** The checks together: the worst tone wins (failed, working, queued, done). */
export function rollupTone(rows) {
  const tones = new Set(rows.map((r) => r.tone));
  for (const t of ["failed", "working", "queued", "done", "stopped", "skipped"]) if (tones.has(t)) return t;
  return null;
}
