// Everything agents need from the person, as items, from any agent:
//
//   sources   herdr-core's status of every terminal (terminals(): blocked,
//             error, with the agent's own report { kind, msg }), placed
//             by agents() (space, tab); plus an adapter's details where the
//             agent offers them (the screen, a hook record).
//   adapters  one per agent family: { id, handles(terminal), describe(screen,
//             record), step(goal, screen, state), hook }. `describe` turns the
//             screen (and the hook record, if the adapter has one) into the
//             exact request; `step` answers it a key at a time (claude.js).
//             An agent no adapter knows gets the generic one: herdr-core's
//             words for what it waits on and the end of its screen, with
//             peek and go to. To add Codex, pi, opencode: write
//             <agent>.js with describe/step and list it in ADAPTERS.
//   types     "permission", "question", "other" (an error, or waiting for
//             input that is neither): the overview's groups. A finished agent
//             isn't one: the sidebar and Fireflies' own toast tell about it.
//
// Pure: no herdr imports (scripts/nocturne-notifications.test.ts).

import * as claude from "./claude.js";

export const TYPES = ["permission", "question", "other"];

/** The generic adapter: herdr-core's words for the request and the screen's last lines. */
export const generic = {
  id: "generic",
  handles: () => true,
  describe: () => null,
  step: null,
  hook: false,
};

export const ADAPTERS = [
  {
    id: "claude",
    handles: (t) => /claude/.test(String(t?.report?.app ?? t?.program?.key ?? "")),
    describe: claude.describe,
    step: claude.step,
    dialog: claude.dialog,
    hook: true,
  },
  generic,
];

export const adapterOf = (t) => ADAPTERS.find((a) => a.handles(t)) ?? generic;

/** The last lines of a screen that say something (for the generic view). */
export function tail(screen, n = 14) {
  const ls = String(screen ?? "").replace(/\r/g, "").split("\n").map((l) => l.replace(/\s+$/, ""));
  while (ls.length && !ls[ls.length - 1].trim()) ls.pop();
  const out = [];
  for (let i = ls.length - 1; i >= 0 && out.length < n; i--) {
    if (/^[─━╌]{8,}$/.test(ls[i].trim())) continue;
    if (!ls[i].trim() && !out.length) continue;
    out.unshift(ls[i]);
  }
  // Drop leading blanks and squeeze runs of blank lines.
  return out.filter((l, i) => l.trim() || (i > 0 && out[i - 1].trim())).join("\n").replace(/^\n+/, "");
}

/** "machine/t3" -> { machine: "machine", id: "t3" }; "t3" -> { machine: null, id: "t3" }. */
export function splitAddress(address) {
  const i = String(address).lastIndexOf("/");
  return i < 0 ? { machine: null, id: address } : { machine: address.slice(0, i), id: address.slice(i + 1) };
}

/** A terminal's status word: blocked, done, error, working, idle, or null. */
export function statusOf(t) {
  return t?.report?.state ?? (typeof t?.status === "string" ? t.status : null);
}

/** What the terminal needs: "permission" | "question" | "other" | null. */
export function typeOf(status, kind, described) {
  if (status === "blocked") {
    if (described?.type) return described.type;
    if (kind === "permission" || kind === "question") return kind;
    return "other";
  }
  if (status === "error") return "other";
  return null;
}

/**
 * The items, newest first within a type:
 *   { id, address, machine, adapter, type, status, kind, msg, name, app, logo,
 *     space, spaceName, tab, tabName, since, request (adapter's describe) | null,
 *     tail (screen's end) | null, answerable }
 * `info` per address: { screen, record } as last read. `agents`: agents() for
 * names and places; a sub-agent (no pane) goes by its parent's place.
 */
