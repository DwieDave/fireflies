// The Connections panel's work: its list (saved ones, then those another
// mod sent, then those found in the space's folder), connecting to one (a
// password asked first where it must be), finding connections in the folder
// (discover.ts: .env files, direnv, SQLite files), testing, saving a found one
// (its password into the keychain) and removing one (its keychain item and
// history too).

import type { Context } from "gpui-kit";
import { InputState } from "gpui-base";
import { exec, readTextFile } from "herdr";
import type { Conn } from "./kinds.ts";
import { newId, where } from "./kinds.ts";
import type { Found } from "./discover.ts";
import { ENV_FILES, FIND_SCRIPT, foundFile, foundInVars, mergeFound, parseEnvFile } from "./discover.ts";
import { projectEnv } from "./envrc.ts";
import { deleteSecret, hasSecret, saveSecret } from "./secrets.ts";
import { clearHistory, readHistory, writeConnections } from "./store.ts";
import { IO, dataHome, loadTables, needsPassword, runOn } from "./session.ts";
import type { ConnectArgs } from "./state.ts";
import { gridStart, noteOf } from "./state.ts";
import type { default as DbView } from "./main.ts";

/** The list the Connections panel shows, in order. */
export function connList(v: DbView): Conn[] {
  return [...v.saved, ...v.sent, ...v.found.map((f) => f.conn)];
}

/** The connection under the cursor. */
export const connAtCursor = (v: DbView): Conn | null => connList(v)[v.connAt] ?? null;

/** Finds connections in the space's folder: its .env files, its direnv environment (only when
 *  direnv already allows it: never allowed from here), its SQLite files. */
export async function discover(v: DbView, cx: Context): Promise<void> {
  const folder = v.folder;

  if (!folder || v.on) return;

  const lists: Found[][] = [];

  for (const f of ENV_FILES) {
    const text = await readTextFile(`${folder}/${f}`).catch(() => null);

    if (text) lists.push(foundInVars(parseEnvFile(text), f, folder));
  }

  const files = await exec("sh", ["-c", FIND_SCRIPT, "ff-find", folder]).catch(() => null);

  lists.push((files?.stdout ?? "").split("\n").filter(Boolean).map((p) => foundFile(p, folder)));
  setFound(v, mergeFound(lists));
  cx.notify();

  // direnv last: a flake's shell can take a while the first time.
  const env = await projectEnv(exec, folder).catch(() => null);

  if (env?.kind !== "ready") return;

  v.envPath = env.env.get("PATH") ?? null;
  v.clients.clear();
  lists.splice(lists.length - 1, 0, foundInVars(env.env, "direnv", folder));
  setFound(v, mergeFound(lists));
  cx.notify();
}

/** The found ones, their secrets into memory (never shared, never written). */
function setFound(v: DbView, list: readonly Found[]): void {
  const at = connAtCursor(v)?.id;

  v.found = list.filter((f) => !v.saved.some((s) => where(s) === where(f.conn) && s.kind === f.conn.kind));

  for (const f of v.found) if (f.secret) v.secrets.set(f.conn.id, f.secret);

  const again = connList(v).findIndex((c) => c.id === at);

  if (again >= 0) v.connAt = again;
}

/** A connection another mod sent (databases.connect): listed and connected, not saved. */
export function receive(v: DbView, a: ConnectArgs, cx: Context): void {
  const base: Conn = { id: `sent:${a.kind}:${a.host ?? ""}:${a.port ?? ""}:${a.path ?? a.url ?? ""}:${a.database ?? ""}`, name: a.name ?? a.database ?? a.path ?? a.host ?? a.kind, kind: a.kind, readonly: a.readonly ?? false, secret: a.kind === "sqlite" ? "none" : "ask", origin: "sent", from: a.from ?? "another mod" };
  const conn: Conn = { ...base, ...pick(a) };

  v.sent = [conn, ...v.sent.filter((c) => c.id !== conn.id)];
  v.connAt = v.saved.length;
  v.panel = "conns";
  void connect(v, conn, cx);
}

/** Where a connection is: the fields a connect request may carry. */
type Place = { -readonly [K in "host" | "port" | "user" | "database" | "path" | "url"]?: Conn[K] };

/** The place fields of a connect request that are there. */
function pick(a: ConnectArgs): Place {
  const out: Place = {};

  if (a.host !== undefined) out.host = a.host;

  if (a.port !== undefined) out.port = a.port;

  if (a.user !== undefined) out.user = a.user;

  if (a.database !== undefined) out.database = a.database;

  if (a.path !== undefined) out.path = a.path;

  if (a.url !== undefined) out.url = a.url;

  return out;
}

/** Connects: the password first where it must be asked, then the tables. A local server that
 *  trusts its socket needs none, so a sent one tries without and asks when refused. */
