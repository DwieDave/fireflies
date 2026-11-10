// Talking to GitHub through the gh CLI (its own login; this mod keeps no
// token). REST reads go through `gh api -i` with the last ETag, so an
// unchanged answer is a 304 that costs nothing against the rate limit and
// hands back the copy kept here. A space on another machine runs gh there.

import { exec } from "herdr";
import { parseHeaders } from "./model.js";
import { candidates, slug } from "./remotes.js";

const cache = new Map(); // `${on}|${path}` -> { etag, data }

/** Why gh failed, in a person's words. */
function why(r) {
  const err = `${r?.stderr ?? ""}`.trim();
  if (/not logged|gh auth login|authentication/i.test(err)) return "gh isn't logged in: run `gh auth login`.";
  if (/rate limit/i.test(err)) return "GitHub's rate limit is used up for now; trying again shortly.";
  if (/could not resolve|network|timeout|dial tcp|no such host/i.test(err)) return "GitHub can't be reached right now.";
  return err.split("\n").filter(Boolean).pop() || "gh didn't answer.";
}

async function gh(args, { cwd, on, timeout = 30000 } = {}) {
  try {
    return await exec("gh", args, { cwd, on: on ?? undefined, timeout });
  } catch (e) {
    const msg = String(e?.message ?? e);
    throw new Error(/ENOENT|not found|cannot start|No such file/i.test(msg) ? "gh isn't installed: the GitHub window talks to GitHub through the gh CLI." : msg);
  }
}

const VIEW = "nameWithOwner,defaultBranchRef,url,isFork,parent";
const gone = (r) => /could not resolve to a repository|HTTP 404|not found/i.test(r?.stderr ?? "");

/** The GitHub repo of a folder: { owner, name, full, host, root, on, url, base, branch, parent }, or null when it has none.
 *  Which repo is picked from the folder's remotes (remotes.js: gh's default, the branch's push remote, origin, …),
 *  not by gh's guess, which in a fork with an `upstream` remote is the parent. */
export async function repoOf(folder, on) {
  if (!folder) return null;
  const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: folder, on: on ?? undefined }).catch(() => null);
  if (!top || top.code !== 0) return null;
  const root = top.stdout.trim();
  const [cfg, br] = await Promise.all([
    exec("git", ["config", "--get-regexp", "^(remote|branch)\\."], { cwd: root, on: on ?? undefined }).catch(() => null),
    exec("git", ["branch", "--show-current"], { cwd: root, on: on ?? undefined }).catch(() => null),
  ]);
  const branch = br?.stdout.trim() || null;
  const list = candidates(cfg?.code === 0 ? cfg.stdout : "", branch);
  // No remote on a known GitHub host (an enterprise host by another name): gh picks, as it always did.
  if (!list.length) return viewRepo(null, { root, on, branch });
  for (const c of list) {
    const r = await viewRepo(c, { root, on, branch }, { quiet: true });
    if (r) return r;
  }
  return null;
}

/** GitHub's word on a repo ({ full, host }, or null: the folder's, as gh resolves it), for a folder of it. */
export async function viewRepo(want, { root, on, branch = null }, { quiet = false } = {}) {
  const r = await gh(["repo", "view", ...(want ? [slug(want)] : []), "--json", VIEW], { cwd: root, on });
  if (r.code !== 0) {
    if (quiet && gone(r)) return null;
    if (/no git remotes|not a git|none of the git remotes|could not determine/i.test(r.stderr)) return null;
    throw new Error(why(r));
  }
  const j = JSON.parse(r.stdout);
  const [owner, name] = j.nameWithOwner.split("/");
  const parent = j.isFork && j.parent?.owner?.login && j.parent?.name ? `${j.parent.owner.login}/${j.parent.name}` : null;
  return { owner, name, full: j.nameWithOwner, host: want?.host ?? "github.com", root, on: on ?? null, url: j.url, base: j.defaultBranchRef?.name ?? null, branch, parent };
}

