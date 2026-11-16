// A Chromium tab whose page wants media Chromium can't play here (its build
// has no H.264 or AAC, and no DRM): web.mediaUnsupported from the native view
// (chromium.rs MEDIA_SCRIPT says how it knows, and how sure). settings.json
// `chromium_video` says what follows: "fallback" (default) reopens the page
// in WebKit and says so in a toast, "ask" asks in a toast first (a click on it
// runs reopen:{ slot, tab, engine }), "error" leaves the page's own error.

import type { Context } from "gpui-kit";
import { notify, settings } from "herdr";
import { isBoolean, isString, nullable, object, parseJson } from "./guard.ts";
import type { Guarded } from "./guard.ts";
import type { Tab } from "./tabs.ts";
import type Browser from "./main.ts";

/** web.mediaUnsupported's data: why (error, nosource, drm, probe), what it asked for, how sure. */
export const isMediaData = object({ reason: isString }, { codec: nullable(isString), sure: isBoolean });

export type MediaData = Guarded<typeof isMediaData>;

/** What the page wanted, in words. */
export function wanted(d: MediaData): string {
  if (d.reason === "drm") return "protected (DRM) video";

  return /mp4a|aac|audio/i.test(d.codec ?? "") ? "AAC audio" : "H.264 video";
}

const hostOf = (tab: Tab): string => /^[a-z]+:\/\/([^/?#]+)/i.exec(tab.page.href ?? "")?.[1]?.replace(/^www\./, "") ?? "This page";

/** The policy: settings.json `chromium_video`. */
export const policy = (): "fallback" | "ask" | "error" => {
  const p = settings().chromium_video;

  return p === "ask" || p === "error" ? p : "fallback";
};

/** A Chromium tab's page wants what Chromium can't play. Once per page: a tab
 *  already told (or back in WebKit) hears nothing more. */
export function mediaUnsupported(view: Browser, tab: Tab, d: MediaData, cx: Context) {
  if (tab.engine !== "chromium" || view.mediaTold.has(tab.id)) return;

  view.mediaTold.add(tab.id);

  const p = policy();

  if (p === "error") return;

  const host = hostOf(tab), what = wanted(d);

  if (p === "fallback") {
    view.reopenIn(tab, "webkit", cx);
    notify({ title: "Reopened in WebKit", body: `${host} plays ${what}, which Chromium here can't.`, level: "info", timeout: 6000 });

    return;
  }

  notify({
    title: "Chromium can't play this",
    body: `${host} wants ${what}. Click to reopen it in WebKit.`,
    level: "warning",
    timeout: 12000,
    action: { name: `browser.reopen:${JSON.stringify({ slot: view.slot, tab: tab.id, engine: "webkit" })}` },
  });
}

const isReopen = object({ tab: isString }, { slot: nullable(isString), engine: isString });

/** `reopen:{ slot, tab, engine }`: that tab of the pane with that slot, in that engine (the ask toast's click). */
export function reopenCommand(view: Browser, value: string, cx: Context) {
  const r = parseJson(value, isReopen);

  if (!r || (r.slot ?? null) !== (view.slot ?? null)) return;

  const tab = view.tabs.list.find((t) => t.id === r.tab);

  if (tab) view.reopenIn(tab, r.engine === "chromium" ? "chromium" : "webkit", cx);
}
