// Pins: what a person keeps in the jar at the top of the sky. Agents fly in
// its body (the fireflies); any other pane (a plain terminal, a web page, an
// editor, a files pane) sits as a tile on the shelf at its foot. Each keeps
// its own order: when it was pinned (onShelf() says which is which).
//
// A terminal's pin (an agent's or a plain shell's) lives on the terminal, so
// every window, the agents mod and the CLI see it, and it ends with the terminal:
//   herdr.pinned        set by Fireflies' terminal.pin {terminal, pinned} ("1" or gone)
//   nocturne.pinned-at  when it was pinned (ms), Nocturne's order in the jar;
//                       a pin made elsewhere (CLI, the agents mod) gets one
//                       stamped when the sky first sees it (stamps())
// A mod pane (web, editor, files, ...) has no terminal: its pin is a record in
// the mods' shared storage (persisted), PANES_KEY:
//   [{ pane, mod, props, at, tab? }]   pane: its id; mod and props: what it shows,
//                                to find it again if its id changed; at: as above
//                                tab: one web tab of a browser pane (its
//                                tab id, "web", "web-2", …, kept across restarts)
// A record without `tab` pins the whole pane; with one, that tab alone: a tile
// of its own, named by the tab's title (browser.tab-titles), going to
// the pane and showing that tab (kit.js goToPin). One pane may have its own pin
// and several tab pins at once; the browser drops a tab's pin when the tab closes.
// It ends when the pane closes (tidy(): missing from panes() for GONE_AFTER ms);
// a parked pane stays pinned. Going to it brings a parked pane back.
// Pure functions: no herdr imports at run time, so the tests can load this file.

import type { AgentInfo, PaneInfo, shared } from "herdr";
import { isNull, isNumber, isString, nullable, object, oneOf, readSharedList, sharedListKey } from "./guard.ts";
import type { Guarded } from "./guard.ts";
import { isJson, isJsonObject } from "./guards.ts";
import type { Json, Labels, Terminal } from "./guards.ts";

export const PIN_LABEL = "herdr.pinned";
export const AT_LABEL = "nocturne.pinned-at";

/** How long a pin time may wait for its pin before stamps() takes it away (ms). */
export const GRACE = 10000;

/** Pinned, by its terminal's labels. */
export const isPinned = (labels: Labels | undefined): boolean => Boolean(labels?.[PIN_LABEL]);

/** When it was pinned (ms), or null: not yet stamped. */
export function pinnedAt(labels: Labels | undefined): number | null {
  const at = labels?.[AT_LABEL];
  const n = Number(at);

  return at && Number.isFinite(n) ? n : null;
}

/** Anything with a terminal's address (an agent, a terminal). */
interface Addressed {
  readonly address: string;
}

/** A terminal's labels by its address. */
type LabelsOf = (address: string) => Labels | undefined;

/** The order in the jar: by when pinned; unstamped ones last, by address. */
export function jarOrder(a: Addressed, b: Addressed, labelsOf: LabelsOf): number {
  const x = pinnedAt(labelsOf(a.address));
  const y = pinnedAt(labelsOf(b.address));

  if (x != null && y != null && x !== y) return x - y;

  if ((x == null) !== (y == null)) return x == null ? 1 : -1;

  return a.address < b.address ? -1 : a.address > b.address ? 1 : 0;
}

/** The sidebar's agents: the pinned ones, the rest, and all in that order. */
export interface SortedAgents<A> {
  readonly pinned: A[];
  readonly rest: A[];
  readonly all: A[];
}

/**
 * The sidebar's order: pinned agents first, in the order pinned, then the
 * rest by `rank` (kit.ts agentRank: needs you, working, command, done, idle).
 * `labelsOf(address)`: that terminal's labels.
 */
export function sortAgents<A extends Addressed>(list: readonly A[], rank: (a: A) => number, labelsOf: LabelsOf): SortedAgents<A> {
  const pinned = list.filter((a) => isPinned(labelsOf(a.address))).sort((a, b) => jarOrder(a, b, labelsOf));
  const rest = list.filter((a) => !isPinned(labelsOf(a.address))).sort((a, b) => rank(a) - rank(b));

  return { pinned, rest, all: [...pinned, ...rest] };
}

/** A label to write on a terminal: [address, "label=value"]. */
export type LabelWrite = readonly [string, string];