/** gh api's --hostname for a repo off github.com. */
const hostArgs = (repo) => (repo?.host && repo.host !== "github.com" ? ["--hostname", repo.host] : []);

/** A REST read: { data, etag, changed } (changed false when GitHub said 304).
 *  `prior` ({ etag, data }, e.g. from the window's cache) is what a 304 hands
 *  back; without it the last answer kept here is. `slim` shrinks the answer
 *  before it's kept (only what the window draws). `fresh` skips the ETag. */
export async function api(repo, path, { fresh = false, prior = null, slim = null } = {}) {
  const key = `${repo.on ?? ""}|${path}`;
  const kept = fresh ? null : prior?.etag && prior.data != null ? prior : cache.get(key);
  const args = ["api", "-i", ...hostArgs(repo), ...(kept?.etag ? ["-H", `If-None-Match: ${kept.etag}`] : []), path];
  const r = await gh(args, { cwd: repo.root, on: repo.on });
  const { status, etag, body } = parseHeaders(r.stdout);
  if (status === 304 && kept) return { data: kept.data, etag: kept.etag, changed: false };
  if (status >= 200 && status < 300) {
    let data = body ? JSON.parse(body) : null;
    if (slim && data != null) data = slim(data);
    cache.set(key, { etag, data });
    return { data, etag, changed: true };
  }
  if (status) {
    let msg = `GitHub said ${status}`;
    try { msg = JSON.parse(body).message ?? msg; } catch { /* not JSON */ }
    throw new Error(status === 403 && /rate limit/i.test(msg) ? "GitHub's rate limit is used up for now; trying again shortly." : msg);
  }
  throw new Error(why(r));
}

/** A GraphQL read (only the fields asked for): its `data`. `partial`: data that
 *  came back beside errors (one owner GitHub won't show, say) is used, unless a scope is missing. */
export async function graphql(repo, query, vars = {}, { partial = false } = {}) {
  const args = ["api", "graphql", ...hostArgs(repo), "-f", `query=${query}`];
  for (const [k, v] of Object.entries(vars)) args.push(typeof v === "number" ? "-F" : "-f", `${k}=${v}`);
  const r = await gh(args, { cwd: repo.root, on: repo.on });
  let j = null;
  try { j = JSON.parse(r.stdout || "null"); } catch { /* not JSON */ }
  if (j?.data && !j.errors?.length) return j.data;
  if (partial && j?.data && !j.errors.some((e) => e?.type === "INSUFFICIENT_SCOPES")) return j.data;
  if (j?.errors?.length) throw new Error(j.errors[0].message ?? "GitHub didn't answer.");
  throw new Error(why(r));
}

/** A gh command that prints JSON (`gh pr list --json ...`). */
export async function ghJson(repo, args) {
  const r = await gh([...args, "-R", slug(repo)], { cwd: repo.root, on: repo.on });
  if (r.code !== 0) throw new Error(why(r));
  return JSON.parse(r.stdout || "null");
}

/** A gh command run for its text or its effect: { ok, out, err }. */
export async function ghRun(repo, args, { timeout } = {}) {
  const r = await gh([...args, "-R", slug(repo)], { cwd: repo.root, on: repo.on, timeout });
  return { ok: r.code === 0, out: r.stdout, err: r.code === 0 ? "" : why(r) };
}

/** A file of the repo at a commit (the workflow behind a run), or null. */
export async function fileAt(repo, path, ref) {
  try {
    const { data } = await api(repo, `repos/${repo.full}/contents/${path}?ref=${encodeURIComponent(ref)}`);
    return data?.content ? unbase64(data.content.replace(/\s/g, "")) : null;
  } catch {
    return null;
  }
}

/** Base64 to text (the mod runtime may not have atob). */
function unbase64(s) {
  if (typeof atob === "function") return atob(s);
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "", bits = 0, n = 0;
  for (const ch of s) {
    const v = A.indexOf(ch);
    if (v < 0) continue;
    bits = (bits << 6) | v; n += 6;
    if (n >= 8) { n -= 8; out += String.fromCharCode((bits >> n) & 255); }
  }
  return out;
}
