// The Connections panel's work: its list (saved ones, then those another
// mod sent, then those found in the space's folder), connecting to one (a
// password asked first where it must be), finding connections in the folder
// (discover.ts: .env files, direnv, SQLite files), testing, saving a found one
// (its password into the keychain) and removing one (its keychain item and
// history too). A connection whose password is a cluster's secret (kube.ts)
// reads it at each connect, into memory; a failed read says why and asks.

import type { Context } from "gpui-kit";
import { InputState } from "gpui-base";
import { exec, readTextFile } from "herdr";
import type { Conn, ConnDraft } from "./kinds.ts";
import { newId, where } from "./kinds.ts";
import type { Found } from "./discover.ts";
import { ENV_FILES, FIND_SCRIPT, foundFile, foundInVars, mergeFound, parseEnvFile } from "./discover.ts";
import { deleteSecret, hasSecret, saveSecret } from "./secrets.ts";
import type { KubeSource } from "./kube.ts";
import { forwardProblem, kubeProblem, kubeWords, readKube } from "./kube.ts";
import { clearHistory, readHistory } from "./store.ts";
import { changePinned } from "./pinned.ts";
import { IO, clientFrom, clientOf, dataHome, loadTables, needsPassword, runLine, runOn } from "./session.ts";
import { PROGRAMS } from "./clients.ts";
import { endWords, reading } from "./reads.ts";
import { folderEnvReady } from "./folderenv.ts";
import { forwardFirst, takenAfter } from "./forward.ts";
import type { ConnectArgs } from "./state.ts";
import { gridStart, noteOf } from "./state.ts";
import { counted } from "./edits.ts";
import { withDatabase } from "./dbs.ts";
import { beforeLeaving } from "./cell-edit.ts";
import type { default as DbView } from "./main.ts";

/** The list the Connections panel shows, in order. */
export function connList(v: DbView): Conn[] {
  return [...v.saved, ...v.sent, ...v.found.map((f) => f.conn)];
}

/** The connection under the cursor. */
export const connAtCursor = (v: DbView): Conn | null => connList(v)[v.connAt] ?? null;

/** Finds connections in the space's folder: its .env files, its direnv environment (only when
 *  direnv already allows it: never allowed from here), its SQLite files. */
