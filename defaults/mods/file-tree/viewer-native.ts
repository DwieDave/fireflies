// The viewer's native views (PDF, media, Quick Look): their ids, the calls
// and their proven answers, a PDF's page and scale, a clip's state, their
// events. Shared like viewer.ts.

import type { Context } from "gpui-kit";
import * as herdr from "herdr";
import type { Guard, Guarded } from "./guard.ts";
import { noun } from "./kinds.ts";
import type { PdfFacts, MediaFacts , isNativeEvent} from "./viewer-state.ts";
import { isPdfFacts, isPdfState, isMediaState } from "./viewer-state.ts";
import { failWith } from "./viewer-load.ts";
import type { default as Viewer } from "./viewer.ts";

export function onNativeEvent(v: Viewer, e: Guarded<typeof isNativeEvent>, cx: Context): void {
  if (e.id && e.id !== nativeId(v)) return;

  const d = e.data ?? {};

  // Esc in the view: the keyboard is the app's again, this preview's keys first.
  if (e.event === "view.escapeKey") {
    v.handle?.focus();

    return;
  }

  if (e.event === "load.error") failWith(v, cx, d.message ?? `Can't show this ${noun(v.kind)}`);
  else if (e.event === "pdf.locked") v.note = "locked with a password";
  else if (e.event === "pdf.page" || (e.event === "load.finish" && v.kind === "pdf")) {
    v.pdf = { ...v.pdf, ...d };

    // The view fits the page once it has its size, without saying so: ask again.
    if (e.event === "load.finish") pdfLater(v, cx);
  } else if (e.event === "load.finish" && (v.kind === "video" || v.kind === "audio")) mediaFacts(v, cx);
}

/** The view's id: a new file gets a new view. */
export function nativeId(v: Viewer): string {
  return `preview-${v.how?.how === "native" ? v.how.view : "none"}`;
}

/** An action on the native view, and its answer if it's a T (null when it isn't, or the
 *  call failed: the bar says why). */
export function askNative<T>(v: Viewer, action: string, guard: Guard<T>, args: { readonly [name: string]: number | boolean } = {}): T | null {
  try {
    const answer = herdr.nativeViewCall(nativeId(v), action, { ...args });

    return guard(answer) ? answer : null;
  } catch (err) {
    v.note = err instanceof Error ? err.message : String(err);

    return null;
  }
}

/** An action on the native view whose answer isn't needed. */
export function actNative(v: Viewer, action: string, args: { readonly [name: string]: number | boolean } = {}): void {
  try {
    herdr.nativeViewCall(nativeId(v), action, { ...args });
  } catch (err) {
    v.note = err instanceof Error ? err.message : String(err);
  }
}

export function pdfDo(v: Viewer, action: string, args?: { readonly [name: string]: number }): void {
  const s = askNative(v, action, isPdfFacts, args);

  if (s) v.pdf = { ...v.pdf, ...s };
}

/** The PDF view's state (empty when it doesn't answer). */
export function pdfState(v: Viewer): PdfFacts {
  return askNative(v, "state", isPdfState)?.content ?? {};
}

/** The player's state (empty when it doesn't answer). */
export function mediaState(v: Viewer): MediaFacts {
  return askNative(v, "state", isMediaState)?.content ?? {};
}

/** The PDF view's page and scale a moment from now (after a resize, a load). */
export function pdfLater(v: Viewer, cx: Context): void {
  if (v.how?.how !== "native" || v.kind !== "pdf") return;

  const asked = ++v.pdfAsk;

  cx.timer.after(300, (cx) => {
    if (asked !== v.pdfAsk) return;

    const s = pdfState(v);

    if (s.pageCount) {
      v.pdf = { ...v.pdf, ...s };
      cx.notify();
    }
  });
}

/** A clip's length, once the player knows it. */
export function mediaFacts(v: Viewer, cx: Context, tries = 0): void {
  const length = mediaState(v).duration ?? 0;

  if (length > 0) {
    v.media = { duration: length };
    cx.notify();

    return;
  }

  if (tries < 20) cx.timer.after(250, (cx) => mediaFacts(v, cx, tries + 1));
}
