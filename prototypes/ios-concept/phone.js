// Drawing for the concept pages: the font, the pixel art (assets.js), and the
// dithered canvases (sky, moon, hills, glow) nocturne's sidebar draws with
// ordered dither on the desktop. 1 canvas px = 1 CSS px, scaled pixelated.

(() => {
  const face = new FontFace("Departure Mono", `url(data:font/otf;base64,${FONT_B64})`);
  face.load().then((f) => document.fonts.add(f));

  // <i class="art logo" data-art="logo-claude"></i> takes the SVG, in currentColor.
  for (const el of document.querySelectorAll("[data-art]")) {
    const svg = ART[el.dataset.art];
    if (svg) el.innerHTML = svg.replace("<svg ", '<svg fill="currentColor" preserveAspectRatio="xMidYMid meet" ');
  }

  // 4x4 Bayer thresholds, 0..1.
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
  const on = (x, y, k) => k > BAYER[(y & 3) * 4 + (x & 3)];

  // A seeded random so every render draws the same stars.
  const rand = (seed) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  function put(ctx, x, y, c) {
    ctx.fillStyle = c;
    ctx.fillRect(x, y, 1, 1);
  }

  // The night sky: near black at the top, a dithered blue haze growing toward the
  // hills, scattered stars, and an optional dithered moon and hill line.
  function sky(cv) {
    const w = cv.width = cv.clientWidth;
    const h = cv.height = cv.clientHeight;
    const ctx = cv.getContext("2d");
    const o = cv.dataset;
    const r = rand(Number(o.seed || 7));
    const haze = o.haze || "#1d2438";
    const from = Number(o.from ?? 0.35);
    ctx.fillStyle = "#080808";
    ctx.fillRect(0, 0, w, h);

    for (let y = 0; y < h; y++) {
      const k = Math.max(0, (y / h - from) / (1 - from)) * Number(o.depth ?? 0.55);
      for (let x = 0; x < w; x++) if (on(x, y, k)) put(ctx, x, y, haze);
    }

    for (let i = 0; i < w * h * 0.0009; i++) {
      const x = Math.floor(r() * w), y = Math.floor(r() * h);
      const c = r() > 0.85 ? "#c6c6c6" : "#5f6d6d";
      put(ctx, x, y, c);
      if (r() > 0.93) { put(ctx, x - 1, y, c); put(ctx, x + 1, y, c); put(ctx, x, y - 1, c); put(ctx, x, y + 1, c); }
    }

    if (o.moon) {
      const [mx, my, mr] = o.moon.split(",").map(Number);
      for (let y = -mr; y <= mr; y++) for (let x = -mr; x <= mr; x++) {
        const d = Math.hypot(x, y) / mr;
        if (d > 1) continue;
        // lit from the right: the terminator is a soft dithered band
        const lit = Math.min(1, Math.max(0, (x / mr + 0.15) * 1.6 + 0.5)) * (1 - d * d * 0.35);
        const k = Math.max(0.06, lit);
        if (on(mx + x, my + y, k)) put(ctx, mx + x, my + y, "#d0d0d0");
      }
    }

    if (o.hills) {
      const base = h - Number(o.hills);
      let prev = base;
      for (let x = 0; x < w; x++) {
        const y = Math.round(base - 6 * Math.sin(x / 41) - 4 * Math.sin(x / 13 + 1) - 3 * Math.sin(x / 97 + 2));
        for (let yy = y; yy < h; yy++) if (on(x, yy, 0.5)) put(ctx, x, yy, "#26282b");
        put(ctx, x, y, "#7a7a7a");
        for (let yy = Math.min(y, prev); yy < Math.max(y, prev); yy++) put(ctx, x, yy, "#7a7a7a");
        prev = y;
      }
    }
  }

  // A soft dithered glow (a firefly's halo, the notification's lamp).
  function glow(cv) {
    const w = cv.width = cv.clientWidth;
    const h = cv.height = cv.clientHeight;
    const ctx = cv.getContext("2d");
    const c = cv.dataset.color || "#e3c78a";
    const s = Number(cv.dataset.strength || 0.6);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const d = Math.hypot((x - w / 2) / (w / 2), (y - h / 2) / (h / 2));
      if (d < 1 && on(x, y, (1 - d) * (1 - d) * s)) put(ctx, x, y, c);
    }
  }

  const draw = () => {
    document.querySelectorAll("canvas.sky").forEach(sky);
    document.querySelectorAll("canvas.glow").forEach(glow);
  };
  document.readyState === "complete" ? draw() : addEventListener("load", draw);
})();
