// The image viewer's decisions, as plain functions (no app calls), so
// scripts/nocturne-image.test.ts can check them: which files are pictures,
// what a file's first bytes say it is and how big, whether the app draws it
// or it needs converting first, the folder's order for next / previous, and
// the zoom and pan arithmetic.

/** Extensions the viewer opens (the app's links::Viewer::Image list). */
export const IMAGE_EXT = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "tif", "tiff", "ico", "svg", "avif", "heic", "heif"];
const EXT_FORMAT = { jpg: "jpeg", tif: "tiff", heif: "heic" };

/** The lower-case extension of a path ("" without one). */
export function extension(path) {
  const name = String(path ?? "").split("/").pop();
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** Whether a path names a picture the viewer opens. */
export const isImage = (path) => IMAGE_EXT.includes(extension(path));

/** The format a path's extension claims: png, jpeg, gif, webp, bmp, tiff, ico, svg, avif, heic. */
export function formatOf(path) {
  const ext = extension(path);
  return IMAGE_EXT.includes(ext) ? EXT_FORMAT[ext] ?? ext : null;
}

/** `od -An -v -tx1` output -> bytes. */
export function hexBytes(text) {
  const out = [];
  for (const h of String(text ?? "").split(/\s+/)) if (h) out.push(parseInt(h, 16));
  return out;
}

const ascii = (b, at, n) => String.fromCharCode(...b.slice(at, at + n));
const be16 = (b, i) => (b[i] << 8) | b[i + 1];
const be32 = (b, i) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
const le16 = (b, i) => b[i] | (b[i + 1] << 8);
const le32 = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16)) + b[i + 3] * 0x1000000;
const le24 = (b, i) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);

/** What a file's first bytes say: { format, width, height, orientation?, animated? }, or
 *  null when they name no picture. width / height are as shown (a JPEG's EXIF
 *  orientation turning it on its side swaps them); 0 when the bytes read don't reach them. */
export function sniff(b) {
  if (!b || b.length < 4) return null;
  // PNG: the IHDR chunk; an acTL chunk before the pictures makes it animated (APNG).
  if (b[0] === 0x89 && ascii(b, 1, 3) === "PNG") {
    const animated = findAscii(b, "acTL", 8, Math.min(b.length, 4096)) >= 0 && findAscii(b, "acTL", 8, Math.min(b.length, 4096)) < findAscii(b, "IDAT", 8, b.length);
    return { format: "png", width: b.length >= 24 ? be32(b, 16) : 0, height: b.length >= 24 ? be32(b, 20) : 0, ...(animated ? { animated: true } : {}) };
  }
  if (ascii(b, 0, 4) === "GIF8") {
    const frames = gifFrames(b);
    return { format: "gif", width: le16(b, 6), height: le16(b, 8), ...(frames > 1 ? { animated: true, frames } : {}) };
  }
  if (b[0] === 0xff && b[1] === 0xd8) return jpeg(b);
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return webp(b);
  if (b[0] === 0x42 && b[1] === 0x4d && b.length >= 26) return { format: "bmp", width: Math.abs(le32s(b, 18)), height: Math.abs(le32s(b, 22)) };
  if ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 42 && b[3] === 0) || (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0 && b[3] === 42)) return tiff(b);
  if (b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0 && b.length >= 8) {
    // ICO: the largest picture inside (0 means 256).
    let width = 0, height = 0;
    for (let i = 0, n = le16(b, 4); i < n && 6 + i * 16 + 2 <= b.length; i++) {
      const w = b[6 + i * 16] || 256, h = b[7 + i * 16] || 256;
      if (w * h > width * height) { width = w; height = h; }
    }
    return { format: "ico", width, height };
  }
  if (ascii(b, 4, 4) === "ftyp") {
    const brands = ascii(b, 8, Math.min(be32(b, 0), 64) - 8);
    const format = /avi[fs]/.test(brands) ? "avif" : /hei[cxms]|hev[cx]|mif1|msf1/.test(brands) ? "heic" : null;
    if (!format) return null;
    // The first image's spatial extent (`ispe`): version/flags, then width and height.
    const at = findAscii(b, "ispe", 8, b.length);
    return { format, width: at >= 0 && at + 16 <= b.length ? be32(b, at + 8) : 0, height: at >= 0 && at + 16 <= b.length ? be32(b, at + 12) : 0 };
  }
  const text = ascii(b, 0, Math.min(b.length, 4096)).replace(/^﻿/, "");
  if (/^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*|<!DOCTYPE[^>]*>\s*)*<svg[\s>]/i.test(text)) return { format: "svg", ...svgSize(text) };
  return null;
}

