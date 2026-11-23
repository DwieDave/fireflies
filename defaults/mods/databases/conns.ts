// The Connections panel's work: its list (saved ones, then those another
// mod sent, then those found in the space's folder), connecting to one (a
// password asked first where it must be), finding connections in the folder
// (discover.ts: .env files, direnv, SQLite files), testing, saving a found one
// (its password into the keychain) and removing one (its keychain item and
// history too). A connection whose password is a cluster's secret (kube.ts)
// reads it at each connect, into memory; a failed read says why and asks.

import { InputState } from "gpui-base";
import { Array as Arr, Deferred, Effect, Option, String as Str } from "effect";
import { Exec, Files, causeMessage, redraw } from "@fireflies/kit";
import type { Conn, ConnDraft } from "./kinds.ts";
import { isSslMode, newId, speaksTls, sslProblem, where } from "./kinds.ts";
import type { Found } from "./discover.ts";
import { ENV_FILES, FIND_SCRIPT, foundFile, foundInVars, mergeFound, parseEnvFile } from "./discover.ts";
import { deleteSecret, saveSecret } from "./secrets.ts";
import type { KubeSource } from "./kube.ts";
import { forwardProblem, kubeProblem, kubeWords, readKube } from "./kube.ts";
import { clearHistory, readHistory } from "./store.ts";
import { changePinned } from "./pinned.ts";
import { clientFrom, clientOf, dataHome, loadTables, needsPassword, runLine, runOn } from "./session.ts";
import { PROGRAMS } from "./clients.ts";
import { endWords, reading } from "./reads.ts";
import { folderEnvReady } from "./folderenv.ts";
import { forwardFirst, takenAfter } from "./forward.ts";
import type { ConnectArgs } from "./state.ts";
import { gridStart } from "./state.ts";
import { counted } from "./edits.ts";
import { withDatabase } from "./dbs.ts";
import { beforeLeaving } from "./cell-edit.ts";
import { keepCopy } from "./opening.ts";
import type { default as DbView } from "./main.ts";
import type { DbRun } from "./app.ts";

/** The list the Connections panel shows, in order. */
export function connList(v: DbView): Conn[] {
  return [...v.saved, ...v.sent, ...Arr.map(v.found, (f) => f.conn)];
}

/** The connection under the cursor. */
export const connAtCursor = (v: DbView): Conn | null => connList(v)[v.connAt] ?? null;

/** Finds connections in the space's folder: its .env files, its direnv environment (only when
 *  direnv already allows it: never allowed from here; waited for while it loads), its SQLite files. */
export const discover = (v: DbView): Effect.Effect<void, never, DbRun> => Effect.gen(function* () {
  const folder = v.folder;

  if ((folder === null || Str.isEmpty(folder)) || (v.on !== null && Str.isNonEmpty(v.on))) return;

  const files = yield* Files;
  // A file that can't be read is one not there.
  const texts = yield* Effect.forEach(ENV_FILES, (f) => Effect.map(Effect.orElseSucceed(files.read(`${folder}/${f}`), () => Option.none<string>()), (text) => [f, text] as const));
  const lists: Found[][] = Arr.flatMap(texts, ([f, text]) => (Option.isSome(text) && Str.isNonEmpty(text.value) ? [foundInVars(parseEnvFile(text.value), f, folder)] : []));
  const found = yield* Effect.orElseSucceed(Effect.map(Exec.use((x) => x.run("sh", ["-c", FIND_SCRIPT, "ff-find", folder])), (r) => r.stdout), () => "");

  lists.push(Arr.map(Arr.filter(Str.split(found, "\n"), Str.isNonEmpty), (p) => foundFile(p, folder)));
  setFound(v, mergeFound(lists));
  yield* redraw;

  // direnv last: a flake's shell can take a while the first time (folderenv.ts loads it).
  const loading = v.env;

  if (loading.kind === "loading") yield* Deferred.await(loading.done);

  const env = v.env;

  if (env.kind !== "ready") return;

  lists.splice(lists.length - 1, 0, foundInVars(env.env, "direnv", folder));
  setFound(v, mergeFound(lists));
  yield* redraw;
});