/**
 * The order labels to write for these terminals ([address, label=value]):
 * a pin with no time gets one (after the newest, so it joins at the end), a
 * time left behind by an unpin goes. Exited terminals aren't listed, so
 * nothing is written for them.
 */
export function stamps(terminals: readonly Terminal[], now: number): LabelWrite[] {
  const out: LabelWrite[] = [];
  let next = now;

  for (const t of terminals) {
    if (t.state && t.state !== "live") continue;

    const pinned = isPinned(t.labels);
    const at = t.labels?.[AT_LABEL];

    if (pinned && pinnedAt(t.labels) == null) out.push([t.address, `${AT_LABEL}=${next++}`]);
    // A fresh time may land before its pin: give the pin GRACE ms to follow.
    else if (!pinned && at && !(now - Number(at) < GRACE)) out.push([t.address, `${AT_LABEL}=`]);
  }

  return out;
}

/** `order` with items i and j swapped (both in it). */
function swapped<T>(order: readonly T[], i: number, j: number): T[] {
  return order.map((x, k) => (k === i ? order[j] : k === j ? order[i] : x) ?? x);
}

/**
 * The label writes that move `address` one step up (-1) or down (+1) in the
 * jar (`pinned`, in jar order): every pin gets a fresh time in the new order,
 * so ties (two windows stamping in the same ms) can't stall a move.
 */
export function moveInJar(pinned: readonly Addressed[], address: string, dir: number, now: number): LabelWrite[] {
  const i = pinned.findIndex((a) => a.address === address);
  const j = i + dir;

  if (i < 0 || j < 0 || j >= pinned.length) return [];

  return swapped(pinned.map((a) => a.address), i, j).map((addr, k) => [addr, `${AT_LABEL}=${now + k}`]);
}

// ---- every kind of pin: the jar's items

/** shared() key: the mod panes' pins, [{ pane, mod, props, at, tab? }]. */
export const PANES_KEY = "nocturne.pinned-panes";

/** How long a pinned mod pane may be missing from panes() before its pin goes (ms):
 *  long enough for a restart to bring the panes back, or a window to load them. */
export const GONE_AFTER = 15000;

/** A mod pane's pin, as stored under PANES_KEY. `at` is written as a number;
 *  a number in a string reads as one too. Other browsers' fields are kept. */
const isPaneRecord = object({ pane: isString }, { mod: nullable(isString), props: isJson, at: oneOf(isNumber, isString, isNull), tab: isString });

export type PaneRecord = Guarded<typeof isPaneRecord>;

/** PANES_KEY, read entry by entry. */
export const PANES = sharedListKey(PANES_KEY, isPaneRecord);

/** The mod panes' pins as stored (shared(PANES_KEY), read with `read`), well formed only. */
export function paneRecords(read: typeof shared): PaneRecord[] {
  return readSharedList(read, PANES).filter((r) => r.pane !== "");
}

/** `value` with its objects' keys sorted, at every depth (to compare as JSON). */
function sortedKeys(value: Json): Json {
  if (isJsonObject(value)) return Object.fromEntries(Object.keys(value).sort().flatMap((k) => {
    const v = value[k];

    return v === undefined ? [] : [[k, sortedKeys(v)]];
  }));

  return Array.isArray(value) ? value.map((v: Json) => sortedKeys(v)) : value;
}

/** Same props: equal as JSON with the keys sorted, at every depth. */
const sameProps = (a: Json, b: Json) => JSON.stringify(sortedKeys(a)) === JSON.stringify(sortedKeys(b));

/** A pin made while its mod had its old name (nocturne-browser, src/layout.rs
 *  RENAMED_MODS) names the mod as it is called now. */
const RENAMED: ReadonlyMap<string, string> = new Map([["nocturne-agents", "agent-graph"], ["nocturne-files", "file-tree"], ["nocturne-picker", "finder"], ["nocturne-image", "preview"]]);

export const modNow = (m: string): string => RENAMED.get(m) ?? (m.startsWith("nocturne-") ? m.slice("nocturne-".length) : m);

/** The pane (of `panes`, PaneInfo) a pin record names: its own id, else the one
 *  pane of the same mod showing the same (non-empty) props. Null: not there now. */
export function findPane(rec: PaneRecord, panes: readonly PaneInfo[]): PaneInfo | null {
  const own = panes.find((p) => p.pane === rec.pane && !p.terminal);

  if (own) return own;

  const props = rec.props;

  if (!rec.mod || !isJsonObject(props) || !Object.keys(props).length) return null;

  const mod = modNow(rec.mod);
  const like = panes.filter((p) => !p.terminal && p.mod === mod && sameProps(isJson(p.props) ? p.props : null, props));

  return like.length === 1 ? (like[0] ?? null) : null;
}

