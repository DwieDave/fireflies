// Export (e): a small form over the window, keyboard first (form-keys.ts):
// what (a table whole, its shown page or its filtered rows; or a query's
// result), the format (CSV, JSON, SQL inserts), where (the clipboard, or a
// file: a folder picked, a name typed). A whole table is read again without
// the page's limit (up to 64 MB of output).

import { div } from "gpui-kit";
import type { Context, Element, KeyEvent } from "gpui-kit";
import { h_flex, v_flex, Input, InputState } from "gpui-base";
import { window as appWindow } from "herdr";
import type { Theme } from "herdr";
import type { Stop } from "@fireflies/form-keys";
import { formHints, formKey, ring } from "@fireflies/form-keys";
import { Array as Arr, Clock, Effect, Option, String as Str } from "effect";
import { redraw } from "@fireflies/kit";
import type { TableRef } from "./catalog.ts";
import { browseSql, qualified } from "./catalog.ts";
import type { ResultSet } from "./parse-out.ts";
import type { Taken } from "./state.ts";
import type { Format } from "./export.ts";
import { FORMATS, FORMAT_NAME, exportName, exportText, writeOut } from "./export.ts";
import { runOn } from "./session.ts";
import { chip, popupScrim, stop } from "./kit.ts";
import { hint } from "@fireflies/keyhelp";
import type { default as DbView } from "./main.ts";
import { nowMs, pickFolder } from "./app.ts";
import type { DbRun } from "./app.ts";

/** What an export is of: a table (whole, its page, its filter), or a query's result. */
export type ExportOf = { readonly table: TableRef } | { readonly result: ResultSet; readonly name: string };

/** Which rows of a table. */
type Which = "whole" | "page" | "filtered";

const WHICH_NAME = { whole: "the whole table", page: "this page", filtered: "the filtered rows" } as const satisfies { readonly [W in Which]: string };

/** Output kept of a whole table's read. */
const EXPORT_LIMIT = 64 * 1024 * 1024;

export function openExport(v: DbView, of: ExportOf, cx: Context): void {
  v.exporting = new ExportForm(v, of);
  v.focusSelf();
  cx.notify();
}

export class ExportForm {
  readonly v: DbView;
  readonly of: ExportOf;
  format: Format = "csv";
  toFile = false;
  which: Which = "whole";
  readonly name: InputState;
  at = 0;
  busy = false;
  error: string | null = null;

  constructor(v: DbView, of: ExportOf) {
    this.v = v;
    this.of = of;

    const shown = "table" in of && v.rows.browse?.table.name === of.table.name ? v.rows.browse : null;

    this.which = shown?.filter !== undefined && Str.isNonEmpty(shown?.filter) ? "filtered" : "whole";
    this.name = InputState.new({ value: exportName("table" in of ? of.table.name : of.name, "csv", nowMs()) });
  }

  /** The table's choices: the page and the filter only when it's the one shown. */
  whichList(): Which[] {
    if (!("table" in this.of)) return [];

    const b = this.v.rows.browse;
    const shown = b?.table.name === this.of.table.name;

    return ["whole", ...(shown ? ["page" as const] : []), ...(shown && Str.isNonEmpty(b?.filter) ? ["filtered" as const] : [])];
  }

  stops(): Stop[] {
    return [
      ...(this.whichList().length > 1 ? [{ id: "which", kind: "choice" } as const] : []),
      { id: "format", kind: "choice" }, { id: "to", kind: "choice" },
      ...(this.toFile ? [{ id: "name", kind: "text" } as const] : []),
      { id: "go", kind: "button", submit: true }, { id: "cancel", kind: "button" },
    ];
  }

  /** A form key: taken while the form is up, but what the name field types (and an app chord) is "typing". */
  key(e: KeyEvent, cx: Context): Taken {
    const stops = this.stops();
    const s = stops[this.at];
    const a = formKey(stops, this.at, e.key === " " ? "space" : e.key, e.modifiers, e.key_char ?? null);

    if (a === null || a.act === "type") return "typing";

    if (this.busy) return true;

    switch (a.act) {
      case "move": this.at = a.to; this.focus(); break;
      case "submit": this.v.run(this.go()); break;
      case "cancel": this.close(); break;
      case "press": if (s?.id === "cancel") this.close(); else this.v.run(this.go()); break;
      case "step":
      case "open": this.step(s?.id ?? "", a.act === "step" ? a.by : 1); break;
      default: break;
    }

    cx.notify();

    return true;
  }

  focus(): void {
    if (this.stops()[this.at]?.id === "name") this.name.focus();
    else this.v.focusSelf();
  }

  step(id: string, by: number): void {
    const turn = <T>(list: readonly T[], now: T): T => list[(list.indexOf(now) + by + list.length) % list.length] ?? now;

    if (id === "format") {
      this.format = turn(FORMATS, this.format);
      this.name.set_value(Str.replace(/\.[a-z]+$/, `.${this.format}`)(this.name.value()));
    } else if (id === "to") this.toFile = !this.toFile;
    else if (id === "which") this.which = turn(this.whichList(), this.which);
  }

  close(): void {
    this.v.exporting = null;
    this.v.focusShown();
  }

