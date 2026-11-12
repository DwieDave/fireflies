// Pins: what a person keeps in the jar at the top of the sky. Agents fly in
// its body (the fireflies); any other pane (a plain terminal, a web page, an
// editor, a files pane) sits as a tile on the shelf at its foot. Each keeps
// its own order: when it was pinned (onShelf() says which is which).
//
// A terminal's pin (an agent's or a plain shell's) lives on the terminal, so
// every window, the agents mod and the CLI see it, and it ends with the terminal:
//   herdr.pinned        set by Herdr's terminal.pin {terminal, pinned} ("1" or gone)
//   nocturne.pinned-at  when it was pinned (ms), Nocturne's order in the jar;
//                       a pin made elsewhere (CLI, the agents mod) gets one
//                       stamped when the sky first sees it (stamps())
// A mod pane (web, editor, files, ...) has no terminal: its pin is a record in
// the mods' shared storage (persisted), PANES_KEY:
//   [{ pane, mod, props, at }]   pane: its id; mod and props: what it shows,
//                                to find it again if its id changed; at: as above
// It ends when the pane closes (tidy(): missing from panes() for GONE_AFTER ms);
// a parked pane stays pinned. Going to it brings a parked pane back.
// Pure functions: no herdr imports, so the tests can load this file.

export const PIN_LABEL = "herdr.pinned";
export const AT_LABEL = "nocturne.pinned-at";
/** How long a pin time may wait for its pin before stamps() takes it away (ms). */
export const GRACE = 10000;

/** Pinned, by its terminal's labels. */
export const isPinned = (labels) => Boolean(labels?.[PIN_LABEL]);

/** When it was pinned (ms), or null: not yet stamped. */
export function pinnedAt(labels) {
  const n = Number(labels?.[AT_LABEL]);
  return labels?.[AT_LABEL] && Number.isFinite(n) ? n : null;
}

/** The order in the jar: by when pinned; unstamped ones last, by address. */
export function jarOrder(a, b, labelsOf) {
  const x = pinnedAt(labelsOf(a.address)), y = pinnedAt(labelsOf(b.address));
  if (x != null && y != null && x !== y) return x - y;
  if ((x == null) !== (y == null)) return x == null ? 1 : -1;
  return a.address < b.address ? -1 : a.address > b.address ? 1 : 0;
}

/**
 * The sidebar's order: pinned agents first, in the order pinned, then the
 * rest by `rank` (kit.js agentRank: needs you, working, command, done, idle).
 * `labelsOf(address)`: that terminal's labels.
 */
export function sortAgents(list, rank, labelsOf) {
  const pinned = list.filter((a) => isPinned(labelsOf(a.address))).sort((a, b) => jarOrder(a, b, labelsOf));
  const rest = list.filter((a) => !isPinned(labelsOf(a.address))).sort((a, b) => rank(a) - rank(b));
  return { pinned, rest, all: [...pinned, ...rest] };
}

/**
 * The order labels to write for these terminals ([address, label=value]):
 * a pin with no time gets one (after the newest, so it joins at the end), a
 * time left behind by an unpin goes. Exited terminals aren't listed, so
 * nothing is written for them.
 */
export function stamps(terminals, now) {
  const out = [];
  let next = now;
  for (const t of terminals) {
    if (t.state && t.state !== "live") continue;
    const pinned = isPinned(t.labels), at = t.labels?.[AT_LABEL];
    if (pinned && pinnedAt(t.labels) == null) out.push([t.address, `${AT_LABEL}=${next++}`]);
    // A fresh time may land before its pin: give the pin GRACE ms to follow.
    else if (!pinned && at && !(now - Number(at) < GRACE)) out.push([t.address, `${AT_LABEL}=`]);
  }
  return out;
}

/**
 * The label writes that move `address` one step up (-1) or down (+1) in the
 * jar (`pinned`, in jar order): every pin gets a fresh time in the new order,
 * so ties (two windows stamping in the same ms) can't stall a move.
 */
export function moveInJar(pinned, address, dir, now) {
  const i = pinned.findIndex((a) => a.address === address), j = i + dir;
  if (i < 0 || j < 0 || j >= pinned.length) return [];
  const order = pinned.map((a) => a.address);
  [order[i], order[j]] = [order[j], order[i]];
  return order.map((addr, k) => [addr, `${AT_LABEL}=${now + k}`]);
}

// ---- every kind of pin: the jar's items

/** shared() key: the mod panes' pins, [{ pane, mod, props, at }]. */
export const PANES_KEY = "nocturne.pinned-panes";
/** How long a pinned mod pane may be missing from panes() before its pin goes (ms):
 *  long enough for a restart to bring the panes back, or a window to load them. */
export const GONE_AFTER = 15000;

/** The mod panes' pins as stored (shared(PANES_KEY)), well formed only. */
export function paneRecords(value) {
  return Array.isArray(value) ? value.filter((r) => r && typeof r.pane === "string" && r.pane) : [];
}

/** Same props: equal as JSON with the keys sorted, at every depth. */
function sameProps(a, b) {
  const norm = (v) => (v && typeof v === "object" && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, norm(v[k])]))
    : Array.isArray(v) ? v.map(norm) : v);
  return JSON.stringify(norm(a ?? null)) === JSON.stringify(norm(b ?? null));
}