/** A record's web tab (a tab pin), or null (the whole pane). */
export const recordTab = (r: PaneRecord): string | null => r.tab || null;

/** A mod pane is pinned as a whole (its id, among the records; its tab pins aside). */
export const panePinned = (records: readonly PaneRecord[], pane: string): boolean => records.some((r) => r.pane === pane && !recordTab(r));

/** Tab `tab` of mod pane `pane` is pinned on its own. */
export const tabPinned = (records: readonly PaneRecord[], pane: string, tab: string): boolean => records.some((r) => r.pane === pane && recordTab(r) === tab);

/** A mod pane as a pin record takes it: its id, its mod and its props. */
export interface PinnedPane {
  readonly pane: string;
  readonly mod?: string | undefined;
  readonly props?: unknown;
}

/** What a pin record keeps of a pane's props: JSON, else null. */
const propsOf = (p: PinnedPane): Json => (isJson(p.props) ? p.props : null);

/** The records with `p` (a PaneInfo of a mod pane) pinned (at `now`) or unpinned
 *  as a whole; its tab pins stay. */
export function pinPaneRecord(records: readonly PaneRecord[], p: PinnedPane, on: boolean, now: number): PaneRecord[] {
  const rest = records.filter((r) => r.pane !== p.pane || recordTab(r));

  return on ? [...rest, { pane: p.pane, mod: p.mod ?? null, props: propsOf(p), at: now }] : rest;
}

/** The records with tab `tab` of `p` (a web pane's PaneInfo) pinned (at `now`) or unpinned. */
export function pinTabRecord(records: readonly PaneRecord[], p: PinnedPane, tab: string, on: boolean, now: number): PaneRecord[] {
  const rest = records.filter((r) => r.pane !== p.pane || recordTab(r) !== tab);

  return on ? [...rest, { pane: p.pane, mod: p.mod ?? null, props: propsOf(p), at: now, tab }] : rest;
}

/** The jar's key for a mod pane's pin ("pane:<id>"), or one of its tabs'
 *  ("pane:<id>#<tab>"); a terminal's is its address. */
export const paneKey = (pane: string, tab: string | null = null): string => (tab ? `pane:${pane}#${tab}` : `pane:${pane}`);
export const isPaneKey = (key: string): boolean => key.startsWith("pane:");

/** A record's jar key. */
export const recordKey = (r: PaneRecord): string => paneKey(r.pane, recordTab(r));

/** A record's time (ms), or null. */
function recordAt(r: PaneRecord): number | null {
  const n = Number(r.at);

  return r.at != null && Number.isFinite(n) ? n : null;
}

/** One thing in the jar, in the order pinned (jarItems). */
export type JarItem =
  /** A pinned agent (agents()). */
  | { readonly kind: "agent"; readonly key: string; readonly agent: AgentInfo; readonly at: number | null }
  /** A pinned terminal that isn't an agent, and its pane if it has one. */
  | { readonly kind: "terminal"; readonly key: string; readonly terminal: Terminal; readonly pane: PaneInfo | null; readonly at: number | null }
  /** A pinned mod pane that's there now; with `tab`, one web tab of it. */
  | { readonly kind: "pane"; readonly key: string; readonly record: PaneRecord; readonly pane: PaneInfo; readonly tab?: string; readonly at: number | null };

/** What the jar is made of: agents(), terminals(), panes(), paneRecords(). */
export interface JarSources {
  readonly agents: readonly AgentInfo[];
  readonly terminals: readonly Terminal[];
  readonly panes: readonly PaneInfo[];
  readonly records: readonly PaneRecord[];
}

/**
 * Everything in the jar, in the order pinned (unstamped ones last, then by key):
 *   { kind: "agent", key: address, agent }                a pinned agent (agents())
 *   { kind: "terminal", key: address, terminal, pane }    a pinned terminal that isn't an agent
 *   { kind: "pane", key: "pane:<id>", record, pane }      a pinned mod pane that's there now
 *   { kind: "pane", key: "pane:<id>#<tab>", record, pane, tab }   one web tab of it, pinned
 */
