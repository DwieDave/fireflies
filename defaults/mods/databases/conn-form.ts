// A connection's form (n: new, e: edit), keyboard first (form-keys.ts, as
// the GitHub forms): the kind, its name, where it is (a server's host, port,
// user and database; a file's path; a libSQL URL), its password or token
// (masked: into the keychain, or "ask each time": memory only), ssl (a
// server's: off is sslmode=disable; another sslmode, from a pasted URL, is
// kept and shown beside it), read only. A URL pasted into the host
// (postgres://ada@db/lantern?sslmode=require) fills the fields.
// Test runs `select 1` with what's typed; save writes connections.json.

import { div } from "gpui-kit";
import type { Context, Element, KeyEvent } from "gpui-kit";
import { h_flex, v_flex, Input, InputState } from "gpui-base";
import { window as appWindow } from "herdr";
import type { Theme } from "herdr";
import type { Stop } from "@fireflies/form-keys";
import { formHints, formKey, ring } from "@fireflies/form-keys";
import { Array as Arr, Effect, Option, String as Str } from "effect";
import type { Conn, ConnDraft, Kind, SslMode } from "./kinds.ts";
import type { Taken } from "./state.ts";
import { DEFAULT_PORT, KINDS, KIND_NAME, newId, speaksTls } from "./kinds.ts";
import { clientOf } from "./session.ts";
import { installLine } from "./clients.ts";
import { parseDbUrl } from "./discover.ts";
import { saveSecret } from "./secrets.ts";
import { changePinned } from "./pinned.ts";
import { test } from "./conns.ts";
import { chip, popupScrim, stop } from "./kit.ts";
import { hint } from "@fireflies/keyhelp";
import type { default as DbView } from "./main.ts";
import { nowMs, pickFile } from "./app.ts";
import type { DbRun } from "./app.ts";
import { edge } from "@fireflies/tones";

/** The form's text fields. */
type Field = "name" | "host" | "port" | "user" | "database" | "path" | "url" | "password";

const LABEL = { name: "name", host: "host", port: "port", user: "user", database: "database", path: "file", url: "URL", password: "password" } as const satisfies { readonly [F in Field]: string };

/** Which fields a kind has. */
function fieldsOf(kind: Kind, remote: boolean): Field[] {
  if (kind === "sqlite") return ["name", "path"];

  if (kind === "libsql") return remote ? ["name", "url", "password"] : ["name", "path"];

  return ["name", "host", "port", "user", "database", "password"];
}

/** Opens the form: a new connection (null) or one to edit. */
export function openForm(v: DbView, c: Conn | null, cx: Context): void {
  v.form = new ConnForm(v, c);
  v.form.focusStop();
  cx.notify();
}

export class ConnForm {
  readonly v: DbView;
  readonly editing: Conn | null;
  kind: Kind;
  remote: boolean;
  readonly inputs = new Map<Field, InputState>();
  ask: boolean;
  readonly: boolean;
  /** The sslmode saved (absent: the client's default); the ssl toggle is off at "disable". */
  sslmode: SslMode | undefined;
  /** The sslmode the toggle turns back on to: the connection's own other one (a pasted
   *  require), else none (the client's default). */
  sslOn: SslMode | undefined;
  at = 1;
  error: string | null = null;
  busy = false;

  constructor(v: DbView, c: Conn | null) {
    this.v = v;
    this.editing = c;
    this.kind = c?.kind ?? "postgres";
    this.remote = Boolean(c?.url);
    this.ask = c?.secret === "ask";
    this.readonly = c?.readonly ?? false;
    this.sslmode = c?.sslmode;
    this.sslOn = c?.sslmode === "disable" ? undefined : c?.sslmode;

    const value = (f: Field): string => {
      if (c === null) return "";

      switch (f) {
        case "port": return c.port !== undefined && c.port !== 0 ? String(c.port) : "";
        case "password": return "";
        default: return c[f] ?? "";
      }
    };

    for (const f of ["name", "host", "port", "user", "database", "path", "url", "password"] as const) {
      const input = InputState.new({ placeholder: this.placeholder(f), value: value(f) });

      if (f === "password") input.set_masked(true);

      // A URL typed or pasted: the kind and the fields change, so the form draws again.
      if (f === "host") {
        input.on("change", (_e, cx) => {
          this.fromUrl();
          cx.notify();
        });
      }

      this.inputs.set(f, input);
    }
  }

