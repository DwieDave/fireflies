// Everything agents need from the person, as items, from any agent:
//
//   sources   herdr-core's status of every terminal (terminals(): blocked,
//             error, with the agent's own report { kind, msg }), placed
//             by agents() (space, tab); plus an adapter's details where the
//             agent offers them (the screen, a hook record).
//   adapters  one per agent family: { id, handles(terminal), describe(screen,
//             record), step(goal, screen, state), hook }. `describe` turns the
//             screen (and the hook record, if the adapter has one) into the
//             exact request; `step` answers it a key at a time (claude.ts).
//             An agent no adapter knows gets the generic one: herdr-core's
//             words for what it waits on and the end of its screen, with
//             peek and go to. To add Codex, pi, opencode: write
//             <agent>.ts with describe/step and list it in ADAPTERS.
//   types     "permission", "question", "other" (an error, or waiting for
//             input that is neither): the overview's groups. A finished agent
//             isn't one: the sidebar and Fireflies' own toast tell about it.
//

import type { Guarded } from "./guard.ts";
import { isBoolean, isNumber, isString, literal, nullable, object } from "./guard.ts";
import * as claude from "./claude.ts";
import type { HookRecord, Request, Step, Goal } from "./claude.ts";

/** A status that waits on the person: an agent blocked on them, or one that failed. */
const isWaiting = literal("blocked", "error");

/** What an item asks of the person: the overview's groups. */
export type ItemType = "permission" | "question" | "other";

export const TYPES: readonly ItemType[] = ["permission", "question", "other"];

/** A terminal as terminals() (herdr-core's listing) has it: the fields read here. */
export const isTerminal = object({ address: isString }, {
  state: nullable(isString),
  status: nullable(isString),
  status_ms: nullable(isNumber),
  // The agent's own report.
  report: nullable(object({}, { state: nullable(isString), kind: nullable(isString), msg: nullable(isString), app: nullable(isString) })),
  parent: nullable(isString),
  labels: nullable(object({}, { "herdr.space": isString, "nocturne.name": isString })),
  name: nullable(isString),
  program: nullable(object({}, { key: nullable(isString), name: nullable(isString) })),
});

export type Terminal = Guarded<typeof isTerminal>;

/** What picks an adapter: the agent's report, else its program. */
export interface AgentKind {
  readonly report?: { readonly app?: string | null | undefined } | null | undefined;
  readonly program?: { readonly key?: string | null | undefined } | null | undefined;
}

/** One agent family: which terminals it knows, how it reads their request off the screen
 *  (and its hook record), how it answers a key at a time. */
export interface Adapter {
  readonly id: "claude" | "generic";
  readonly handles: (t: AgentKind) => boolean;
  readonly describe: (screen: string | null, record: HookRecord | null) => Request | null;
  readonly step: ((goal: Goal, screen: string, state: claude.StepState) => Step) | null;
  readonly dialog?: (screen: string) => string;
  readonly hook: boolean;
}

/** The generic adapter: herdr-core's words for the request and the screen's last lines. */
export const generic: Adapter = {
  id: "generic",
  handles: () => true,
  describe: () => null,
  step: null,
  hook: false,
};

export const ADAPTERS: readonly Adapter[] = [
  {
    id: "claude",
    handles: (t) => /claude/.test(t.report?.app ?? t.program?.key ?? ""),
    describe: claude.describe,
    step: claude.step,
    dialog: claude.dialog,
    hook: true,
  },
  generic,
];

export const adapterOf = (t: AgentKind): Adapter => ADAPTERS.find((a) => a.handles(t)) ?? generic;

/** The last lines of a screen that say something (for the generic view). */
export function tail(screen: string | null, n = 14): string {
  const ls = (screen ?? "").replace(/\r/g, "").split("\n").map((l) => l.replace(/\s+$/, ""));

  while (ls.length && !ls.at(-1)?.trim()) ls.pop();

  const out: string[] = [];

  for (let i = ls.length - 1; i >= 0 && out.length < n; i--) {
    const l = ls[i] ?? "";

    if (/^[─━╌]{8,}$/.test(l.trim())) continue;

    if (!l.trim() && !out.length) continue;

    out.unshift(l);
  }

  // Drop leading blanks and squeeze runs of blank lines.
  return out.filter((l, i) => l.trim() || (i > 0 && out[i - 1]?.trim())).join("\n").replace(/^\n+/, "");
}

