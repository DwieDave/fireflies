// Pinned agents: the fireflies a person keeps in the jar at the top of the sky.
// A pin lives on the agent's terminal, so every window, the agents mod and the
// CLI see it, and it ends with the terminal:
//   herdr.pinned        set by Herdr's terminal.pin {terminal, pinned} ("1" or gone)
//   nocturne.pinned-at  when it was pinned (ms), Nocturne's order in the jar;
//                       a pin made elsewhere (CLI, the agents mod) gets one
//                       stamped when the sky first sees it (stamps())
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