/** The found ones, their secrets into memory (never shared, never written). */
function setFound(v: DbView, list: readonly Found[]): void {
  const at = connAtCursor(v)?.id;

  v.found = Arr.filter(list, (f) => !Arr.some(v.saved, (s) => where(s) === where(f.conn) && s.kind === f.conn.kind));

  for (const f of v.found) if (f.secret !== null && Str.isNonEmpty(f.secret)) v.secrets.set(f.conn.id, f.secret);

  const again = Option.getOrElse(Arr.findFirstIndex(connList(v), (c) => c.id === at), () => -1);

  if (again >= 0) v.connAt = again;
}

/** A connection another mod sent (databases.connect): listed and connected, not saved. A
 *  cluster's secret named in it is checked first (kube.ts), and its sslmode: a bad one refuses the
 *  request. */
export function receive(v: DbView, a: ConnectArgs, go = true): Conn | null {
  const problem = (a.secret !== undefined ? kubeProblem(a.secret, a.kind, a.host) : null) ?? (a.forward !== undefined ? forwardProblem(a.forward, a.kind, a.host, a.port) : null)
    ?? (a.sslmode !== undefined ? sslProblem(a.sslmode) : null);

  if (problem !== null && Str.isNonEmpty(problem)) {
    v.say(`databases.connect: ${problem}`, "failed");

    return null;
  }

  const secret = a.secret !== undefined ? "kubernetes" : a.kind === "sqlite" ? "none" : "ask";
  const base: Conn = { id: `sent:${a.kind}:${a.host ?? ""}:${a.port ?? ""}:${a.path ?? a.url ?? ""}:${a.database ?? ""}`, name: a.name ?? a.database ?? a.path ?? a.host ?? a.kind, kind: a.kind, readonly: a.readonly ?? false, secret, origin: "sent", from: a.from ?? "another mod" };
  const conn: ConnDraft = { ...base, ...pick(a) };

  if (a.secret !== undefined) conn.source = a.secret;

  if (a.forward !== undefined) conn.forward = a.forward;

  // A database picked on it earlier in this window (dbs.ts) stands when it's sent again.
  const picked = v.picked.get(conn.id);
  const kept = picked === undefined ? conn : withDatabase(conn, picked);

  v.sent = [kept, ...Arr.filter(v.sent, (c) => c.id !== conn.id)];
  v.sentArgs.set(conn.id, a);
  v.connAt = v.saved.length;
  v.panel = "conns";

  if (go) v.run(connect(v, kept));

  return kept;
}

/** Where a connection is and how it asks for TLS: the fields a connect request may carry. */
type Place = { -readonly [K in "host" | "port" | "user" | "database" | "path" | "url" | "sslmode"]?: Conn[K] };

/** The place fields of a connect request that are there. */
function pick(a: ConnectArgs): Place {
  const out: Place = {};

  if (a.host !== undefined) out.host = a.host;

  if (a.port !== undefined) out.port = a.port;

  if (a.user !== undefined) out.user = a.user;

  if (a.database !== undefined) out.database = a.database;

  if (a.path !== undefined) out.path = a.path;

  if (a.url !== undefined) out.url = a.url;

  // A file has no TLS: an sslmode sent with one is left out.
  if (isSslMode(a.sslmode) && speaksTls(a.kind)) out.sslmode = a.sslmode;

  return out;
}

/** Connects: the password first where it must be asked (or read from a cluster's secret), then
 *  the tables. A local server that trusts its socket needs none, so a sent one tries without and
 *  asks when refused. */
export const connect = (v: DbView, c: Conn): Effect.Effect<void, never, DbRun> => Effect.gen(function* () {
  if (counted(v.edits).cells !== 0) {
    beforeLeaving(v, `connect to ${c.name}`, () => v.run(connect(v, c)));

    return;
  }

  // A connection from a port-forward: its port looked at first (down: the ask, forward.ts).
  if (c.forward !== undefined && !(yield* forwardFirst(v, c))) return;

  yield* connectNow(v, c);
});

