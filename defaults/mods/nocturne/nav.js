// Keyboard navigation of Nocturne's chrome: the sidebar (sky.js) and the tab
// strip (tabs.js, which also walks the focused pane's header, the parked chips
// the bell and "+ new"). Both are layout blocks the keyboard reaches with pane.go
// (cmd-alt-arrows) or layout.focus (nocturne.sidebar / nocturne.tabstrip /
// nocturne.header); focused().block then names the block that has it.
//
// Pure: no herdr. A key becomes a verb (keyVerb); the view moves its cursor
// (move, moveSection, moveRow) and acts on the verb itself.

/** shared() key: where the tab strip's cursor is when it's outside the strip,
 *  so that copy draws the ring: { region: "head" | "parked" | "bell" | "new", pane?, item }. */
export const CURSOR = "nocturne.chrome";

/** The layout block showing nocturne with `role` (sky, tabs), from layout(). */
export function blockOf(node, role) {
  if (!node || typeof node !== "object") return null;
  if (node.content?.mod === "nocturne" && node.content?.props?.role === role) return node.id ?? null;
  for (const c of node.children ?? []) { const f = blockOf(c, role); if (f) return f; }
  return null;
}

/** A shown layout block in `node` (layout()) shows `mod`. */
export function hasMod(node, mod) {
  if (!node || typeof node !== "object" || node.hidden) return false;
  if (node.content?.mod === mod) return true;
  return (node.children ?? []).some((c) => hasMod(c, mod));
}

// Keys shared by both: moving, acting, leaving.
const COMMON = {
  down: "down", j: "down", up: "up", k: "up",
  left: "left", h: "left", right: "right", l: "right",
  home: "first", g: "first", end: "last", G: "last",
  tab: "next", "shift-tab": "prev",
  enter: "go", space: "go",
  m: "menu", "shift-f10": "menu", ".": "menu",
  r: "rename", f2: "rename",
  escape: "back", q: "back",
  "?": "help",
};

/** The sidebar's own verbs on top of COMMON (h / ← lead nowhere there: the sidebar is the leftmost block). */
export const SIDEBAR_KEYS = (({ left: _l, h: _h, ...rest }) => rest)({ ...COMMON, n: "new", f: "folder", d: "delete", t: "tab", w: "worktree", p: "pin", J: "pin-down", K: "pin-up" });

/** The tab strip's own verbs on top of COMMON. */
export const STRIP_KEYS = { ...COMMON, x: "close", n: "new", H: "move-left", L: "move-right" };

// The ? lists: [keys, what] per line, every key its keymap takes, ? keys last.
// The keys dialog (screens.js, keymap.js) shows them too.
export const SIDEBAR_HELP = [
  ["j k  ↑ ↓", "move"], ["tab  ⇧tab", "next / previous section"], ["g G  home end", "first / last"],
  ["⏎  space", "open: show the space, focus the agent, press the button"],
  ["m  .", "the row's menu"], ["r", "rename"], ["n", "new space"], ["t", "new tab in the space"],
  ["f", "change the space's folder"], ["w", "new worktree"], ["d", "delete the space (asks)"],
  ["p", "pin / unpin the agent"], ["J K", "move it in the jar"],
  ["l  →", "to the panes"], ["esc  q", "back to the pane"], ["?", "keys"],
];
export const STRIP_HELP = [
  ["h l  ← →", "move along the row (h past the first tab: the sidebar)"], ["j k  ↓ ↑", "tabs · the pane's header · parked panes · the pane"],
  ["tab  ⇧tab", "every control in turn"], ["g G  home end", "first / last"],
  ["⏎  space", "select the tab, press the button"], ["1 … 9", "select that tab"],
  ["m  .", "the tab's menu (on a button: its menu)"], ["r", "rename the tab"],
  ["x", "close the tab"], ["n", "new tab"], ["H L", "move the tab left / right"],
  ["esc  q", "back to the pane"], ["?", "keys"],
];
/** The focused pane's header: the strip's second row (nocturne.header goes straight there). */
export const HEADER_HELP = [
  ["h l  ← →", "walk its controls: name, text size, float, splits, even out, gridify, park, zoom, ⋯, close"],
  ["⏎  space", "press the control"], ["tab  ⇧tab", "every control in turn"], ["g G  home end", "first / last"],
  ["m  .", "the pane's menu"], ["r", "rename the pane"], ["x", "close the pane"],
  ["k  ↑", "up to the tabs"], ["j  ↓", "down to the parked panes, then the pane"],
  ["1 … 9", "select that tab"], ["n", "new tab"], ["esc  q", "back to the pane"], ["?", "keys"],
];
/** The shown tab's parked chips: the strip's third row. */
export const PARKED_HELP = [
  ["h l  ← →", "walk the chips"], ["⏎  space", "put the pane back"], ["tab  ⇧tab", "every control in turn"],
  ["g G  home end", "first / last"], ["m  .", "the pane's menu"], ["x", "close the pane"],
  ["k  ↑", "up to the pane's header"], ["j  ↓", "back to the pane"],
  ["1 … 9", "select that tab"], ["n", "new tab"], ["esc  q", "back to the pane"], ["?", "keys"],
];
/** Every popup menu (popup.js): right-click menus, the git menu, these key lists. */
export const MENU_HELP = [
  ["j k  ↑ ↓", "move"], ["ctrl-n ctrl-p", "move"], ["tab  ⇧tab", "move"], ["home end", "first / last"],
  ["⏎  space", "pick the row"], ["a row's letter", "pick that row"], ["esc  q", "close"],
];

/** What a key event means in `keymap`, or null (not ours: let it go). Keys with
 *  cmd, ctrl or alt are never ours (they're the app's and the window's). */
export function keyVerb(e, keymap) {
  const m = e?.modifiers ?? {};
  if (m.control || m.platform || m.alt) return null;
  const typed = e.key_char && e.key_char.length === 1 && e.key_char !== " " ? e.key_char : null;
  const key = String(e.key ?? "");
  // Named keys first (shift-tab, shift-f10), then what the key types (?, J, .).
  const named = m.shift ? `shift-${key}` : key;
  if (keymap[named] && (named.length > 1 || !typed)) return keymap[named];
  if (typed && keymap[typed]) return keymap[typed];
  if (!m.shift && keymap[key]) return keymap[key];
  if (/^[1-9]$/.test(typed ?? "")) return `n${typed}`;
  return null;
}

/** The id `d` steps from `cursor` in `items` ([{ id }]), held at the ends. Unknown cursor: the first. */
export function move(items, cursor, d) {
  if (!items.length) return null;
  const i = items.findIndex((x) => x.id === cursor);
  if (i < 0) return items[0].id;
  return items[Math.max(0, Math.min(items.length - 1, i + d))].id;
}

/** Tab / shift-tab: the first item of the next / previous section (`sec`), wrapping. */
export function moveSection(items, cursor, d) {
  if (!items.length) return null;
  const secs = [...new Set(items.map((x) => x.sec))];
  const at = items.find((x) => x.id === cursor)?.sec;
  const i = secs.indexOf(at);
  const next = secs[i < 0 ? 0 : (i + d + secs.length) % secs.length];
  return items.find((x) => x.sec === next).id;
}

/** The cursor kept on a live item: the same id, else the nearest by index, else the first. */
export function keep(items, cursor, lastIndex = 0) {
  if (!items.length) return null;
  if (items.some((x) => x.id === cursor)) return cursor;
  return items[Math.max(0, Math.min(items.length - 1, lastIndex))].id;
}
