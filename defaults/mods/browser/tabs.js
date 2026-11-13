// The web pane's tabs, as data: every function takes the list and gives a new
// one, so main.js keeps no rules of its own about where a tab goes or which
// one shows. main.js draws them and keeps one web view per tab.
//
//   tabs    { list: [tab], active: id, next: n }   n: the next tab's number
//   tab     { id, start, page, error, failed, video, zoom, live, opener, of }
//           id      the native view's id: "web" for the first, then "web-2", …
//           start   the address the view is created on (null: a blank tab,
//                   its address field open); later pages are navigations
//           page    { href, title, loading, progress, canGoBack, canGoForward }
//           failed  { url }: its last load failed (error says how); r retries url
//           live    its view exists: a restored tab gets one when first shown
//           opener  the tab whose link opened it (it goes after its siblings)

/** The native view id of tab number n. */
export const tabId = (n) => (n <= 1 ? "web" : `web-${n}`);

/** A tab on `url` (null: blank). */
export function makeTab(id, url, zoom, { title = null, live = true, opener = null } = {}) {
  return { id, start: url ?? null, page: { href: url ?? null, title, loading: false, progress: 0, canGoBack: false, canGoForward: false },
    error: null, failed: null, video: false, zoom, live, opener, of: null };
}

/** One tab on `url`. */
export function single(url, zoom) {
  return { list: [makeTab(tabId(1), url, zoom)], active: tabId(1), next: 2 };
}

export const activeTab = (m) => m.list.find((t) => t.id === m.active) ?? m.list[0];
export const indexOf = (m, id) => m.list.findIndex((t) => t.id === id);

/** A new tab on `url` (null: blank). From a link (`opener`): after the shown
 *  tab and the tabs it opened already, as a browser does; else at the end.
 *  `background`: the shown tab stays. Returns `[tabs, tab]`. */
export function open(m, url, { background = false, opener = null, zoom } = {}) {
  const from = activeTab(m);
  const tab = makeTab(tabId(m.next), url, zoom ?? from?.zoom ?? 0.9, { opener });
  let at = m.list.length;
  if (opener) {
    at = indexOf(m, opener) + 1;
    while (at < m.list.length && m.list[at].opener === opener) at++;
  }
  const list = [...m.list.slice(0, at), tab, ...m.list.slice(at)];
  return [{ list, active: background ? m.active : tab.id, next: m.next + 1 }, tab];
}

/** Closes tab `id`. The shown one: its right neighbor shows, else its left.
 *  The last tab: a blank one takes its place (the pane stays). Returns
 *  `[tabs, closed]`; closed is null when there was no such tab. */
export function close(m, id) {
  const i = indexOf(m, id);
  if (i < 0) return [m, null];
  const closed = m.list[i];
  const list = m.list.filter((t) => t.id !== id)
    // Its opened tabs now hang off nothing (they stay where they are).
    .map((t) => (t.opener === id ? { ...t, opener: null } : t));
  if (!list.length) {
    const fresh = makeTab(tabId(m.next), null, closed.zoom);
    return [{ list: [fresh], active: fresh.id, next: m.next + 1 }, closed];
  }
  const active = m.active !== id ? m.active : (list[i] ?? list[i - 1]).id;
  return [{ ...m, list, active }, closed];
}

/** Shows tab `id`; it gets its view now, if it had none. */
export function show(m, id) {
  if (indexOf(m, id) < 0) return m;
  // Shown another tab, the tab shown before starts a fresh row of links
  // (a link opened from it later goes right after it again).
  const was = id === m.active ? null : m.active;
  return { ...m, active: id, list: m.list.map((t) => ({ ...t, live: t.live || t.id === id, opener: t.opener && t.opener === was ? null : t.opener })) };
}

/** The tab `by` steps from the shown one (wrapping). */
export function step(m, by) {
  const n = m.list.length;
  const i = Math.max(0, indexOf(m, m.active));
  return m.list[(((i + by) % n) + n) % n].id;
}

