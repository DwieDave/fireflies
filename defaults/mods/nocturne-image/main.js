// Nocturne Image: a picture in a pane beside where it was opened from: a link
// to an image clicked in a terminal (a screenshot an agent saved, `ls`, an OSC 8
// link), an image picked in the files pane, a link in the Markdown viewer, or
// the `image.open {path}` command. Props: { path, on?, slot }.
//
// PNG, JPEG, GIF (animated), WebP, BMP, TIFF, ICO and SVG are drawn as they are;
// HEIC / HEIF and AVIF are converted to a PNG copy first (macOS: sips, else
// qlmanage; Linux: heif-convert, avifdec, ImageMagick or ffmpeg), and with no
// converter it says so. The original is only read: what's drawn is a copy in
// the app's cache, named by its contents, so a file an agent rewrites shows
// again by itself (the folder is watched; another machine's is polled).
//
// It fits the pane until you zoom; turning (r) and SVGs at any zoom are drawn
// through a small SVG wrapper so they stay sharp. The bar: name, size, format,
// file size, the place in its folder (‹ ›), zoom (fit / 100%), turn,
// background (checker / dark), files (the folder in the files pane), open (the
// system's app), copy (the path).
// Keys while it has focus:
//   + = / -     zoom in / out        0  fit      1  100%
//   h j k l ←↓↑→  pan (when it doesn't fit; else ← → step through the folder)
//   n ] / p [   next / previous image in the folder
//   r / R       turn right / left    b  background    o  open    y  copy path
// Mouse: drag to pan, ⌘/ctrl + scroll zooms at the pointer, scroll pans,
// double-click toggles fit and 100%.
// Commands (keys.json, `herdr-app do nocturne-image.<c>`; every shown viewer
// takes them): zoom_in, zoom_out, fit, actual, next, prev, rotate, background, reload.

import { View, div, svg, image, PathBuilder, Background } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { props, theme, settings, exec, run, panes, shared, setShared, watchFolder, nextCommand, home, appHome, writeTextFile, window as appWindow } from "herdr";
import { formatOf, hexBytes, sniff, sizeFromFile, plan, cantShow, siblings, stepIn, fitted, fitScale, clampPan, zoomTo, step, panBy, rotate, placed, percent, fileSize, wrapper, sharpness, turned } from "./logic.js";

const MOD = "nocturne-image";
// Each viewer's shown file by slot: its name for the pane header
// (nocturne/header.js), its path so a second click on it finds this viewer.
const TITLES = `${MOD}.titles`, PATHS = `${MOD}.paths`;
const ART = "mods/nocturne/art";
// Copies of what's shown, under the app's folder (where image() reads).
const CACHE = `cache/${MOD}`;
// The first bytes read for the size and format.
const HEAD = 262144;
// A file on another machine: read it this often; fetched up to this size.
const POLL = 4000, REMOTE_MAX = 6 * 1024 * 1024;
// Pan steps: a key, and a key with shift.
const NUDGE = 60, SHOVE = 240;
// Formats the SVG renderer can embed when turning a picture; others get a PNG copy first.
const EMBEDS = ["png", "jpeg", "gif", "webp", "svg"];

const RECT = () => PathBuilder.fill().move_to("0%", "0%").line_to("100%", "0%").line_to("100%", "100%").line_to("0%", "100%").close().build();
const zoom = () => Number(settings()?.zoom) || 1;
const unzoom = (v) => v / zoom();
const platform = () => appWindow()?.platform ?? "linux";
const dpr = () => (platform() === "macos" ? 2 : 1);
/** A 50% checker filling the parent, `cell` px squares (as ../nocturne/kit.js dither). */
function checker(color, cell = 1) {
  return window.paint_path(RECT(), Background.checkerboard(color, Math.max(1, Math.round(cell * zoom() * dpr())))).absolute().top(0).left(0).size_full();
}
const stop = (_e, cx) => cx.stop_propagation();
const dirname = (p) => String(p).replace(/\/[^/]*$/, "") || "/";
const basename = (p) => String(p).replace(/\/+$/, "").split("/").pop() || String(p);
const tilde = (p, h) => (!p || !h ? p ?? "" : p === h ? "~" : p.startsWith(h + "/") ? "~" + p.slice(h.length) : p);
const sh = (script, args, on) => exec("sh", ["-c", script, MOD, ...args], on ? { on } : undefined).catch((e) => ({ code: -1, stdout: "", stderr: String(e?.message ?? e) }));

