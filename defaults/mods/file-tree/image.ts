// The preview's pictures, as plain functions (no app calls), so
// scripts/preview.test.ts can check them: what a file's first bytes
// say it is and how big, whether the app draws it or it needs converting
// first, and the zoom and pan arithmetic.

import { KINDS, extension } from "./kinds.ts";

/** A picture's format. */
export type Format = "png" | "jpeg" | "gif" | "webp" | "bmp" | "tiff" | "ico" | "svg" | "avif" | "heic";

/** A width and a height (px). */
export interface Size {
  readonly width: number;
  readonly height: number;
}

/** What a picture's first bytes say: its format and size as shown (a JPEG's
 *  EXIF orientation turning it on its side swaps them; 0 when the bytes read
 *  don't reach them), its EXIF orientation (1-8, when not 1), whether it moves. */
export interface Picture extends Size {
  readonly format: Format;
  readonly orientation?: number;
  readonly animated?: true;
  readonly frames?: number;
}

/** A converter: the program, and its argv (`$IN` / `$OUT` / `$OUTDIR` stand for the paths). */
export interface Converter {
  readonly tool: string;
  readonly argv: readonly string[];
}

/** How a format gets on screen here (plan()). */
export type Plan =
  /** The app draws it. */
  | { readonly kind: "native" }
  /** A PNG copy made by the first tool found. */
  | { readonly kind: "convert"; readonly tools: readonly Converter[] }
  /** Nothing here can show it. */
  | { readonly kind: "none" };

/** A view of a picture. `scale`: screen px per image px; `x` / `y`: the
 *  picture's centre from the viewport's centre, in screen px; `rot`: quarter
 *  turns clockwise. `fit` follows the pane's size until zoomed or panned. */
export interface View {
  readonly fit: boolean;
  readonly scale: number;
  readonly x: number;
  readonly y: number;
  readonly rot: number;
}

/** A point in the viewport (px from its top left). */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Where the picture's box goes in the viewport (screen px). */
export interface Placed extends Size {
  readonly left: number;
  readonly top: number;
}

/** Extensions of pictures (kinds.ts KINDS.image). */
export const IMAGE_EXT = KINDS.image;

/** The format each picture extension names. */
const EXT_FORMAT: ReadonlyMap<string, Format> = new Map<string, Format>([
  ["png", "png"], ["jpg", "jpeg"], ["jpeg", "jpeg"], ["gif", "gif"], ["webp", "webp"], ["bmp", "bmp"], ["tif", "tiff"], ["tiff", "tiff"],
  ["ico", "ico"], ["svg", "svg"], ["avif", "avif"], ["heic", "heic"], ["heif", "heic"],
]);

/** Whether a path names a picture. */
export const isImage = (path: string | null | undefined): boolean => IMAGE_EXT.includes(extension(path));

/** The format a path's extension claims: png, jpeg, gif, webp, bmp, tiff, ico, svg, avif, heic. */
export function formatOf(path: string | null | undefined): Format | null {
  return EXT_FORMAT.get(extension(path)) ?? null;
}

/** `od -An -v -tx1` output -> bytes. */
export function hexBytes(text: string | null | undefined): number[] {
  const out: number[] = [];

  for (const h of (text ?? "").split(/\s+/)) if (h) out.push(parseInt(h, 16));

  return out;
}

type Bytes = readonly number[];

/** Byte `i` (0 past the end). */
const at = (b: Bytes, i: number): number => b[i] ?? 0;
const ascii = (b: Bytes, from: number, n: number): string => String.fromCharCode(...b.slice(from, from + n));
const be16 = (b: Bytes, i: number): number => (at(b, i) << 8) | at(b, i + 1);
const be32 = (b: Bytes, i: number): number => ((at(b, i) << 24) >>> 0) + (at(b, i + 1) << 16) + (at(b, i + 2) << 8) + at(b, i + 3);
const le16 = (b: Bytes, i: number): number => at(b, i) | (at(b, i + 1) << 8);
const le32 = (b: Bytes, i: number): number => (at(b, i) | (at(b, i + 1) << 8) | (at(b, i + 2) << 16)) + at(b, i + 3) * 0x1000000;
const le24 = (b: Bytes, i: number): number => at(b, i) | (at(b, i + 1) << 8) | (at(b, i + 2) << 16);
const le32s = (b: Bytes, i: number): number => le32(b, i) | 0;