  placeholder(f: Field): string {
    switch (f) {
      case "host": return "localhost, or a URL: postgres://user@host/db";
      case "port": return String(DEFAULT_PORT[this.kind] || "");
      case "password": return this.editing?.secret === "keychain" ? "kept in the keychain (type to replace)"
        : this.editing?.secret === "kubernetes" && this.editing.source !== undefined ? `read from secret ${this.editing.source.name} at connect (type one to keep it in the keychain instead)`
        : this.kind === "libsql" ? "the token" : "none, or ~/.pgpass";
      case "path": return "/path/to/data.db";
      case "url": return "libsql://name-org.turso.io";
      default: return LABEL[f];
    }
  }

  value(f: Field): string {
    return Str.trim(this.inputs.get(f)?.value() ?? "");
  }

  /** A URL pasted into the host: its parts into the fields (the password into the masked one). */
  fromUrl(): void {
    const u = /^[a-z0-9+]+:\/\//i.test(this.value("host")) ? parseDbUrl(this.value("host")) : null;

    if (u === null || (u.kind !== "postgres" && u.kind !== "mysql")) return;

    this.kind = u.kind;

    const put = (f: Field, s: string | number | null | undefined) => this.inputs.get(f)?.set_value(s === null || s === undefined ? "" : String(s));

    put("host", u.host);
    put("port", u.port);
    put("user", u.user);
    put("database", u.database);

    if (u.password !== null && Str.isNonEmpty(u.password)) put("password", u.password);

    // The URL says how it asks for TLS, or nothing (the client's default).
    this.sslmode = u.sslmode;
    this.sslOn = u.sslmode === "disable" ? undefined : u.sslmode;
  }

  /** The stops in tab order: the kind, the fields, the toggles, the buttons. */
  stops(): Stop[] {
    const fields = Arr.map(fieldsOf(this.kind, this.remote), (f): Stop => ({ id: f, kind: "text" }));

    const toggles: Stop[] = [
      ...(this.kind === "libsql" ? [{ id: "remote", kind: "toggle" } as const] : []),
      ...(this.kind === "sqlite" || (this.kind === "libsql" && !this.remote) ? [] : [{ id: "ask", kind: "toggle" } as const]),
      ...(speaksTls(this.kind) ? [{ id: "ssl", kind: "toggle" } as const] : []),
      { id: "readonly", kind: "toggle" },
    ];

    return [{ id: "kind", kind: "choice" }, ...fields, ...toggles, { id: "test", kind: "button" }, { id: "save", kind: "button", submit: true }, { id: "cancel", kind: "button" }];
  }

  /** The keyboard onto the stop the form is at. */
  focusStop(): void {
    const s = this.stops()[this.at];
    const input = s !== undefined ? this.inputs.get(s.id === "kind" ? "name" : fieldOf(s.id) ?? "name") : undefined;

    if (s?.kind === "text" && input !== undefined) input.focus();
    else this.v.focusSelf();
  }

  /** A form key: taken while the form is up, but what a field types (and an app chord) is "typing". */
  key(e: KeyEvent, cx: Context): Taken {
    const stops = this.stops();
    const k = e.key === " " ? "space" : e.key;
    const a = formKey(stops, this.at, k, e.modifiers, e.key_char ?? null);
    const s = stops[this.at];

    if (a === null || a.act === "type") return "typing";

    switch (a.act) {
      case "move": this.at = a.to; this.focusStop(); break;
      case "submit": this.v.run(this.save()); break;
      case "cancel": this.close(); break;
      case "press": this.press(s?.id ?? ""); break;
      case "step":
      case "open": if (s?.id === "kind") this.step(a.act === "step" ? a.by : 1); break;
      case "flip": this.flip(s?.id ?? ""); break;
      default: break;
    }

    cx.notify();

    return true;
  }

