// Generated with gpui-kit.d.ts beside it (`just types`): the runtime's globals and
// Node-like modules, which the mods have and the bun tests take from bun instead.

declare module "buffer" {
  // HERDR: an interface and a value rather than `class extends Uint8Array`,
  // whose static `from` cannot match Uint8Array's overloads under strict.
  export interface Buffer extends Uint8Array {
    toString(encoding?: string): string;
  }
  export const Buffer: {
    prototype: Buffer;
    from(value: string | ArrayBuffer | ArrayLike<number>, encoding?: string): Buffer;
    alloc(size: number): Buffer;
  };
}
declare module "path" {
  export function join(...parts: string[]): string;
  export function resolve(...parts: string[]): string;
  export function dirname(path: string): string;
  export function basename(path: string, suffix?: string): string;
  const path: { join: typeof join; resolve: typeof resolve; dirname: typeof dirname; basename: typeof basename };
  export default path;
}
declare module "url" {
  export const URL: typeof globalThis.URL;
  export const URLSearchParams: typeof globalThis.URLSearchParams;
}
declare module "crypto" {
  export interface Hash { update(data: string | Uint8Array): Hash; digest(encoding?: string): string | import("buffer").Buffer; }
  export function createHash(algorithm: string): Hash;
  export function randomBytes(size: number): import("buffer").Buffer;
  export function randomUUID(): string;
  export const webcrypto: Crypto;
}
declare module "zlib" {
  export function deflateSync(data: string | Uint8Array): import("buffer").Buffer;
  export function inflateSync(data: Uint8Array): import("buffer").Buffer;
  export function gzipSync(data: string | Uint8Array): import("buffer").Buffer;
  export function gunzipSync(data: Uint8Array): import("buffer").Buffer;
}
interface Console {
  debug(...values: unknown[]): void;
  log(...values: unknown[]): void;
  info(...values: unknown[]): void;
  warn(...values: unknown[]): void;
  error(...values: unknown[]): void;
}
/**
 * Diagnostics. A global, as it is in every other JavaScript runtime, and the
 * only one: the shell used to export the same object a second time as
 * `gpui.log`, which bought a name and nothing else.
 *
 * Needs no capability — a script that runs may say something — and output goes
 * to `tracing` under the `gpui_shell::script` target.
 */