/** The tab a number key names: 1–8 the nth, 9 the last (as a browser). Null: none. */
export function nth(m, n) {
  if (!(n >= 1 && n <= 9)) return null;
  return (n === 9 ? m.list.at(-1) : m.list[n - 1])?.id ?? null;
}

/** Tab `id` moved to place `index` (0-based: where it ends up, clamped). It
 *  was put there by hand, so it leaves its row of links (opener). */
export function move(m, id, index) {
  const i = indexOf(m, id);
  if (i < 0) return m;
  const to = Math.max(0, Math.min(m.list.length - 1, Number(index) || 0));
  if (to === i) return m;
  const rest = m.list.filter((t) => t.id !== id);
  return { ...m, list: [...rest.slice(0, to), { ...m.list[i], opener: null }, ...rest.slice(to)] };
}

// ---- dragging a tab along the strip (as the app's own strip, nocturne/tabdrag.js)

/** How far (window px) a press moves before it's a drag rather than a click. */
export const DRAG_START = 4;

/** The gap the pointer is over: before tab `id`, or after it (its right
 *  half); `id` null: the strip's end. `x`, `width`: the pointer's place in the tab. */
export const gapAt = (id, x, width) => ({ id, after: id != null && x >= width / 2 });

/** Where `dragged` ends up (move's index) dropped into `gap`, or null when the
 *  drop leaves it where it is (over itself, or its own gaps). A gap after a
 *  tab and the gap before the next one are the same place. */
export function dropIndex(m, dragged, gap) {
  const i = indexOf(m, dragged);
  if (!gap || i < 0) return null;
  const rest = m.list.map((t) => t.id).filter((x) => x !== dragged);
  let at;
  if (gap.id == null) at = rest.length;
  else {
    const j = rest.indexOf(gap.id);
    if (j < 0) return null;
    at = j + (gap.after ? 1 : 0);
  }
  return at === i ? null : at;
}

/** The tab the drop marker stands before for a drop at `index` (dropIndex's):
 *  its left edge; null: the strip's end. Undefined: no marker. */
export function stakeBefore(m, dragged, index) {
  if (index == null) return undefined;
  const rest = m.list.map((t) => t.id).filter((x) => x !== dragged);
  return rest[index] ?? null;
}

/** What survives a restart: each tab's address, title and zoom. */
export function save(m) {
  return JSON.stringify({ active: m.active, next: m.next,
    tabs: m.list.map((t) => ({ id: t.id, href: t.page.href ?? t.start ?? null, title: t.page.title ?? null, zoom: t.zoom })) });
}

/** The saved tabs, or null. Only the shown tab gets its view at once; the
 *  others load when first shown. */
export function restore(text, zoom) {
  let s;
  try { s = JSON.parse(text); } catch { return null; }
  const saved = Array.isArray(s?.tabs) ? s.tabs.filter((t) => t && typeof t.id === "string") : [];
  if (!saved.length) return null;
  const active = saved.some((t) => t.id === s.active) ? s.active : saved[0].id;
  const list = saved.map((t) => makeTab(t.id, typeof t.href === "string" ? t.href : null, Number(t.zoom) || zoom,
    { title: typeof t.title === "string" ? t.title : null, live: t.id === active }));
  const top = Math.max(1, ...saved.map((t) => Number(/^web-(\d+)$/.exec(t.id)?.[1] ?? 1)));
  return { list, active, next: Math.max(Number(s.next) || 0, top + 1) };
}

