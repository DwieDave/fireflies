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

/** A Chromium load error (net::Error, chromium.rs on_load_error) in words, or
 *  null where its own message says enough. */
export function chromiumWords(code: number, host: string): string | null {
  const words = new Map<number, string>([
    [-106, "You're offline."],
    [-105, `Can't find ${host}: no such site, or no name server.`],
    [-137, `Can't find ${host}: no such site, or no name server.`],
    [-102, `${host} refused the connection.`],
    [-109, `${host} can't be reached.`],
    [-118, `${host} took too long to answer.`],
    [-7, `${host} took too long to answer.`],
    [-101, "The connection was reset."],
    [-100, "The connection went down."],
    [-21, "The network changed: try again."],
    [-310, `${host} redirects in a loop.`],
    [-324, `${host} answered nothing.`],
    [-200, `${host}'s certificate isn't trusted.`],
    [-201, `${host}'s certificate has expired or isn't valid yet.`],
    [-202, `${host}'s certificate isn't trusted.`],
    [-107, `A secure connection to ${host} failed.`],
    [-113, `A secure connection to ${host} failed.`],
    [-301, "This kind of address can't open here."],
    [-6, "There's no such file."],
  ]);

  return words.get(code) ?? null;
}

/** The native view kind a tab's page is made with: Chromium only while it is
 *  ready and for an http(s) page (a file:// page is always WebKit's). */
export function viewKind(engine: Engine, url: string | null): "web" | "chromium" {
  return engine === "chromium" && chromiumReady() && !Tabs.filePath(url) ? "chromium" : "web";
}
