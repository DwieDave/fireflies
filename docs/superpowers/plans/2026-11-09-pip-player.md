# Picture-in-Picture Player Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A video playing in a browser pane can be lifted into one Nocturne-styled, square-cornered player that floats inside Herdr (over panes, tabs and spaces) or pops out above every app, with a button that takes you back to the pane it came from. Works for any `<video>` WebKit can put in Picture in Picture, not one site.

**Architecture:** WebKit's own Picture in Picture does the media work. When it starts, the native-view crate takes WebKit's video view (`WebVideoViewContainer`) out of the system `PIPPanel` (ordered out, never shown) and hosts it either in a new native view kind `pip` (drawn by a mod in a Herdr `kind: "window"` overlay) or in a native square `NSPanel` (popped out). Before any exit, the video goes back into the system panel and that panel is shown, then WebKit exits; a fixed page script announces page-side exits so this also happens for a site's own controls. "Back" emits the existing `view.press` event for the source web view, which already focuses its pane (switching tab and space).

**Tech Stack:** Rust (objc2, objc2-app-kit, objc2-web-kit) in `native/herdr-native-view`; GPUI host glue in `src/native_view.rs`; mods in JavaScript (gpui-kit, `herdr` module).

**Spec:** this conversation's findings, saved in memory `pip-player-findings.md`; probes in the session scratchpad `pip/` folder (probe5–probe15).

## Global Constraints