function findAscii(b: Bytes, s: string, from: number, to: number): number {
  const codes = [...s].map((c) => c.charCodeAt(0));

  for (let i = from; i + codes.length <= to; i++) if (codes.every((c, j) => b[i + j] === c)) return i;

  return -1;
}

/** GIF image descriptors counted through the blocks read (stops at the first truncated one). */
function gifFrames(b: Bytes): number {
  let i = 13;
  let frames = 0;

  if (at(b, 10) & 0x80) i += 3 * (1 << ((at(b, 10) & 7) + 1));

  const skipBlocks = (): void => {
    while (i < b.length && b[i] !== 0) i += at(b, i) + 1;

    i += 1;
  };

  while (i < b.length && frames < 1000) {
    if (b[i] === 0x21) {
      i += 2;
      skipBlocks();
    } else if (b[i] === 0x2c) {
      frames++;

      const packed = at(b, i + 9);

      i += 10;

      if (packed & 0x80) i += 3 * (1 << ((packed & 7) + 1));

      i += 1;
      skipBlocks();
    } else break;
  }

  return frames;
}

/** A TIFF structure's 16 and 32 bit readers, in its byte order. */
function readers(b: Bytes, little: boolean): readonly [u16: (i: number) => number, u32: (i: number) => number] {
  return [(i) => (little ? le16(b, i) : be16(b, i)), (i) => (little ? le32(b, i) : be32(b, i))];
}

/** The Orientation tag (0x0112) of the TIFF structure at `t`. */
function exifOrientation(b: Bytes, t: number): number | null {
  const [u16, u32] = readers(b, b[t] === 0x49);
  const ifd = t + u32(t + 4);

  for (let k = 0, n = u16(ifd); k < n && ifd + 2 + k * 12 + 10 <= b.length; k++) {
    const e = ifd + 2 + k * 12;

    if (u16(e) === 0x0112) {
      const v = u16(e + 8);

      return v >= 1 && v <= 8 ? v : null;
    }
  }

  return null;
}

function jpeg(b: Bytes): Picture {
  let i = 2;
  let orientation = 1;

  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i++;

      continue;
    }

    const marker = at(b, i + 1);

    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;

      continue;
    }

    const len = be16(b, i + 2);

    if (marker === 0xe1 && ascii(b, i + 4, 4) === "Exif") orientation = exifOrientation(b, i + 10) ?? orientation;

    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      const height = be16(b, i + 5);
      const width = be16(b, i + 7);
      const turnedOver = orientation >= 5;
      const size = { format: "jpeg", width: turnedOver ? height : width, height: turnedOver ? width : height } as const;

      return orientation !== 1 ? { ...size, orientation } : size;
    }

    i += 2 + len;
  }

  return { format: "jpeg", width: 0, height: 0 };
}

function tiff(b: Bytes): Picture {
  const [u16, u32] = readers(b, b[0] === 0x49);
  const ifd = u32(4);
  let width = 0;
  let height = 0;

  for (let k = 0, n = ifd + 2 <= b.length ? u16(ifd) : 0; k < n && ifd + 2 + k * 12 + 12 <= b.length; k++) {
    const e = ifd + 2 + k * 12;
    const tag = u16(e);
    const v = u16(e + 2) === 3 ? u16(e + 8) : u32(e + 8);

    if (tag === 256) width = v;
    else if (tag === 257) height = v;
  }

  return { format: "tiff", width, height };
}