export function jarItems(from: JarSources): JarItem[] {
  const out: JarItem[] = [];
  const isAgent = new Set(from.agents.map((a) => a.address));
  const labels = new Map(from.terminals.map((t) => [t.address, t.labels]));

  for (const a of from.agents) {
    if (isPinned(labels.get(a.address))) out.push({ kind: "agent", key: a.address, agent: a, at: pinnedAt(labels.get(a.address)) });
  }

  for (const t of from.terminals) {
    if (isAgent.has(t.address) || (t.state && t.state !== "live") || !isPinned(t.labels)) continue;

    out.push({ kind: "terminal", key: t.address, terminal: t, pane: from.panes.find((p) => p.terminal === t.address) ?? null, at: pinnedAt(t.labels) });
  }

  for (const r of from.records) {
    const p = findPane(r, from.panes);
    const tab = recordTab(r);

    if (!p) continue;

    const key = paneKey(p.pane, tab);
    const at = recordAt(r);

    out.push(tab ? { kind: "pane", key, record: r, pane: p, tab, at } : { kind: "pane", key, record: r, pane: p, at });
  }

  return out.sort((a, b) => {
    if (a.at != null && b.at != null && a.at !== b.at) return a.at - b.at;

    if ((a.at == null) !== (b.at == null)) return a.at == null ? 1 : -1;

    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
}

/** A jar item sits on the shelf (a pane that isn't an agent's), not in the jar's body. */
export const onShelf = (it: Pick<JarItem, "kind">): boolean => it.kind !== "agent";

/** A new time for a jar item: [key, at]. */
export type JarTime = readonly [string, number];

/**
 * The new times ([key, at]) that move `key` one step up / left (-1) or down /
 * right (+1) among its own kind in `jar` (jarItems' order): a firefly past
 * fireflies, a tile past tiles. Every one of them gets a fresh time in the
 * new order, so ties can't stall a move.
 */
export function reorder(jar: readonly Pick<JarItem, "kind" | "key">[], key: string, dir: number, now: number): JarTime[] {
  const it = jar.find((x) => x.key === key);

  if (!it) return [];

  const group = jar.filter((x) => onShelf(x) === onShelf(it));
  const i = group.indexOf(it);
  const j = i + dir;

  if (j < 0 || j >= group.length) return [];

  return swapped(group.map((x) => x.key), i, j).map((k, n) => [k, now + n]);
}

/** The records with new times (`times`, [key, at] from reorder) for their panes (and tabs). */
export function retime(records: readonly PaneRecord[], times: readonly JarTime[]): PaneRecord[] {
  const at = new Map(times.filter(([k]) => isPaneKey(k)));

  return records.map((r) => {
    const t = at.get(recordKey(r));

    return t === undefined ? r : { ...r, at: t };
  });
}

/** The machine a pane id is on ("machine/…"), "" for this one. */
const machineOf = (pane: string) => (pane.includes("/") ? (pane.split("/")[0] ?? "") : "");

/**
 * Keeping the records true to panes() (once per draw): a record found under a
 * new id (a restart gave the pane another) takes that id; one missing for
 * GONE_AFTER ms goes (its pane closed). `missing`: Map pane -> since when (ms),
 * kept by the caller and updated here. Remote panes ("machine/…") whose machine
 * shows no panes now are left alone: it's away, not closed.
 * Returns the records to store, or null when nothing changed.
 */
export function tidy(records: readonly PaneRecord[], panes: readonly PaneInfo[], missing: Map<string, number>, now: number): PaneRecord[] | null {
  let changed = false;
  const machines = new Set(panes.map((p) => machineOf(p.pane)));
  const out: PaneRecord[] = [];
  // A pane's records (its own pin, its tabs') go together: once one is over time, all are.
  const gone = new Set<string>();

  for (const r of records) {
    const p = findPane(r, panes);

    if (p) {
      missing.delete(r.pane);

      if (p.pane !== r.pane) {
        changed = true;
        out.push({ ...r, pane: p.pane });
      } else out.push(r);

      continue;
    }

    if (!panes.length || !machines.has(machineOf(r.pane))) {
      out.push(r);
      continue;
    }

    const since = missing.get(r.pane) ?? now;

    missing.set(r.pane, since);

    if (gone.has(r.pane) || now - since >= GONE_AFTER) {
      changed = true;
      gone.add(r.pane);
      continue;
    }

    out.push(r);
  }

  for (const pane of gone) missing.delete(pane);

  return changed ? out : null;
}
