// What the GitHub window keeps between openings: the last pull requests,
// PR details, runs, jobs and workflow needs it read, per repo, so a window
// shows them at once and reads GitHub again behind them (store.js writes it
// to the app's data folder). Plain functions over plain JSON: no herdr
// imports, so scripts/ tests it.
//
// Only what the window draws is kept (slim*), the file stays under a byte
// budget (fit), the least recently opened repos go first (prune), and
// nothing that looks like a credential is ever written (scrub).

export const VERSION = 1;
// readTextFile/writeTextFile stop at 1 MiB; stay well under it.
export const MAX_BYTES = 768 * 1024;
export const LIMITS = { repos: 8, details: 16, jobs: 10, needs: 12, lists: 3, runs: 4 };

/** An empty cache document. */
export const blank = () => ({ v: VERSION, folders: {}, repos: {} });

/** A cache document read from disk, or a blank one when it's missing, broken or old. */
export function parse(text) {
  try {
    const d = JSON.parse(String(text ?? ""));
    if (d?.v === VERSION && d.repos && typeof d.repos === "object" && d.folders && typeof d.folders === "object") return d;
  } catch { /* broken: start over */ }
  return blank();
}

export const repoKey = (repo) => `${repo?.on ?? ""}|${repo?.full ?? ""}`;
export const folderKey = (folder, on) => `${on ?? ""}|${folder ?? ""}`;

/** The repo entry a space's folder last showed (its repo and data), or null. */
export function lookup(doc, folder, on) {
  const key = doc?.folders?.[folderKey(folder, on)];
  return key ? doc.repos?.[key] ?? null : null;
}

/** A fresh entry for a repo. */
export const entryFor = (repo) => ({ at: 0, repo: slimRepo(repo), prs: { lists: {}, details: {} }, actions: { runs: {}, jobs: {}, needs: {} } });

// ---- slim: only the fields the window shows

const pick = (o, keys) => {
  if (!o || typeof o !== "object") return o ?? null;
  const out = {};
  for (const k of keys) if (o[k] !== undefined) out[k] = o[k];
  return out;
};
const login = (a) => (a ? { login: a.login ?? null } : null);

export function slimRepo(r) {
  return r ? { owner: r.owner, name: r.name, full: r.full, root: r.root, on: r.on ?? null, url: scrubUrl(r.url), base: r.base ?? null, branch: r.branch ?? null } : null;
}

/** A pull request's row in the list. */
export function slimPrRow(p) {
  return {
    ...pick(p, ["number", "title", "isDraft", "headRefName", "additions", "deletions", "reviewDecision", "updatedAt", "tone", "rollup"]),
    author: login(p.author),
    labels: (p.labels ?? []).map((l) => pick(l, ["name", "color"])),
  };
}

const CHECK = ["__typename", "name", "context", "workflowName", "status", "conclusion", "state", "detailsUrl", "targetUrl", "startedAt", "completedAt"];

/** A pull request as the right panel draws it (gh pr view's JSON). */
export function slimPr(pr) {
  if (!pr) return null;
  return {
    ...pick(pr, ["number", "title", "body", "isDraft", "baseRefName", "headRefName", "reviewDecision", "url", "createdAt", "updatedAt", "additions", "deletions", "changedFiles"]),
    author: login(pr.author),
    labels: (pr.labels ?? []).map((l) => pick(l, ["name", "color"])),
    statusCheckRollup: (pr.statusCheckRollup ?? []).map((c) => pick(c, CHECK)),
    comments: (pr.comments ?? []).map((c) => ({ ...pick(c, ["body", "createdAt", "url"]), author: login(c.author) })),
    reviews: (pr.reviews ?? []).map((r) => ({ ...pick(r, ["state", "body", "submittedAt"]), author: login(r.author) })),
  };
}

/** A review (line) comment, from the REST API. */
export function slimReviewComment(c) {
  return { ...pick(c, ["body", "created_at", "path", "line", "original_line", "in_reply_to_id", "html_url"]), user: login(c.user) };
}

/** A workflow run, from the REST API (its full answer is ~12 KB a run). */
export function slimRun(r) {
  return pick(r, ["id", "name", "display_title", "status", "conclusion", "run_number", "head_branch", "head_sha", "event", "path", "run_started_at", "updated_at", "html_url"]);
}