export async function discover(v: DbView, cx: Context, envLoad: Promise<void> = Promise.resolve()): Promise<void> {
  cx = v.held(cx);

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

  // direnv last: a flake's shell can take a while the first time (folderenv.ts loads it).
  await envLoad;

  const env = v.env;

  if (env.kind !== "ready") return;

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

/** A connection another mod sent (databases.connect): listed and connected, not saved. A
 *  cluster's secret named in it is checked first (kube.ts): a bad one refuses the request. */
export function receive(v: DbView, a: ConnectArgs, cx: Context): void {
  const problem = (a.secret ? kubeProblem(a.secret, a.kind, a.host) : null) ?? (a.forward ? forwardProblem(a.forward, a.kind, a.host, a.port) : null);

  if (problem) {
    v.say(`databases.connect: ${problem}`, "failed");

    return;
  }

  const secret = a.secret ? "kubernetes" : a.kind === "sqlite" ? "none" : "ask";
  const base: Conn = { id: `sent:${a.kind}:${a.host ?? ""}:${a.port ?? ""}:${a.path ?? a.url ?? ""}:${a.database ?? ""}`, name: a.name ?? a.database ?? a.path ?? a.host ?? a.kind, kind: a.kind, readonly: a.readonly ?? false, secret, origin: "sent", from: a.from ?? "another mod" };
  const conn: ConnDraft = { ...base, ...pick(a) };

  if (a.secret) conn.source = a.secret;

  if (a.forward) conn.forward = a.forward;

  // A database picked on it earlier in this window (dbs.ts) stands when it's sent again.
  const picked = v.picked.get(conn.id);
  const kept = picked === undefined ? conn : withDatabase(conn, picked);

  v.sent = [kept, ...v.sent.filter((c) => c.id !== conn.id)];
  v.connAt = v.saved.length;
  v.panel = "conns";
  void connect(v, kept, cx);
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

/** Connects: the password first where it must be asked (or read from a cluster's secret), then
 *  the tables. A local server that trusts its socket needs none, so a sent one tries without and
 *  asks when refused. */
export async function connect(v: DbView, c: Conn, cx: Context): Promise<void> {
  cx = v.held(cx);

  if (counted(v.edits).cells) {
    beforeLeaving(v, `connect to ${c.name}`, () => void connect(v, c, cx));

    return;
  }

  // A connection from a port-forward: its port looked at first (down: the ask, forward.ts).
  if (c.forward && !(await forwardFirst(v, c, cx))) return;

  return connectNow(v, c, cx);
}

/** Connects without looking at its forward (after the port was found open, or started). */
export function connectNow(v: DbView, c: Conn, cx: Context): Promise<void> {
  cx = v.held(cx);

  if (c.secret === "kubernetes" && c.source) return readThenOpen(v, c, c.source, cx);

  if (c.secret === "ask" && c.origin !== "sent" && needsPassword(v, c)) {
    v.askPassword(c, false, cx, () => void connect(v, c, cx));

    return Promise.resolve();
  }

  return open(v, c, cx);
}

/** The connection with what the read gave that isn't secret (its user, its database), in its list. */
function placed(v: DbView, c: Conn, user: string | undefined, database: string | undefined): Conn {
  if ((user === undefined || user === c.user) && (database === undefined || database === c.database)) return c;

  const next: ConnDraft = { ...c };

  if (user !== undefined) next.user = user;

  if (database !== undefined) next.database = database;

  const swap = (list: Conn[]): Conn[] => list.map((x) => (x.id === c.id ? next : x));

  v.saved = swap(v.saved);
  v.sent = swap(v.sent);

  return next;
}

/** How long the secret's read may take (kubectl's own --request-timeout is 10 s, exec's 15 s). */
export const KUBE_DEADLINE = 20000;

/** Reads the password from the cluster's secret (again at every connect), then connects; a failed
 *  read says why and asks for it instead. The client is looked for first: without one there is
 *  nothing to read the secret for. Nothing of the value is said, logged or written. */
export async function readThenOpen(v: DbView, c: Conn, s: KubeSource, cx: Context): Promise<void> {
  cx = v.held(cx);

  v.active = c;
  v.alive = null;
  v.catalog = { tables: [], error: null, busy: false };
  cx.notify();

  const cat = v.catalog;
  let r: Awaited<ReturnType<typeof readKube>>;

  try {
    const missing = await clientMissing(v, c, cx);

    if (v.active !== c || v.catalog !== cat) return;

    if (missing) {
      cat.error = missing;
      v.say(missing, "failed");

      return;
    }

    v.say(`reading the password from secret ${s.name}…`, "working");

    const e = await reading(v, `reading the password from secret ${s.name}`, "tables", cx, () => readKube(exec, s), KUBE_DEADLINE);

    if (v.active !== c || v.catalog !== cat) return;

    if (!("value" in e)) {
      cat.error = endWords(e, `reading the password from secret ${s.name}`);
      v.say(cat.error ?? "", "failed");

      return;
    }

    r = e.value;
  } catch (error) {
    if (v.catalog === cat) cat.error = `reading the password from secret ${s.name} failed: ${error instanceof Error ? error.message : String(error)}`;

    return;
  } finally {
    cx.notify();
  }

  if ("error" in r) {
    const why = `couldn't read secret ${s.name} · ${s.key}: ${r.error}`;

    v.secrets.delete(c.id);
    v.sourced.set(c.id, { ok: false, text: why });
    v.say(`${why} · type the password`, "failed");
    v.askPassword(c, false, cx, () => void open(v, c, cx));
    cx.notify();

    return;
  }

  const next = placed(v, c, r.user, r.database);

  v.secrets.set(next.id, r.password);
  v.sourced.set(next.id, { ok: true, text: `password from ${kubeWords(s)}` });
  v.say(`password from ${kubeWords(s)}`, "done");

  return open(v, next, cx);
}

/** Why the connection's client can't run (said before anything is read for it), or null. The
 *  folder's environment is waited for first (it may bring the client). */
export async function clientMissing(v: DbView, c: Conn, cx: Context): Promise<string | null> {
  cx = v.held(cx);

  if (c.kind === "libsql" && c.url) return null;

  await folderEnvReady(v, cx);

  const f = await clientOf(v, c.kind);

  if (!("missing" in f)) return null;

  const said = `${f.missing} (${clientFrom(v, f)})`;

  v.logLine({ sql: `looking for ${PROGRAMS[c.kind].join(" / ")}`, ok: false, ms: 0, said, conn: c.name, run: runLine(v, c.kind, f, []) });

  return said;
}

/** Connects with what the window has (the password in memory, the keychain's, none). */
export function openConn(v: DbView, c: Conn, cx: Context): Promise<void> {
  return open(v, c, cx);
}

function open(v: DbView, c: Conn, cx: Context): Promise<void> {
  cx = v.held(cx);

  v.active = c;
  v.alive = null;
  v.catalog = { tables: [], error: null, busy: true };
  v.struct = { table: null, data: null, busy: false, error: null };
  v.rows = { browse: null, set: null, total: null, error: null, busy: false, at: gridStart(), filtering: false };
  v.edits = null;
  v.cellEdit = null;
  v.tableAt = 0;
  v.history = [];

  const tables = loadTables(v, cx).then(() => {
    // A sent one refused without a password: ask for it, then again.
    const e = v.catalog.error ?? "";
    const refused = v.active === c && /password|authentication/i.test(e);

    if (refused && c.origin === "sent" && !v.secrets.has(c.id)) v.askPassword(c, false, cx, () => void connect(v, c, cx));

    // Something other than the database on a forward's port (another program holds it): said, with
    // another local port offered.
    if (v.active === c && e && c.forward) void takenAfter(v, c, e, cx);

    // A secret's password the server refused (the wrong secret picked, rotated since): asked once.
    if (refused && c.secret === "kubernetes" && c.source && v.sourced.get(c.id)?.ok) {
      v.sourced.set(c.id, { ok: false, text: `the server refused the password from secret ${c.source.name} · ${c.source.key}` });
      v.askPassword(c, false, cx, () => void open(v, c, cx));
    }
  });

  if (c.origin === "saved") void readHistory(IO, dataHome(), c.id).then((h) => {
    if (v.active === c) v.history = h;

    cx.notify();
  });

  void v.loadQueries(c, cx);
  cx.notify();

  return tables;
}

/** Tests a connection: one `select 1`, said in the bar (a read: its seconds shown, esc stops it). */
export async function test(v: DbView, c: Conn, cx: Context): Promise<void> {
  cx = v.held(cx);

  try {
    const missing = await clientMissing(v, c, cx);

    if (missing) {
      v.note = noteOf(`${c.name}: ${missing}`, "failed");

      return;
    }

    const source = c.secret === "kubernetes" ? c.source ?? null : null;

    if (source) {
      const e = await reading(v, `reading the password from secret ${source.name}`, "conns", cx, () => readKube(exec, source), KUBE_DEADLINE);
      const r = "value" in e ? e.value : { error: endWords(e, "the read") ?? "" };

      if ("error" in r) {
        v.note = noteOf(`${c.name}: couldn't read secret ${source.name}: ${r.error}`, "failed");

        return;
      }

      v.secrets.set(c.id, r.password);
    }

    if (needsPassword(v, c)) {
      v.askPassword(c, false, cx, () => void test(v, c, cx));

      return;
    }

    v.note = noteOf(`testing ${c.name}…`, "working");
    cx.notify();

    const e = await reading(v, `testing ${c.name}`, "conns", cx, (started) => runOn(v, c, [{ text: "select 1", risk: "read" }], started, undefined, `test of ${c.name}`));

    if (!("value" in e)) {
      v.note = noteOf(endWords(e, `testing ${c.name}`) ?? "", "failed");

      return;
    }

    const o = e.value;

    v.note = o.noSecret ? noteOf(`${c.name}: the keychain has no password for it (e to set one)`, "failed")
      : o.error ? noteOf(`${c.name}: ${o.error.message}`, "failed") : noteOf(`${c.name} answers · ${o.ms} ms`, "done");
  } catch (error) {
    v.note = noteOf(`testing ${c.name} failed: ${error instanceof Error ? error.message : String(error)}`, "failed");
  } finally {
    cx.notify();
  }
}

/** Saves a found or sent connection: kept, its password (if one) moved to the keychain. */
export async function saveFound(v: DbView, c: Conn, cx: Context): Promise<void> {
  cx = v.held(cx);

  if (c.origin === "saved") return;

  const id = newId(c.kind);
  const secret = v.secrets.get(c.id) ?? null;
  const kube = c.secret === "kubernetes" && c.source ? c.source : null;
  const kept: Conn = { ...c, id, origin: "saved", secret: kube ? "kubernetes" : secret ? "keychain" : c.secret === "ask" ? "ask" : "none" };
  const dir = v.dir;

  // A cluster's secret is saved as where it is (read again at each connect), never its value.
  if (kube) {
    if (secret) v.secrets.set(id, secret);

    const read = v.sourced.get(c.id);

    if (read) v.sourced.set(id, read);
  } else if (secret && dir) {
    const failed = await saveSecret(IO, dir, id, `Fireflies database ${c.name}`, secret);

    if (failed) {
      v.say(`the keychain refused it: ${failed}`, "failed");

      return;
    }
  }

  if (v.active?.id === c.id) v.active = kept;

  const list = await changePinned(v, (now) => [...now.filter((x) => x.id !== id), kept], cx);

  if (!list) return;

  v.found = v.found.filter((f) => f.conn.id !== c.id);
  v.sent = v.sent.filter((s) => s.id !== c.id);
  v.connAt = Math.max(0, v.saved.findIndex((x) => x.id === id));
  v.say(`pinned ${c.name}: every Databases window lists it${kube ? ` · its password is read from secret ${kube.name} at each connect` : secret ? " · its password is in the keychain" : ""}${c.forward ? ` · its forward (${c.forward.target}) is offered when its port is down` : ""}`, "done");
  cx.notify();
}

/** Removes a saved connection (asked first by the caller): its keychain item and history go too. */
export async function remove(v: DbView, c: Conn, cx: Context): Promise<void> {
  cx = v.held(cx);

  if (c.origin !== "saved") {
    v.sent = v.sent.filter((s) => s.id !== c.id);
    cx.notify();

    return;
  }

  if (!(await changePinned(v, (now) => now.filter((s) => s.id !== c.id), cx))) return;

  await deleteSecret(IO, c.id);
  await clearHistory(IO, dataHome(), c.id);

  if (v.active?.id === c.id) v.active = null;

  v.connAt = Math.max(0, Math.min(v.connAt, connList(v).length - 1));
  v.say(`unpinned ${c.name}`, "done");
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