- macOS only (native views are macOS only); other platforms keep their behavior: `capabilities()` lists `pip`, `available` stays false there, mods show nothing.
- Square corners everywhere in the player; Nocturne look (font `Departure Mono`, theme colors, 1 px borders, no shadows/rounding).
- No site-specific code: video is chosen generically (largest playing `<video>`, any frame).
- Web views only enter PiP when created with `pip: true`; without it, behavior is unchanged (PiP stays unsupported).
- Native actions stay a whitelist; no action evaluates script text from a mod. Scripts are fixed constants in the crate.
- Private classes (`PIPPanel`, `PIPViewController`, `WebVideoViewContainer`) are looked up by name at runtime; when missing, leave the system PiP alone (fallback: macOS's own window).
- Exit sequence (verified): video back into `PIPPanel` content → panel `orderFront` at the player's screen rect → ≥300 ms → WebKit exit. Never exit while the video is outside the panel.
- Commits: lowercase conventional commits, single line, no co-author trailers. Stage only this work (the tree has unrelated edits under `defaults/mods/nocturne*`).
- `defaults/AGENTS.md` describes every new mod-facing capability in the same commit.
- Don't run a bare `target/*/herdr-app`: test with `HERDR_APP_HOME` set to a scratch folder and an isolated core.

## Review Focus

- Pane closed while its video is in the player → session ends, player overlay closes, no crash, no orphan panel.
- Site calls `document.exitPictureInPicture()` itself (or `webkitSetPresentationMode('inline')`) → video returns to the page and keeps rendering (not the stuck "playing in picture in picture" placeholder).
- Second PiP started from another pane while one is active → first one returns to its page; player switches to the new source.
- Player overlay closed by Herdr (layout switch) while the video is in it → treated as close: video returns to its page.
- Page navigates away / reloads during PiP → player closes on `leave`, nothing left hidden playing audio.

---

### Task 1: `pip` view kind and `pip` web prop (pure, tested)

**Files:**
- Modify: `native/herdr-native-view/src/lib.rs`

**Interfaces:**
- Produces: `Kind::Pip` (name `"pip"`), `Source::Pip(String)` (the source web view key), `Spec.pip: bool` (web views only, default false), `Kind::Web` actions + `"web.pip"`, `Kind::Pip` actions = `focus, blur, setVisible, setHoles, state, dispose, pip.toggle, pip.back, pip.close, pip.popOut`, `capabilities()` lists pip. `pub const PIP_HANDLER: &str = "herdrPip"` and `pub const PIP_PAGE_SCRIPT: &str` (the fixed user script, Task 2 fills its text).

- [ ] **Step 1: Write failing tests** in `lib.rs` tests:
  `pip_views_take_a_web_key`: `Spec::parse({kind:"pip", of:"7:web"})` → `Source::Pip("7:web")`; `{kind:"pip"}` and `{kind:"pip", of:""}` are errors; `Kind::Pip.allows("pip.back")`, `!Kind::Pip.allows("browser.navigate")`, `Kind::Web.allows("web.pip")`.
  `web_pip_prop_defaults_off`: `{kind:"web", url:"https://x.y"}` → `pip == false`; with `pip: true` → true.
- [ ] **Step 2:** `cargo test -p herdr-native-view` → FAIL (no `Kind::Pip`).
- [ ] **Step 3:** Implement as listed in Interfaces; `redacted()` for `Source::Pip` returns `"pip"`.
- [ ] **Step 4:** `cargo test -p herdr-native-view` → PASS; `cargo build` → compiles (macos.rs `match`es get a `Renderer::Pip`-less placeholder arm returning an error until Task 3).
- [ ] **Step 5:** `git commit -m "feat(native-view): pip view kind and pip web prop"`

### Task 2: Page bridge — enable PiP, report it, start it

**Files:**
- Create: `native/herdr-native-view/src/pip.rs` (macOS; `mod pip;` in lib.rs under `cfg(target_os = "macos")`)
- Modify: `native/herdr-native-view/src/macos.rs` (`make()` web branch, `WebDelegate`, `call()`, `dispose()`)

**Interfaces:**
- Consumes: Task 1 names.
- Produces in `pip.rs`:
  `pub(crate) fn configure(config: &WKWebViewConfiguration, handler: &ProtocolObject<dyn WKScriptMessageHandler>)` — KVC `allowsPictureInPictureMediaPlayback = true`, adds `PIP_PAGE_SCRIPT` (at document start, all frames) and the `herdrPip` handler.
  `pub(crate) fn on_message(web_key: &str, generation: u64, body: Value, frame: Retained<WKFrameInfo>)` — message types `play`, `enter`, `leave`, `exiting`.
  `pub(crate) fn start(web_key: &str, web: &WKWebView) -> Result<Value, String>` — runs the fixed pick script (`callAsyncJavaScript`, in the frame that last reported `play`, else the main frame); returns `{ of: web_key }`.
  `pub(crate) fn web_gone(web_key: &str)` — called from `dispose()` of a web view.
- Events (on the web view's key): `pip.enter { of }`, `pip.leave {}`.
- Page script behavior: capture listeners on `window` for `play`, `enterpictureinpicture`, `leavepictureinpicture`, `webkitpresentationmodechanged` post `{type}` to `herdrPip`; wraps `Document.prototype.exitPictureInPicture` and `HTMLVideoElement.prototype.webkitSetPresentationMode` (to `inline`) so they post `{type:"exiting"}`, wait 350 ms, then call the original.
- Pick script: of `document.querySelectorAll('video')` with `readyState > 0`, prefer playing, then largest `clientWidth*clientHeight`; if `document.pictureInPictureElement` is set, exit instead (toggle); `requestPictureInPicture()`, falling back to `webkitSetPresentationMode('picture-in-picture')`; returns `"entered" | "exited" | "none"`.

- [ ] **Step 1:** `WebDelegate` implements `WKScriptMessageHandler` (`userContentController:didReceiveScriptMessage:`) forwarding body + `frameInfo` to `pip::on_message`. Only when `spec.pip`: `make()` calls `pip::configure`. `dispose()` removes the handler (`removeScriptMessageHandlerForName:`) to break the controller → delegate retain.
- [ ] **Step 2:** `call()`: `("web.pip", Renderer::Web { view, .. })` → `pip::start(key, view)`; errors when the view wasn't created with `pip: true` (`"this page was opened without pip"`).
- [ ] **Step 3:** `cargo build` → compiles.
- [ ] **Step 4: Verify in an isolated app** (local page serving the probe's `v.mp4`): `native.call {key, action:"web.pip"}` → `native.debug` events show `pip.enter`; the system PiP window appears (takeover is Task 3).
- [ ] **Step 5:** `git commit -m "feat(native-view): web views report and start picture in picture"`

### Task 3: Take over the video into a `pip` view; back, close, toggle

**Files:**
- Modify: `native/herdr-native-view/src/pip.rs`, `native/herdr-native-view/src/macos.rs`

**Interfaces:**
- Consumes: Task 2.
- Produces in `pip.rs`: one `Session { source, generation, frame, panel, video, place: Place, playing }`, `enum Place { System, View(String), Popped }`;
  `pub(crate) fn tick()` (called at the end of `macos::frame_end`): finds the `PIPPanel` (class by name) of the active session, takes its `WebVideoViewContainer`, `orderOut`s it, keeps it out while we hold the video, and moves the video into the attached view's host;
  `pub(crate) fn attach(pip_key: &str, of: &str, host: &NSView)` / `pub(crate) fn detach(pip_key: &str)`;
  `pub(crate) fn action(pip_key: &str, action: &str) -> Result<Value, String>` for `pip.toggle`, `pip.back`, `pip.close`;
  `fn give_back(s: &mut Session)` — the verified exit sequence (panel frame = the video's current screen rect so the system flyback starts from the player).
- `Renderer::Pip { of }`: `make()` returns an empty `NSView` (like `App`); `ensure` → `attach`; `dispose` → `detach`.
- Events: on the pip view's key `pip.state { playing, popped }`, `pip.ended {}`.
- Rules: `back` = give back, exit, resume if it was playing, then `emit(source, generation, "view.press", {})` (host focuses that pane). `close` = give back, exit (WebKit pauses). `detach` while `Place::View(this)` = `close`. `exiting` message = `give_back` now. `leave` message = end session: drop video refs, close popped panel, emit `pip.leave` on source and `pip.ended` on the attached view. A new `enter` from another source while a session is active: `give_back` + exit the old one first. `web_gone(source)` ends the session silently.

- [ ] **Step 1:** Implement session, `tick`, `attach/detach`, `give_back`, actions, renderer wiring.
- [ ] **Step 2:** `cargo build`; `cargo test -p herdr-native-view` still PASS.
- [ ] **Step 3: Verify in the isolated app** with a mod-free check via `native.call`/`native.debug` plus a scratch mod pane drawing `{kind:"pip", of}`: video shows in it, source pane hidden keeps playing, `pip.back` returns video to the page (screenshot shows frames, not the placeholder) and focuses the pane; `pip.close` returns it paused; page-side `document.exitPictureInPicture()` returns it rendering.
- [ ] **Step 4:** `git commit -m "feat(native-view): pip views take over the picture in picture video"`

### Task 4: Pop out into a square floating panel

**Files:**
- Modify: `native/herdr-native-view/src/pip.rs`

**Interfaces:**
- Consumes: Task 3 session.
- Produces: action `pip.popOut { colors: { background, foreground, dim, border } }` → `NSPanel` (borderless, non-activating, `level = floating`, `collectionBehavior = canJoinAllSpaces | fullScreenAuxiliary`, movable by background, no shadow, square) at the pip view's screen rect: a 22 px bar (1 px border, `Departure Mono` 11 pt or monospaced system font, buttons `↩` back, `⇲` back into Herdr, `▶`/`❚❚`, `✕`) above the video. `Place::Popped`; the mod then closes its overlay (detach doesn't end a popped session).
- Panel buttons: back / toggle / close as in Task 3; "into Herdr" emits `pip.popIn { of }` on the source key (the browser mod reopens the player; its `attach` takes the video from the panel and closes it).

- [ ] **Step 1:** Implement panel + button target class (`define_class!`, methods `back:`, `popIn:`, `toggle:`, `close:`).
- [ ] **Step 2:** `cargo build`.
- [ ] **Step 3: Verify:** pop out → panel stays above another app and on another macOS Space; corners square (screenshot); back/close work from the panel.
- [ ] **Step 4:** `git commit -m "feat(native-view): pop the pip player out above every app"`

### Task 5: Mods — `nocturne-pip` player, browser integration, docs

**Files:**
- Create: `defaults/mods/nocturne-pip/mod.json` (`{ "place": "none" }`), `defaults/mods/nocturne-pip/main.js`
- Create: `defaults/mods/nocturne-browser/icons/picture-in-picture.svg` (Lucide style, 24 viewBox, stroke 2)
- Modify: `defaults/mods/nocturne-browser/main.js`, `defaults/AGENTS.md` (native views section)

**Interfaces:**
- Consumes: Tasks 2–4 actions and events.
- Player (`nocturne-pip`): opened as `openOverlay({ mod: "nocturne-pip", kind: "window", key: "nocturne-pip", frame: "none", width: 384, height: 238, props: { of } })`. Renders a 22 px bar (title `picture in picture` dim, buttons back / pop out / play-pause / close, each stopping propagation so the rest of the bar drags the window) over `herdr.nativeView.new("pip", { kind: "pip", of })`; square, theme background, 1 px `t.border`. Events: `pip.state` updates the play icon; `pip.ended` → `closeOverlay(props().overlay)`. Pop out: `pip.popOut` with theme colors, then close the overlay. Without native views: a one-line "needs native views" body.
- Browser: web view props gain `pip: true`; bar button `picture-in-picture` (enabled when a page is open) and command `nocturne-browser.pip` → `this.call("web.pip")`; events `pip.enter` and `pip.popIn` → open the player with `of = d.of`.

- [ ] **Step 1:** Write the two mods' changes and the icon.
- [ ] **Step 2:** `defaults/AGENTS.md`: document `pip: true`, `web.pip`, the `pip` kind and its actions/events in the native views paragraph, and the `nocturne-browser.pip` command where the browser's commands are listed (if listed).
- [ ] **Step 3:** `cargo test` (render tests load shipped mods; docs test) → PASS.
- [ ] **Step 4: End-to-end in the isolated app:** browser pane on the local video page → PiP button → player window in Herdr; switch tab and space: player stays, video plays; back → source tab/space/pane focused, video playing inline; pop out → above another app; `⇲` → back in Herdr; close the source pane during PiP → player closes.
- [ ] **Step 5:** `git commit -m "feat(nocturne): a picture in picture player for browser videos"`

---

## Revision 2 (2026-11-09): lift the video, no macOS Picture in Picture

**Why:** macOS draws the Picture in Picture window in `PIPAgent` (`/System/Library/CoreServices/PIPAgent.app`), another process. Hiding or moving the in-process `PIPPanel` stand-in leaves it on screen, so the Revision 1 player always showed macOS's rounded window next to ours. The user chose to drop WebKit's Picture in Picture.

**Design:** `web.pip` marks the page's biggest (playing) `<video>` (main frame first, else the frame that last played one) and starts a session; `pip.enter { of }` goes to the browser mod, which opens the player. When a `pip` view attaches, the page's whole `WKWebView` moves from its pane into that view (or the popped-out panel), and a fixed isolated-world script lifts the marked video into the top layer (`popover="manual"` + `showPopover()`, `position: fixed; inset: 0; object-fit: contain`, page scrolling off). A video in an iframe is lifted in its frame, and its `<iframe>` in the main frame. Back and close move the web view home and undo the lift (close also pauses). A navigation, a vanished video, a crashed page or a closed pane ends the session. Nothing appears outside Herdr except our own popped-out panel. No private Apple classes.

**Kept:** `Kind::Pip`, `Spec.pip` (now: the page reports videos), actions and events (minus the macOS PiP ones), `Popped`, `focus_pressed`, the mods.

### Task 6: lift instead of Picture in Picture
**Files:** `native/herdr-native-view/src/pip.rs` (rewrite of the session), `src/macos.rs` (`web_of(key)`, commit → `pip::navigated`), `defaults/mods/nocturne-browser/main.js` (placeholder while the video is out), `defaults/AGENTS.md`.
- [ ] Rewrite; `cargo build`; `cargo test -p herdr-native-view --lib` passes.
- [ ] E2E in the test app, with the window sampler: open → pop out → back, twice; tab switch; close; navigation while lifted; page removes its video; video in an iframe. No `PIPAgent` window at any sample.
- [ ] Commit: `feat(native-view): the pip player lifts the page's video instead of using macOS picture in picture`