export function slimJob(j) {
  return {
    ...pick(j, ["id", "name", "status", "conclusion", "started_at", "completed_at", "html_url"]),
    steps: (j.steps ?? []).map((s) => pick(s, ["number", "name", "status", "conclusion", "started_at", "completed_at"])),
  };
}

// ---- secrets: never written

const SECRET_KEY = /^(token|access_?token|refresh_?token|oauth_?token|authorization|auth|password|passwd|secret|client_?secret|private_?key|api_?key|cookie)$/i;
const SECRET_TEXT = /\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g;

/** A URL without user:password@ in it. */
export function scrubUrl(u) {
  return typeof u === "string" ? u.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@\s]*@/i, "$1") : u ?? null;
}

/** A copy without credential-named keys, GitHub tokens or URL credentials. */
export function scrub(v) {
  if (typeof v === "string") return scrubUrl(v).replace(SECRET_TEXT, "[redacted]");
  if (Array.isArray(v)) return v.map(scrub);
  if (!v || typeof v !== "object") return v;
  const out = {};
  for (const [k, x] of Object.entries(v)) if (!SECRET_KEY.test(k)) out[k] = scrub(x);
  return out;
}

// ---- bounds

/** Keeps the newest `n` entries of an object of { at } values. */
export function newest(obj, n) {
  const kept = Object.entries(obj ?? {}).sort((a, b) => (b[1]?.at ?? 0) - (a[1]?.at ?? 0)).slice(0, Math.max(0, n));
  return Object.fromEntries(kept);
}

/** Bounds every part of the document by count: the last repos opened, and in each the newest details, jobs, needs, lists. */
export function prune(doc, limits = LIMITS) {
  const repos = newest(doc.repos, limits.repos);
  for (const e of Object.values(repos)) {
    e.prs = { lists: newest(e.prs?.lists, limits.lists), details: newest(e.prs?.details, limits.details) };
    e.actions = { runs: newest(e.actions?.runs, limits.runs), jobs: newest(e.actions?.jobs, limits.jobs), needs: newest(e.actions?.needs, limits.needs) };
  }
  const folders = {};
  for (const [f, k] of Object.entries(doc.folders ?? {})) if (repos[k]) folders[f] = k;
  return { v: VERSION, folders, repos };
}

/** The document as text under `max` bytes: drops the oldest pieces (whole repos
 *  other than `keep`, then details, jobs, needs, lists) until it fits. */
export function fit(doc, max = MAX_BYTES, keep = null) {
  let d = prune(doc);
  let text = JSON.stringify(d);
  if (bytes(text) <= max) return text;
  const pieces = [];
  for (const [k, e] of Object.entries(d.repos)) {
    if (k !== keep) pieces.push({ at: e.at ?? 0, drop: () => { delete d.repos[k]; } });
    for (const [part, sub] of [["prs", "details"], ["prs", "lists"], ["actions", "jobs"], ["actions", "needs"], ["actions", "runs"]]) {
      for (const [id, x] of Object.entries(e[part]?.[sub] ?? {})) pieces.push({ at: x?.at ?? 0, drop: () => { delete e[part][sub][id]; } });
    }
  }
  pieces.sort((a, b) => a.at - b.at);
  // Drop in growing batches: each round costs one stringify.
  let i = 0, batch = Math.max(1, Math.ceil(pieces.length / 16));
  while (i < pieces.length) {
    for (const p of pieces.slice(i, i + batch)) p.drop();
    i += batch;
    d = prune(d);
    text = JSON.stringify(d);
    if (bytes(text) <= max) return text;
  }
  return JSON.stringify(blank());
}

function bytes(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c >= 0xd800 && c < 0xdc00 ? (i++, 4) : 3;
  }
  return n;
}

/** Puts this window's entry for `repo` (seen in `folder`) into the document read from disk:
 *  other repos (other windows') stay as they are. Returns the text to write. */
export function merge(disk, folder, entry, now = Date.now(), max = MAX_BYTES) {
  const d = parse(typeof disk === "string" ? disk : JSON.stringify(disk ?? blank()));
  const key = repoKey(entry.repo);
  d.repos[key] = scrub({ ...entry, at: now });
  if (folder) d.folders[folderKey(folder, entry.repo?.on)] = key;
  return fit(d, max, key);
}