function webp(b: Bytes): Picture {
  const chunk = ascii(b, 12, 4);

  if (chunk === "VP8X") {
    const size = { format: "webp", width: le24(b, 24) + 1, height: le24(b, 27) + 1 } as const;

    return at(b, 20) & 0x02 ? { ...size, animated: true } : size;
  }

  if (chunk === "VP8L") {
    const bits = le32(b, 21);

    return { format: "webp", width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }

  if (chunk === "VP8 ") return { format: "webp", width: le16(b, 26) & 0x3fff, height: le16(b, 28) & 0x3fff };

  return { format: "webp", width: 0, height: 0 };
}

/** ICO: the largest picture inside (0 means 256). */
function ico(b: Bytes): Picture {
  let width = 0;
  let height = 0;

  for (let i = 0, n = le16(b, 4); i < n && 6 + i * 16 + 2 <= b.length; i++) {
    const w = at(b, 6 + i * 16) || 256;
    const h = at(b, 7 + i * 16) || 256;

    if (w * h > width * height) {
      width = w;
      height = h;
    }
  }

  return { format: "ico", width, height };
}

/** AVIF and HEIF: the brand says which; the first image's spatial extent (`ispe`) its size. */
function heif(b: Bytes): Picture | null {
  const brands = ascii(b, 8, Math.min(be32(b, 0), 64) - 8);
  const format = /avi[fs]/.test(brands) ? "avif" : /hei[cxms]|hev[cx]|mif1|msf1/.test(brands) ? "heic" : null;

  if (!format) return null;

  // version/flags, then width and height.
  const box = findAscii(b, "ispe", 8, b.length);
  const known = box >= 0 && box + 16 <= b.length;

  return { format, width: known ? be32(b, box + 8) : 0, height: known ? be32(b, box + 12) : 0 };
}

/** What a file's first bytes say (see Picture), or null when they name no picture. */
export function sniff(b: Bytes | null | undefined): Picture | null {
  if (!b || b.length < 4) return null;

  // PNG: the IHDR chunk; an acTL chunk before the pictures makes it animated (APNG).
  if (b[0] === 0x89 && ascii(b, 1, 3) === "PNG") {
    const actl = findAscii(b, "acTL", 8, Math.min(b.length, 4096));
    const size = { format: "png", width: b.length >= 24 ? be32(b, 16) : 0, height: b.length >= 24 ? be32(b, 20) : 0 } as const;

    return actl >= 0 && actl < findAscii(b, "IDAT", 8, b.length) ? { ...size, animated: true } : size;
  }

  if (ascii(b, 0, 4) === "GIF8") {
    const frames = gifFrames(b);
    const size = { format: "gif", width: le16(b, 6), height: le16(b, 8) } as const;

    return frames > 1 ? { ...size, animated: true, frames } : size;
  }

  if (b[0] === 0xff && b[1] === 0xd8) return jpeg(b);

  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return webp(b);

  if (b[0] === 0x42 && b[1] === 0x4d && b.length >= 26) return { format: "bmp", width: Math.abs(le32s(b, 18)), height: Math.abs(le32s(b, 22)) };

  if ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 42 && b[3] === 0) || (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0 && b[3] === 42)) return tiff(b);

  if (b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0 && b.length >= 8) return ico(b);

  if (ascii(b, 4, 4) === "ftyp") return heif(b);

  const text = ascii(b, 0, Math.min(b.length, 4096)).replace(/^﻿/, "");

  if (/^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*|<!DOCTYPE[^>]*>\s*)*<svg[\s>]/i.test(text)) return { format: "svg", ...svgSize(text) };

  return null;
}

/** CSS px per unit. */
const UNITS: ReadonlyMap<string, number> = new Map([["px", 1], ["pt", 4 / 3], ["pc", 16], ["in", 96], ["cm", 96 / 2.54], ["mm", 96 / 25.4], ["", 1]]);

