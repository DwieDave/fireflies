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

import { Array as Arr, Option, Order, Schema, String as Str } from "effect";
import * as claude from "./claude.ts";
import * as request from "./request.ts";
import type { Step, Goal } from "./claude.ts";
import type { HookRecord, Request } from "./request.ts";

/** Left out, null, or an `A`. */
const maybe = <A, I>(s: Schema.Codec<A, I>) => Schema.optionalKey(Schema.NullOr(s));

const maybeString = maybe(Schema.String);

/** A status that waits on the person: an agent blocked on them, or one that failed. */
const StatusSchema = Schema.Literals(["blocked", "error"]);

const isWaiting = Schema.is(StatusSchema);

/** What an item asks of the person: the overview's groups. */
export const ItemTypeSchema = Schema.Literals(["permission", "question", "other"]);

export type ItemType = typeof ItemTypeSchema.Type;

export const TYPES: readonly ItemType[] = ItemTypeSchema.literals;

/** A terminal as terminals() (herdr-core's listing) has it: the fields read here. */
export const TerminalSchema = Schema.Struct({
  address: Schema.String,
  state: maybeString,
  status: maybeString,
  status_ms: maybe(Schema.Finite),
  // The agent's own report.
  report: maybe(Schema.Struct({ state: maybeString, kind: maybeString, msg: maybeString, app: maybeString })),
  parent: maybeString,
  labels: maybe(Schema.Struct({ "herdr.space": Schema.optionalKey(Schema.String), "nocturne.name": Schema.optionalKey(Schema.String) })),
  name: maybeString,
  program: maybe(Schema.Struct({ key: maybeString, name: maybeString })),
});

export type Terminal = typeof TerminalSchema.Type;

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
    describe: request.describe,
    step: claude.step,
    dialog: request.dialog,
    hook: true,
  },
  generic,
];

export const adapterOf = (t: AgentKind): Adapter => Option.getOrElse(Arr.findFirst(ADAPTERS, (a) => a.handles(t)), () => generic);

/** Whether a line has nothing but blanks. */
const blank = (l: string): boolean => Str.isEmpty(Str.trim(l));

/** The last lines of a screen that say something (for the generic view). */
export function tail(screen: string | null, n = 14): string {
  const ls = Arr.map(Str.split(Str.replace(/\r/g, "")(screen ?? ""), "\n"), Str.replace(/\s+$/, ""));

  while (ls.length > 0 && blank(ls.at(-1) ?? "")) ls.pop();

  const out: string[] = [];

  for (let i = ls.length - 1; i >= 0 && out.length < n; i--) {
    const l = ls[i] ?? "";

    if (/^[─━╌]{8,}$/.test(Str.trim(l))) continue;

    if (blank(l) && out.length === 0) continue;

    out.unshift(l);
  }

  // Drop leading blanks and squeeze runs of blank lines.
  const kept = Arr.filter(out, (l, i) => !blank(l) || (i > 0 && !blank(out[i - 1] ?? "")));

  return Str.replace(/^\n+/, "")(Arr.join(kept, "\n"));
}

/** A terminal's address split: the machine it is on (null: this one) and its id there. */
export interface Address {
  readonly machine: string | null;
  readonly id: string;
}

/** "machine/t3" -> { machine: "machine", id: "t3" }; "t3" -> { machine: null, id: "t3" }. */
export function splitAddress(address: string): Address {
  return Option.match(Str.lastIndexOf("/")(address), {
    onNone: () => ({ machine: null, id: address }),
    onSome: (i) => ({ machine: Str.slice(0, i)(address), id: Str.slice(i + 1)(address) }),
  });
}

/** A terminal's status word: blocked, done, error, working, idle, or null. */
export function statusOf(t: Terminal): string | null {
  return t.report?.state ?? t.status ?? null;
}

/** What the terminal needs: "permission" | "question" | "other" | null. */
export function typeOf(status: string | null, kind: string | null, described: Request | null): ItemType | null {
  if (status === "blocked") {
    if (described !== null) return described.type;

    if (kind === "permission" || kind === "question") return kind;

    return "other";
  }

  if (status === "error") return "other";

  return null;
}

/** An item: one agent waiting on the person (as shared notifications.items keeps it). */
export const ItemSchema = Schema.Struct({
  id: Schema.String,
  address: Schema.String,
  machine: Schema.NullOr(Schema.String),
  adapter: Schema.Literals(["claude", "generic"]),
  type: ItemTypeSchema,
  status: StatusSchema,
  kind: Schema.NullOr(Schema.String),
  msg: Schema.String,
  name: Schema.String,
  program: Schema.String,
  app: Schema.NullOr(Schema.String),
  logo: Schema.String,
  space: Schema.NullOr(Schema.String),
  spaceName: Schema.String,
  tab: Schema.NullOr(Schema.String),
  tabName: Schema.String,
  tabIndex: Schema.NullOr(Schema.Finite),
  since: Schema.Finite,
  request: Schema.NullOr(request.RequestSchema),
  tail: Schema.NullOr(Schema.String),
  answerable: Schema.Boolean,
  // For readers outside this mod (Nocturne's toasts): the words as the overview says them.
  title: Schema.String,
  line: Schema.String,
});