const le32s = (b, i) => le32(b, i) | 0;

function findAscii(b, s, from, to) {
  const codes = [...s].map((c) => c.charCodeAt(0));
  for (let i = from; i + codes.length <= to; i++) if (codes.every((c, j) => b[i + j] === c)) return i;
  return -1;
}

/** GIF image descriptors counted through the blocks read (stops at the first truncated one). */
function gifFrames(b) {
  let i = 13, frames = 0;
  if (b[10] & 0x80) i += 3 * (1 << ((b[10] & 7) + 1));
  const skipBlocks = () => { while (i < b.length && b[i] !== 0) i += b[i] + 1; i += 1; };
  while (i < b.length && frames < 1000) {
    if (b[i] === 0x21) { i += 2; skipBlocks(); }
    else if (b[i] === 0x2c) {
      frames++;
      const packed = b[i + 9];
      i += 10;
      if (packed & 0x80) i += 3 * (1 << ((packed & 7) + 1));
      i += 1; skipBlocks();
    } else break;
  }
  return frames;
}

function jpeg(b) {
  let i = 2, orientation = 1;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const marker = b[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const len = be16(b, i + 2);
    if (marker === 0xe1 && ascii(b, i + 4, 4) === "Exif") orientation = exifOrientation(b, i + 10) ?? orientation;
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      const height = be16(b, i + 5), width = be16(b, i + 7);
      const turned = orientation >= 5;
      return { format: "jpeg", width: turned ? height : width, height: turned ? width : height, ...(orientation !== 1 ? { orientation } : {}) };
    }
    i += 2 + len;
  }
  return { format: "jpeg", width: 0, height: 0 };
}

/** The Orientation tag (0x0112) of the TIFF structure at `t`. */
function exifOrientation(b, t) {
  const little = b[t] === 0x49;
  const u16 = (i) => (little ? le16(b, i) : be16(b, i)), u32 = (i) => (little ? le32(b, i) : be32(b, i));
  const ifd = t + u32(t + 4);
  for (let k = 0, n = u16(ifd); k < n && ifd + 2 + k * 12 + 10 <= b.length; k++) {
    const e = ifd + 2 + k * 12;
    if (u16(e) === 0x0112) { const v = u16(e + 8); return v >= 1 && v <= 8 ? v : null; }
  }
  return null;
}

function tiff(b) {
  const little = b[0] === 0x49;
  const u16 = (i) => (little ? le16(b, i) : be16(b, i)), u32 = (i) => (little ? le32(b, i) : be32(b, i));
  const ifd = u32(4);
  let width = 0, height = 0;
  for (let k = 0, n = ifd + 2 <= b.length ? u16(ifd) : 0; k < n && ifd + 2 + k * 12 + 12 <= b.length; k++) {
    const e = ifd + 2 + k * 12, tag = u16(e), type = u16(e + 2);
    const v = type === 3 ? u16(e + 8) : u32(e + 8);
    if (tag === 256) width = v; else if (tag === 257) height = v;
  }
  return { format: "tiff", width, height };
}