// One copy per contents: `<crc>-<bytes>.<ext>` (then its size line and its first bytes).
const COPY = `f="$1"; d="$2"; e="$3"; [ -f "$f" ] || exit 3; mkdir -p "$d" || exit 4
set -- $(cksum < "$f"); n="$1-$2.$e"
[ -f "$d/$n" ] || cp -c "$f" "$d/$n" 2>/dev/null || cp "$f" "$d/$n" || exit 4
printf '%s\\n%s\\n' "$n" "$2"; od -An -v -tx1 -N ${HEAD} "$d/$n"`;

export default class ImageView extends View {
  init(p, cx) {
    const pr = props() ?? p ?? {};
    this.on = pr.on ?? null;
    this.slot = pr.slot ?? null;
    this.handle = cx.focus_handle();
    this.port = { width: 0, height: 0 };
    this.checker = true;
    this.names = [];
    this.copied = 0;
    this.open(pr.path ?? "", cx);
    if (this.on) cx.timer.every(POLL, (cx) => { this.load(cx); this.list(cx); });
    // Copies nobody looked at for a week go.
    if (!this.on && pr.path) sh('[ -d "$1" ] && find "$1" -type f -mtime +7 -delete', [`${appHome()}/${CACHE}`]);
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "focus") this.handle.focus();
        else this.command(c, cx);
        cx.notify();
      }
    });
  }

  // ---- the file

  /** Shows `path`, fitted. */
  open(path, cx) {
    const sameFolder = this.path && dirname(this.path) === dirname(path);
    this.path = path;
    this.info = null; this.error = null; this.src = null; this.copy = null; this.busy = "Reading…";
    this.view = null;
    this.gen = (this.gen ?? 0) + 1;
    this.title();
    this.load(cx);
    if (!sameFolder) { this.names = []; this.list(cx); if (!this.on && path) this.watch(cx, this.gen); }
  }

  /** Copies the file into the cache (again, if it changed) and works out how to draw it. */
  load(cx) {
    const path = this.path, gen = this.gen;
    if (!path) { this.error = "No file given"; this.busy = null; return; }
    cx.spawn(async (cx) => {
      const dir = `${appHome()}/${CACHE}`;
      const ext = (formatOf(path) ?? "img").replace("jpeg", "jpg");
      let r;
      if (this.on) r = await this.fetch(path, dir, ext);
      else r = await sh(COPY, [path, dir, ext]);
      if (gen !== this.gen) return;
      if (r.code !== 0) {
        const error = r.code === 3 ? "It isn't there (moved or deleted?)" : (r.stderr || "Can't read it").trim();
        if (error !== this.error) { this.error = error; this.busy = null; cx.notify(); }
        return;
      }
      const [name, size, ...rest] = r.stdout.split("\n");
      if (this.copy?.name === name && !this.error) return; // unchanged
      const head = sniff(hexBytes(rest.join(" ")));
      const format = head?.format ?? formatOf(path);
      const info = { ...(head ?? { width: 0, height: 0 }), format, bytes: Number(size) };
      if (!head) { this.fail(cx, "Not a picture, or a damaged one", info); return; }
      if (!info.width && format !== "heic" && format !== "avif") {
        const f = await sh('file -b "$1"', [`${dir}/${name}`]);
        Object.assign(info, sizeFromFile(f.stdout) ?? {});
        if (gen !== this.gen) return;
        if (!info.width) { this.fail(cx, "Can't tell how big it is (a damaged file?)", info); return; }
      }
      const how = plan(format, platform());
      let copy = { name, abs: `${dir}/${name}`, format };
      if (how.kind === "none") { this.fail(cx, cantShow(format, platform()), info); return; }
      if (how.kind === "convert") {
        this.busy = `Converting ${format.toUpperCase()}…`; cx.notify();
        copy = await this.convert(how.tools, copy, dir);
        if (gen !== this.gen) return;
        if (!copy) { this.fail(cx, cantShow(format, platform()), info); return; }
        // The PNG's own size: the original's header may name a tile or a thumbnail.
        const png = await sh('od -An -v -tx1 -N 32 "$1"', [copy.abs]);
        const s = sniff(hexBytes(png.stdout));
        if (s?.width) { info.width = s.width; info.height = s.height; }
        delete info.orientation;
        if (!info.width) { this.fail(cx, "Can't tell how big it is (a damaged file?)", info); return; }
      }
      const resized = !this.info || this.info.width !== info.width || this.info.height !== info.height;
      this.info = info; this.copy = copy; this.error = null; this.busy = null;
      if (resized || !this.view) this.view = null; // fit again once the pane's size is known
      await this.draw(cx);
      cx.notify();
    });
  }

  fail(cx, error, info) {
    this.info = info; this.error = error; this.busy = null; this.src = null;
    cx.notify();
  }

  /** Another machine's file: its checksum there, then (once per contents) its bytes over base64. */
  async fetch(path, dir, ext) {
    const sum = await sh('[ -f "$1" ] || exit 3; cksum < "$1"', [path], this.on);
    if (sum.code !== 0) return sum;
    const [crc, bytes] = sum.stdout.trim().split(/\s+/);
    const name = `${crc}-${bytes}.${ext}`;
    const have = await sh('[ -f "$1/$2" ] && od -An -v -tx1 -N ' + HEAD + ' "$1/$2"', [dir, name]);
    if (have.code === 0) return { code: 0, stdout: `${name}\n${bytes}\n${have.stdout}` };
    if (Number(bytes) > REMOTE_MAX) return { code: 4, stdout: "", stderr: `Too large to fetch from ${this.on} (${fileSize(Number(bytes))})` };
    const data = await sh('base64 < "$1"', [path], this.on);
    if (data.code !== 0) return data;
    await sh('mkdir -p "$1"', [dir]);
    const b64 = `${dir}/${name}.b64`;
    try { await writeTextFile(b64, data.stdout, null); } catch { /* left over from before: replaced below */ }
    return sh(`base64 -d < "$1" > "$2/$3" && rm -f "$1" && printf '%s\\n%s\\n' "$3" "$4" && od -An -v -tx1 -N ${HEAD} "$2/$3"`, [b64, dir, name, bytes]);
  }

  /** A PNG copy by the first converter found; -> { name, abs, format: "png" } or null. */
  async convert(tools, copy, dir) {
    const name = copy.name.replace(/\.[^.]*$/, "") + ".png", out = `${dir}/${name}`;
    const done = { name, abs: out, format: "png" };
    if ((await sh('[ -s "$1" ]', [out])).code === 0) return done;
    for (const { tool, argv } of tools) {
      if ((await sh('command -v "$1" >/dev/null', [tool])).code !== 0) continue;
      const args = argv.map((a) => a.replace("$IN", copy.abs).replace("$OUTDIR", dir).replace("$OUT", out));
      const r = await exec(args[0], args.slice(1), { timeout: 60000 }).catch(() => null);
      // qlmanage writes `<name>.png` next to its own name.
      if (tool === "qlmanage") await sh('[ -s "$1/$2.png" ] && mv "$1/$2.png" "$3"', [dir, copy.name, out]);
      if (r && (await sh('[ -s "$1" ]', [out])).code === 0) return done;
    }
    return null;
  }

  /** What image() draws: the copy itself, or (turned, or a vector) a wrapper SVG around it. */
  async draw(cx) {
    const copy = this.copy, info = this.info, gen = this.gen;
    if (!copy || !info) return;
    // Turns come faster than wrappers are written: only the latest draw lands.
    const token = this.drawing = (this.drawing ?? 0) + 1;
    const stale = () => gen !== this.gen || token !== this.drawing;
    const rot = this.view?.rot ?? 0;
    const vector = copy.format === "svg";
    if (!rot && !vector) { this.src = `${CACHE}/${copy.name}`; this.still = false; return; }
    let inner = copy;
    if (!EMBEDS.includes(copy.format)) {
      // BMP / TIFF / ICO: the SVG renderer embeds PNGs.
      inner = await this.convert(platform() === "macos"
        ? [{ tool: "sips", argv: ["sips", "-s", "format", "png", "$IN", "--out", "$OUT"] }]
        : [{ tool: "magick", argv: ["magick", "$IN[0]", "$OUT"] }, { tool: "convert", argv: ["convert", "$IN[0]", "$OUT"] }], copy, `${appHome()}/${CACHE}`);
      if (stale()) return;
      if (!inner) { this.note = "can't turn this format here"; this.view = { ...this.view, rot: 0 }; this.src = `${CACHE}/${copy.name}`; return; }
    }
    // Stored size: an EXIF orientation that turns it on its side swaps the shown one.
    const o = info.orientation ?? 1;
    const stored = o >= 5 ? { width: info.height, height: info.width } : info;
    const k = vector ? sharpness(info, this.view?.scale ?? 1, dpr()) : 1;
    const name = `${copy.name.replace(/\.[^.]*$/, "")}-r${rot}-k${k}.svg`;
    try { await writeTextFile(`${appHome()}/${CACHE}/${name}`, wrapper(inner.abs, stored, rot, k, inner.format === "jpeg" ? o : 1), null); } catch { /* already written: same name, same contents */ }
    if (stale()) return;
    this.src = `${CACHE}/${name}`;
    this.still = Boolean(info.animated && rot);
    cx.notify();
  }

  /** Waits for the file's folder to change: the file and the folder's list again. */
  watch(cx, gen) {
    const dir = dirname(this.path);
    cx.spawn(async (cx) => {
      while (gen === this.gen || dirname(this.path) === dir) {
        try { await watchFolder(dir); } catch { return; }
        if (dirname(this.path) !== dir) return;
        // Any change here: the checksum says whether this file changed.
        this.load(cx);
        this.list(cx);
      }
    });
  }

  /** The pictures in the file's folder, for next / previous. */
  list(cx) {
    const dir = dirname(this.path);
    if (!this.path) return;
    cx.spawn(async (cx) => {
      const r = await sh('ls -1A "$1"', [dir], this.on);
      if (r.code !== 0 || dirname(this.path) !== dir) return;
      const names = siblings(r.stdout.split("\n"), basename(this.path));
      if (names.join("\n") !== this.names.join("\n")) { this.names = names; cx.notify(); }
    });
  }

  go(dir, cx) {
    const next = stepIn(this.names, basename(this.path), dir);
    if (next && next !== basename(this.path)) this.open(`${dirname(this.path)}/${next}`, cx);
  }

  /** Tells the pane header which file this viewer shows, and the app which path. */
  title() {
    if (!this.slot) return;
    const live = new Set(panes().filter((p) => p.mod === MOD).map((p) => p.props?.slot).filter(Boolean));
    const keep = (was, value) => {
      const next = Object.fromEntries(Object.entries(was ?? {}).filter(([k]) => live.has(k)));
      next[this.slot] = value;
      return next;
    };
    const name = this.path ? basename(this.path) : "Image";
    const titles = shared(TITLES) ?? {}, paths = shared(PATHS) ?? {};
    const stale = (was) => Object.keys(was).some((k) => !live.has(k) && k !== this.slot);
    if (titles[this.slot] !== name || stale(titles)) setShared(TITLES, keep(titles, name));
    if (paths[this.slot] !== this.path || stale(paths)) setShared(PATHS, keep(paths, this.path));
  }

  pane() {
    return panes().find((p) => p.mod === MOD && this.slot && p.props?.slot === this.slot) ?? null;
  }

  // ---- actions

  reveal() {
    run("pane.split", { edge: "right", px: 280, mod: "nocturne-files", props: { folder: dirname(this.path), on: this.on } });
  }

  system() {
    if (!this.on) run("image.open", { path: this.path, in: "system" });
  }

  copyPath(cx) {
    cx.write_to_clipboard(this.on ? `${this.on}:${this.path}` : this.path);
    const at = this.copied = Date.now();
    cx.timer.after(1400, (cx) => { if (this.copied === at) { this.copied = 0; cx.notify(); } });
  }

  // ---- zoom and pan

  /** The picture's size as shown, and whether it's a vector (fit may enlarge it). */
  img() { return { width: this.info?.width || 1, height: this.info?.height || 1 }; }
  vector() { return this.copy?.format === "svg"; }
  ready() { return Boolean(this.info?.width && this.port.width && this.src); }

  /** The view, fitted the first time the picture and the pane's size are both known. */
  current() {
    if (!this.view && this.info?.width && this.port.width) this.view = fitted(this.img(), this.port, 0, this.vector());
    return this.view;
  }

  /** Sets the view; a vector redraws sharper (or lighter) when its scale crosses a step. */
  set(view, cx) {
    const before = this.view;
    this.view = view;
    const k = (v) => sharpness(this.img(), v?.scale ?? 1, dpr());
    if (before?.rot !== view.rot || (this.vector() && k(before) !== k(view))) this.draw(cx);
  }

  zoomBy(dir, cx, at) {
    const v = this.current();
    if (v) this.set(zoomTo(v, step(v.scale, dir), this.img(), this.port, at), cx);
  }

  fit(cx) {
    const v = this.current();
    if (v) this.set(fitted(this.img(), this.port, v.rot, this.vector()), cx);
  }

  actual(cx, at) {
    const v = this.current();
    if (v) this.set(zoomTo(v, 1, this.img(), this.port, at), cx);
  }

  turn(dir, cx) {
    const v = this.current();
    if (v) { this.note = null; this.set(rotate(v, dir, this.img(), this.port, this.vector()), cx); }
  }

  /** Whether part of the picture is out of view (so keys pan rather than step). */
  pannable() {
    const v = this.current();
    if (!v) return false;
    const { width, height } = turned(this.img(), v.rot);
    return width * v.scale > this.port.width + 1 || height * v.scale > this.port.height + 1;
  }

  pan(dx, dy, cx) {
    const v = this.current();
    if (v) this.set(panBy(v, dx, dy, this.img(), this.port), cx);
  }

  resized(size, cx) {
    const port = { width: size.width, height: size.height };
    if (Math.abs(port.width - this.port.width) <= 1 && Math.abs(port.height - this.port.height) <= 1) return;
    this.port = port;
    const v = this.view;
    if (v) this.set(v.fit ? { ...v, scale: fitScale(this.img(), port, v.rot, this.vector()) } : clampPan(v, this.img(), port), cx);
    cx.notify();
  }

  key(e, cx) {
    const k = e.key, m = e.modifiers ?? {};
    if (m.platform || m.control || m.alt) return;
    const d = m.shift ? SHOVE : NUDGE;
    const pan = this.pannable();
    if (k === "+" || k === "=") this.zoomBy(1, cx);
    else if (k === "-" || k === "_") this.zoomBy(-1, cx);
    else if (k === "0") this.fit(cx);
    else if (k === "1") this.actual(cx);
    else if (k === "n" || k === "]" || k === "pagedown" || k === "space") this.go(1, cx);
    else if (k === "p" || k === "[" || k === "pageup" || k === "backspace") this.go(-1, cx);
    else if ((k === "h" || k === "left") && !pan) this.go(-1, cx);
    else if ((k === "l" || k === "right") && !pan) this.go(1, cx);
    else if (k === "h" || k === "left") this.pan(d, 0, cx);
    else if (k === "l" || k === "right") this.pan(-d, 0, cx);
    else if (k === "k" || k === "up") this.pan(0, d, cx);
    else if (k === "j" || k === "down") this.pan(0, -d, cx);
    else if (k === "r" || k === "R") this.turn(m.shift || k === "R" ? -1 : 1, cx);
    else if (k === "b") this.checker = !this.checker;
    else if (k === "o") this.system();
    else if (k === "y") this.copyPath(cx);
    else if (k === "f") this.reveal();
    else return;
    cx.stop_propagation();
    cx.notify();
  }

  /** `nocturne-image.<command>` (keys.json, `herdr-app do`): every shown viewer takes it. */
  command(c, cx) {
    if (c === "zoom_in") this.zoomBy(1, cx);
    else if (c === "zoom_out") this.zoomBy(-1, cx);
    else if (c === "fit") this.fit(cx);
    else if (c === "actual") this.actual(cx);
    else if (c === "next") this.go(1, cx);
    else if (c === "prev") this.go(-1, cx);
    else if (c === "rotate") this.turn(1, cx);
    else if (c === "background") this.checker = !this.checker;
    else if (c === "reload") { this.copy = null; this.load(cx); }
  }

  /** Pointer position in the viewport, from an event on it. */
  at(e) {
    const p = e?.local_position;
    return p ? { x: p.x, y: p.y } : null;
  }

  wheel(e, cx) {
    const m = e.modifiers ?? {}, dy = e.delta?.y ?? 0, dx = e.delta?.x ?? 0;
    const v = this.current();
    if (!v) return;
    if (m.platform || m.control) {
      const k = Math.exp(Math.max(-1, Math.min(1, dy / 240)));
      this.set(zoomTo(v, v.scale * k, this.img(), this.port, this.at(e)), cx);
    } else if (this.pannable()) this.set(panBy(v, dx, dy, this.img(), this.port), cx);
    else return;
    cx.notify();
  }

  // ---- parts

  chip(t, id, label, action, on) {
    return h_flex().id(id).relative().h(20).px(6).flex_none().items_center()
      .text_color(on ? t.foreground : t.muted).hover((s) => s.text_color(t.foreground))
      .on_mouse_down("left", stop)
      .on_click((_e, cx) => { cx.stop_propagation(); action(cx); cx.notify(); })
      .when(Boolean(on), (el) => el.child(checker(t.ansi0, 1)).child(div().absolute().left(0).right(0).bottom(0).h(2).bg(t.accent)))
      .child(div().relative().child(label));
  }

  /** "1920 × 1080 · PNG · 2.4 MB · animated". */
  facts(w) {
    const i = this.info;
    if (!i) return "";
    const parts = [];
    if (i.width) parts.push(`${i.width} × ${i.height}`);
    if (w >= 520 && i.format) parts.push(i.format.toUpperCase());
    if (w >= 600 && i.bytes >= 0) parts.push(fileSize(i.bytes));
    if (w >= 680 && i.animated) parts.push(this.still ? "still while turned" : i.frames ? `${i.frames} frames` : "animated");
    return parts.join(" · ");
  }

  toolbar(t) {
    const w = unzoom(this.port.width) || 600, v = this.view;
    const index = this.names.indexOf(basename(this.path));
    const many = this.names.length > 1;
    return h_flex().id("img-toolbar").relative().h(34).flex_none().px(10).gap(8).items_center().text_size(11)
      .when(w >= 320, (el) => el.child(div().flex_none().text_color(t.ansi8).child("IMG")))
      .child(h_flex().flex_1().min_w(0).gap(8).items_baseline()
        .child(div().flex_none().max_w_full().truncate().text_color(t.foreground).child(basename(this.path || "Image")))
        .when(w >= 420 && Boolean(this.info?.width || this.info?.format), (el) => el.child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(this.facts(w)))))
      .when(many && w >= 360, (el) => el
        .child(this.chip(t, "img-prev", "‹", (cx) => this.go(-1, cx)))
        .child(div().flex_none().text_color(t.dim).child(index >= 0 ? `${index + 1}/${this.names.length}` : `${this.names.length}`))
        .child(this.chip(t, "img-next", "›", (cx) => this.go(1, cx))))
      .when(Boolean(v) && this.ready(), (el) => el
        // The scale, then two chips that each do what they say: one toggle labelled
        // by its state ("fit 21%" zooming to 100%) read backwards and moved under the pointer.
        .when(w >= 400, (e2) => e2.child(div().flex_none().text_color(t.dim).child(percent(v.scale))))
        .child(this.chip(t, "img-fit", "fit", (cx) => this.fit(cx), v.fit))
        .child(this.chip(t, "img-actual", "100%", (cx) => this.actual(cx), !v.fit && Math.abs(v.scale - 1) < 1e-9))
        .when(w >= 380, (e2) => e2.child(this.chip(t, "img-turn", this.note ?? (v.rot ? `turn ${v.rot * 90}°` : "turn"), (cx) => this.turn(1, cx), Boolean(v.rot))))
        .when(w >= 460, (e2) => e2.child(this.chip(t, "img-bg", this.checker ? "checker" : "dark", () => { this.checker = !this.checker; }, false))))
      .when(Boolean(this.path), (el) => el
        .when(w >= 300, (e2) => e2.child(this.chip(t, "img-files", "files", () => this.reveal())))
        .when(w >= 540 && !this.on, (e2) => e2.child(this.chip(t, "img-open", "open", () => this.system())))
        .when(w >= 620, (e2) => e2.child(this.chip(t, "img-copy", this.copied ? "copied" : "copy", (cx) => this.copyPath(cx), Boolean(this.copied)))))
      .child(div().absolute().left(0).right(0).bottom(0).h(2).child(checker(t.ansi0, 1)));
  }

  empty(t, title, hint) {
    return v_flex().size_full().items_center().justify_center().gap(10).px(16).text_size(11)
      .child(svg(`${ART}/moon-8.svg`).w(44).h(44).text_color(t.ansi8).opacity(0.6))
      .child(div().text_color(t.foreground).child(title))
      .when(Boolean(hint), (el) => el.child(div().text_center().text_color(t.ansi8).child(hint)));
  }

  /** Where the view is when part of the picture is out of it: dithered rails on the
   *  right and bottom edges, as the Markdown viewer's scrollbar. */
  rails(t, box, focused) {
    const port = this.port, out = [];
    const color = focused ? t.accent : t.ansi8;
    if (box.height > port.height + 1) {
      const shown = port.height / box.height, top = (-box.top / box.height) * port.height;
      out.push(div().absolute().right(1).w(3).top(unzoom(top)).h(unzoom(Math.max(16, port.height * shown))).child(checker(color, 1)));
    }
    if (box.width > port.width + 1) {
      const shown = port.width / box.width, left = (-box.left / box.width) * port.width;
      out.push(div().absolute().bottom(1).h(3).left(unzoom(left)).w(unzoom(Math.max(16, port.width * shown))).child(checker(color, 1)));
    }
    return out;
  }

  picture(t, focused) {
    const v = this.current();
    const box = placed(v, this.img(), this.port);
    const [l, tp, w, h] = [box.left, box.top, box.width, box.height].map(unzoom);
    return [
      // The checker sits under the picture only: transparency reads, the pane stays dark.
      div().absolute().left(l).top(tp).w(w).h(h).overflow_hidden().bg(this.checker ? t.hover : t.background)
        .when(this.checker, (el) => el.child(checker(t.ansi0, 8))),
      image(this.src).id(`img-${this.slot ?? "view"}`).absolute().left(l).top(tp).w(w).h(h),
      ...this.rails(t, box, focused),
    ];
  }

  render() {
    const t = theme();
    const focused = this.handle.is_focused();
    let inner = [];
    if (this.error) inner = [this.empty(t, "Can't show this picture", this.error)];
    else if (this.busy || !this.src) inner = [this.empty(t, this.busy ?? "Reading…", tilde(this.path, home()))];
    else if (this.current()) inner = this.picture(t, focused);
    const body = div().id("img-view").relative().flex_1().min_h(0).overflow_hidden()
      .when(this.pannable(), (el) => (this.drag ? el.cursor_grabbing() : el.cursor_grab()))
      .on_size_change((size, cx) => this.resized(size, cx))
      .on_scroll_wheel((e, cx) => this.wheel(e, cx))
      .on_mouse_down("left", (e, cx) => {
        this.handle.focus();
        const at = this.at(e);
        if (e.click_count === 2 && at && this.current()) { this.view.fit ? this.actual(cx, at) : this.fit(cx); this.drag = null; cx.notify(); return; }
        if (at && this.pannable()) { this.drag = { from: at, x: this.view.x, y: this.view.y }; cx.notify(); }
      })
      .on_mouse_move((e, cx) => {
        const at = this.at(e), d = this.drag;
        if (!d || !at || !this.view) return;
        this.view = clampPan({ ...this.view, fit: false, x: d.x + at.x - d.from.x, y: d.y + at.y - d.from.y }, this.img(), this.port);
        cx.notify();
      })
      .on_mouse_up("left", (_e, cx) => { if (this.drag) { this.drag = null; cx.notify(); } })
      .on_hover((over, cx) => { if (!over && this.drag) { this.drag = null; cx.notify(); } })
      .children(inner);
    return v_flex().id(MOD).size_full().bg(t.background).text_color(t.foreground).track_focus(this.handle)
      .on_key_down((e, cx) => this.key(e, cx))
      .child(this.toolbar(t))
      .child(body);
  }
}