  step(by: number): void {
    this.kind = KINDS[(KINDS.indexOf(this.kind) + by + KINDS.length) % KINDS.length] ?? "postgres";
  }

  flip(id: string): void {
    if (id === "remote") this.remote = !this.remote;
    else if (id === "ask") this.ask = !this.ask;
    else if (id === "ssl") this.sslmode = this.ssl() ? "disable" : this.sslOn;
    else if (id === "readonly") this.readonly = !this.readonly;
  }

  /** Whether the ssl toggle is on (any sslmode but disable, or none). */
  ssl(): boolean {
    return this.sslmode !== "disable";
  }

  press(id: string): void {
    if (id === "test") this.v.run(this.test());
    else if (id === "save") this.v.run(this.save());
    else if (id === "cancel") this.close();
  }

  close(): void {
    this.v.form = null;
    this.v.focusShown();
  }

  /** The connection the fields describe (`id` kept when editing). */
  conn(id: string): Conn {
    const has = (f: Field) => fieldsOf(this.kind, this.remote).includes(f) && this.value(f) !== "";
    const port = Number(this.value("port"));
    const typed = this.value("password");
    // Off macOS there's no keychain here: a typed password is asked each time (kept in memory).
    const keychain = appWindow().platform === "macos";

    // A cluster's secret stays where the password comes from until one is typed (or ask is set).
    const source = Str.isEmpty(typed) && !this.ask && this.editing?.secret === "kubernetes" && (this.kind === "postgres" || this.kind === "mysql") ? this.editing.source : undefined;

    const secret = this.kind === "sqlite" || (this.kind === "libsql" && !this.remote) ? "none"
      : source !== undefined ? "kubernetes"
      : this.ask || (Str.isNonEmpty(typed) && !keychain) ? "ask" : Str.isNonEmpty(typed) || this.editing?.secret === "keychain" ? "keychain" : "none";

    const c: ConnDraft = { id, name: this.value("name") || this.value("database") || Str.split(this.value("path"), "/").at(-1) || KIND_NAME[this.kind], kind: this.kind, readonly: this.readonly, secret, origin: "saved" };

    if (source !== undefined) c.source = source;

    if (has("host")) c.host = this.value("host");

    if (has("port") && Number.isFinite(port) && port > 0) c.port = port;

    if (has("user")) c.user = this.value("user");

    if (has("database")) c.database = this.value("database");

    if (has("path")) c.path = Str.replace(/^~(?=\/)/, "")(this.value("path"));

    if (has("url")) c.url = this.value("url");

    if (this.sslmode !== undefined && speaksTls(this.kind)) c.sslmode = this.sslmode;

    return c;
  }

  /** Why the fields can't be saved yet, or null. */
  problem(): string | null {
    if ((this.kind === "sqlite" || (this.kind === "libsql" && !this.remote)) && Str.isEmpty(this.value("path"))) return "a file is needed";

    if (this.kind === "libsql" && this.remote && Str.isEmpty(this.value("url"))) return "the URL is needed";

    return null;
  }

  /** Tests the fields as they are (the connection isn't kept). */
  test(): Effect.Effect<void, never, DbRun> {
    const c = { ...this.conn(`test-${nowMs()}`), secret: "ask" as const };

    this.v.secrets.set(c.id, this.value("password") || (this.editing !== null ? this.v.secrets.get(this.editing.id) ?? "" : ""));

    // An edited one whose password is in the keychain (or a cluster's secret) tests with that one.
    const kept = this.conn(c.id);

    const tried: Conn = Str.isEmpty(this.value("password")) && this.editing?.secret === "keychain" ? { ...c, id: this.editing.id, secret: "keychain" }
      : kept.secret === "kubernetes" ? kept : c;

    return Effect.ensuring(test(this.v, tried), Effect.sync(() => this.v.secrets.delete(c.id)));
  }

