// Safari's Web Inspector for a tab's page: the inspector pane itself
// (initInspector), finding and opening it beside the page, its keys.

import type { AsyncContext, Context, KeyEvent } from "gpui-kit";
import * as herdr from "herdr";
import { nextCommand, shared, setShared, run, panes } from "herdr";
import { isString, object, readSharedMap, sharedMapKey, writeSharedMap } from "./guard.ts";
import { keyOf, available } from "./props.ts";
import type Browser from "./main.ts";

// The open inspector panes: { [web view key]: pane id }, one per page.
export const INSPECTORS = sharedMapKey("browser.inspectors", isString);

export const INSPECTOR = "inspector";

/** web.inspect's answer: the key an inspector names the view by. */
export const isInspected = object({ of: isString });

/** An inspector pane: pane.go gives it the keyboard; enter puts it into the inspector, cmd+esc takes it out. */
export function initInspector(view: Browser, cx: AsyncContext) {
  const handle = cx.focus_handle();

  view.handle = handle;

  if (available()) {
    cx.spawn(async (cx) => {
      for (;;) {
        const e = await view.nextEvent();

        if (e === null) return;

        if (e?.event === "load.error") {
          view.lost = e.data.message ?? "Nothing to inspect.";
          cx.notify();
        }

        if (e?.event === "view.escapeKey") handle.focus();
      }
    });
  }

  cx.spawn(async (cx) => {
    for (;;) {
      const c = String(await nextCommand()).replace(/^browser\./, "");

      if (c === "focus") handle.focus();

      cx.notify();
    }
  });
}

/** The page's inspector pane, if one is open. */
export function inspectorPane(view: Browser, of: string): string | null {
  const pane = readSharedMap(shared, INSPECTORS).get(of);

  return pane && panes().some((x) => x.pane === pane) ? pane : null;
}

/** The page's inspector in a split beside this pane, or closes it (the </> button). */
export function toggleInspector(view: Browser, cx?: Context) {
  const of = inspected(view);

  if (of === null) return;

  const pane = inspectorPane(view, of);

  if (!pane) {
    openInspector(view, of, cx);

    return;
  }

  const open = new Map(readSharedMap(shared, INSPECTORS));

  open.delete(of);
  writeSharedMap(setShared, INSPECTORS, open);
  run("pane.close", { pane });
}

/** Opens an inspector pane for the web view `of`, beside this pane. */
export function openInspector(view: Browser, of: string, cx?: Context) {
  if (inspectorPane(view, of)) return;

  const mine = view.ownPane();
  const before = new Set(panes().map((x) => x.pane));
  const direction = view.barW > 1100 ? "right" : "down";

  run("pane.split", mine ? { direction, pane: mine.pane, mod: "browser", props: { inspect: of } } : { direction, mod: "browser", props: { inspect: of } });

  // Remember the new pane, to close it from here again.
  const note = (tries: number) => {
    const made = panes().find((x) => !before.has(x.pane) && x.mod === "browser");

    if (made) writeSharedMap(setShared, INSPECTORS, new Map([...readSharedMap(shared, INSPECTORS), [of, made.pane]]));
    else if (tries > 0) cx?.timer.after(100, () => note(tries - 1));
  };

  note(10);
}

/** web.inspect on the shown tab's view: the key an inspector names the view by, or null
 *  (a failure goes to the error line). */
export function inspected(view: Browser): string | null {
  try {
    const r = herdr.nativeViewCall(view.tab.id, "web.inspect", {});

    return isInspected(r) ? r.of : null;
  } catch (cause: unknown) {
    view.error = cause instanceof Error ? cause.message : String(cause);

    return null;
  }
}

/** The inspector pane's keys: enter puts the keyboard into it. */
export function inspectorKey(view: Browser, e: KeyEvent, cx: Context) {
  if (keyOf(e) !== "enter" || view.lost) return;

  view.quiet(INSPECTOR, "focus", {});
  cx.stop_propagation();
}
