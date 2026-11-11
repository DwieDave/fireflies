// A new pull request, as plain functions: no herdr imports, so scripts/
// tests them. prForm.js draws the form and runs git and gh; this fills the
// title and body the way `gh pr create --fill` does, finds the repo's pull
// request template, reads git's answers, checks the form and builds
// `git push` and `gh pr create`.

/** gh's humanize: a branch name with - and _ as spaces. */
export const humanize = (branch) => String(branch ?? "").replace(/[-_]/g, " ");

/** Title and body from the commits between base and head, oldest first,
 *  as `gh pr create --fill`: one commit gives its subject and body; more
 *  give the branch name and the subjects as a list. */
export function fillFrom(commits, head) {
  const list = commits ?? [];
  if (list.length === 1) return { title: list[0].subject ?? "", body: (list[0].body ?? "").trim() };
  if (!list.length) return { title: humanize(head), body: "" };
  return { title: humanize(head), body: list.map((c) => `- ${c.subject}`).join("\n") };
}

// Where gh looks for a template: the repo's root, .github/ and docs/, any case.
const ONE = /^(\.github\/|docs\/)?pull_request_template(\.md)?$/i;
const MANY = /^(\.github\/|docs\/)?pull_request_template\/[^/]+\.md$/i;

/** The repo's pull request templates among its files: the single one first, then the named ones (PULL_REQUEST_TEMPLATE/*.md), by name. */
export function templatesIn(paths) {
  const one = [], many = [];
  for (const p of paths ?? []) {
    if (ONE.test(p)) one.push(p);
    else if (MANY.test(p)) many.push(p);
  }
  const rank = (p) => (p.toLowerCase().startsWith(".github/") ? 0 : p.includes("/") ? 2 : 1);
  one.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  many.sort((a, b) => a.localeCompare(b));
  return [...one, ...many];
}

/** The body to start with: the template when there is one, else the commits' (`fill`). */
export function startBody(template, fill) {
  const t = String(template ?? "").trim();
  if (!t) return fill ?? "";
  return t;
}

/** `git log --format=%H%x1f%s%x1f%b%x1e` output, newest first as git prints it, to [{ sha, subject, body }] oldest first. */
export function parseLog(text) {
  return String(text ?? "").split("\x1e").map((r) => r.replace(/^\n+/, "")).filter((r) => r.trim()).map((r) => {
    const [sha, subject, body] = r.split("\x1f");
    return { sha: sha.trim(), subject: (subject ?? "").trim(), body: (body ?? "").trim() };
  }).reverse();
}

/** `git diff --numstat` output to { files: [{ path, add, del }], add, del }. */
export function parseNumstat(text) {
  const files = [];
  let add = 0, del = 0;
  for (const line of String(text ?? "").split("\n")) {
    const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line);
    if (!m) continue;
    const a = m[1] === "-" ? 0 : Number(m[1]), d = m[2] === "-" ? 0 : Number(m[2]);
    files.push({ path: m[3], add: a, del: d, binary: m[1] === "-" });
    add += a; del += d;
  }
  return { files, add, del };
}

/** `git for-each-ref --format=%(refname:short)%09%(upstream:short)%09%(upstream:track)` output: [{ name, upstream, ahead, behind, gone }]. */
export function parseBranches(text) {
  const out = [];
  for (const line of String(text ?? "").split("\n")) {
    if (!line.trim()) continue;
    const [name, upstream = "", track = ""] = line.split("\t");
    out.push({
      name, upstream: upstream || null,
      ahead: Number(/ahead (\d+)/.exec(track)?.[1] ?? 0), behind: Number(/behind (\d+)/.exec(track)?.[1] ?? 0),
      gone: /gone/.test(track),
    });
  }
  return out;
}

/** The remote that holds the repo (`owner/name` on `host`), among the folder's (remotes.js candidates), or null. */
export function remoteFor(candidates, full, host = "github.com") {
  return (candidates ?? []).find((c) => c.full.toLowerCase() === String(full).toLowerCase() && c.host === host)?.remote ?? null;
}

/** Whether head needs pushing before the pull request can point at it:
 *  null (it's there and current), or { why, args } with the git push argv.
 *  `onRemote`: GitHub has the branch; `ahead`: local commits it doesn't. */
export function pushPlan({ remote, head, onRemote, ahead = 0, tracking = false }) {
  if (!remote || !head) return null;
  if (!onRemote) return { why: `${head} isn't on ${remote} yet`, args: ["push", "--set-upstream", remote, head] };
  if (ahead > 0) return { why: `${ahead} commit${ahead === 1 ? "" : "s"} of ${head} not on ${remote}`, args: tracking ? ["push", remote, head] : ["push", "--set-upstream", remote, head] };
  return null;
}

/** What's wrong with the form, per field: { base?, head?, title? }. */
export function prErrors(f, { commits = null } = {}) {
  const e = {};
  if (!f.base) e.base = "Pick the branch to merge into.";
  if (!f.head) e.head = "Pick the branch with the changes.";
  if (f.base && f.head && f.base === f.head && !f.headOwner) e.head = "Head and base are the same branch.";
  if (!String(f.title ?? "").trim()) e.title = "A pull request needs a title.";
  if (!e.head && !e.base && commits && commits.length === 0) e.head = `No commits between ${f.base} and ${f.head}.`;
  return e;
}

/** `gh pr create` argv (without -R). `headOwner`: a fork's owner, for a pull request into its parent. */
export function prArgs(f) {
  const args = ["pr", "create", "--base", f.base, "--head", f.headOwner ? `${f.headOwner}:${f.head}` : f.head, "--title", String(f.title).trim(), "--body", f.body ?? ""];
  if (f.draft) args.push("--draft");
  for (const [flag, list] of [["--reviewer", f.reviewers], ["--assignee", f.assignees], ["--label", f.labels]]) {
    if (list?.length) args.push(flag, list.join(","));
  }
  if (f.milestone) args.push("--milestone", f.milestone);
  return args;
}

/** The new pull request's number, from what gh printed (its URL). */
export function createdNumber(out) {
  const m = /\/pull\/(\d+)/.exec(String(out ?? ""));
  return m ? Number(m[1]) : null;
}
