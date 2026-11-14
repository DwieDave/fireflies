// A password that lives in a Kubernetes secret (the Kubernetes mod's port-
// forwards send one): the connect request carries where it is, never the
// value, and this window reads it itself when it connects, with one fixed
// kubectl call it builds (kubeReadArgs) from checked names, so nothing a
// sender writes can run anything else. The value (base64 on kubectl's stdout)
// goes into the window's memory (v.secrets) and from there the way every
// password goes (runner.ts); a reconnect reads again (credentials rotate).
// Only for a server on this machine (a port-forward listens on loopback):
// a request can't send a secret of the cluster to another host.
//
// The contract (defaults/AGENTS.md, the k8s mod's README):
//   "secret": { "from": "kubernetes", "context": …, "namespace": …, "name": …, "key": …,
//               "userKey"?: …, "databaseKey"?: …, "kubectl"?: "kubectl" | "/abs/…/kubectl" }

import type { Guarded } from "./guard.ts";
import { isString, literal, object } from "./guard.ts";
import type { ExecResult } from "herdr";

/** Where a connection's password is in a cluster (the connect request's `secret`, a saved one's `source`). */
export const isKubeSource = object({ from: literal("kubernetes"), context: isString, namespace: isString, name: isString, key: isString }, {
  userKey: isString, databaseKey: isString, kubectl: isString,
});

export type KubeSource = Guarded<typeof isKubeSource>;

/** A DNS label (a namespace), a DNS subdomain (a secret's name), a secret's key (kubernetes' own rules). */
const NAMESPACE = /^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/;
const NAME = /^[a-z0-9]([-a-z0-9.]{0,251}[a-z0-9])?$/;
const KEY = /^[-._a-zA-Z0-9]{1,253}$/;
const KUBECTL = /^(kubectl|\/[^\0\n\r]*\/kubectl)$/;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/** Why the window won't read this source for a connection to `host`, or null. */
export function kubeProblem(s: KubeSource, kind: string, host: string | undefined): string | null {
  if (kind !== "postgres" && kind !== "mysql") return "a secret is read only for Postgres and MySQL";

  if (!host || !LOOPBACK.has(host)) return "a secret is read only for a server on this machine (127.0.0.1, a port-forward)";

  if (!s.context || s.context.length > 253 || [...s.context].some((ch) => ch.charCodeAt(0) < 0x20)) return "its context isn't a context's name";

  if (!NAMESPACE.test(s.namespace)) return "its namespace isn't a namespace's name";

  if (!NAME.test(s.name)) return "its name isn't a secret's name";

  for (const k of [s.key, s.userKey, s.databaseKey]) if (k !== undefined && !KEY.test(k)) return `${k} isn't a secret's key`;

  if (s.kubectl !== undefined && !KUBECTL.test(s.kubectl)) return "kubectl must be kubectl or a path ending in /kubectl";

  return null;
}

/** The keys one read prints, in order: the password's, then the user's and the database's when named. */
const keysOf = (s: KubeSource): string[] => [s.key, ...(s.userKey ? [s.userKey] : []), ...(s.databaseKey ? [s.databaseKey] : [])];

/** The template: each key's base64 on a line of its own (an absent key: an empty line). */
export function kubeTemplate(s: KubeSource): string {
  return `{{with .data}}${keysOf(s).map((k) => `{{with index . "${k}"}}{{.}}{{end}}{{"\\n"}}`).join("")}{{end}}`;
}

/** A program and its arguments. */
export interface KubeCall {
  readonly program: string;
  readonly args: string[];
}

/** The program and arguments of the one read (checked by kubeProblem first). */
export function kubeReadArgs(s: KubeSource): KubeCall {
  return {
    program: s.kubectl ?? "kubectl",
    args: [`--context=${s.context}`, `--namespace=${s.namespace}`, "get", "secret", s.name, "--request-timeout=10s", "-o", `go-template=${kubeTemplate(s)}`],
  };
}