  /** Saves the fields as a pinned connection (its password into the keychain first, if one). */
  save(): Effect.Effect<void, never, DbRun> {
    return Effect.gen({ self: this }, function* () {
      const problem = this.problem();

      if (problem !== null && Str.isNonEmpty(problem)) {
        this.error = problem;

        return;
      }

      const id = this.editing?.origin === "saved" ? this.editing.id : yield* newId(this.kind);
      const c = this.conn(id);
      const pw = this.value("password");
      const dir = this.v.dir;

      if (Str.isNonEmpty(pw) && c.secret === "keychain" && (dir !== null && Str.isNonEmpty(dir))) {
        const saved = yield* Effect.result(saveSecret(dir, id, `Fireflies database ${c.name}`, pw));

        if (saved._tag === "Failure") {
          this.error = `the keychain refused it: ${saved.failure.message}`;

          return;
        }
      }

      if (Str.isNonEmpty(pw) && c.secret === "ask") this.v.secrets.set(id, pw);

      const v = this.v;
      const i = Option.getOrElse(Arr.findFirstIndex(v.saved, (s) => s.id === id), () => -1);

      const list = yield* changePinned(v, (now) => (Arr.some(now, (s) => s.id === id) ? Arr.map(now, (s) => (s.id === id ? c : s)) : [...now, c]));

      if (list === null) return;

      if (v.active?.id === id) v.active = c;

      v.connAt = Option.getOrElse(Arr.findFirstIndex(v.saved, (s) => s.id === id), () => -1);
      v.say(`${i >= 0 ? "saved" : "added"} ${c.name}`, "done");
      this.close();
    });
  }

  /** The form, over the window. */
  draw(t: Theme): Element {
    const stops = this.stops();
    const on = (id: string) => stops[this.at]?.id === id;
    const v = this.v;

    return div().id("db-form").absolute().inset_0().flex().items_center().justify_center().text_size(12)
      .child(popupScrim("db-form-scrim"))
      .child(v_flex().id("db-form-box").relative().w(Math.min(600, v.size.width - 32)).max_h(v.size.height - 40).overflow_y_scroll().bg(t.background).border(1).border_color(t.accent)
        .on_mouse_down("left", stop)
        .child(h_flex().h(30).px(14).items_center().text_color(t.foreground).child(this.editing?.origin === "saved" ? `Edit ${this.editing.name}` : "New connection"))
        .child(v_flex().px(14).pb(10).gap(10)
          .child(this.kindRow(t, on("kind")))
          .child(this.fieldGrid(t, on))
          .child(this.toggleRow(t, on))
          .when(this.error !== null, (el) => el.child(div().text_color(t.blocked).child(this.error ?? "")))
          .child(this.buttons(t, on)))
        .child(h_flex().h(22).px(14).gap(12).items_center().text_size(11)
          .children(Arr.map(formHints(stops, this.at, { mac: appWindow().platform === "macos", submit: "save" }), ([k, w], i) => hint(t, `form-hint-${i}`, k, w)))));
  }

  kindRow(t: Theme, focused: boolean): Element {
    // Its client missing on this machine: said here, before anything is saved or tried.
    const found = this.v.clients.get(this.kind);
    const missing = found !== undefined && "missing" in found && !(this.kind === "libsql" && this.remote) ? found.missing : null;

    return v_flex().gap(4).child(div().text_color(t.foreground).child("kind"))
      .child(ring(h_flex().gap(4).p(2), focused, t.accent).children(Arr.map(KINDS, (k) => chip(t, `form-kind-${k}`, KIND_NAME[k], this.kind === k, () => {
        this.kind = k;
        this.at = 0;
        this.v.run(clientOf(this.v, k));
      }))))
      .when(missing !== null, (el) => el.child(div().id("form-client-missing").text_color(t.ansi3).child(`${missing ?? ""} · ${installLine(this.kind, this.v.setup)}`)));
  }

