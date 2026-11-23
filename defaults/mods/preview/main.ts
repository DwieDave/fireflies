// Nocturne Preview: a file you look at but don't edit, in a pane beside where it
// was opened from: a link clicked in a terminal (a screenshot an agent saved, a
// report it wrote, `ls`, an OSC 8 link), a file picked in the files pane, a link
// in the Markdown viewer, or the `preview.open {path}` command (`image.open` is
// the same). Props: { path, on?, slot }.
//
//   pictures   PNG, JPEG, GIF (animated), WebP, BMP, TIFF, ICO, SVG drawn as
//              they are; HEIC / HEIF and AVIF converted to a PNG copy first
//              (macOS: sips, else qlmanage; Linux: heif-convert, avifdec,
//              ImageMagick or ffmpeg). Fit, 100%, zoom, pan, turn, background.
//   PDF        macOS: the system's PDF view (scroll, zoom, pages); elsewhere one
//              page at a time through pdftoppm when it's installed.
//   CSV / TSV  a table: the header row stays put, numbers align right, the row
//              numbers stay at the left; the first 50 000 rows / 200 columns of
//              the first 4 MB, saying so when there's more.
//   SQLite     .sqlite / .db: its tables, each one's first 1 000 rows, read only
//              (sqlite3).
//   patches    .diff / .patch: colored as diff colors them, file by file.
//   fonts      macOS: Quick Look's specimen.
//   audio / video  macOS: the system's player (never plays by itself).
// What can't be shown here says why and offers the system's app (o).
//
// The original is only read: pictures, PDFs and fonts are drawn from a copy in
// the app's cache named by its contents, so a file an agent rewrites shows again
// by itself (the folder is watched; another machine's is polled).
//
// The bar: kind, name, facts, the place in its folder (‹ ›), the kind's own
// controls, files (the folder in the files pane), open (the system's app), copy
// (the path).
// Keys while it has focus:
//   n ] / p [   next / previous file of the same kind in the folder
//   o  open in the system's app    y  copy path    f  folder in the files pane
//   e  edit as text in the editor (tables, patches, SVG)
//   pictures: + = / - zoom, 0 fit, 1 100%, h j k l ←↓↑→ pan (← → step the
//             folder when it fits), r / R turn, b background
//   PDF:      + / - zoom, 0 fit width, 1 100%, ← → / pageup pagedown pages, g / G first / last
//   tables, patches: j k ↓ ↑ rows, J K / pageup pagedown pages, g / G top / bottom,
//             h l ← → columns (tables), } { next / previous file (patches),
//             t / T next / previous table (SQLite)
//   audio, video: space / k play / pause, ← → (h l) 5 s, shift 30 s, 0 start, m sound
//   tab / shift-tab  the bar's controls (a ring shows which), enter presses it
//   ?  the keys, as a strip under the bar     esc  ring, then strip, away
// A native view (the PDF, the player, Quick Look) that took the keyboard with a
// click gives it back on esc (cmd-esc too): the preview's keys work again.
// Mouse: pictures: a mouse wheel, ⌘/ctrl + scroll or a trackpad pinch zooms at
// the pointer; drag and a trackpad's two-finger scroll pan when zoomed in;
// double-click toggles fit and 100% (a PDF's own view takes its scroll and
// pinch). The bar shows the zoom (pictures, PDFs). Tables and patches: scroll (shift or
// sideways: across).
// Commands (keys.json, `herdr-app do preview.<c>`; every shown preview
// takes them): zoom_in, zoom_out, fit, actual, next, prev, rotate, background,
// reload, page_next, page_prev.
//
// Another file in this pane: shared `preview.show` { slot, path, n, at } for
// the pane whose slot it names. The app sends it for `preview.open` (a
// terminal's Cmd-click on a picture, the picker, a script) when a preview pane
// is already in the tab: the one asked from, else the one that last had the
// keyboard (shared `preview.last`, its slot, noted here), else the first; a
// files pane sends it to its own preview pane (file-tree/routing.ts). So one
// preview pane takes the next file instead of a new pane each time.
//
// What's drawn, and how, is viewer.ts: the files pane's preview split
// (file-tree) shows a file with the same code.

import type { AsyncContext, Context, Element } from "gpui-kit";
import type { Props } from "gpui-shell";
import { shared, setShared } from "herdr";
import { Option, Schema } from "effect";
import { readShared, readSharedOption, sharedKey, writeShared } from "@fireflies/kit";
import Viewer from "@fireflies/viewer";

/** A file for the preview pane whose slot it names (the files pane's routing.ts writes the same shape). */
export const ShowSchema = Schema.Struct({ slot: Schema.String, path: Schema.String, n: Schema.Finite, at: Schema.optionalKey(Schema.Finite) });

export type Show = typeof ShowSchema.Type;

export const SHOW_KEY = sharedKey("preview.show", Schema.NullOr(ShowSchema));

/** The preview pane that last had the keyboard (its slot): the app's
 *  `preview.open` shows the next file there. */
export const LAST_KEY = sharedKey("preview.last", Schema.NullOr(Schema.String));

/** The `preview.show` record now, none when there is none (or it's in another shape). */
const showNow = (): Option.Option<Show> => Option.flatMap(readSharedOption(shared, SHOW_KEY), Option.fromNullOr);

export default class PreviewView extends Viewer {
  // The last `preview.show` seen: one from before this pane started is old.
  seenShow = 0;

  override init(p: Props | undefined, cx: AsyncContext): void {
    super.init(p, cx);
    this.seenShow = Option.match(showNow(), { onNone: () => 0, onSome: (ask) => ask.n });
  }

  override render(cx: Context): Element {
    const slot = this.slot;

    if (slot !== null && !this.embedded) {
      // Render can't load: the file is opened from a timer right after it.
      const ask = Option.getOrNull(Option.filter(showNow(), (x) => x.slot === slot && x.n !== this.seenShow));

      if (ask !== null) {
        this.seenShow = ask.n;
        cx.timer.after(0, (cx) => {
          this.open(ask.path, cx);
          cx.notify();
        });
      }

      if (this.handle?.is_focused() === true && readShared(shared, LAST_KEY, null) !== slot) {
        cx.timer.after(0, () => {
          if (readShared(shared, LAST_KEY, null) !== slot) writeShared(setShared, LAST_KEY, slot);
        });
      }
    }

    return super.render(cx);
  }
}