export function collect({ terminals = [], agents = [], info = {}, names = {}, dismissed = {}, since: began = {} }) {
  const byAddr = new Map(agents.map((a) => [a.address, a]));
  const items = [];
  for (const t of terminals) {
    if (!t?.address || t.state === "finished") continue;
    const status = statusOf(t);
    if (status !== "blocked" && status !== "error") continue;
    const adapter = adapterOf(t);
    const got = info[t.address] ?? {};
    const request = got.screen != null && status === "blocked" ? adapter.describe(got.screen, got.record ?? null) : null;
    const type = typeOf(status, t.report?.kind ?? null, request);
    const since = began[t.address] ?? (Number(t.status_ms) || 0);
    const id = `${t.address}@${since}`;
    if (type === "other" && dismissed[id]) continue;
    let place = byAddr.get(t.address);
    for (let p = t.parent, hops = 0; !place && p && hops < 8; hops++) {
      place = byAddr.get(p);
      p = terminals.find((x) => x.address === p)?.parent;
    }
    // Fireflies' screens leave out terminals that aren't in a space (another app's): so does this.
    if (!place && !t.labels?.["herdr.space"]) continue;
    const app = t.report?.app ?? place?.app ?? null;
    const { machine } = splitAddress(t.address);
    items.push({
      id, address: t.address, machine, adapter: adapter.id, type, status,
      kind: t.report?.kind ?? null, msg: t.report?.msg ?? "",
      name: names[t.address] || t.name || t.program?.name || place?.program?.name || app || t.address,
      program: t.program?.name ?? place?.program?.name ?? app ?? "",
      app, logo: logoKey(app ?? t.program?.key),
      space: place?.space ?? null, spaceName: place?.space_name ?? "", tab: place?.tab ?? null,
      tabName: place && place.tab_name !== String(place.tab_index) ? place.tab_name : "", tabIndex: place?.tab_index ?? null,
      since, request, tail: got.screen != null ? tail(got.screen) : null,
      answerable: Boolean(request && adapter.step),
    });
    const it = items[items.length - 1];
    // For readers outside this mod (Nocturne's toasts): the words as the overview says them.
    it.title = `${it.name} ${headline(it)}`;
    it.line = summary(it);
  }
  return items.sort((a, b) => TYPES.indexOf(a.type) - TYPES.indexOf(b.type) || b.since - a.since);
}

/** { permission: [...], question: [...], other: [...] }. */
export function group(items) {
  const g = { permission: [], question: [], other: [] };
  for (const it of items) g[it.type]?.push(it);
  return g;
}

/** Counts per type, and how many need the person (permissions and questions). */
export function counts(items) {
  const g = group(items);
  return { permission: g.permission.length, question: g.question.length, other: g.other.length, needs: g.permission.length + g.question.length };
}

const LOGOS = { claude: "claude", "claude-code": "claude", opencode: "opencode", pi: "pi", codex: "codex" };
export const logoKey = (app) => LOGOS[app] ?? "agent";

/** "just now", "40s", "4m", "2h", "3d". */
export function age(since, now = Date.now()) {
  if (!since) return "";
  const s = Math.max(0, Math.round((now - since) / 1000));
  if (s < 10) return "just now";
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

/** The headline for an item: what the agent wants, in a few words. */
export function headline(it) {
  const r = it.request;
  if (it.type === "permission") {
    const tool = r?.tool ?? "";
    if (/^(Bash|Bash command|PowerShell)$/.test(tool)) return "wants to run a command";
    if (/^(Write|Create file)$/.test(tool)) return "wants to create a file";
    if (/^(Edit|MultiEdit|Edit file|NotebookEdit)$/.test(tool)) return "wants to edit a file";
    if (/^(WebFetch|Fetch)$/.test(tool)) return "wants to fetch a page";
    if (/^mcp__/.test(tool)) return `wants to use ${tool.replace(/^mcp__/, "").replace(/__/g, " · ")}`;
    return tool ? `wants to use ${tool}` : "asks for permission";
  }
  if (it.type === "question") {
    const n = r?.questions?.length ?? 0;
    return n > 1 ? `asks ${n} questions` : "asks a question";
  }
  if (it.status === "error") return "stopped with an error";
  return "waits for you";
}

/** "fireflies / 2 fix login", "vps · deploy / 1". */
export function where(it) {
  const tab = [it.tabIndex, it.tabName].filter((x) => x != null && x !== "").join(" ");
  const place = it.spaceName ? (tab ? `${it.spaceName} / ${tab}` : it.spaceName) : "";
  return [it.machine, place].filter(Boolean).join(" · ");
}

/** One line under the agent's name in the list. */
export function summary(it) {
  const r = it.request;
  if (r?.type === "permission") return [r.tool, r.line].filter(Boolean).join(" · ");
  if (r?.type === "question") return r.questions.map((q) => q.header || q.question).join(", ");
  if (it.msg) return it.msg;
  if (it.status === "error") return "error";
  return "needs input";
}