  fieldGrid(t: Theme, on: (id: string) => boolean): Element {
    const fields = fieldsOf(this.kind, this.remote);

    const cell = (f: Field) => {
      const input = this.inputs.get(f);

      const box = h_flex().h(26).px(8).items_center().border(1).border_color(on(f) ? t.accent : t.muted).when(on(f), (el) => el.bg(`${edge(t)}66`))
        .child(input !== undefined ? Input.new(input).flex_1().text_size(12).text_color(t.foreground) : div())
        .when(f === "path", (el) => el.child(chip(t, "form-pick", "pick…", false, () => this.v.run(this.pick()))));

      const note = f === "password" ? (this.ask ? "asked each time" : "kept in the keychain") : f === "host" ? "or a URL" : "";

      return v_flex().id(`form-${f}`).gap(4).w(f === "name" || f === "path" || f === "url" ? Math.min(560, this.v.size.width - 60) : Math.min(272, (this.v.size.width - 74) / 2))
        .on_mouse_down("left", (_e, cx) => {
          this.at = Option.getOrElse(Arr.findFirstIndex(this.stops(), (s) => s.id === f), () => -1);
          input?.focus();
          cx.notify();
        })
        .child(h_flex().justify_between().child(div().text_color(t.foreground).child(LABEL[f])).child(div().text_color(t.dim).child(note)))
        .child(box);
    };

    return h_flex().flex_wrap().gap(12).children(Arr.map(fields, cell));
  }

  toggleRow(t: Theme, on: (id: string) => boolean): Element {
    const toggle = (id: string, label: string, value: boolean, note = "") => ring(h_flex().id(`form-${id}`).gap(6).px(4).h(22).items_center().cursor_pointer()
      .on_mouse_down("left", (_e, cx) => {
        this.flip(id);
        cx.notify();
      })
      .child(div().text_color(value ? t.accent : t.dim).child(value ? "▣" : "□"))
      .child(div().text_color(t.muted).child(label))
      .when(note !== "", (el) => el.child(div().id(`form-${id}-note`).text_color(t.dim).child(note))), on(id), t.accent);

    const ids = Arr.map(Arr.filter(this.stops(), (s) => s.kind === "toggle"), (s) => s.id);

    return h_flex().flex_wrap().gap(14).children(Arr.map(ids, (id) => (id === "remote" ? toggle(id, "remote (Turso, sqld)", this.remote)
      : id === "ssl" ? toggle(id, "ssl", this.ssl(), sslWords(this.sslmode))
      : id === "ask" ? toggle(id, "ask for the password each time", this.ask) : toggle(id, "read only", this.readonly))));
  }

  buttons(t: Theme, on: (id: string) => boolean): Element {
    const button = (id: string, label: string, key: string, main = false) => ring(h_flex().id(`form-${id}`).h(24).px(10).gap(8).items_center().border(1)
      .border_color(main ? t.accent : t.muted).text_color(main ? t.foreground : t.muted).cursor_pointer()
      .on_mouse_down("left", (_e, cx) => {
        cx.stop_propagation();
        this.press(id);
        cx.notify();
      })
      .child(div().child(label)).child(div().text_size(10.8).text_color(t.accent).child(key)), on(id), t.accent);

    return h_flex().gap(8).justify_end()
      .child(button("test", "Test", ""))
      .child(button("save", "Save", "enter", true))
      .child(button("cancel", "Cancel", "esc"));
  }

  /** The system's file picker for the path field. */
  pick(): Effect.Effect<void> {
    return Effect.map(pickFile("Open the database"), (path) => {
      if (Option.isSome(path) && Str.isNonEmpty(path.value)) this.inputs.get("path")?.set_value(path.value);
    });
  }
}

/** The ssl toggle's note: the sslmode it saves, so one from a pasted URL isn't hidden. */
export function sslWords(mode: SslMode | undefined): string {
  return mode !== undefined ? `sslmode=${mode}` : "client default";
}

/** A stop id that names a field. */
function fieldOf(id: string): Field | null {
  const fields: readonly Field[] = ["name", "host", "port", "user", "database", "path", "url", "password"];

  return Option.getOrUndefined(Arr.findFirst(fields, (f) => f === id)) ?? null;
}