/** Connects without looking at its forward (after the port was found open, or started). */
export const connectNow = (v: DbView, c: Conn): Effect.Effect<void, never, DbRun> => Effect.suspend(() => {
  if (c.secret === "kubernetes" && c.source !== undefined) return readThenOpen(v, c, c.source);

  if (c.secret === "ask" && c.origin !== "sent" && needsPassword(v, c)) {
    v.askPassword(c, false, () => v.run(connect(v, c)));

    return redraw;
  }

  return open(v, c);
});

/** The connection with what the read gave that isn't secret (its user, its database), in its list. */
function placed(v: DbView, c: Conn, user: string | undefined, database: string | undefined): Conn {
  if ((user === undefined || user === c.user) && (database === undefined || database === c.database)) return c;

  const next: ConnDraft = { ...c };

  if (user !== undefined) next.user = user;

  if (database !== undefined) next.database = database;

  const swap = (list: Conn[]): Conn[] => Arr.map(list, (x) => (x.id === c.id ? next : x));

  v.saved = swap(v.saved);
  v.sent = swap(v.sent);

  return next;
}

/** How long the secret's read may take (kubectl's own --request-timeout is 10 s, exec's 15 s). */
export const KUBE_DEADLINE = 20000;

/** Reads the password from the cluster's secret (again at every connect), then connects; a failed
 *  read says why and asks for it instead. The client is looked for first: without one there is
 *  nothing to read the secret for. Nothing of the value is said, logged or written. */
export const readThenOpen = (v: DbView, c: Conn, s: KubeSource): Effect.Effect<void, never, DbRun> => Effect.gen(function* () {
  v.active = c;
  v.alive = null;
  v.catalog = { tables: [], error: null, busy: false };
  yield* redraw;

  const cat = v.catalog;
  const what = `reading the password from secret ${s.name}`;

  const read = yield* Effect.gen(function* () {
    const missing = yield* clientMissing(v, c);

    if (v.active !== c || v.catalog !== cat) return null;

    if (missing !== null && Str.isNonEmpty(missing)) {
      cat.error = missing;
      v.say(missing, "failed");

      return null;
    }

    v.say(`${what}…`, "working");

    const e = yield* reading(v, what, "tables", () => readKube(s), KUBE_DEADLINE);

    if (v.active !== c || v.catalog !== cat) return null;

    if (!("value" in e)) {
      cat.error = endWords(e, what);
      v.say(cat.error ?? "", "failed");

      return null;
    }

    return e.value;
  }).pipe(
    Effect.catchDefect((d) => Effect.sync(() => {
      if (v.catalog === cat) cat.error = `${what} failed: ${causeMessage(d)}`;

      return null;
    })),
    Effect.ensuring(redraw),
  );

  if (read === null) return;

  if ("error" in read) {
    const why = `couldn't read secret ${s.name} · ${s.key}: ${read.error}`;

    v.secrets.delete(c.id);
    v.sourced.set(c.id, { ok: false, text: why });
    v.say(`${why} · type the password`, "failed");
    v.askPassword(c, false, () => v.run(open(v, c)));
    yield* redraw;

    return;
  }

  const next = placed(v, c, read.user, read.database);

  v.secrets.set(next.id, read.password);
  v.sourced.set(next.id, { ok: true, text: `password from ${kubeWords(s)}` });
  v.say(`password from ${kubeWords(s)}`, "done");

  yield* open(v, next);
});

/** Why the connection's client can't run (said before anything is read for it), or null. The
 *  folder's environment is waited for first (it may bring the client). */
export const clientMissing = (v: DbView, c: Conn): Effect.Effect<string | null, never, DbRun> => Effect.gen(function* () {
  if (c.kind === "libsql" && (c.url !== undefined && Str.isNonEmpty(c.url))) return null;

  yield* folderEnvReady(v);

  const f = yield* clientOf(v, c.kind);

  if (!("missing" in f)) return null;

  const said = `${f.missing} (${clientFrom(v, f)})`;

  v.logLine({ sql: `looking for ${Arr.join(PROGRAMS[c.kind], " / ")}`, ok: false, ms: 0, said, conn: c.name, run: runLine(v, c.kind, f, []) });

  return said;
});

