// The web views' events (nextNativeViewEvent), proven where they come in
// (parseEvent), what a failed load says (loadFailure), and what each event
// does to its tab (onEvent).

import type { Context } from "gpui-kit";
import { shared, setShared, panes, openOverlay } from "herdr";
import type { Guarded } from "./guard.ts";
import type { Tab } from "./tabs.ts";
import { isBoolean, isNumber, isString, literal, nullable, object, oneOf, parseJson, readShared, writeShared } from "./guard.ts";
import { openTab } from "./tab-ops.ts";
import { saveTabs, fetchIcon } from "./publish.ts";
import { focusPage } from "./address.ts";
import { toggleInspector, openInspector } from "./inspector.ts";
import { PLAYER, PIP_PANE, PIP_SNAP, snapOn, hidePane, unhide } from "./away.ts";
import type Browser from "./main.ts";

/** web.newTab: what would open a window. */
export const isNewTab = object({ url: isString }, { background: isBoolean });

/** web.inspector, pip.enter, pip.popIn: the web view meant. */
export const isOfData = object({ of: isString });

export type OfData = Guarded<typeof isOfData>;

export const isAfter = literal("pane", "park");

/** pip.popIn's `then`: the player goes on into a pane or a chip (null: it stays a window).
 *  Read from its descriptor, as guard.ts reads fields: a `then` field written in a guard
 *  of our own would make that object a thenable. */
export const thenOf = (d: OfData): "pane" | "park" | null => {
  const then = Object.getOwnPropertyDescriptor(d, "then")?.value;

  return isAfter(then) ? then : null;
};

/** load.* and web.location: the page's state (fields left out keep theirs). */
export const isPageState = object({}, {
  href: nullable(isString),
  url: nullable(isString),
  title: nullable(isString),
  loading: isBoolean,
  progress: isNumber,
  canGoBack: isBoolean,
  canGoForward: isBoolean,
});

type PageState = Guarded<typeof isPageState>;

/** load.error: what failed, and where. */
export const isLoadError = object({}, { code: isNumber, domain: nullable(isString), failingUrl: nullable(isString), href: nullable(isString), message: nullable(isString) });

export type LoadError = Guarded<typeof isLoadError>;

/** No data read. */
export const isNoData = object({});

/** The view an event came from: a tab's id (none: the shown tab's). */
export const FROM = { id: nullable(isString) };

/** One event of the web views (nextNativeViewEvent), a union on its name: the events read
 *  here with their data proven; any other is skipped where it comes in (parseEvent). */
export const isWebEvent = oneOf(
  object({ event: literal("web.newTab"), data: isNewTab }, FROM),
  object({ event: literal("web.inspector", "pip.enter", "pip.popIn"), data: isOfData }, FROM),
  object({ event: literal("load.start", "load.commit", "load.finish", "web.location"), data: isPageState }, FROM),
  object({ event: literal("load.error"), data: isLoadError }, FROM),
  object({ event: literal("web.video") }, { ...FROM, data: object({}, { present: isBoolean }) }),
  object({ event: literal("web.icon") }, { ...FROM, data: object({}, { href: nullable(isString) }) }),
  object({ event: literal("pip.start") }, { ...FROM, data: object({}, { result: isString, error: isString }) }),
  object({ event: literal("pip.snapped"), data: object({ on: isBoolean }) }, FROM),
  object({ event: literal("view.click", "view.escapeKey", "web.inspectKey", "web.reloadKey", "pip.leave", "pip.moved") }, { ...FROM, data: isNoData }),
);

export type WebEvent = Guarded<typeof isWebEvent>;

/** A web view's event (nextNativeViewEvent's text), or undefined: not one read here. */
export const parseEvent = (text: string): WebEvent | undefined => parseJson(text, isWebEvent);

/** A failed load in words, and the address to retry. */
export interface Failure {
  readonly message: string;
  readonly url: string | null;
}

/** A load.error in words a person reads, or null when nothing failed: a load
 *  cut short (NSURLErrorDomain -999: the next navigation replaced it, a
 *  redirect, a click while loading; WebKitErrorDomain 102: a download, or a
 *  tab opened instead; 204: a plug-in took it). `url`: the address to retry
 *  (the one that failed, not the page still shown). */