/** A terminal's address split: the machine it is on (null: this one) and its id there. */
export interface Address {
  readonly machine: string | null;
  readonly id: string;
}

/** "machine/t3" -> { machine: "machine", id: "t3" }; "t3" -> { machine: null, id: "t3" }. */
export function splitAddress(address: string): Address {
  const i = address.lastIndexOf("/");

  return i < 0 ? { machine: null, id: address } : { machine: address.slice(0, i), id: address.slice(i + 1) };
}

/** A terminal's status word: blocked, done, error, working, idle, or null. */
export function statusOf(t: Terminal): string | null {
  return t.report?.state ?? t.status ?? null;
}

/** What the terminal needs: "permission" | "question" | "other" | null. */
export function typeOf(status: string | null, kind: string | null, described: Request | null): ItemType | null {
  if (status === "blocked") {
    if (described?.type) return described.type;

    if (kind === "permission" || kind === "question") return kind;

    return "other";
  }

  if (status === "error") return "other";

  return null;
}

/** An item: one agent waiting on the person (as shared notifications.items keeps it). */
export const isItem = object({
  id: isString,
  address: isString,
  machine: nullable(isString),
  adapter: literal("claude", "generic"),
  type: literal("permission", "question", "other"),
  status: literal("blocked", "error"),
  kind: nullable(isString),
  msg: isString,
  name: isString,
  program: isString,
  app: nullable(isString),
  logo: isString,
  space: nullable(isString),
  spaceName: isString,
  tab: nullable(isString),
  tabName: isString,
  tabIndex: nullable(isNumber),
  since: isNumber,
  request: nullable(claude.isRequest),
  tail: nullable(isString),
  answerable: isBoolean,
  // For readers outside this mod (Nocturne's toasts): the words as the overview says them.
  title: isString,
  line: isString,
});

export type Item = Guarded<typeof isItem>;

/** What a terminal shows, as last read: its screen and its hook record. */
export interface Info {
  readonly screen: string | null;
  readonly record: HookRecord | null;
}

/** An agent's place (agents()), the fields read here. */
export interface Place {
  readonly address: string;
  readonly space: string;
  readonly space_name: string;
  readonly tab: string;
  readonly tab_name: string;
  readonly tab_index: number;
  readonly app: string | null;
  readonly program: { readonly name: string };
}

/** What collect() reads: the terminals, the agents' places, what each shows (by address),
 *  the names people gave them, the errors put away (item ids), when each status began. */
export interface Sources {
  readonly terminals?: readonly Terminal[];
  readonly agents?: readonly Place[];
  readonly info?: ReadonlyMap<string, Info>;
  readonly names?: ReadonlyMap<string, string>;
  readonly dismissed?: ReadonlySet<string>;
  readonly since?: ReadonlyMap<string, number>;
}

/**
 * The items, newest first within a type. `info` per address: { screen, record } as last
 * read. `agents`: agents() for names and places; a sub-agent (no pane) goes by its
 * parent's place.
 */
export function collect({ terminals = [], agents = [], info = new Map(), names = new Map(), dismissed = new Set(), since: began = new Map() }: Sources): Item[] {
  const byAddr = new Map(agents.map((a) => [a.address, a]));
  const items: Item[] = [];

  for (const t of terminals) {
    if (!t.address || t.state === "finished") continue;

    const status = statusOf(t);

    if (!isWaiting(status)) continue;

    const adapter = adapterOf(t);
    const got = info.get(t.address);
    const request = got && got.screen !== null && status === "blocked" ? adapter.describe(got.screen, got.record) : null;
    const type = typeOf(status, t.report?.kind ?? null, request);

    if (!type) continue;

    const since = began.get(t.address) ?? (t.status_ms || 0);
    const id = `${t.address}@${since}`;

    if (type === "other" && dismissed.has(id)) continue;

    let place = byAddr.get(t.address);

    for (let p = t.parent, hops = 0; !place && p && hops < 8; hops++) {
      const parent = p;

      place = byAddr.get(parent);
      p = terminals.find((x) => x.address === parent)?.parent;
    }

    // Fireflies' screens leave out terminals that aren't in a space (another app's): so does this.
    if (!place && !t.labels?.["herdr.space"]) continue;

    const app = t.report?.app ?? place?.app ?? null;
    const { machine } = splitAddress(t.address);

    const it = {
      id, address: t.address, machine, adapter: adapter.id, type, status,
      kind: t.report?.kind ?? null, msg: t.report?.msg ?? "",
      name: names.get(t.address) || t.name || t.program?.name || place?.program.name || app || t.address,
      program: t.program?.name ?? place?.program.name ?? app ?? "",
      app, logo: logoKey(app ?? t.program?.key),
      space: place?.space ?? null, spaceName: place?.space_name ?? "", tab: place?.tab ?? null,
      tabName: place && place.tab_name !== String(place.tab_index) ? place.tab_name : "", tabIndex: place?.tab_index ?? null,
      since, request, tail: got && got.screen !== null ? tail(got.screen) : null,
      answerable: Boolean(request && adapter.step),
    };

    // For readers outside this mod (Nocturne's toasts): the words as the overview says them.
    items.push({ ...it, title: `${it.name} ${headline(it)}`, line: summary(it) });
  }

  return items.sort((a, b) => TYPES.indexOf(a.type) - TYPES.indexOf(b.type) || b.since - a.since);
}