/** The pane (of `panes`, PaneInfo) a pin record names: its own id, else the one
 *  pane of the same mod showing the same (non-empty) props. Null: not there now. */
export function findPane(rec, panes) {
  const own = panes.find((p) => p.pane === rec.pane && !p.terminal);
  if (own) return own;
  if (!rec.mod || !rec.props || typeof rec.props !== "object" || !Object.keys(rec.props).length) return null;
  const like = panes.filter((p) => !p.terminal && p.mod === rec.mod && sameProps(p.props, rec.props));
  return like.length === 1 ? like[0] : null;
}

/** A mod pane is pinned (its id, among the records). */
export const panePinned = (records, pane) => records.some((r) => r.pane === pane);

/** The records with `p` (a PaneInfo of a mod pane) pinned (at `now`) or unpinned. */
export function pinPaneRecord(records, p, on, now) {
  const rest = records.filter((r) => r.pane !== p.pane);
  return on ? [...rest, { pane: p.pane, mod: p.mod ?? null, props: p.props ?? null, at: now }] : rest;
}

/** The jar's key for a mod pane's pin ("pane:<id>"); a terminal's is its address. */
export const paneKey = (pane) => `pane:${pane}`;
export const isPaneKey = (key) => String(key).startsWith("pane:");

/**
 * Everything in the jar, in the order pinned (unstamped ones last, then by key):
 *   { kind: "agent", key: address, agent }                a pinned agent (agents())
 *   { kind: "terminal", key: address, terminal, pane }    a pinned terminal that isn't an agent
 *   { kind: "pane", key: "pane:<id>", record, pane }      a pinned mod pane that's there now
 * `agents`: agents(); `terminals`: terminals(); `panes`: panes(); `records`: paneRecords().
 */
export function jarItems({ agents, terminals, panes, records }) {
  const out = [];
  const isAgent = new Set(agents.map((a) => a.address));
  const labels = new Map(terminals.map((t) => [t.address, t.labels ?? {}]));
  for (const a of agents) {
    if (isPinned(labels.get(a.address))) out.push({ kind: "agent", key: a.address, agent: a, at: pinnedAt(labels.get(a.address)) });
  }
  for (const t of terminals) {
    if (isAgent.has(t.address) || (t.state && t.state !== "live") || !isPinned(t.labels)) continue;
    out.push({ kind: "terminal", key: t.address, terminal: t, pane: panes.find((p) => p.terminal === t.address) ?? null, at: pinnedAt(t.labels) });
  }
  for (const r of records) {
    const p = findPane(r, panes);
    if (p) out.push({ kind: "pane", key: paneKey(p.pane), record: r, pane: p, at: Number.isFinite(Number(r.at)) && r.at != null ? Number(r.at) : null });
  }
  return out.sort((a, b) => {
    if (a.at != null && b.at != null && a.at !== b.at) return a.at - b.at;
    if ((a.at == null) !== (b.at == null)) return a.at == null ? 1 : -1;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
}

/** A jar item sits on the shelf (a pane that isn't an agent's), not in the jar's body. */
export const onShelf = (it) => it.kind !== "agent";

/**
 * The new times ([key, at]) that move `key` one step up / left (-1) or down /
 * right (+1) among its own kind in `jar` (jarItems' order): a firefly past
 * fireflies, a tile past tiles. Every one of them gets a fresh time in the
 * new order, so ties can't stall a move.
 */
export function reorder(jar, key, dir, now) {
  const it = jar.find((x) => x.key === key);
  if (!it) return [];
  const group = jar.filter((x) => onShelf(x) === onShelf(it));
  const i = group.indexOf(it), j = i + dir;
  if (j < 0 || j >= group.length) return [];
  const order = group.map((x) => x.key);
  [order[i], order[j]] = [order[j], order[i]];
  return order.map((k, n) => [k, now + n]);
}

/** The records with new times (`times`, [key, at] from reorder) for their panes. */
export function retime(records, times) {
  const at = new Map(times.filter(([k]) => isPaneKey(k)).map(([k, v]) => [k.slice(5), v]));
  return records.map((r) => (at.has(r.pane) ? { ...r, at: at.get(r.pane) } : r));
}

/**
 * Keeping the records true to panes() (once per draw): a record found under a
 * new id (a restart gave the pane another) takes that id; one missing for
 * GONE_AFTER ms goes (its pane closed). `missing`: Map pane -> since when (ms),
 * kept by the caller and updated here. Remote panes ("machine/…") whose machine
 * shows no panes now are left alone: it's away, not closed.
 * Returns the records to store, or null when nothing changed.
 */
export function tidy(records, panes, missing, now) {
  let changed = false;
  const machines = new Set(panes.map((p) => (p.pane.includes("/") ? p.pane.split("/")[0] : "")));
  const out = [];
  for (const r of records) {
    const p = findPane(r, panes);
    if (p) {
      missing.delete(r.pane);
      if (p.pane !== r.pane) { changed = true; out.push({ ...r, pane: p.pane }); } else out.push(r);
      continue;
    }
    const machine = r.pane.includes("/") ? r.pane.split("/")[0] : "";
    if (!panes.length || !machines.has(machine)) { out.push(r); continue; }
    const since = missing.get(r.pane) ?? now;
    missing.set(r.pane, since);
    if (now - since >= GONE_AFTER) { changed = true; missing.delete(r.pane); continue; }
    out.push(r);
  }
  return changed ? out : null;
}