export function loadFailure(d: LoadError): Failure | null {
  const code = d.code ?? Number.NaN, domain = d.domain ?? null;
  const url = d.failingUrl || null;
  const web = domain === "WebKitErrorDomain" || (domain === null && code === 102);

  if ((domain === "NSURLErrorDomain" || domain === null) && code === -999) return null;

  if (web && (code === 102 || code === 204)) return null;

  const host = /^[a-z]+:\/\/([^/?#]+)/i.exec(url ?? d.href ?? "")?.[1]?.replace(/^www\./, "") ?? "The site";

  const words = domain === "NSURLErrorDomain" || domain === null ? new Map<number, string>([
    [-1009, "You're offline."],
    [-1020, "No network may be used for this."],
    [-1003, `Can't find ${host}: no such site, or no name server.`],
    [-1004, `${host} doesn't answer.`],
    [-1001, `${host} took too long to answer.`],
    [-1005, "The connection went down."],
    [-1007, `${host} redirects in a loop.`],
    [-1011, `${host} answered something unreadable.`],
    [-1202, `${host}'s certificate isn't trusted.`],
    [-1201, `${host}'s certificate has expired or isn't valid yet.`],
    [-1200, `A secure connection to ${host} failed.`],
    [-1206, `${host} wants a client certificate.`],
    [-1022, `${host} has to be opened over https.`],
    [-1002, "This kind of address can't open here."],
    [-1100, "There's no such file."],
    [-1102, "That file can't be read."],
  ]).get(code) ?? null : web && (code === 100 || code === 101) ? "This page can't be shown here: ↗ opens it in the system's browser." : null;

  const said = (d.message ?? "").trim();
  // WebKit's generic "The operation couldn't be completed. (… error N.)" says nothing.
  const vague = !said || /couldn.t be completed|NSURLErrorDomain|WebKitErrorDomain/i.test(said);
  const message = words ?? (vague ? `The page didn't load${Number.isFinite(code) ? ` (error ${code})` : ""}.` : said);

  return { message, url };
}

/** A load's step or a new address: the tab's page as the view says it now
 *  (fields left out keep theirs); a new page clears the last one's error, a
 *  finished one is kept for the next start. */
function pageMoved(view: Browser, tab: Tab, event: "load.start" | "load.commit" | "load.finish" | "web.location", s: PageState) {
  const was = tab.page;

  tab.page = {
    href: s.href ?? s.url ?? was.href,
    title: s.title === undefined ? was.title : s.title,
    loading: s.loading ?? was.loading,
    progress: s.progress ?? was.progress,
    canGoBack: s.canGoBack ?? was.canGoBack,
    canGoForward: s.canGoForward ?? was.canGoForward,
  };

  // The next page: the last one's error line goes.
  if (event === "load.start" || event === "load.commit") {
    tab.error = null;
    tab.failed = null;
  }

  if ((event === "load.finish" || event === "web.location") && tab.page.href) saveTabs(view);
}

/** A load that failed: it stops, and says what in words with the address to retry
 *  (one cut short, by another page, a download or a tab instead, says nothing). */
function loadFailed(tab: Tab, d: LoadError) {
  tab.page = { ...tab.page, loading: false };

  const f = loadFailure(d);

  if (f) {
    tab.error = f.message;
    tab.failed = { url: f.url };
  }
}

/** What a web view's event does to its tab, the bar and the pane. */
export function onEvent(view: Browser, e: WebEvent, cx: Context) {
  // Each tab's view says its id; a closed tab's last words go nowhere.
  const tab = e.id === null || e.id === undefined ? view.tab : view.tabs.list.find((t) => t.id === e.id);

  if (!tab) return;

  switch (e.event) {
    // A new window, a middle or Cmd click, the link menu (native view `tabs: true`).
    case "web.newTab":
      if (!e.data.url) return;

      openTab(view, e.data.url, { background: Boolean(e.data.background), opener: tab.id }, cx);

      if (!e.data.background) cx.timer.after(300, () => focusPage(view));

      return;
    case "view.click":
      view.claim();

      return;
    // cmd+esc in the page: the keyboard is the bar's again.
    case "view.escapeKey":
      view.claim();
      view.handle?.focus();

      return;
    // Right-click "Inspect Element": WebKit opened the inspector; give it its pane.
    case "web.inspector":
      openInspector(view, e.data.of, cx);

      return;
    // ⌥⌘I while the page has the keyboard (it never reaches Fireflies' keys).
    case "web.inspectKey":
      toggleInspector(view, cx);

      return;
    // ⌘R while the page has the keyboard: reload (or stop, while it loads).
    case "web.reloadKey":
      view.command("reload");

      return;
    // web.location: the address changed without a load too (links in
    // single-page apps, pushState, #fragments, back/forward within a page).
    case "load.start":
    case "load.commit":
    case "load.finish":
    case "web.location":
      pageMoved(view, tab, e.event, e.data);

      return;

    // The page's icon link (none: null): fetched for its origin unless cached.
    case "web.icon":
      fetchIcon(view, tab, e.data?.href ?? null, cx);

      return;
    // ⧉ shows while the page has a <video> (it comes and goes with the page).
    case "web.video":
      tab.video = Boolean(e.data?.present);

      return;
    // A load cut short (another page, a download, a tab instead) isn't one.
    case "load.error":
      loadFailed(tab, e.data);

      return;

    // The page's video goes to the player (⧉), or comes back into Fireflies from
    // its popped-out window: the player shows it. Meanwhile the page is away.
    // From the window out of Fireflies' ◧ / ⤓, `then`: the player goes on into a pane or a chip.
    case "pip.enter":
    case "pip.popIn": {
      const after = thenOf(e.data);

      openOverlay({ ...PLAYER, snap: snapOn(), props: after ? { of: e.data.of, after } : { of: e.data.of } });

      if (e.event === "pip.enter") {
        view.away = true;
        view.pipOf = e.data.of;
        hidePane(view);
      }

      return;
    }

    case "pip.leave":
      view.away = false;
      unhide(view, true);

      return;
    // The video went into a pane (not a parked chip): the page shows again.
    case "pip.moved":
      cx.timer.after(400, () => {
        const n = readShared(shared, PIP_PANE, null);

        if (n?.of === view.pipOf && !n.park && panes().some((x) => x.pane === n.pane)) unhide(view, false);
      });

      return;
    // The window out of Fireflies' snapping toggle: the player's mode, kept for every player.
    case "pip.snapped":
      writeShared(setShared, PIP_SNAP, e.data.on);

      return;
    case "pip.start":
      if (e.data?.result === "none") view.error = "No video on this page.";

      if (e.data?.error) view.error = `Picture in picture: ${e.data.error}`;
  }
}
