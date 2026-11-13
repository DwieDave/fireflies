// Which GitHub repo a folder is, from its git remotes, without asking gh to
// guess: `gh repo view` in a fork with an `upstream` remote answers the
// parent. Plain functions over `git config` output: no herdr imports, so
// scripts/ tests it. gh.ts reads the config and asks GitHub about the pick.
//
// The order:
//   1. gh's own default, if the user set one (`gh repo set-default` writes
//      remote.<name>.gh-resolved = base, or an owner/name);
//   2. the remote the current branch pushes to or tracks:
//      branch.<b>.pushRemote, remote.pushDefault, branch.<b>.remote;
//   3. origin;
//   4. the other remotes, in the config's order.
// Only remotes on GitHub count (github.com, its ssh host aliases, *.ghe.com,
// hosts named github…); none at all means gh.ts lets gh pick as before.

/** A remote's GitHub repo. */
export interface RemoteRepo {
  readonly host: string;
  readonly owner: string;
  readonly name: string;
}

/** Why a remote was picked. */
export type Why = "gh default" | "branch push" | "push default" | "branch remote" | "origin" | "remote";

/** A GitHub remote of the folder, as candidates() ranks them. */
export interface Candidate extends RemoteRepo {
  readonly remote: string;
  readonly full: string;
  readonly why: Why;
}

/** What slug() reads of a repo: its host and owner/name. */
export interface Slugged {
  readonly host?: string | null | undefined;
  readonly full: string;
}

/** `git config --get-regexp` output as [key, value] pairs, keys as git prints them (section and variable lowercased). */
export function parseConfig(text: string): [string, string][] {
  const out: [string, string][] = [];

  for (const line of text.split("\n")) {
    if (!line.trim()) continue;

    const at = line.indexOf(" ");

    out.push(at < 0 ? [line, ""] : [line.slice(0, at), line.slice(at + 1).trim()]);
  }

  return out;
}

/** A remote URL's GitHub repo: { host, owner, name }, or null when it isn't one. */
export function parseRemoteUrl(url: string | null | undefined): RemoteRepo | null {
  const u = (url ?? "").trim();
  // https://, ssh://, git:// ; else git@github.com:owner/name
  const m = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]*@)?([^/:]+)(?::\d+)?\/(.+)$/i.exec(u) ?? /^(?:[^@/]+@)?([^/:]+):(?!\/)(.+)$/.exec(u);
  const host = m?.[1], path = m?.[2];

  if (host === undefined || path === undefined) return null;

  const parts = path.replace(/\/+$/, "").replace(/\.git$/i, "").split("/").filter(Boolean);
  const [owner, name] = parts;

  if (parts.length !== 2 || owner === undefined || name === undefined) return null;

  const h = githubHost(host);

  return h ? { host: h, owner, name } : null;
}

/** The GitHub host a remote's host stands for, or null when it isn't GitHub. */
export function githubHost(host: string): string | null {
  const h = host.toLowerCase();

  if (h === "github.com" || h === "www.github.com" || h === "ssh.github.com") return "github.com";

  if (h.endsWith(".ghe.com")) return h;

  if (/^github(\.com)?([-_]|$)/.test(h)) return "github.com"; // ssh host aliases: github-work, github.com-work

  if (/(^|\.)github\./.test(h)) return h; // GitHub Enterprise: github.example.com

  return null;
}

/** A remote's url and gh's resolved default (remote.<name>.gh-resolved). */
interface Remote {
  url?: string;
  resolved?: string;
}

/** The folder's GitHub remotes, best first: [{ remote, host, owner, name, full, why }]. */
export function candidates(configText: string, branch: string | null = null): Candidate[] {
  const cfg = parseConfig(configText);
  const remotes = new Map<string, Remote>(); // name -> { url, resolved }, in the config's order

  const get = (key: string): string | null => {
    let v: string | null = null;

    for (const [k, x] of cfg) if (k === key) v = x;

    return v;
  };

  for (const [k, v] of cfg) {
    const m = /^remote\.(.+)\.(url|gh-resolved)$/.exec(k);
    const name = m?.[1];

    if (name === undefined) continue;

    const r = remotes.get(name) ?? {};

    if (m?.[2] === "url") r.url ??= v;
    else r.resolved = v;

    remotes.set(name, r);
  }

  const out: Candidate[] = [];

  const add = (name: string | null, why: Why, repo: RemoteRepo | null = null) => {
    if (!name || name === ".") return;

    const r = remotes.get(name);
    const p = repo ?? parseRemoteUrl(r?.url);

    if (!p) return;

    const c = { remote: name, host: p.host, owner: p.owner, name: p.name, full: `${p.owner}/${p.name}`, why };

    if (!out.some((o) => o.full === c.full && o.host === c.host)) out.push(c);
  };

  // 1. gh's default: "base" means this remote's repo; an owner/name names one.
  for (const [name, r] of remotes) {
    if (!r.resolved) continue;

    const named = /^([^/\s]+)\/([^/\s]+)$/.exec(r.resolved);
    const own = parseRemoteUrl(r.url);
    const owner = named?.[1], repo = named?.[2];

    if (owner !== undefined && repo !== undefined && own) add(name, "gh default", { host: own.host, owner, name: repo });
    else if (r.resolved === "base") add(name, "gh default");
  }

  // 2. where the current branch goes; 3. origin; 4. the rest.
  if (branch) {
    add(get(`branch.${branch}.pushremote`), "branch push");
    add(get("remote.pushdefault"), "push default");
    add(get(`branch.${branch}.remote`), "branch remote");
  } else {
    add(get("remote.pushdefault"), "push default");
  }

  add("origin", "origin");

  for (const name of remotes.keys()) add(name, "remote");

  return out;
}

/** What gh's -R takes for a repo: owner/name, or host/owner/name off github.com. */
export const slug = (r: Slugged | null | undefined): string => (r?.host && r.host !== "github.com" ? `${r.host}/${r.full}` : r?.full ?? "");
