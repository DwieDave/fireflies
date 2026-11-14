// The Databases window (databases): a floating window over the tab with the
// shown space's connections, toggled by nocturne.databases (the palette,
// "+ new" > Databases, the git mark's menu). The window says it's open in
// shared(WINDOW) and renews that every few seconds, so a stale note (an app
// restart) doesn't swallow a press.
//
// Another mod hands it a connection (the contract in docs and briefs:
// procs3's ports, the Kubernetes mod's port-forwards, the files pane's *.db):
//   nocturne.databases:{"kind": …, "name"?, "host"?, "port"?, "database"?, "user"?, "path"?, "url"?, "readonly"?, "from"?, "secret"?, "forward"?}
// opens the window on it, or gives it to an open window (databases.connect);
// with "as": "pane" | "tab" it opens there instead (inpane.ts). No secret
// travels: the window asks for the password or takes it from the keychain,
// or reads it itself from the cluster's secret that "secret" names
// ({"from": "kubernetes", "context", "namespace", "name", "key", "userKey"?,
// "databaseKey"?, "kubectl"?}: the databases mod's kube.ts checks and reads it), and "forward"
// the port-forward it came from ({"context", "namespace", "target", "remote", "local", "kubectl"?}).

import { openOverlay, closeOverlay, shared, setShared, run } from "herdr";
import { isBoolean, isNumber, isString, literal, nullable, object, parseJson, readShared, sharedKey, writeShared } from "./guard.ts";
import type { Guarded } from "./guard.ts";
import { here } from "./panels.ts";

/** The Databases window's note that it's open (the databases mod writes it). */
const WINDOW = sharedKey("databases.window", nullable(object({ id: isString }, { beat: isNumber })));
const FRESH = 10000;

/** Where a cluster keeps the password (the databases mod's kube.ts guard, copied: a place, never a value). */
const isKubeSource = object({ from: literal("kubernetes"), context: isString, namespace: isString, name: isString, key: isString }, {
  userKey: isString, databaseKey: isString, kubectl: isString,
});

/** The port-forward a connection came from (the databases mod's kube.ts guard, copied: nothing secret). */
const isKubeForward = object({ context: isString, namespace: isString, target: isString, remote: isNumber, local: isNumber }, { kubectl: isString });

/** A connection another mod sends (the databases mod's own guard, copied: no secret in it). */
export const isConnectArgs = object({ kind: literal("postgres", "mysql", "sqlite", "libsql") }, {
  name: isString, host: isString, port: isNumber, database: isString, user: isString, path: isString, url: isString, readonly: isBoolean, from: isString,
  secret: isKubeSource, forward: isKubeForward, as: literal("pane", "tab", "window"),
});

export type ConnectArgs = Guarded<typeof isConnectArgs>;

/** The open window's overlay id, or null. */
export function databasesOpen(): string | null {
  const w = readShared(shared, WINDOW, null);

  return w?.id && Date.now() - (w.beat ?? 0) < FRESH ? w.id : null;
}

/** The window's props: the shown space's folder and machine, and a connection to open. */
type DbProps = { folder: string | null; on: string | null; connect?: Omit<ConnectArgs, "as"> };

function openWindow(props: DbProps): void {
  const id = openOverlay({ mod: "databases", kind: "window", key: "databases", frame: "none", scrim: true, width: 0.88, height: 0.88, resizable: { min: [520, 360] }, props });

  writeShared(setShared, WINDOW, { id, beat: Date.now() });
}

/** The props a window opens with now (an attached space's folder, else the focused pane's). */
function place(): DbProps {
  const h = here();

  return { folder: (h.space?.attached && h.space.folder) || h.folder, on: h.on };
}

/** Opens the window over the tab, or closes it. */
export function toggleDatabases(): void {
  const open = databasesOpen();

  if (open) {
    closeOverlay(open);
    writeShared(setShared, WINDOW, null);

    return;
  }

  openWindow(place());
}

/** The window, opened (an open one stays). */
export function openDatabases(): void {
  if (!databasesOpen()) openWindow(place());
}

/** A connection sent to the window: an open one takes it, else one opens on it. */
export function connectDatabases(args: ConnectArgs): void {
  const { as: _as, ...connect } = args;

  if (databasesOpen()) run(`databases.connect:${JSON.stringify(connect)}`);
  else openWindow({ ...place(), connect });
}

/** `nocturne.databases:{…}` with a kind: the connection (where `as` says, else the window); else null. */
export function connectArgsOf(value: string): ConnectArgs | null {
  const v = value.trim();

  return v.startsWith("{") ? parseJson(v, isConnectArgs) ?? null : null;
}