/** The items by type. */
export interface Groups {
  readonly permission: Item[];
  readonly question: Item[];
  readonly other: Item[];
}

/** { permission: [...], question: [...], other: [...] }. */
export function group(items: readonly Item[]): Groups {
  const g: Groups = { permission: [], question: [], other: [] };

  for (const it of items) g[it.type].push(it);

  return g;
}

/** How many items of each type, and how many need the person. */
export interface Counts {
  readonly permission: number;
  readonly question: number;
  readonly other: number;
  readonly needs: number;
}

/** Counts per type, and how many need the person (permissions and questions). */
export function counts(items: readonly Item[]): Counts {
  const g = group(items);

  return { permission: g.permission.length, question: g.question.length, other: g.other.length, needs: g.permission.length + g.question.length };
}

const LOGOS: ReadonlyMap<string, string> = new Map([["claude", "claude"], ["claude-code", "claude"], ["opencode", "opencode"], ["pi", "pi"], ["codex", "codex"]]);

export const logoKey = (app: string | null | undefined): string => LOGOS.get(app ?? "") ?? "agent";

/** "just now", "40s", "4m", "2h", "3d". */
export function age(since: number, now = Date.now()): string {
  if (!since) return "";

  const s = Math.max(0, Math.round((now - since) / 1000));

  if (s < 10) return "just now";

  if (s < 60) return `${s}s`;

  if (s < 3600) return `${Math.floor(s / 60)}m`;

  if (s < 86400) return `${Math.floor(s / 3600)}h`;

  return `${Math.floor(s / 86400)}d`;
}

/** What the headline and the summary read of an item. */
type Said = Pick<Item, "type" | "request" | "status" | "msg">;

/** The headline for an item: what the agent wants, in a few words. */
export function headline(it: Said): string {
  const r = it.request;

  if (it.type === "permission") {
    const tool = r?.type === "permission" ? r.tool : "";

    if (/^(Bash|Bash command|PowerShell)$/.test(tool)) return "wants to run a command";

    if (/^(Write|Create file)$/.test(tool)) return "wants to create a file";

    if (/^(Edit|MultiEdit|Edit file|NotebookEdit)$/.test(tool)) return "wants to edit a file";

    if (/^(WebFetch|Fetch)$/.test(tool)) return "wants to fetch a page";

    if (tool.startsWith('mcp__')) return `wants to use ${tool.replace(/^mcp__/, "").replace(/__/g, " · ")}`;

    return tool ? `wants to use ${tool}` : "asks for permission";
  }

  if (it.type === "question") {
    const n = r?.type === "question" ? r.questions.length : 0;

    return n > 1 ? `asks ${n} questions` : "asks a question";
  }

  if (it.status === "error") return "stopped with an error";

  return "waits for you";
}

/** "fireflies / 2 fix login", "vps · deploy / 1". */
export function where(it: Pick<Item, "tabIndex" | "tabName" | "spaceName" | "machine">): string {
  const tab = [it.tabIndex, it.tabName].filter((x) => x !== null && x !== "").join(" ");
  const place = it.spaceName ? (tab ? `${it.spaceName} / ${tab}` : it.spaceName) : "";

  return [it.machine, place].filter(Boolean).join(" · ");
}

/** One line under the agent's name in the list. */
export function summary(it: Said): string {
  const r = it.request;

  if (r?.type === "permission") return [r.tool, r.line].filter(Boolean).join(" · ");

  if (r?.type === "question") return r.questions.map((q) => q.header || q.question).join(", ");

  if (it.msg) return it.msg;

  if (it.status === "error") return "error";

  return "needs input";
}