/** Connects with what the window has (the password in memory, the keychain's, none). */
export const openConn = (v: DbView, c: Conn): Effect.Effect<void, never, DbRun> => open(v, c);

const open = (v: DbView, c: Conn): Effect.Effect<void, never, DbRun> => Effect.gen(function* () {
  v.active = c;
  v.alive = null;
  v.catalog = { tables: [], error: null, busy: true };
  v.struct = { table: null, data: null, busy: false, error: null };
  v.rows = { browse: null, set: null, total: null, error: null, busy: false, at: gridStart(), filtering: false };
  v.edits = null;
  v.cellEdit = null;
  v.tableAt = 0;
  v.history = [];

  if (c.origin === "saved") {
    v.run(Effect.map(Effect.orElseSucceed(readHistory(dataHome(), c.id), () => []), (h) => {
      if (v.active === c) v.history = h;
    }));
  }

  v.loadQueries(c);
  yield* redraw;
  yield* loadTables(v);

  // Connected: kept as where the view is (its space's place, a pane's own).
  if (v.active?.id === c.id && v.catalog.error === null) keepCopy(v);

  // A sent one refused without a password: ask for it, then again.
  const e = v.catalog.error ?? "";
  const refused = v.active === c && /password|authentication/i.test(e);

  if (refused && c.origin === "sent" && !v.secrets.has(c.id)) v.askPassword(c, false, () => v.run(connect(v, c)));

  // Something other than the database on a forward's port (another program holds it): said, with
  // another local port offered.
  if (v.active === c && Str.isNonEmpty(e) && c.forward !== undefined) v.run(takenAfter(v, c, e));

  // A secret's password the server refused (the wrong secret picked, rotated since): asked once.
  if (refused && c.secret === "kubernetes" && c.source !== undefined && v.sourced.get(c.id)?.ok === true) {
    v.sourced.set(c.id, { ok: false, text: `the server refused the password from secret ${c.source.name} · ${c.source.key}` });
    v.askPassword(c, false, () => v.run(open(v, c)));
  }
});

/** Tests a connection: one `select 1`, said in the bar (a read: its seconds shown, esc stops it). */
export const test = (v: DbView, c: Conn): Effect.Effect<void, never, DbRun> => Effect.gen(function* () {
  const missing = yield* clientMissing(v, c);

  if (missing !== null && Str.isNonEmpty(missing)) {
    v.say(`${c.name}: ${missing}`, "failed");

    return;
  }

  const source = c.secret === "kubernetes" ? c.source ?? null : null;

  if (source !== null) {
    const e = yield* reading(v, `reading the password from secret ${source.name}`, "conns", () => readKube(source), KUBE_DEADLINE);
    const r = "value" in e ? e.value : { error: endWords(e, "the read") ?? "" };

    if ("error" in r) {
      v.say(`${c.name}: couldn't read secret ${source.name}: ${r.error}`, "failed");

      return;
    }

    v.secrets.set(c.id, r.password);
  }

  if (needsPassword(v, c)) {
    v.askPassword(c, false, () => v.run(test(v, c)));

    return;
  }

  v.say(`testing ${c.name}…`, "working");
  yield* redraw;

  const e = yield* reading(v, `testing ${c.name}`, "conns", (started) => runOn(v, c, [{ text: "select 1", risk: "read" }], started, undefined, `test of ${c.name}`));

  if (!("value" in e)) {
    v.say(endWords(e, `testing ${c.name}`) ?? "", "failed");

    return;
  }

  const o = e.value;

  if (o.noSecret === true) v.say(`${c.name}: the keychain has no password for it (e to set one)`, "failed");
  else if (o.error !== null) v.say(`${c.name}: ${o.error.message}`, "failed");
  else v.say(`${c.name} answers · ${o.ms} ms`, "done");
}).pipe(
  Effect.catchDefect((d) => Effect.sync(() => v.say(`testing ${c.name} failed: ${causeMessage(d)}`, "failed"))),
  Effect.ensuring(redraw),
);