  /** The rows to export, read again where they must be. */
  rows(): Effect.Effect<{ readonly set: ResultSet } | { readonly error: string }, never, DbRun> {
    const of = this.of;

    if (!("table" in of)) return Effect.succeed({ set: of.result });

    const v = this.v;
    const c = v.active;
    const b = v.rows.browse;

    if (this.which === "page" && v.rows.set !== null) return Effect.succeed({ set: v.rows.set });

    if (c === null) return Effect.succeed({ error: "not connected" });

    const filter = this.which === "filtered" && b !== null ? b.filter : "";
    const sql = browseSql(c.kind, { table: of.table, sort: b?.table.name === of.table.name ? b.sort : null, filter, offset: 0, limit: 1_000_000_000 });

    if ("refused" in sql) return Effect.succeed({ error: sql.refused });

    return Effect.map(runOn(v, c, sql.statements.slice(0, 1), undefined, EXPORT_LIMIT), (o) => (o.error !== null ? { error: o.error.message } : { set: o.results[0]?.set ?? { columns: [], rows: [] } }));
  }

  /** Exports: the rows read (again where they must be), written or copied, said in the bar. */
  go(): Effect.Effect<void, never, DbRun> {
    const self = this;

    return Effect.gen(function* () {
      const v = self.v;
      const c = v.active;

      self.busy = true;
      self.error = null;
      yield* redraw;

      const got = yield* self.rows();

      if ("error" in got) {
        self.error = got.error;

        return;
      }

      const table = "table" in self.of && c !== null ? qualified(c.kind, self.of.table) : "result";
      const set = got.set;
      const text = exportText(set, self.format, c?.kind ?? "sqlite", table);
      const done = yield* self.write(text);

      if (done !== null && Str.isNonEmpty(done)) {
        v.say(`${set.rows.length} rows as ${FORMAT_NAME[self.format]} ${done}`, "done");
        self.close();
      }
    }).pipe(Effect.ensuring(Effect.sync(() => {
      self.busy = false;
    })));
  }

  /** Writes the text where asked; says where, or null (the error is shown). */
  write(text: string): Effect.Effect<string | null, never, DbRun> {
    const self = this;

    return Effect.gen(function* () {
      if (!self.toFile) {
        self.v.own?.write_to_clipboard(text);

        return "copied";
      }

      const folder = Option.getOrNull(yield* pickFolder("Export here"));
      const dir = self.v.dir;

      if ((folder === null || Str.isEmpty(folder)) || (dir === null || Str.isEmpty(dir))) {
        self.error = folder !== null && Str.isNonEmpty(folder) ? "the window's private folder is missing" : null;

        return null;
      }

      const name = Str.trim(self.name.value());
      const dest = `${Str.replace(/\/$/, "")(folder)}/${Str.isNonEmpty(name) ? name : exportName("export", self.format, yield* Clock.currentTimeMillis)}`;

      return yield* writeOut(dir, dest, text).pipe(
        Effect.as(`to ${dest}`),
        Effect.catch((error) => Effect.sync(() => {
          self.error = error.message;

          return null;
        })),
      );
    });
  }

  draw(t: Theme): Element {
    const stops = this.stops();
    const on = (id: string) => stops[this.at]?.id === id;
    const title = "table" in this.of ? `Export · ${this.of.table.name}` : `Export · ${this.of.name}`;

    const row = (id: string, label: string, chips: Element[]) => v_flex().gap(4)
      .child(div().text_color(t.dim).child(label))
      .child(ring(h_flex().id(`exp-${id}`).gap(4).p(2), on(id), t.accent).children(chips));

    const pickChip = (id: string, label: string, onNow: boolean, set: () => void) => chip(t, id, label, onNow, set);

    return div().id("db-export").absolute().inset_0().flex().items_center().justify_center().text_size(12)
      .child(popupScrim("db-export-scrim"))
      .child(v_flex().id("db-export-box").relative().w(Math.min(520, this.v.size.width - 32)).bg(t.background).border(1).border_color(t.accent).on_mouse_down("left", stop)
        .child(h_flex().h(30).px(14).items_center().text_color(t.foreground).child(title))
        .child(v_flex().px(14).pb(12).gap(10)
          .when(this.whichList().length > 1, (el) => el.child(row("which", "what", Arr.map(this.whichList(), (w) => pickChip(`exp-w-${w}`, WHICH_NAME[w], this.which === w, () => { this.which = w; })))))
          .child(row("format", "format", Arr.map(FORMATS, (f) => pickChip(`exp-f-${f}`, FORMAT_NAME[f], this.format === f, () => { this.format = f; }))))
          .child(row("to", "to", [pickChip("exp-to-clip", "the clipboard", !this.toFile, () => { this.toFile = false; }), pickChip("exp-to-file", "a file…", this.toFile, () => { this.toFile = true; })]))
          .when(this.toFile, (el) => el.child(v_flex().gap(4).child(div().text_color(t.dim).child("named (the folder is asked next)"))
            .child(h_flex().h(26).px(8).items_center().border(1).border_color(on("name") ? t.accent : t.muted).child(Input.new(this.name).flex_1().text_size(12).text_color(t.foreground)))))
          .when(this.error !== null, (el) => el.child(div().text_color(t.blocked).child(this.error ?? "")))
          .child(h_flex().gap(8).justify_end()
            .child(ring(chip(t, "exp-go", this.busy ? "exporting…" : "Export  enter", false, () => this.v.run(this.go()), t.accent), on("go"), t.accent))
            .child(ring(chip(t, "exp-cancel", "Cancel  esc", false, () => this.close()), on("cancel"), t.accent))))
        .child(h_flex().h(22).px(14).gap(12).items_center().text_size(11)
          .children(Arr.map(formHints(stops, this.at, { mac: appWindow().platform === "macos", submit: "export" }), ([k, w], i) => hint(t, `exp-hint-${i}`, k, w)))));
  }
}
