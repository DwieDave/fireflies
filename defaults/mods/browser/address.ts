// The address: what was typed as a URL (target), going there, retrying a
// failed load, the page taking the keyboard, the system's browser, editing
// the address, the open command.

import type { Context } from "gpui-kit";
import { run, focused } from "herdr";
import * as Tabs from "./tabs.ts";
import { openTab } from "./tab-ops.ts";
import { available } from "./props.ts";
import type Browser from "./main.ts";

export const SEARCH = "https://duckduckgo.com/?q=";

/** What was typed, as a URL: an address as is (https added), anything else searched. */
export function target(text: string): string | null {
  const s = text.trim();

  if (!s) return null;

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s;

  const hostish = !/\s/.test(s) && (/^(localhost|\[[0-9a-f:]+\]|\d{1,3}(\.\d{1,3}){3})(:\d+)?(\/|$)/i.test(s) || /^[^/\s]+\.[a-z]{2,}(:\d+)?(\/|$)/i.test(s));

  return hostish ? s : SEARCH + encodeURIComponent(s);
}

export function goTo(view: Browser, text: string, cx?: Context) {
  const url = target(text);

  if (!url) return;

  view.editing = false;
  view.error = null;
  view.tab.failed = null;

  const first = !view.start;

  if (first) view.start = url; // the view is created on it
  // A file (file://): the view's source changes (it loads the file in
  // place); navigate takes http(s) only.
  else if (Tabs.filePath(url)) view.start = url;
  else view.call("browser.navigate", { url });

  view.page = { ...view.page, href: url, loading: true, progress: 0.05 };
  // The keyboard into the page, as a browser does (the first page's view
  // comes with the next frame); the mod keeps GPUI's, for its chords.
  view.handle?.focus();

  if (first) cx?.timer.after(300, () => focusPage(view));
  else focusPage(view);

  cx?.notify();
}

/** After a failed load: that address again (the page shown may be the one
 *  before it), else the page. */
export function retry(view: Browser) {
  const url = view.tab.failed?.url;

  view.error = null;
  view.tab.failed = null;

  if (url) {
    view.call("browser.navigate", { url });
    view.page = { ...view.page, loading: true, progress: 0.05 };
  } else view.call("browser.reload");
}

/** The page takes AppKit's keyboard (quietly: no view yet is no error). */
export function focusPage(view: Browser) {
  if (!view.start) return;

  view.quiet(view.tab.id, "focus", {});
}

/** Out of the address field without going: the page has the keyboard
 *  again (a blank pane: the bar), the mod GPUI's. */
export function leaveAddress(view: Browser) {
  view.editing = false;
  view.handle?.focus();
  focusPage(view);
}

/** The page in the system's default browser. */
export function external(view: Browser) {
  const url = view.page.href;

  if (!url) return;

  // cx.open_url would come back here as a new web pane (settings `links`).
  run("app.open_url", { url, in: "system" });
}

export function editAddress(view: Browser) {
  // The page may hold AppKit's keyboard: typing would go on to it.
  if (view.start && available()) view.call("blur");

  view.editing = true;

  const href = view.page.href ?? "";

  view.input?.set_value(href);

  // The whole address selected, as a browser's: typing replaces it.
  if (href) view.input?.set_selected_range({ start: 0, end: href.length });

  view.input?.focus();
}

/** `browser.open:<{ url, slot? } or a URL>`: the page in a new tab
 *  in front, and this pane takes the keyboard (the editor's links). */
export function openCommand(view: Browser, value: string, cx: Context) {
  const a = Tabs.openArgs(value);

  if (!a || !(a.slot !== null ? a.slot === view.slot : view.mine())) return;

  const url = target(a.url);

  if (!url) return;

  openTab(view, url, {}, cx);
  view.claim();

  const me = view.ownPane();

  if (me && focused()?.pane !== me.pane) run("pane.focus", { pane: me.pane });

  view.handle?.focus();
  // Its view comes with the next frame.
  cx.timer.after(300, () => focusPage(view));
}