declare const console: Console;
declare module "console" {
  const console: Console;
  export default console;
}
declare module "process" {
  export interface CommandOutput { code: number; stdout: string; stderr: string; }
  export function run(command: string, args?: string[]): Promise<CommandOutput>;
  export function exit(code?: number): void;
  export function nextTick(callback: (...args: unknown[]) => void, ...args: unknown[]): void;
  export const platform: string;
  export const arch: string;
  const process: { run: typeof run; exit: typeof exit; nextTick: typeof nextTick; platform: string; arch: string };
  export default process;
}
declare module "os" {
  export function platform(): string;
  export function arch(): string;
  export const EOL: string;
  const os: { platform: typeof platform; arch: typeof arch; EOL: string };
  export default os;
}
declare module "fs/promises" {
  export interface Dirent { name: string; isDirectory(): boolean; }
  export interface MakeDirectoryOptions { recursive?: boolean; }
  export function readFile(path: string): Promise<Uint8Array>;
  export function readFile(path: string, encoding: "utf8" | { encoding: "utf8" }): Promise<string>;
  export function writeFile(path: string, contents: string | Uint8Array): Promise<void>;
  export function readdir(path: string): Promise<string[]>;
  export function readdir(path: string, options: { withFileTypes: true }): Promise<Dirent[]>;
  export function exists(path: string): Promise<boolean>;
  export function unlink(path: string): Promise<void>;
  export function rmdir(path: string): Promise<void>;
  export function mkdir(path: string, options?: MakeDirectoryOptions): Promise<void>;
}
declare module "net" {
  export interface Socket {
    write(data: string): Promise<void>;
    /** Reads raw bytes. Resolves to null after the peer reaches EOF. */
    read(maxBytes?: number): Promise<Uint8Array | null>;
    close(): void;
  }
  export function connect(host: string, port: number): Promise<Socket>;
  const net: { connect: typeof connect };
  export default net;
}
declare module "websocket" {
  export interface WebSocketSocket {
    /** Waits for the next text or binary message. */
    read(): Promise<string | Uint8Array>;
    /** Sends a text or binary message. */
    write(data: string | Uint8Array): Promise<void>;
    /** Sends and flushes a close frame. */
    close(): Promise<void>;
  }
  export interface WebSocketConnectOptions {
    /** Additional protocol headers. Credential and WebSocket control headers are refused. */
    headers?: Readonly<Record<string, string>>;
  }
  export interface WebSocketType {
    connect(url: string, options?: WebSocketConnectOptions): Promise<WebSocketSocket>;
  }
  /** Capability-gated client sockets; not the browser global constructor. */
  export const WebSocket: WebSocketType;
}
interface ShellFetchResponse {
  readonly status: number;
  readonly ok: boolean;
  readonly url: string;
  text(): Promise<string>;
  json(): Promise<unknown>;
}
interface ShellFetchOptions {
  /**
   * GET by default. Any HTTP method may be named; which of them may reach a
   * given host and path is the plugin's `capabilities.network` policy, not
   * this field.
   */
  method?: string;
  /** Client-managed framing headers such as Host and Content-Length are refused. */
  headers?: Record<string, string>;
  body?: string | Uint8Array;
}
declare function fetch(url: string, options?: ShellFetchOptions): Promise<ShellFetchResponse>;
declare const process: typeof import("process").default;
// HERDR: the web globals the engine installs (LLRT's Buffer, URL and crypto),
// which `lib: ["ES2022"]` leaves out. Not declared, because the engine has
// none of them: setTimeout and setInterval (stubs that throw: use cx.timer),
// TextDecoder, TextEncoder, structuredClone.
declare function atob(data: string): string;
declare function btoa(data: string): string;
declare function queueMicrotask(callback: () => void): void;
type Buffer = import("buffer").Buffer;
declare const Buffer: typeof import("buffer").Buffer;
interface URLSearchParams {
  readonly size: number;
  append(name: string, value: string): void;
  delete(name: string, value?: string): void;
  get(name: string): string | null;
  getAll(name: string): string[];
  has(name: string, value?: string): boolean;
  set(name: string, value: string): void;
  sort(): void;
  toString(): string;
  forEach(callback: (value: string, key: string, parent: URLSearchParams) => void): void;
  keys(): IterableIterator<string>;
  values(): IterableIterator<string>;
  entries(): IterableIterator<[string, string]>;
  [Symbol.iterator](): IterableIterator<[string, string]>;
}
declare var URLSearchParams: {
  prototype: URLSearchParams;
  new (init?: string | Record<string, string> | [string, string][] | URLSearchParams): URLSearchParams;
};
interface URL {
  hash: string;
  host: string;
  hostname: string;
  href: string;
  readonly origin: string;
  password: string;
  pathname: string;
  port: string;
  protocol: string;
  search: string;
  readonly searchParams: URLSearchParams;
  username: string;
  toString(): string;
  toJSON(): string;
}
declare var URL: { prototype: URL; new (url: string | URL, base?: string | URL): URL };
interface Crypto {
  getRandomValues<T extends Uint8Array | Uint16Array | Uint32Array | Int8Array | Int16Array | Int32Array>(array: T): T;
  randomUUID(): string;
  readonly subtle: unknown;
}
declare const crypto: Crypto;


/**
 * The window the script is drawing into. A global: nothing to import, and
 * unlike `cx`, nothing hands it to you.
 *
 * Ambient: every call reads the host call that is running now, and throws
 * outside one. There is no handle to hold, so there is nothing to hold past the
 * call that would have made it stale.
 *
 * An overlay belongs to the window rather than to the view that opened it —
 * `cx.notify()` re-renders this view, `window.open_dialog()` changes what the
 * user is looking at — which is why these are here and not on `Context`.
 */
type GpuiShellWindow = import("gpui-kit").Window;
interface Window extends GpuiShellWindow {}
declare var window: Window & typeof globalThis;

/**
 * `window.localStorage`, reachable bare as it is in a browser, where `window`
 * *is* the global object. Here `window` is an ordinary object, so both
 * spellings are installed rather than one falling out of the other.
 */
declare const localStorage: import("gpui-kit").Storage;
/** `window.sessionStorage`, bare, for the same reason. */
declare const sessionStorage: import("gpui-kit").Storage;
