// The web types Effect's declarations name, for the mods' lib (ES2022, no
// DOM; the engine's own globals, TextEncoder and TextDecoder among them, are
// in gpui-kit.d.ts). Types only: the engine has none of these as values, so
// none is declared as one, and a mod can't construct them (`new AbortController()`
// doesn't type-check, as it wouldn't run). They let Effect's .d.ts files
// check; the APIs that take or give them (web streams, form data, an abort
// signal) aren't for mods.

interface AbortSignal {
  readonly aborted: boolean;
}

interface ReadableStream<R = unknown> {
  readonly locked: boolean;
  readonly __chunk?: R;
}

interface WritableStream<W = unknown> {
  readonly locked: boolean;
  readonly __chunk?: W;
}

interface TransformStream<I = unknown, O = unknown> {
  readonly readable: ReadableStream<O>;
  readonly writable: WritableStream<I>;
}

interface QueuingStrategy<T = unknown> {
  readonly highWaterMark?: number;
  readonly __chunk?: T;
}

interface Request {
  readonly url: string;
}

interface RequestInit {
  readonly method?: string;
}

interface Response {
  readonly status: number;
}

interface FormData {
  readonly __formData: true;
}

interface Blob {
  readonly size: number;
}

interface File extends Blob {
  readonly name: string;
}

interface Storage {
  readonly length: number;
}
