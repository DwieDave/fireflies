// The viewer's native views (PDF, media, Quick Look): their ids, the calls
// and their decoded answers, a PDF's page and scale, a clip's state, their
// events.

import { Effect, Option, Schema, String as Str } from "effect";
import * as herdr from "herdr";
import { causeMessage } from "@fireflies/kit";
import type { Codec } from "@fireflies/kit";
import { noun } from "./kinds.ts";
import type { MediaFacts, NativeEvent, PdfFacts } from "./viewer-state.ts";
import { MediaStateSchema, PdfFactsSchema, PdfStateSchema } from "./viewer-state.ts";
import { failWith } from "./viewer-load.ts";
import type { default as Viewer } from "./viewer.ts";

/** The app stopped sending this copy's native view events (a reload of the mod). */
export class NativeEventsEnded extends Schema.TaggedError<NativeEventsEnded, { readonly brand: unique symbol }>()("NativeEventsEnded", {
  message: Schema.String,
}) {}

export function onNativeEvent(v: Viewer, e: NativeEvent): void {
  if (e.id !== undefined && e.id !== null && Str.isNonEmpty(e.id) && e.id !== nativeId(v)) return;

  const d = e.data ?? {};

  // Esc in the view: the keyboard is the app's again, this preview's keys first.
  if (e.event === "view.escapeKey") {
    v.handle?.focus();

    return;
  }

  if (e.event === "load.error") failWith(v, d.message ?? `Can't show this ${noun(v.kind)}`);
  else if (e.event === "pdf.locked") v.note = "locked with a password";
  else if (e.event === "pdf.page" || (e.event === "load.finish" && v.kind === "pdf")) {
    v.pdf = { ...v.pdf, ...d };

    // The view fits the page once it has its size, without saying so: ask again.
    if (e.event === "load.finish") pdfLater(v);
  } else if (e.event === "load.finish" && (v.kind === "video" || v.kind === "audio")) mediaFacts(v);
}

/** The view's id: a new file gets a new view. */
export function nativeId(v: Viewer): string {
  return `preview-${v.how?.how === "native" ? v.how.view : "none"}`;
}

/** An action's arguments. */
type Args = { readonly [name: string]: number | boolean };

/** An action on the native view, and its answer when it is of `schema`'s shape (none
 *  when it isn't, or the call failed: the bar says why). */
export function askNative<A, I>(v: Viewer, action: string, schema: Codec<A, I>, args: Args = {}): Option.Option<A> {
  try {
    return Schema.decodeUnknownOption(schema)(herdr.nativeViewCall(nativeId(v), action, { ...args }));
  } catch (err) {
    // The view refused or is gone: the bar's note says so.
    v.note = causeMessage(err);

    return Option.none();
  }
}

/** An action on the native view whose answer isn't needed. */
export function actNative(v: Viewer, action: string, args: Args = {}): void {
  try {
    herdr.nativeViewCall(nativeId(v), action, { ...args });
  } catch (err) {
    // As askNative: the note says why.
    v.note = causeMessage(err);
  }
}

export function pdfDo(v: Viewer, action: string, args?: { readonly [name: string]: number }): void {
  const s = askNative(v, action, PdfFactsSchema, args);

  if (Option.isSome(s)) v.pdf = { ...v.pdf, ...s.value };
}

/** The PDF view's state (empty when it doesn't answer). */
export function pdfState(v: Viewer): PdfFacts {
  return Option.match(askNative(v, "state", PdfStateSchema), { onNone: () => ({}), onSome: (s) => s.content });
}

/** The player's state (empty when it doesn't answer). */
export function mediaState(v: Viewer): MediaFacts {
  return Option.match(askNative(v, "state", MediaStateSchema), { onNone: () => ({}), onSome: (s) => s.content });
}

/** The PDF view's page and scale a moment from now (after a resize, a load); a later ask replaces it. */
export function pdfLater(v: Viewer): void {
  if (v.how?.how !== "native" || v.kind !== "pdf") return;

  v.fx?.run(Effect.andThen(Effect.sleep(300), Effect.sync(() => {
    const s = pdfState(v);

    if ((s.pageCount ?? 0) > 0) v.pdf = { ...v.pdf, ...s };
  })), { key: "pdf-later" });
}

/** A clip's length, once the player knows it: asked now, then every 250 ms, 20 times at most. */
export function mediaFacts(v: Viewer): void {
  const ask = Effect.sync(() => mediaState(v).duration ?? 0);

  v.fx?.run(Effect.gen(function* () {
    for (let tries = 0; tries <= 20; tries++) {
      if (tries > 0) yield* Effect.sleep(250);

      const length = yield* ask;

      if (length > 0) {
        v.media = { duration: length };

        return;
      }
    }
  }), { key: "media" });
}