export function connect(v: DbView, c: Conn, cx: Context): Promise<void> {
  if (c.secret === "ask" && c.origin !== "sent" && needsPassword(v, c)) {
    v.askPassword(c, false, cx, () => void connect(v, c, cx));

    return Promise.resolve();
  }

  v.active = c;
  v.catalog = { tables: [], error: null, busy: true };
  v.struct = { table: null, data: null, busy: false, error: null };
  v.rows = { browse: null, set: null, total: null, error: null, busy: false, at: gridStart(), filtering: false };
  v.tableAt = 0;
  v.history = [];

  const tables = loadTables(v, cx).then(() => {
    // A sent one refused without a password: ask for it, then again.
    const e = v.catalog.error ?? "";

    if (c.origin === "sent" && v.active === c && /password|authentication/i.test(e) && !v.secrets.has(c.id)) v.askPassword(c, false, cx, () => void connect(v, c, cx));
  });

  if (c.origin === "saved") void readHistory(IO, dataHome(), c.id).then((h) => {
    if (v.active === c) v.history = h;

    cx.notify();
  });

  void v.loadQueries(c, cx);
  cx.notify();

  return tables;
}

/** Tests a connection: one `select 1`, said in the bar. */
export async function test(v: DbView, c: Conn, cx: Context): Promise<void> {
  if (needsPassword(v, c)) {
    v.askPassword(c, false, cx, () => void test(v, c, cx));

    return;
  }

  v.note = noteOf(`testing ${c.name}…`, "working");
  cx.notify();

  const o = await runOn(v, c, [{ text: "select 1", risk: "read" }]);

  v.note = o.noSecret ? noteOf(`${c.name}: the keychain has no password for it (e to set one)`, "failed")
    : o.error ? noteOf(`${c.name}: ${o.error.message}`, "failed") : noteOf(`${c.name} answers · ${o.ms} ms`, "done");
  cx.notify();
}

/** Saves a found or sent connection: kept, its password (if one) moved to the keychain. */
export async function saveFound(v: DbView, c: Conn, cx: Context): Promise<void> {
  if (c.origin === "saved") return;

  const id = newId(c.kind);
  const secret = v.secrets.get(c.id) ?? null;
  const kept: Conn = { ...c, id, origin: "saved", secret: secret ? "keychain" : c.secret === "ask" ? "ask" : "none" };
  const dir = v.dir;

  if (secret && dir) {
    const failed = await saveSecret(IO, dir, id, `Fireflies database ${c.name}`, secret);

    if (failed) {
      v.say(`the keychain refused it: ${failed}`, "failed");

      return;
    }
  }

  v.saved = [...v.saved, kept];
  v.found = v.found.filter((f) => f.conn.id !== c.id);
  v.sent = v.sent.filter((s) => s.id !== c.id);
  await writeConnections(IO, dataHome(), v.saved);

  if (v.active?.id === c.id) v.active = kept;

  v.connAt = v.saved.length - 1;
  v.say(`saved ${c.name}${secret ? " · its password is in the keychain" : ""}`, "done");
  cx.notify();
}

/** Removes a saved connection (asked first by the caller): its keychain item and history go too. */
export async function remove(v: DbView, c: Conn, cx: Context): Promise<void> {
  if (c.origin !== "saved") {
    v.sent = v.sent.filter((s) => s.id !== c.id);
    cx.notify();

    return;
  }

  v.saved = v.saved.filter((s) => s.id !== c.id);
  await writeConnections(IO, dataHome(), v.saved);
  await deleteSecret(IO, c.id);
  await clearHistory(IO, dataHome(), c.id);

  if (v.active?.id === c.id) v.active = null;

  v.connAt = Math.max(0, Math.min(v.connAt, connList(v).length - 1));
  v.say(`removed ${c.name}`, "done");
  cx.notify();
}

/** Asks for a connection's password (masked), kept in memory; `keychain`: the keychain had none
 *  (offer to keep it there). Enter runs `then`. */
export function askPassword(v: DbView, c: Conn, keychain: boolean, cx: Context, then?: () => void): void {
  const input = InputState.new({ placeholder: keychain ? "the password (kept in the keychain)" : "the password (kept while the window is open)" });

  input.set_masked(true);
  v.password = {
    conn: c.id,
    input,
    done: () => {
      const pw = input.value();

      v.password = null;
      v.secrets.set(c.id, pw);

      const go = then ?? (() => void connect(v, keychain ? { ...c, secret: "ask" } : c, cx));

      if (keychain && v.dir && pw) {
        void saveSecret(IO, v.dir, c.id, `Fireflies database ${c.name}`, pw).then((failed) => {
          if (failed) v.say(`the keychain refused it: ${failed}`, "failed");

          go();
        });
      } else go();
    },
  };
  cx.notify();
  input.focus();
}

/** Whether a saved connection that keeps its password in the keychain has one there. */
export const keychainHas = (c: Conn): Promise<boolean> => (c.secret === "keychain" ? hasSecret(IO, c.id) : Promise.resolve(true));
