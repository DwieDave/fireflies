// Which engine a tab's page runs on: WebKit (the system's, always there) or
// Chromium (once enabled in Settings → Web: nativeViewCapabilities lists the
// `chromium` kind). settings.json `web_engine` picks what new panes open in;
// a tab keeps the engine it was opened in, and a tab a page opens takes its
// opener's.

import * as herdr from "herdr";
import { settings } from "herdr";
import * as Tabs from "./tabs.ts";

export type Engine = "webkit" | "chromium";

export const isEngine = (v: unknown): v is Engine => v === "webkit" || v === "chromium";

/** Chromium views can be made now (installed, in a build that has it). */
export function chromiumReady(): boolean {
  try {
    // Stock Herdr has no native views: the call throws there.
    return herdr.nativeViewCapabilities().kinds.some((k) => k.kind === "chromium");
  } catch {
    return false;
  }
}

/** What a new pane opens in: settings.json `web_engine`, Chromium only while it's ready. */
export function defaultEngine(): Engine {
  return settings().web_engine === "chromium" && chromiumReady() ? "chromium" : "webkit";
}

export const otherEngine = (e: Engine): Engine => (e === "chromium" ? "webkit" : "chromium");

/** The engine's name for people. */
export const engineName = (e: Engine): string => (e === "chromium" ? "Chromium" : "WebKit");

/** The native view kind a tab's page is made with: Chromium only while it is
 *  ready and for an http(s) page (a file:// page is always WebKit's). */
export function viewKind(engine: Engine, url: string | null): "web" | "chromium" {
  return engine === "chromium" && chromiumReady() && !Tabs.filePath(url) ? "chromium" : "web";
}
