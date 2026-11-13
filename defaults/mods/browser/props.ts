// What every part of the web pane reads: its props (a page, a tab's menu, an
// inspector), the copy that last had the keyboard, the bar's icons and key
// context, whether native views exist here, a bar button's shape.

import type { Context, KeyEvent } from "gpui-kit";
import type { Props } from "gpui-shell";
import * as herdr from "herdr";
import { props, closeOverlay } from "herdr";
import type { Guarded } from "./guard.ts";
import { isBoolean, isNull, isNumber, isString, nullable, object, oneOf, sharedKey } from "./guard.ts";

export const ICONS = "mods/browser/icons";

// A web pane's mark (nocturne/header.ts markPath): a tab's while its favicon is unknown.
export const WEB_MARK = "mods/workspace-chrome/monitor.svg";

/** A key's name: the typed character for printable keys ("H", "?", "+"), else GPUI's key. */
export const keyOf = (e: KeyEvent): string => (isString(e.key_char) && e.key_char.length === 1 && e.key_char.trim() ? e.key_char : e.key);

// The copy that last had the keyboard or a click: it takes broadcast commands
// while no web pane is focused.
export const ACTIVE = sharedKey("browser.active", nullable(isString));

// Tab and shift-tab, bound in the browser's own key context (see the top).
export const CONTEXT = "NocturneBrowser", TAB = "nocturne_browser::tab", TAB_BACK = "nocturne_browser::tab_back";

/** The key event a bound tab stands for. */
export const tabEvent = (shift: boolean): KeyEvent => ({ key: "tab", keystroke: shift ? "shift-tab" : "tab", modifiers: { shift, control: false, alt: false, platform: false, function: false } });

/** An object (not an array, not null): its fields still to be proven. */
export const isPlainObject = (value: unknown): value is object => typeof value === "object" && value !== null && !Array.isArray(value);

/** A tab's menu, as the popup copy is opened with it (props { tabMenu }). */
export const isTabMenu = object({ tab: isString, title: isString, pinned: isBoolean, canPin: isBoolean, index: isNumber, count: isNumber }, { slot: nullable(isString) });

export type TabMenu = Guarded<typeof isTabMenu>;

/** What it is opened with (see the top): other props are no props. */
export const isBrowserProps = object({}, {
  url: nullable(isString),
  slot: oneOf(isString, isNumber, isNull),
  inspect: oneOf(isString, isNumber, isNull),
  tabMenu: isTabMenu,
  overlay: isString,
});

export type BrowserProps = Guarded<typeof isBrowserProps>;

/** This copy's props (the app's, else what init was given). */
export const browserProps = (given?: Props): BrowserProps => {
  const p = props() ?? given;

  return isBrowserProps(p) ? p : {};
};

/** Closes the popup this copy is (a tab's menu). */
export const closeOwn = () => {
  const id = browserProps().overlay;

  if (id !== undefined) closeOverlay(id);
};

// ---- the web view's events (nextNativeViewEvent) and answers (nativeViewCall)

// Not on stock Herdr: the module has no nativeView there.
export const available = () => typeof herdr.nativeView !== "undefined";

/** What a call to a web view is given: a page to go to, whether it shows, or nothing. */
export type CallArgs = { readonly url: string } | { readonly visible: boolean } | Readonly<Record<never, never>>;

/** A bar button tab and enter reach: its id, whether it can be pressed, what it does. */
export interface Control {
  readonly id: string;
  readonly enabled: boolean;
  readonly action: (cx: Context) => void;
}