export type Item = typeof ItemSchema.Type;

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
  const byAddr = new Map(Arr.map(agents, (a) => [a.address, a] as const));

  const parentOf = (address: string): string | null =>
    Option.getOrNull(Option.flatMapNullishOr(Arr.findFirst(terminals, (x) => x.address === address), (x) => x.parent));

  const items: Item[] = [];

  for (const t of terminals) {
    if (Str.isEmpty(t.address) || t.state === "finished") continue;

    const status = statusOf(t);

    if (!isWaiting(status)) continue;

    const adapter = adapterOf(t);
    const got = info.get(t.address);
    const screen = got?.screen ?? null;
    const request = got !== undefined && screen !== null && status === "blocked" ? adapter.describe(screen, got.record) : null;
    const type = typeOf(status, t.report?.kind ?? null, request);

    if (type === null) continue;

    const since = began.get(t.address) ?? orZero(t.status_ms);
    const id = `${t.address}@${since}`;

    if (type === "other" && dismissed.has(id)) continue;

    let place = byAddr.get(t.address);

    for (let p = t.parent ?? null, hops = 0; place === undefined && p !== null && Str.isNonEmpty(p) && hops < 8; hops++) {
      place = byAddr.get(p);
      p = parentOf(p);
    }

    // Fireflies' screens leave out terminals that aren't in a space (another app's): so does this.
    if (place === undefined && !nonEmpty(t.labels?.["herdr.space"])) continue;

    const app = t.report?.app ?? place?.app ?? null;
    const { machine } = splitAddress(t.address);
    const name = firstNonEmpty([names.get(t.address), t.name, t.program?.name, place?.program.name, app]) ?? t.address;

    const it = {
      id, address: t.address, machine, adapter: adapter.id, type, status,
      kind: t.report?.kind ?? null, msg: t.report?.msg ?? "",
      name,
      program: t.program?.name ?? place?.program.name ?? app ?? "",
      app, logo: logoKey(app ?? t.program?.key),
      space: place?.space ?? null, spaceName: place?.space_name ?? "", tab: place?.tab ?? null,
      tabName: place !== undefined && place.tab_name !== String(place.tab_index) ? place.tab_name : "", tabIndex: place?.tab_index ?? null,
      since, request, tail: screen === null ? null : tail(screen),
      answerable: request !== null && adapter.step !== null,
    };

    // For readers outside this mod (Nocturne's toasts): the words as the overview says them.
    items.push({ ...it, title: `${it.name} ${headline(it)}`, line: summary(it) });
  }

  return Arr.sort(items, ITEM_ORDER);
}

/** Items by type (TYPES' order), newest first within a type. */
const ITEM_ORDER = Order.combine(
  Order.mapInput(Order.Number, (it: Item) => TYPES.indexOf(it.type)),
  Order.mapInput(Order.flip(Order.Number), (it: Item) => it.since),
);

/** A number, 0 for none (or 0). */
const orZero = (n: number | null | undefined): number => n ?? 0;

/** A string that is there and says something. */
const nonEmpty = (s: string | null | undefined): s is string => s !== null && s !== undefined && Str.isNonEmpty(s);

/** The first of `xs` that is there and says something. */
const firstNonEmpty = (xs: readonly (string | null | undefined)[]): string | undefined => Option.getOrUndefined(Arr.findFirst(xs, nonEmpty));

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
export function age(since: number, now: number): string {
  if (since === 0) return "";

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

    if (Str.startsWith("mcp__")(tool)) return `wants to use ${Str.replace(/__/g, " · ")(Str.replace(/^mcp__/, "")(tool))}`;

    return Str.isEmpty(tool) ? "asks for permission" : `wants to use ${tool}`;
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
  const tab = Arr.join(Arr.filter([it.tabIndex === null ? "" : String(it.tabIndex), it.tabName], Str.isNonEmpty), " ");
  const place = Str.isEmpty(it.spaceName) ? "" : Str.isEmpty(tab) ? it.spaceName : `${it.spaceName} / ${tab}`;

  return Arr.join(Arr.filter([it.machine ?? "", place], Str.isNonEmpty), " · ");
}

/** One line under the agent's name in the list. */
export function summary(it: Said): string {
  const r = it.request;

  if (r?.type === "permission") return Arr.join(Arr.filter([r.tool, r.line], Str.isNonEmpty), " · ");

  if (r?.type === "question") return Arr.join(Arr.map(r.questions, (q) => (Str.isEmpty(q.header) ? q.question : q.header)), ", ");

  if (Str.isNonEmpty(it.msg)) return it.msg;

  if (it.status === "error") return "error";

  return "needs input";
}