/** A file:// address's path (decoded), or null for any other address. */
export function filePath(url) {
  const m = /^file:\/\/(?:localhost)?(\/[^?#]*)/i.exec(url ?? "");
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return m[1]; }
}

/** Where a tab's view loads from: an http(s) address as `url`; a file://
 *  one (an HTML file from the files pane) as the file itself, with its
 *  folder readable (css, scripts, images beside it) and its scripts on. The
 *  native view takes no file:// `url`. */
export function source(url) {
  const path = filePath(url);
  return path ? { path, trust: "interactive" } : { url };
}

/** A tab's name in the strip: its page's title, else its host (a file: its
 *  name), else "new tab". */
export function label(tab) {
  const title = tab.page.title?.trim();
  if (title) return title;
  const href = tab.page.href ?? tab.start ?? "";
  const file = filePath(href);
  if (file) return file.split("/").filter(Boolean).at(-1) ?? file;
  const m = /^[a-z]+:\/\/([^/?#]+)/i.exec(href);
  return m ? m[1].replace(/^www\./, "") : "new tab";
}

/** A `browser.open:<value>` value: JSON `{ url, slot? }`, or a bare URL. */
export function openArgs(value) {
  const v = String(value ?? "").trim();
  if (!v) return null;
  if (v.startsWith("{")) {
    try {
      const o = JSON.parse(v);
      return typeof o?.url === "string" && o.url.trim() ? { url: o.url.trim(), slot: o.slot == null ? null : String(o.slot) } : null;
    } catch { return null; }
  }
  return { url: v, slot: null };
}

// ---- one tab pinned to the shelf (nocturne's pins.js reads these records)
//
// Nocturne keeps the shelf's pins in shared PINS: [{ pane, mod, props, at, tab? }].
// A record with `tab` pins that one tab of a web pane: the shelf names it by the
// tab's title (TAB_TITLES), and going to it focuses the pane and shows the tab
// (command show:{ slot, tab }, or SHOW when the pane comes on screen later).
// A web pane finds its records by its props' slot (its pane id may change
// across a restart; nocturne's tidy() keeps `pane` current).

export const PINS = "nocturne.pinned-panes";

const ofSlot = (r, slot) => r?.mod === "browser" && r.props?.slot != null && String(r.props.slot) === String(slot);

/** Tab `tab` of the pane with this slot is pinned to the shelf. */
export const tabPinned = (records, slot, tab) => (Array.isArray(records) ? records : []).some((r) => ofSlot(r, slot) && r.tab === tab);

/** The records with tab `tab` of `pane` (its PaneInfo: pane, props with a slot) pinned (at `now`) or not. */
export function pinTab(records, pane, tab, on, now) {
  const slot = pane?.props?.slot;
  const rest = (Array.isArray(records) ? records : []).filter((r) => !(ofSlot(r, slot) && r.tab === tab));
  return on ? [...rest, { pane: pane.pane, mod: "browser", props: pane.props, at: now, tab }] : rest;
}

/** The records without the pins of tab `tab` of the pane with this slot (it
 *  closed), or null when it had none. */
export function dropTabPins(records, slot, tab) {
  const list = Array.isArray(records) ? records : [];
  const rest = list.filter((r) => !(ofSlot(r, slot) && r.tab === tab));
  return rest.length === list.length ? null : rest;
}

/** A `show:` value (JSON `{ slot, tab }`), or null. */
export function showArgs(value) {
  try {
    const o = JSON.parse(String(value ?? ""));
    return typeof o?.tab === "string" && o.tab ? { slot: o.slot == null ? null : String(o.slot), tab: o.tab } : null;
  } catch { return null; }
}

/** Each tab's name for the shelf, `{ [tab id]: label }`; blank tabs have none. */
export const tabTitles = (m) => Object.fromEntries(m.list.filter((t) => t.page.href || t.page.title || t.start).map((t) => [t.id, label(t)]));

// ---- the tab's menu (a right-click on it, m in the bar): its rows in sections

/** The menu's sections for a tab: `{ pinned, canPin, index, count }` →
 *  [[{ act, name, enabled }], …]. */
export function menuRows({ pinned = false, canPin = true, index = 0, count = 1 } = {}) {
  return [
    [{ act: "pin", name: pinned ? "Unpin this tab from the shelf" : "Pin this tab to the shelf", enabled: Boolean(canPin) }],
    [{ act: "left", name: "Move the tab left", enabled: index > 0 }, { act: "right", name: "Move the tab right", enabled: index < count - 1 }],
    [{ act: "close", name: "Close the tab", enabled: true }],
  ];
}

/** The next enabled row from `at` going `by` (wrapping), or `at`. */
export function menuStep(rows, at, by) {
  const n = rows.length;
  for (let k = 1; k <= n; k++) {
    const i = (((at + by * k) % n) + n) % n;
    if (rows[i].enabled) return i;
  }
  return at;
}
