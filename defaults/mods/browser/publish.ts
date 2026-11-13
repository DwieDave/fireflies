// What the pane keeps and tells: its tabs saved for the next start, every
// tab's title and favicon by the pane's slot for nocturne's shelf, the
// favicons fetched into the cache.

import type { AsyncContext, Context } from "gpui-kit";
import * as herdr from "herdr";
import { shared, setShared, panes } from "herdr";
import type { SharedMapKey } from "./guard.ts";
import { isString, readSharedMap, sharedMapKey, writeSharedMap } from "./guard.ts";
import * as Tabs from "./tabs.ts";
import * as Favicons from "./favicons.ts";
import type { Tab } from "./tabs.ts";
import { isPlainObject } from "./props.ts";
import type Browser from "./main.ts";

// What each web pane shows, for the dock's shelf: { [props.slot]: the shown
// tab's page title (else its host) }, as the viewers keep theirs.
export const TITLES = sharedMapKey("browser.titles", isString);

// Every tab's name, for a tab pinned to the shelf: { [props.slot]: { [tab id]: title } }.
// Its entries as stored: an object keyed by tab id, every value a title. Read into maps
// (tabTitlesNow), written back from them.
export interface StoredTitles {
  readonly [tab: string]: string;
}

export const isStoredTitles = (value: unknown): value is StoredTitles =>
  isPlainObject(value) && Object.keys(value).every((tab) => isString(Object.getOwnPropertyDescriptor(value, tab)?.value));

export const TAB_TITLES = sharedMapKey("browser.tab-titles", isStoredTitles);

/** Every pane's tab titles (or icons), by slot, then by tab. */
export const tabTitlesNow = (key: SharedMapKey<StoredTitles> = TAB_TITLES): ReadonlyMap<string, ReadonlyMap<string, string>> =>
  new Map([...readSharedMap(shared, key)].map(([slot, titles]) => [slot, new Map(Object.entries(titles))]));

/** Writes every pane's tab titles (or icons; by slot, then by tab) as stored. */
export const writeTabTitles = (all: ReadonlyMap<string, ReadonlyMap<string, string>>, key: SharedMapKey<StoredTitles> = TAB_TITLES) =>
  writeSharedMap(setShared, key, new Map([...all].map(([slot, titles]) => [slot, Object.fromEntries(titles)])));

// Favicons (favicons.ts), for the shelf: the shown tab's by slot, and every
// tab's by slot, then by tab, as the titles. A value is the icon's file as
// image() takes it ("cache/browser-icons/<host>", under the app's folder); a
// tab without a known icon has none.
export const PAGE_ICONS = sharedMapKey("browser.icons", isString);

export const TAB_ICONS = sharedMapKey("browser.tab-icons", isStoredTitles);

/** Same titles, in the same order. */
export const sameTitles = (a: ReadonlyMap<string, string>, b: ReadonlyMap<string, string>) =>
  a.size === b.size && [...a].every(([k, v], i) => [...b.keys()][i] === k && b.get(k) === v);

/** The tabs, kept for the next start (and the shown page, as before tabs). */
export function saveTabs(view: Browser) {
  try {
    localStorage.setItem("tabs", Tabs.save(view.tabs));

    if (view.page.href) localStorage.setItem("url", view.page.href);
  } catch {
    /* not kept */
  }

  publishTitle(view);
}

/** The browser panes' slots (their pins and titles are kept by them). */
export function liveSlots(): Set<string> {
  return new Set(panes().flatMap((p) => {
    const slot = p.mod === "browser" ? Tabs.paneSlot(p) : null;

    return slot === null ? [] : [slot];
  }));
}

/** The shown tab's name in shared TITLES under this pane's slot (a blank
 *  tab: none, the shelf says the host or "Web"); slots of panes that are
 *  gone go. Written only when something changed. */
export function publishTitle(view: Browser) {
  if (!view.ownSlot || view.inspect || view.gone) return;

  const live = liveSlots();

  publishTabTitles(view, live);
  publishIcons(view, live);

  const was = readSharedMap(shared, TITLES);
  const name = view.page.href || view.page.title ? Tabs.label(view.tab) : null;
  const stale = [...was.keys()].some((k) => !live.has(k) && k !== view.slot);

  if ((was.get(view.slot) ?? null) === name && !stale) return;

  const next = new Map([...was].filter(([k]) => live.has(k) && k !== view.slot));

  if (name) next.set(view.slot, name);

  writeSharedMap(setShared, TITLES, next);
}