/** An SVG's size: width / height attributes (absolute units), else its viewBox, else 300×150. */
export function svgSize(text: string | null | undefined): Size {
  const tag = /<svg\b[^>]*>/i.exec(text ?? "")?.[0] ?? "";

  const len = (name: string): number | null => {
    const m = new RegExp(`\\s${name}\\s*=\\s*["']\\s*([\\d.]+)\\s*(px|pt|pc|in|cm|mm|)\\s*["']`, "i").exec(tag);

    return m ? Number(m[1]) * (UNITS.get((m[2] ?? "").toLowerCase()) ?? 1) : null;
  };

  const box = /\sviewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*["']/i.exec(tag);
  const bw = box ? Number(box[1]) : null;
  const bh = box ? Number(box[2]) : null;
  const w = len("width");
  const h = len("height");
  let width: number;
  let height: number;

  if (w === null && h === null) {
    width = bw ?? 300;
    height = bh ?? 150;
  } else if (w === null) {
    height = h ?? 150;
    width = bw && bh ? (height * bw) / bh : 300;
  } else {
    width = w;
    height = h ?? (bw && bh ? (width * bh) / bw : 150);
  }

  return { width: Math.round(width), height: Math.round(height) };
}

/** The size `file -b` reports ("PNG image data, 480 x 320, ...", "TIFF ... height=200,
 *  ... width=300"): for a file whose first bytes don't say (a TIFF keeping its
 *  directory at the end). */
export function sizeFromFile(text: string | null | undefined): Size | null {
  const t = text ?? "";
  const w = /\bwidth=(\d+)/.exec(t);
  const h = /\bheight=(\d+)/.exec(t);

  if (w && h) return { width: Number(w[1]), height: Number(h[1]) };

  const m = /\b(\d+)\s*x\s*(\d+)\b/.exec(t);

  return m ? { width: Number(m[1]), height: Number(m[2]) } : null;
}

/** Formats the app draws as they are (GPUI's image loader; animated GIF / WebP play). */
export const NATIVE: readonly Format[] = ["png", "jpeg", "gif", "webp", "bmp", "tiff", "ico", "svg"];

/** How a format gets on screen on `platform` (see Plan). */
export function plan(format: Format | null, platform: string): Plan {
  if (format && NATIVE.includes(format)) return { kind: "native" };

  if (format !== "heic" && format !== "avif") return { kind: "none" };

  const tools: Converter[] = [];

  if (platform === "macos") {
    tools.push({ tool: "sips", argv: ["sips", "-s", "format", "png", "$IN", "--out", "$OUT"] });
    tools.push({ tool: "qlmanage", argv: ["qlmanage", "-t", "-s", "4096", "-o", "$OUTDIR", "$IN"] });
  } else if (platform === "linux") {
    tools.push({ tool: "heif-convert", argv: ["heif-convert", "$IN", "$OUT"] });

    if (format === "avif") tools.push({ tool: "avifdec", argv: ["avifdec", "$IN", "$OUT"] });

    tools.push({ tool: "magick", argv: ["magick", "$IN[0]", "$OUT"] });
    tools.push({ tool: "convert", argv: ["convert", "$IN[0]", "$OUT"] });
    tools.push({ tool: "ffmpeg", argv: ["ffmpeg", "-loglevel", "error", "-y", "-i", "$IN", "-frames:v", "1", "$OUT"] });
  }

  return tools.length ? { kind: "convert", tools } : { kind: "none" };
}

/** What can't show `format` says, for the person. */
export function cantShow(format: Format | null, platform: string): string {
  const name = (format ?? "this format").toUpperCase();

  if (platform === "linux") return `${name} needs a converter: install libheif (heif-convert) or ImageMagick`;

  return `Nothing on this computer converts ${name}`;
}

// ---- zoom and pan

export const STEPS: readonly number[] = [0.02, 0.05, 0.1, 0.125, 0.25, 1 / 3, 0.5, 2 / 3, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32];
export const MIN_SCALE = 0.02;
export const MAX_SCALE = 32;

/** Room left around a fitted picture, each side. */
export const PAD = 16;

/** The picture's size on its side or not. */
export const turned = (img: Size, rot: number): Size => (rot % 2 ? { width: img.height, height: img.width } : { width: img.width, height: img.height });

const clampScale = (s: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

/** The scale that shows the whole picture in the viewport: never above 100% for
 *  pixels (a 16 px icon stays crisp), any size for a vector. */
export function fitScale(img: Size, port: Size, rot = 0, vector = false): number {
  const { width, height } = turned(img, rot);

  if (!width || !height || !port.width || !port.height) return 1;

  const s = Math.min(Math.max(1, port.width - 2 * PAD) / width, Math.max(1, port.height - 2 * PAD) / height);

  return clampScale(vector ? s : Math.min(1, s));
}

export const fitted = (img: Size, port: Size, rot = 0, vector = false): View => ({ fit: true, scale: fitScale(img, port, rot, vector), x: 0, y: 0, rot });

/** Pan kept in bounds: a side smaller than the viewport stays centred, a larger
 *  one can't leave a gap at its edges. */
export function clampPan(view: View, img: Size, port: Size): View {
  const { width, height } = turned(img, view.rot);

  const lim = (size: number, room: number, v: number): number => {
    const slack = Math.max(0, (size * view.scale - room) / 2);

    return Math.max(-slack, Math.min(slack, v)) || 0;
  };

  return { ...view, x: lim(width, port.width, view.x), y: lim(height, port.height, view.y) };
}

/** Zoomed to `scale`, keeping the picture's point under `point` (viewport px from its
 *  top left; default the centre) where it is. */
export function zoomTo(view: View, scale: number, img: Size, port: Size, point?: Point | null): View {
  const s = clampScale(scale);
  const ax = (point?.x ?? port.width / 2) - port.width / 2;
  const ay = (point?.y ?? port.height / 2) - port.height / 2;
  const k = s / view.scale;

  return clampPan({ ...view, fit: false, scale: s, x: ax - (ax - view.x) * k, y: ay - (ay - view.y) * k }, img, port);
}

/** The next zoom step in (`dir` 1) or out (-1) from the current scale. */
export function step(scale: number, dir: number): number {
  if (dir > 0) return STEPS.find((s) => s > scale * 1.001) ?? MAX_SCALE;

  return [...STEPS].reverse().find((s) => s < scale / 1.001) ?? MIN_SCALE;
}

export const panBy = (view: View, dx: number, dy: number, img: Size, port: Size): View => clampPan({ ...view, fit: false, x: view.x + dx, y: view.y + dy }, img, port);

/** A quarter turn clockwise (`dir` 1) or back: fitted again if it was. */
export function rotate(view: View, dir: number, img: Size, port: Size, vector = false): View {
  const rot = (((view.rot + dir) % 4) + 4) % 4;

  return view.fit ? fitted(img, port, rot, vector) : clampPan({ ...view, rot, x: 0, y: 0 }, img, port);
}

/** Where the picture's box goes in the viewport. */
export function placed(view: View, img: Size, port: Size): Placed {
  const { width, height } = turned(img, view.rot);
  const w = width * view.scale;
  const h = height * view.scale;

  return { left: port.width / 2 + view.x - w / 2, top: port.height / 2 + view.y - h / 2, width: w, height: h };
}

/** "42%", "100%", "1 600%". */
export const percent = (scale: number): string => `${Math.round(scale * 100)}%`;

/** EXIF orientations 1-8 as (quarter turns, mirrored first). */
const ORIENTATIONS: readonly (readonly [quarters: number, flip: boolean])[] = [[0, false], [0, false], [0, true], [2, false], [2, true], [1, true], [1, false], [3, true], [3, false]];

/** The SVG that draws a cached picture `href` (absolute) turned `rot` quarter turns
 *  (plus its EXIF `orientation`, which the SVG renderer doesn't apply) at `k` times its
 *  size: how a vector stays sharp when zoomed in, and how any picture turns. `img`
 *  is its size as stored (before orientation). */
export function wrapper(href: string, img: Size, rot: number, k: number, orientation = 1): string {
  const W = img.width;
  const H = img.height;
  const [q0, flip] = ORIENTATIONS[orientation] ?? [0, false];
  const q = (q0 + rot) % 4;
  const ow = q % 2 ? H : W;
  const oh = q % 2 ? W : H;
  const move = [`translate(${ow / 2} ${oh / 2})`, `rotate(${q * 90})`, flip ? "scale(-1 1)" : "", `translate(${-W / 2} ${-H / 2})`].filter(Boolean).join(" ");
  const esc = href.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${Math.round(ow * k)}" height="${Math.round(oh * k)}" viewBox="0 0 ${ow} ${oh}">`
    + `<g transform="${move}"><image width="${W}" height="${H}" preserveAspectRatio="none" xlink:href="${esc}" href="${esc}"/></g></svg>`;
}

/** How many times its size a vector is drawn for `scale` on a `dpr` screen: the
 *  next power of two, at most `max` px on its long side. */
export function sharpness(img: Size, scale: number, dpr: number, max = 8192): number {
  const want = Math.max(1, scale * dpr);
  let k = 1;

  while (k < want) k *= 2;

  const long = Math.max(img.width, img.height, 1);

  while (k > 1 && long * k > max) k /= 2;

  return Math.max(k, Math.min(1, max / long));
}
