//! HERDR: `TextEncoder` and `TextDecoder`, UTF-8, over the Buffer the
//! standard runtime already installs.
//!
//! Libraries build one at module load (Effect does, for its random seeds
//! and HTTP bodies): without them such a library can't load at all. UTF-8
//! is the one encoding: `new TextDecoder("latin1")` throws a RangeError
//! naming it, rather than decoding wrongly.

use rquickjs::{Ctx, Result};

const ENCODING: &str = r#"
(() => {
  const g = globalThis;
  const Buf = g.Buffer;
  const utf8 = (label) => {
    const l = String(label).trim().toLowerCase();
    if (l !== "utf-8" && l !== "utf8" && l !== "unicode-1-1-utf-8") {
      throw new RangeError(`TextDecoder: only UTF-8 is supported here, not "${label}"`);
    }
  };
  class TextEncoder {
    get encoding() { return "utf-8"; }
    encode(input = "") {
      const b = Buf.from(String(input), "utf8");
      return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    }
    encodeInto(input, dest) {
      const text = String(input);
      const bytes = this.encode(text);
      let written = 0, read = 0;
      for (const ch of text) {
        const size = Buf.byteLength(ch, "utf8");
        if (written + size > dest.length) break;
        dest.set(bytes.subarray(written, written + size), written);
        written += size;
        read += ch.length;
      }
      return { read, written };
    }
  }
  class TextDecoder {
    #fatal;
    #ignoreBOM;
    constructor(label = "utf-8", options = {}) {
      utf8(label);
      this.#fatal = Boolean(options.fatal);
      this.#ignoreBOM = Boolean(options.ignoreBOM);
    }
    get encoding() { return "utf-8"; }
    get fatal() { return this.#fatal; }
    get ignoreBOM() { return this.#ignoreBOM; }
    decode(input) {
      if (input === undefined || input === null) return "";
      const view = ArrayBuffer.isView(input)
        ? Buf.from(input.buffer, input.byteOffset, input.byteLength)
        : Buf.from(input);
      const text = view.toString("utf8");
      if (this.#fatal && text.includes("�") && !Buf.from(text, "utf8").equals(view)) {
        throw new TypeError("TextDecoder: the input is not valid UTF-8");
      }
      return !this.#ignoreBOM && text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    }
  }
  for (const [name, value] of [["TextEncoder", TextEncoder], ["TextDecoder", TextDecoder]]) {
    if (typeof g[name] === "undefined") {
      Object.defineProperty(g, name, { value, writable: true, configurable: true, enumerable: false });
    }
  }
})();
"#;

pub(super) fn install(ctx: &Ctx<'_>) -> Result<()> {
    ctx.eval::<(), _>(ENCODING)
}