/** Where the password came from, in words (the row, the head, the notes): never the value. */
export function kubeWords(s: KubeSource): string {
  return `secret ${s.name} · ${s.key} (${s.context}/${s.namespace}), read with kubectl`;
}

/** What one read gave: the password, and the user and database when their keys were named. */
export interface KubeRead {
  readonly password: string;
  readonly user?: string;
  readonly database?: string;
}

type ReadDraft = { -readonly [K in keyof KubeRead]: KubeRead[K] };

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** base64's bytes, or null when it isn't base64 (the engine has no atob). */
export function base64Bytes(b64: string): number[] | null {
  const clean = b64.replace(/\s+/g, "").replace(/=+$/, "");
  const out: number[] = [];
  let acc = 0;
  let bits = 0;

  for (const ch of clean) {
    const v = B64.indexOf(ch);

    if (v < 0) return null;

    acc = ((acc << 6) | v) & 0xffffff;
    bits += 6;

    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }

  return out;
}

/** UTF-8 bytes as text, or null when they aren't UTF-8. */
export function utf8(bytes: readonly number[]): string | null {
  let s = "";

  for (let i = 0; i < bytes.length;) {
    const b = bytes[i] ?? 0;
    const n = b < 0x80 ? 0 : b >> 5 === 6 ? 1 : b >> 4 === 14 ? 2 : b >> 3 === 30 ? 3 : -1;

    if (n < 0 || i + n >= bytes.length + (n ? 0 : 1)) return null;

    let cp = n === 0 ? b : b & (0x3f >> n);

    for (let k = 1; k <= n; k++) {
      const c = bytes[i + k] ?? 0;

      if (c >> 6 !== 2) return null;

      cp = (cp << 6) | (c & 0x3f);
    }

    s += String.fromCodePoint(cp);
    i += n + 1;
  }

  return s;
}

/** A key's line decoded: its text, "" when absent, or null when it isn't text. */
function decoded(line: string | undefined): string | null {
  if (!line) return "";

  const bytes = base64Bytes(line);

  return bytes ? utf8(bytes) : null;
}

/** kubectl's answer to the read: the values, or why there are none (never the value in the words). */
export function parseKubeRead(s: KubeSource, r: ExecResult): KubeRead | { readonly error: string } {
  if (r.code !== 0) {
    const said = r.stderr.split("\n").map((l) => l.trim()).find(Boolean) ?? "";

    if (r.code === 127 || (/not found|no such file/i.test(said) && !/secrets? "/.test(said))) return { error: "kubectl isn't there (not on the app's PATH)" };

    return { error: said.replace(/^error:\s*/i, "") || `kubectl exited ${r.code}` };
  }

  const lines = r.stdout.split("\n");
  const keys = keysOf(s);
  const values = keys.map((_k, i) => decoded(lines[i]));
  const bad = keys.find((_k, i) => values[i] === null);

  if (bad) return { error: `the secret's ${bad} isn't text` };

  const [password = "", ...rest] = values.map((x) => x ?? "");

  if (!password) return { error: `the secret ${s.name} has no ${s.key}` };

  const out: ReadDraft = { password };
  let i = 0;

  if (s.userKey) {
    const u = rest[i++];

    if (u) out.user = u;
  }

  if (s.databaseKey) {
    const d = rest[i];

    if (d) out.database = d;
  }

  return out;
}

/** exec, as the read takes it (herdr's; a test's stand-in). */
export type KubeExec = (cmd: string, args: string[], options?: { timeout?: number }) => Promise<ExecResult>;

/** Reads the source (one kubectl call): the values into the caller's memory, or why not. */
export async function readKube(exec: KubeExec, s: KubeSource): Promise<KubeRead | { readonly error: string }> {
  const { program, args } = kubeReadArgs(s);

  try {
    return parseKubeRead(s, await exec(program, args, { timeout: 15000 }));
  } catch (error) {
    const said = error instanceof Error ? error.message : String(error);

    return { error: /not found|no such file|ENOENT/i.test(said) ? "kubectl isn't there (not on the app's PATH)" : said };
  }
}