/** Every tab's name in shared TAB_TITLES under this pane's slot (a tab
 *  pinned to the shelf is named by it); gone panes' entries go. Written
 *  only when something changed. */
export function publishTabTitles(view: Browser, live: ReadonlySet<string>, key: SharedMapKey<StoredTitles> = TAB_TITLES, mine: ReadonlyMap<string, string> = Tabs.tabTitles(view.tabs)) {
  const was = tabTitlesNow(key);
  const same = sameTitles(was.get(view.slot) ?? new Map(), mine);
  const stale = [...was.keys()].some((k) => !live.has(k) && k !== view.slot);

  if (same && !stale) return;

  const next = new Map([...was].filter(([k]) => live.has(k) && k !== view.slot));

  if (mine.size) next.set(view.slot, mine);

  writeTabTitles(next, key);
}

// ---- favicons (favicons.ts)

/** Tab `t`'s favicon file (image()'s path), or null: none cached for its origin. */
export function tabIcon(view: Browser, t: Tab): string | null {
  return Favicons.tabIcons([t], view.icons).get(t.id) ?? null;
}

/** Every tab's icon in shared TAB_ICONS, the shown tab's in PAGE_ICONS, under
 *  this pane's slot, as the titles (written only when something changed). */
export function publishIcons(view: Browser, live: ReadonlySet<string>) {
  const mine = Favicons.tabIcons(view.tabs.list, view.icons);

  publishTabTitles(view, live, TAB_ICONS, mine);

  const was = readSharedMap(shared, PAGE_ICONS);
  const icon = mine.get(view.tab.id) ?? null;
  const stale = [...was.keys()].some((k) => !live.has(k) && k !== view.slot);

  if ((was.get(view.slot) ?? null) === icon && !stale) return;

  const next = new Map([...was].filter(([k]) => live.has(k) && k !== view.slot));

  if (icon) next.set(view.slot, icon);

  writeSharedMap(setShared, PAGE_ICONS, next);
}

/** The origins cached at start (the cache folder's names): their tabs show
 *  their icons at once, after a restart too, with no page loaded. */
export function listIcons(view: Browser, cx: AsyncContext) {
  view.iconsListed = new Promise((done) => {
    cx.spawn(async (cx) => {
      const r = await herdr.exec("ls", ["-1", `${herdr.appHome()}/${Favicons.ICON_DIR}`]).catch(() => null);

      for (const k of r?.code === 0 ? Favicons.listed(r.stdout) : []) view.icons.add(k);

      done();
      publishTitle(view);
      cx.notify();
    });
  });
}

/** The page in tab `t` named its icon (`link`, null: none): fetched into the cache
 *  folder for its origin, once a run, unless it is there already. Until it is (or
 *  when it can't be), the tab wears the web pane's mark. */
export function fetchIcon(view: Browser, t: Tab, link: string | null, cx: Context) {
  const o = Favicons.originOf(t.page.href);

  if (!o || view.iconAsked.has(o.key)) return;

  view.iconAsked.add(o.key);
  cx.spawn(async (cx) => {
    await view.iconsListed;

    if (view.icons.has(o.key)) return;

    const args = ["-c", Favicons.FETCH, "favicon", `${herdr.appHome()}/${Favicons.ICON_DIR}`, o.key, ...Favicons.iconUrls(o, link)];
    const r = await herdr.exec("sh", args, { timeout: 30000 }).catch(() => null);

    if (r?.code !== 0) return;

    view.icons.add(o.key);
    publishTitle(view);
    cx.notify();
  });
}

// ---- a tab pinned to the shelf (Tabs.pinTab; nocturne's shelf draws it)

/** This pane's entry out of a record keyed by slot. */
export function dropSlot<T>(view: Browser, key: SharedMapKey<T>) {
  const titles = readSharedMap(shared, key);

  if (!view.ownSlot || !titles.has(view.slot)) return;

  const rest = new Map(titles);

  rest.delete(view.slot);
  writeSharedMap(setShared, key, rest);
}