function webp(b) {
  const chunk = ascii(b, 12, 4);
  if (chunk === "VP8X") {
    const animated = Boolean(b[20] & 0x02);
    return { format: "webp", width: le24(b, 24) + 1, height: le24(b, 27) + 1, ...(animated ? { animated: true } : {}) };
  }
  if (chunk === "VP8L") {
    const bits = le32(b, 21);
    return { format: "webp", width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8 ") return { format: "webp", width: le16(b, 26) & 0x3fff, height: le16(b, 28) & 0x3fff };
  return { format: "webp", width: 0, height: 0 };
}

const UNITS = { px: 1, pt: 4 / 3, pc: 16, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, "": 1 };
/** An SVG's size: width / height attributes (absolute units), else its viewBox, else 300×150. */
export function svgSize(text) {
  const tag = /<svg\b[^>]*>/i.exec(String(text ?? ""))?.[0] ?? "";
  const attr = (n) => new RegExp(`\\s${n}\\s*=\\s*["']\\s*([\\d.]+)\\s*(px|pt|pc|in|cm|mm|)\\s*["']`, "i").exec(tag);
  const box = /\sviewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*["']/i.exec(tag);
  const len = (m) => (m ? Number(m[1]) * UNITS[m[2].toLowerCase()] : null);
  let width = len(attr("width")), height = len(attr("height"));
  const bw = box ? Number(box[1]) : null, bh = box ? Number(box[2]) : null;
  if (width == null && height == null) { width = bw ?? 300; height = bh ?? 150; }
  else if (width == null) width = bw && bh ? (height * bw) / bh : 300;
  else if (height == null) height = bw && bh ? (width * bh) / bw : 150;
  return { width: Math.round(width), height: Math.round(height) };
}

/** The size `file -b` reports ("PNG image data, 480 x 320, ...", "TIFF ... height=200,
 *  ... width=300"): for a file whose first bytes don't say (a TIFF keeping its
 *  directory at the end). */
export function sizeFromFile(text) {
  const t = String(text ?? "");
  const w = /\bwidth=(\d+)/.exec(t), h = /\bheight=(\d+)/.exec(t);
  if (w && h) return { width: Number(w[1]), height: Number(h[1]) };
  const m = /\b(\d+)\s*x\s*(\d+)\b/.exec(t);
  return m ? { width: Number(m[1]), height: Number(m[2]) } : null;
}

/** Formats the app draws as they are (GPUI's image loader; animated GIF / WebP play). */
export const NATIVE = ["png", "jpeg", "gif", "webp", "bmp", "tiff", "ico", "svg"];

/** How a format gets on screen here:
 *  { kind: "native" }                          the app draws it
 *  { kind: "convert", tools: [{ tool, argv }] } a PNG copy made by the first tool found
 *                                              (argv: `$IN` / `$OUT` / `$OUTDIR` stand for the paths)
 *  { kind: "none" }                            nothing here can show it */
export function plan(format, platform) {
  if (NATIVE.includes(format)) return { kind: "native" };
  if (format !== "heic" && format !== "avif") return { kind: "none" };
  const tools = [];
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
export function cantShow(format, platform) {
  const name = String(format ?? "this format").toUpperCase();
  if (platform === "linux") return `${name} needs a converter: install libheif (heif-convert) or ImageMagick`;
  return `Nothing on this computer converts ${name}`;
}

/** Names in a folder, the pictures among them in the order a person reads them
 *  (case-insensitive, numbers by value: shot-2 before shot-10), hidden ones out
 *  unless `current` is hidden. */
export function siblings(names, current) {
  const hidden = String(current ?? "").startsWith(".");
  return [...new Set(names)].filter((n) => n && isImage(n) && (hidden || !n.startsWith(".")))
    .sort((a, b) => natural(a, b) || (a < b ? -1 : a > b ? 1 : 0));
}

/** Compares names as a person reads them: case aside, runs of digits by value.
 *  (The app's script engine has no Intl.Collator.) */
export function natural(a, b) {
  const parts = (s) => String(s).toLowerCase().match(/\d+|\D+/g) ?? [];
  const x = parts(a), y = parts(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    if (x[i] === y[i]) continue;
    const dx = /^\d/.test(x[i]), dy = /^\d/.test(y[i]);
    if (dx && dy) return Number(x[i]) - Number(y[i]) || x[i].length - y[i].length;
    return x[i] < y[i] ? -1 : 1;
  }
  return x.length - y.length;
}

/** The name `step` places from `current` in `list` (wrapping around); `current`
 *  gone from the list: where it would have been. */
export function stepIn(list, current, step) {
  if (!list.length) return null;
  let i = list.indexOf(current);
  if (i < 0) {
    const after = list.findIndex((n) => natural(n, current) > 0);
    i = (after < 0 ? list.length : after) - (step > 0 ? 1 : 0);
  }
  return list[(((i + step) % list.length) + list.length) % list.length];
}

// ---- zoom and pan
// A view: { fit, scale, x, y, rot }. scale: screen px per image px; x / y: the
// picture's centre from the viewport's centre, in screen px; rot: quarter
// turns clockwise. `fit` follows the pane's size until zoomed or panned.

export const STEPS = [0.02, 0.05, 0.1, 0.125, 0.25, 1 / 3, 0.5, 2 / 3, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32];
export const MIN_SCALE = STEPS[0], MAX_SCALE = STEPS[STEPS.length - 1];
/** Room left around a fitted picture, each side. */
export const PAD = 16;

/** The picture's size on its side or not. */
export const turned = (img, rot) => (rot % 2 ? { width: img.height, height: img.width } : { width: img.width, height: img.height });

/** The scale that shows the whole picture in the viewport: never above 100% for
 *  pixels (a 16 px icon stays crisp), any size for a vector. */
export function fitScale(img, port, rot = 0, vector = false) {
  const { width, height } = turned(img, rot);
  if (!width || !height || !port.width || !port.height) return 1;
  const s = Math.min(Math.max(1, port.width - 2 * PAD) / width, Math.max(1, port.height - 2 * PAD) / height);
  return clampScale(vector ? s : Math.min(1, s));
}

const clampScale = (s) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

export const fitted = (img, port, rot = 0, vector = false) => ({ fit: true, scale: fitScale(img, port, rot, vector), x: 0, y: 0, rot });

/** Pan kept in bounds: a side smaller than the viewport stays centred, a larger
 *  one can't leave a gap at its edges. */
export function clampPan(view, img, port) {
  const { width, height } = turned(img, view.rot);
  const lim = (size, room, v) => { const slack = Math.max(0, (size * view.scale - room) / 2); return Math.max(-slack, Math.min(slack, v)) || 0; };
  return { ...view, x: lim(width, port.width, view.x), y: lim(height, port.height, view.y) };
}

/** Zoomed to `scale`, keeping the picture's point under `at` (viewport px from its
 *  top left; default the centre) where it is. */
export function zoomTo(view, scale, img, port, at) {
  const s = clampScale(scale);
  const ax = (at?.x ?? port.width / 2) - port.width / 2, ay = (at?.y ?? port.height / 2) - port.height / 2;
  const k = s / view.scale;
  return clampPan({ ...view, fit: false, scale: s, x: ax - (ax - view.x) * k, y: ay - (ay - view.y) * k }, img, port);
}

/** The next zoom step in (`dir` 1) or out (-1) from the current scale. */
export function step(scale, dir) {
  if (dir > 0) return STEPS.find((s) => s > scale * 1.001) ?? MAX_SCALE;
  return [...STEPS].reverse().find((s) => s < scale / 1.001) ?? MIN_SCALE;
}

export const panBy = (view, dx, dy, img, port) => clampPan({ ...view, fit: false, x: view.x + dx, y: view.y + dy }, img, port);

/** A quarter turn clockwise (`dir` 1) or back: fitted again if it was. */
export function rotate(view, dir, img, port, vector = false) {
  const rot = (((view.rot + dir) % 4) + 4) % 4;
  return view.fit ? fitted(img, port, rot, vector) : clampPan({ ...view, rot, x: 0, y: 0 }, img, port);
}

/** Where the picture's box goes in the viewport: { left, top, width, height } in screen px. */
export function placed(view, img, port) {
  const { width, height } = turned(img, view.rot);
  const w = width * view.scale, h = height * view.scale;
  return { left: port.width / 2 + view.x - w / 2, top: port.height / 2 + view.y - h / 2, width: w, height: h };
}

/** "42%", "100%", "1 600%". */
export const percent = (scale) => `${Math.round(scale * 100)}%`;

/** "812 B", "4.2 KB", "13 MB". */
export function fileSize(bytes) {
  if (!(bytes >= 0)) return "";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let v = bytes / 1024, u = 0;
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u++; }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[u]}`;
}

/** The SVG that draws a cached picture `href` (absolute) turned `rot` quarter turns
 *  (plus its EXIF `orientation`, which the SVG renderer doesn't apply) at `k` times its
 *  size: how a vector stays sharp when zoomed in, and how any picture turns. `img`
 *  is its size as stored (before orientation). */
export function wrapper(href, img, rot, k, orientation = 1) {
  const W = img.width, H = img.height;
  // EXIF 1-8 as (quarter turns, mirrored first).
  const [q0, flip] = [[0, 0], [0, 0], [0, 1], [2, 0], [2, 1], [1, 1], [1, 0], [3, 1], [3, 0]][orientation] ?? [0, 0];
  const q = (q0 + rot) % 4;
  const ow = q % 2 ? H : W, oh = q % 2 ? W : H;
  const move = [`translate(${ow / 2} ${oh / 2})`, `rotate(${q * 90})`, flip ? "scale(-1 1)" : "", `translate(${-W / 2} ${-H / 2})`].filter(Boolean).join(" ");
  const esc = String(href).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${Math.round(ow * k)}" height="${Math.round(oh * k)}" viewBox="0 0 ${ow} ${oh}">`
    + `<g transform="${move}"><image width="${W}" height="${H}" preserveAspectRatio="none" xlink:href="${esc}" href="${esc}"/></g></svg>`;
}

/** How many times its size a vector is drawn for `scale` on a `dpr` screen: the
 *  next power of two, at most `max` px on its long side. */
export function sharpness(img, scale, dpr, max = 8192) {
  const want = Math.max(1, scale * dpr);
  let k = 1;
  while (k < want) k *= 2;
  const long = Math.max(img.width, img.height, 1);
  while (k > 1 && long * k > max) k /= 2;
  return Math.max(k, Math.min(1, max / long));
}
