// Talking to GitHub through the gh CLI (its own login; this mod keeps no
// token). REST reads go through `gh api -i` with the last ETag, so an
// unchanged answer is a 304 that costs nothing against the rate limit and
// hands back the copy kept here. A space on another machine runs gh there.

import { exec } from "herdr";
import { parseHeaders } from "./model.js";

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

/** The GitHub repo of a folder: { owner, name, full, root, branch, base, url }, or null when it has none. */
export async function repoOf(folder, on) {
  if (!folder) return null;
  const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: folder, on: on ?? undefined }).catch(() => null);
  if (!top || top.code !== 0) return null;
  const root = top.stdout.trim();
  const r = await gh(["repo", "view", "--json", "nameWithOwner,defaultBranchRef,url"], { cwd: root, on });
  if (r.code !== 0) {
    if (/no git remotes|not a git|none of the git remotes|could not determine/i.test(r.stderr)) return null;
    throw new Error(why(r));
  }
  const j = JSON.parse(r.stdout);
  const branch = await exec("git", ["branch", "--show-current"], { cwd: root, on: on ?? undefined }).catch(() => null);
  const [owner, name] = j.nameWithOwner.split("/");
  return { owner, name, full: j.nameWithOwner, root, on: on ?? null, url: j.url, base: j.defaultBranchRef?.name ?? null, branch: branch?.stdout.trim() || null };
}

/** A REST read: { data, changed } (changed false when GitHub said 304). */
export async function api(repo, path, { fresh = false } = {}) {
  const key = `${repo.on ?? ""}|${path}`;
  const kept = fresh ? null : cache.get(key);
  const args = ["api", "-i", ...(kept?.etag ? ["-H", `If-None-Match: ${kept.etag}`] : []), path];
  const r = await gh(args, { cwd: repo.root, on: repo.on });
  const { status, etag, body } = parseHeaders(r.stdout);
  if (status === 304 && kept) return { data: kept.data, changed: false };
  if (status >= 200 && status < 300) {
    const data = body ? JSON.parse(body) : null;
    cache.set(key, { etag, data });
    return { data, changed: true };
  }
  if (status) {
    let msg = `GitHub said ${status}`;
    try { msg = JSON.parse(body).message ?? msg; } catch { /* not JSON */ }
    throw new Error(status === 403 && /rate limit/i.test(msg) ? "GitHub's rate limit is used up for now; trying again shortly." : msg);
  }
  throw new Error(why(r));
}

/** A gh command that prints JSON (`gh pr list --json ...`). */
export async function ghJson(repo, args) {
  const r = await gh([...args, "-R", repo.full], { cwd: repo.root, on: repo.on });
  if (r.code !== 0) throw new Error(why(r));
  return JSON.parse(r.stdout || "null");
}

/** A gh command run for its text or its effect: { ok, out, err }. */
export async function ghRun(repo, args, { timeout } = {}) {
  const r = await gh([...args, "-R", repo.full], { cwd: repo.root, on: repo.on, timeout });
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
