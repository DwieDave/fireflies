// The web pane's tabs, as data: every function takes the list and gives a new
// one, so main.js keeps no rules of its own about where a tab goes or which
// one shows. main.js draws them and keeps one web view per tab.
//
//   tabs    { list: [tab], active: id, next: n }   n: the next tab's number
//   tab     { id, start, page, error, video, zoom, live, opener, of }
//           id      the native view's id: "web" for the first, then "web-2", …
//           start   the address the view is created on (null: a blank tab,
//                   its address field open); later pages are navigations
//           page    { href, title, loading, progress, canGoBack, canGoForward }
//           live    its view exists: a restored tab gets one when first shown
//           opener  the tab whose link opened it (it goes after its siblings)

/** The native view id of tab number n. */
export const tabId = (n) => (n <= 1 ? "web" : `web-${n}`);

/** A tab on `url` (null: blank). */
export function makeTab(id, url, zoom, { title = null, live = true, opener = null } = {}) {
  return { id, start: url ?? null, page: { href: url ?? null, title, loading: false, progress: 0, canGoBack: false, canGoForward: false },
    error: null, video: false, zoom, live, opener, of: null };
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

/** A tab's name in the strip: its page's title, else its host, else "new tab". */
export function label(tab) {
  const title = tab.page.title?.trim();
  if (title) return title;
  const m = /^[a-z]+:\/\/([^/?#]+)/i.exec(tab.page.href ?? tab.start ?? "");
  return m ? m[1].replace(/^www\./, "") : "new tab";
}

/** A `nocturne-browser.open:<value>` value: JSON `{ url, slot? }`, or a bare URL. */
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
