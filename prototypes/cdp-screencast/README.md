# CDP screencast measurement (throwaway)

Answers one question for /Volumes/data/coding/fireflies-wt/chrome-panes-report.md:
how fast and how laggy is a page drawn from Chrome's DevTools screencast
(`Page.startScreencast`) with input sent over `Input.dispatchMouseEvent`?

    bun prototypes/cdp-screencast/measure.ts /Applications/Chromium.app/Contents/MacOS/Chromium 1280 800 2

Headless (`--headless=new`, nothing on screen), a fresh profile in a temp
folder. The page animates every frame; a press switches it between a flat
colour and full-screen noise, so a frame's JPEG size shows when the press
has reached the picture. The press-to-frame figure is a worst case (the
whole frame changes and the noise compresses badly).

Results on 2026-11-16, Chromium 157.0.8103.78 (ungoogled), Apple silicon:

| size | fps | press → frame (min / median / p90 / max, ms) |
| --- | --- | --- |
| 1280×800 @1x | 60 | 13–27 / 33–48 / 48–63 / 48–64 |
| 1280×800 @2x | 60 | 52–94 / 101–118 / 135–141 / 152–230 |
| 1920×1080 @2x | 60 | 93 / 250 / 378 / 463 |