/** Saves a found or sent connection: kept, its password (if one) moved to the keychain. */
export const saveFound = (v: DbView, c: Conn): Effect.Effect<void, never, DbRun> => Effect.gen(function* () {
  if (c.origin === "saved") return;

  const id = yield* newId(c.kind);
  const secret = v.secrets.get(c.id) ?? null;
  const kube = c.secret === "kubernetes" && c.source !== undefined ? c.source : null;
  const kept: Conn = { ...c, id, origin: "saved", secret: kube !== null ? "kubernetes" : secret !== null && Str.isNonEmpty(secret) ? "keychain" : c.secret === "ask" ? "ask" : "none" };
  const dir = v.dir;

  // A cluster's secret is saved as where it is (read again at each connect), never its value.
  if (kube !== null) {
    if (secret !== null && Str.isNonEmpty(secret)) v.secrets.set(id, secret);

    const read = v.sourced.get(c.id);

    if (read !== undefined) v.sourced.set(id, read);
  } else if ((secret !== null && Str.isNonEmpty(secret)) && (dir !== null && Str.isNonEmpty(dir))) {
    const saved = yield* Effect.result(saveSecret(dir, id, `Fireflies database ${c.name}`, secret));

    if (saved._tag === "Failure") {
      v.say(`the keychain refused it: ${saved.failure.message}`, "failed");

      return;
    }
  }

  if (v.active?.id === c.id) v.active = kept;

  const list = yield* changePinned(v, (now) => [...Arr.filter(now, (x) => x.id !== id), kept]);

  if (list === null) return;

  v.found = Arr.filter(v.found, (f) => f.conn.id !== c.id);
  v.sent = Arr.filter(v.sent, (s) => s.id !== c.id);
  v.connAt = Math.max(0, Option.getOrElse(Arr.findFirstIndex(v.saved, (x) => x.id === id), () => -1));
  v.say(`pinned ${c.name}: every Databases window lists it${kube !== null ? ` · its password is read from secret ${kube.name} at each connect` : secret !== null && Str.isNonEmpty(secret) ? " · its password is in the keychain" : ""}${c.forward !== undefined ? ` · its forward (${c.forward.target}) is offered when its port is down` : ""}`, "done");
});

/** Removes a saved connection (asked first by the caller): its keychain item and history go too. */
export const remove = (v: DbView, c: Conn): Effect.Effect<void, never, DbRun> => Effect.gen(function* () {
  if (c.origin !== "saved") {
    v.sent = Arr.filter(v.sent, (s) => s.id !== c.id);

    return;
  }

  if ((yield* changePinned(v, (now) => Arr.filter(now, (s) => s.id !== c.id))) === null) return;

  // Its keychain item and history: gone where they can be (a missing one is gone already).
  yield* Effect.ignore(deleteSecret(c.id));
  yield* Effect.ignore(clearHistory(dataHome(), c.id));

  if (v.active?.id === c.id) v.active = null;

  v.connAt = Math.max(0, Math.min(v.connAt, connList(v).length - 1));
  v.say(`unpinned ${c.name}`, "done");
});

/** Asks for a connection's password (masked), kept in memory; `keychain`: the keychain had none
 *  (offer to keep it there). Enter runs `then`. */
export function askPassword(v: DbView, c: Conn, keychain: boolean, then?: () => void): void {
  const input = InputState.new({ placeholder: keychain ? "the password (kept in the keychain)" : "the password (kept while the window is open)" });

  input.set_masked(true);
  v.password = {
    conn: c.id,
    input,
    done: () => {
      const pw = input.value();

      // Its input had the keyboard: back to the view (else enter on a table went nowhere after).
      v.password = null;
      v.focusShown();
      v.secrets.set(c.id, pw);

      const go = then ?? (() => v.run(connect(v, keychain ? { ...c, secret: "ask" } : c)));
      const dir = v.dir;

      if (keychain && (dir !== null && Str.isNonEmpty(dir)) && Str.isNonEmpty(pw)) {
        v.run(saveSecret(dir, c.id, `Fireflies database ${c.name}`, pw).pipe(
          Effect.catch((failed) => Effect.sync(() => v.say(`the keychain refused it: ${failed.message}`, "failed"))),
          Effect.andThen(Effect.sync(go)),
        ));
      } else go();
    },
  };
  input.focus();
}
