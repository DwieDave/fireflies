//! The picture in picture player for web views (`pip: true`), and `pip` views.
//!
//! No macOS Picture in Picture: its window belongs to another process
//! (PIPAgent) and can't be hidden or styled. Instead the page's whole web view
//! moves into the player (a `pip` view in Herdr, or the popped-out panel) and
//! a fixed script lifts the page's video into the top layer, filling it. Back
//! or close: the web view goes home and the lift is undone.
//!
//! `web.pip` marks the video (main frame first, else the frame that last
//! played one) and starts a session; `pip.enter { of }` tells the page's mod,
//! which opens a player; the player's view attaching takes the web view.

use crate::macos::emit_event;
use block2::RcBlock;
use objc2::rc::{Retained, Weak};
use objc2::runtime::{AnyObject, ProtocolObject};
use objc2::runtime::{NSObject, NSObjectProtocol};
use objc2::{AnyThread, DefinedClass, MainThreadMarker, MainThreadOnly, define_class, msg_send, sel};
use objc2_app_kit::{
    NSApplication, NSAutoresizingMaskOptions, NSBackingStoreType, NSBox, NSBoxType, NSButton, NSCellImagePosition, NSColor,
    NSControl, NSEvent, NSFloatingWindowLevel, NSFont, NSFontAttributeName, NSForegroundColorAttributeName, NSImage,
    NSPanel, NSResponder, NSTextField, NSTitlePosition, NSTrackingArea, NSTrackingAreaOptions, NSView, NSWindow,
    NSWindowCollectionBehavior, NSWindowDelegate, NSWindowStyleMask,
};
use objc2_foundation::{
    NSAttributedString, NSAttributedStringKey, NSData, NSDictionary, NSError, NSPoint, NSRect, NSSize, NSString,
};
use objc2_web_kit::{
    WKContentWorld, WKFrameInfo, WKScriptMessageHandler, WKUserContentController, WKUserScript,
    WKUserScriptInjectionTime, WKWebView, WKWebViewConfiguration,
};
use serde_json::{Value, json};
use std::cell::RefCell;
use std::collections::HashMap;

/// The message handler the page script posts to, in WebKit's isolated client
/// world: pages can't reach it.
pub(crate) const HANDLER: &str = "herdrPip";

/// Reports which frame plays a video (`web.pip` looks there for embedded players).
const WATCH_SCRIPT: &str = r#"(() => {
  addEventListener("play", (e) => { if (e.target instanceof HTMLVideoElement) { try { webkit.messageHandlers.herdrPip.postMessage(JSON.stringify({ type: "play" })); } catch {} } }, true);
})();"#;

/// `web.pip`: marks the frame's biggest video (a playing one first).
const PICK_SCRIPT: &str = r#"
  const area = (v) => v.clientWidth * v.clientHeight;
  const vs = [...document.querySelectorAll("video")].filter((v) => v.readyState > 0 && area(v) > 0);
  vs.sort((a, b) => (b.paused ? 0 : 1) - (a.paused ? 0 : 1) || area(b) - area(a));
  const v = vs[0];
  if (!v) return "none";
  for (const o of document.querySelectorAll("[data-herdr-pip]")) o.removeAttribute("data-herdr-pip");
  v.setAttribute("data-herdr-pip", "");
  return "found";
"#;

/// What the lift does to the page, while it lasts: the page itself goes
/// invisible and black, only the lifted element shows, filling the view. The
/// fill holds in the top layer (a popover), and also when the page keeps it
/// out of there for a moment.
const LIFT_CSS: &str = "html[data-herdr-pip-on], html[data-herdr-pip-on] body { overflow: hidden !important; \
background: #000 !important; } \
html[data-herdr-pip-on] body { visibility: hidden !important; } \
html[data-herdr-pip-on] [data-herdr-pip], html[data-herdr-pip-on] [data-herdr-pip-frame] { position: fixed !important; \
inset: 0 !important; z-index: 2147483647 !important; \
width: 100vw !important; height: 100vh !important; max-width: none !important; max-height: none !important; \
min-width: 0 !important; min-height: 0 !important; margin: 0 !important; padding: 0 !important; border: 0 !important; \
transform: none !important; translate: none !important; scale: none !important; rotate: none !important; \
clip-path: none !important; filter: none !important; object-fit: contain !important; background: #000 !important; \
opacity: 1 !important; visibility: visible !important; display: block !important; } \
[data-herdr-pip]::backdrop, [data-herdr-pip-frame]::backdrop { background: #000; }";

/// Lifts the element marked `attr` (the video, or in the main frame the
/// iframe holding it) into the top layer, filling the view. Pages move their
/// player around (YouTube does when the view's width changes its layout, as
/// moving into the player does), which takes it out of the top layer: a
/// watch puts it back. A video gone for good ends the session (`lost`).
fn lift_script(attr: &str) -> String {
    format!(
        r#"const el = document.querySelector("[{attr}]");
  if (!el) return "none";
  if (!document.getElementById("herdr-pip-style")) {{
    const s = document.createElement("style"); s.id = "herdr-pip-style"; s.textContent = {css};
    (document.head || document.documentElement).appendChild(s);
  }}
  document.documentElement.setAttribute("data-herdr-pip-on", "");
  // The page's own fullscreen would sit above the lift.
  try {{
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (document.webkitFullscreenElement) document.webkitExitFullscreen();
  }} catch {{}}
  if (!el.hasAttribute("data-herdr-pip-was")) el.setAttribute("data-herdr-pip-was", el.getAttribute("popover") ?? "-");
  // Just the video: its own controls (the player has them) go while lifted.
  if (el.tagName === "VIDEO" && el.controls) {{ el.setAttribute("data-herdr-pip-controls", ""); el.controls = false; }}
  const show = () => {{
    if (!el.isConnected || !document.documentElement.hasAttribute("data-herdr-pip-on")) return;
    // The style may be gone with a page's head rewrite.
    if (!document.getElementById("herdr-pip-style")) {{
      const s = document.createElement("style"); s.id = "herdr-pip-style"; s.textContent = {css};
      (document.head || document.documentElement).appendChild(s);
    }}
    if (el.getAttribute("popover") !== "manual") el.popover = "manual";
    try {{ if (!el.matches(":popover-open")) el.showPopover(); }} catch {{}}
  }};
  show();
  if (window.__herdrPipWatch) clearInterval(window.__herdrPipWatch);
  if (window.__herdrPipToggle) window.__herdrPipToggle.el.removeEventListener("toggle", window.__herdrPipToggle.fn);
  const fn = (e) => {{ if (e.newState === "closed") setTimeout(show, 0); }};
  el.addEventListener("toggle", fn);
  window.__herdrPipToggle = {{ el, fn }};
  let gone = 0;
  window.__herdrPipWatch = setInterval(() => {{
    if (el.isConnected) {{ gone = 0; show(); return; }}
    // Out of the page for 2 s: replaced, not moved.
    if (el.tagName === "VIDEO" && ++gone >= 8) {{
      clearInterval(window.__herdrPipWatch); window.__herdrPipWatch = null;
      try {{ webkit.messageHandlers.herdrPip.postMessage(JSON.stringify({{ type: "lost" }})); }} catch {{}}
    }}
  }}, 250);
  return "lifted";"#,
        css = serde_json::to_string(LIFT_CSS).unwrap()
    )
}

/// Undoes `lift_script` (and pauses the video when `pause`).
fn unlift_script(pause: bool) -> String {
    format!(
        r#"const pause = {pause};
  if (window.__herdrPipWatch) {{ clearInterval(window.__herdrPipWatch); window.__herdrPipWatch = null; }}
  if (window.__herdrPipToggle) {{ window.__herdrPipToggle.el.removeEventListener("toggle", window.__herdrPipToggle.fn); window.__herdrPipToggle = null; }}
  document.documentElement.removeAttribute("data-herdr-pip-on");
  for (const el of document.querySelectorAll("[data-herdr-pip], [data-herdr-pip-frame]")) {{
    try {{ el.hidePopover(); }} catch {{}}
    const was = el.getAttribute("data-herdr-pip-was");
    if (was === "-" || was === null) el.removeAttribute("popover"); else el.setAttribute("popover", was);
    el.removeAttribute("data-herdr-pip-was");
    if (el.hasAttribute("data-herdr-pip-controls")) {{ el.removeAttribute("data-herdr-pip-controls"); el.controls = true; }}
    if (pause && el.tagName === "VIDEO") el.pause();
  }}
  document.getElementById("herdr-pip-style")?.remove();
  return "done";"#
    )
}

/// In the main frame: marks the iframe whose page is `url` (the frame the video plays in).
fn mark_frame_script(url: &str) -> String {
    format!(
        r#"const want = new URL({url});
  const same = (src) => {{ try {{ const u = new URL(src, location.href); return u.origin === want.origin && u.pathname === want.pathname; }} catch {{ return false; }} }};
  // The one holding the marked video (same origin: its document is readable),
  // else by its address (never about:blank, which many iframes have).
  const holds = (f) => {{ try {{ return Boolean(f.contentDocument?.querySelector("[data-herdr-pip]")); }} catch {{ return false; }} }};
  const all = [...document.querySelectorAll("iframe")];
  const f = all.find(holds) ?? (want.protocol === "about:" ? undefined : all.find((f) => f.src && same(f.src)));
  if (!f) return "none";
  for (const o of document.querySelectorAll("[data-herdr-pip-frame]")) o.removeAttribute("data-herdr-pip-frame");
  f.setAttribute("data-herdr-pip-frame", "");
  return "found";"#,
        url = serde_json::to_string(url).unwrap()
    )
}

/// What a player does to the video (`pip.toggle`, `pip.seek`, `pip.mute`, `pip.sync`).
#[derive(Clone, Copy, Debug, PartialEq)]
enum Media {
    Toggle,
    /// Seconds on (back when negative).
    Seek(f64),
    /// Sound off (true) or on; None: the other way round.
    Mute(Option<bool>),
    /// Nothing: only how it is.
    Sync,
}

impl Media {
    fn parse(action: &str, args: &Value) -> Result<Media, String> {
        Ok(match action {
            "pip.toggle" => Media::Toggle,
            "pip.seek" => Media::Seek(seek_by(args)?),
            "pip.mute" => Media::Mute(args.get("muted").and_then(Value::as_bool)),
            "pip.sync" => Media::Sync,
            a => return Err(format!("`{a}` is not a media action")),
        })
    }

    /// The fixed script: does it, then says `{ result: "playing" | "paused", muted }`.
    fn script(self) -> String {
        let act = match self {
            Media::Toggle => "if (v.paused) { try { await v.play(); } catch {} } else v.pause();".to_owned(),
            Media::Seek(by) => format!(
                "const t = Math.max(0, v.currentTime + ({by})); v.currentTime = Number.isFinite(v.duration) ? Math.min(v.duration, t) : t;"
            ),
            Media::Mute(m) => {
                let to = m.map_or("!(v.muted || v.volume === 0)".to_owned(), |m| m.to_string());
                format!("const m = {to}; v.muted = m; if (!m && v.volume === 0) v.volume = 1;")
            }
            Media::Sync => String::new(),
        };
        format!(
            r#"const v = document.querySelector("[data-herdr-pip]");
  if (!v) return "none";
  {act}
  return JSON.stringify({{ result: v.paused ? "paused" : "playing", muted: v.muted || v.volume === 0, width: v.videoWidth, height: v.videoHeight }});"#
        )
    }
}

/// A media script's answer as an event's data: `{ result, muted }`, or as it came.
fn media_state(r: Value) -> Value {
    r["result"].as_str().and_then(|s| serde_json::from_str::<Value>(s).ok()).filter(Value::is_object).unwrap_or(r)
}

/// The seconds `pip.seek` takes: finite, at most an hour either way.
fn seek_by(args: &Value) -> Result<f64, String> {
    args.get("by")
        .and_then(Value::as_f64)
        .filter(|b| b.is_finite())
        .map(|b| b.clamp(-3600.0, 3600.0))
        .ok_or_else(|| "pip.seek needs { by: seconds }".into())
}

/// The one video in the player.
struct Session {
    /// The web view it plays in, and that view's load generation.
    source: String,
    generation: u64,
    web: Weak<WKWebView>,
    /// Where the web view lives in its pane, to go back to.
    home: Weak<NSView>,
    /// The frame the video is in; None: the main frame.
    frame: Option<Retained<WKFrameInfo>>,
    /// The web view is out of its pane and the video lifted.
    lifted: bool,
    /// The popped-out window, while the video is out of Herdr.
    popped: Option<Popped>,
}

/// A `pip` view: whose video it shows and where.
struct Attached {
    of: String,
    generation: u64,
    host: Weak<NSView>,
    /// When it attached: the newest player of a page holds its video.
    seq: u64,
}

thread_local! {
    /// Per web view: the frame that last started a video (`web.pip` looks there second).
    static PLAYED: RefCell<HashMap<String, Retained<WKFrameInfo>>> = RefCell::new(HashMap::new());
    static SESSION: RefCell<Option<Session>> = const { RefCell::new(None) };
    static ATTACHED: RefCell<HashMap<String, Attached>> = RefCell::new(HashMap::new());
    static SEQ: std::cell::Cell<u64> = const { std::cell::Cell::new(0) };
    /// Per `pip` view: its host's last size change and, while a resize is
    /// under way, the size its web view keeps (crate::resize).
    static RESIZING: RefCell<HashMap<String, Resizing>> = RefCell::new(HashMap::new());
}

struct Resizing {
    last: std::time::Instant,
    /// Live: the web view's settled size, drawn scaled into the host.
    settled: Option<NSSize>,
    /// Bumped each change: a settle timer acts only if no change came after it.
    tick: u64,
}

/// Lets a `pip: true` web view's page report the frames that play videos.
pub(crate) fn configure(
    mtm: MainThreadMarker,
    config: &WKWebViewConfiguration,
    handler: &ProtocolObject<dyn WKScriptMessageHandler>,
) {
    unsafe {
        let content = config.userContentController();
        let client = WKContentWorld::defaultClientWorld(mtm);
        let script = WKUserScript::initWithSource_injectionTime_forMainFrameOnly_inContentWorld(
            WKUserScript::alloc(mtm),
            &NSString::from_str(WATCH_SCRIPT),
            WKUserScriptInjectionTime::AtDocumentStart,
            false,
            &client,
        );
        content.addUserScript(&script);
        content.addScriptMessageHandler_contentWorld_name(handler, &client, &NSString::from_str(HANDLER));
    }
}

/// Undoes `configure` (the controller holds the handler, which would keep it alive).
pub(crate) fn unconfigure(content: &WKUserContentController) {
    unsafe { content.removeAllScriptMessageHandlers() };
}

/// A message from the page script (isolated world only).
pub(crate) fn on_message(web_key: &str, _generation: u64, name: &str, body: &str, frame: Retained<WKFrameInfo>) {
    if name != HANDLER {
        return;
    }
    match serde_json::from_str::<Value>(body).ok().and_then(|v| v["type"].as_str().map(str::to_owned)).as_deref() {
        Some("play") => {
            PLAYED.with(|p| p.borrow_mut().insert(web_key.to_owned(), frame));
        }
        // The lifted video left the page: nothing to show.
        Some("lost") => {
            if let Some(mtm) = MainThreadMarker::new() {
                end(mtm, web_key, false);
            }
        }
        _ => {}
    }
}

/// `web.pip`: the page's video into the player, or (again) back. Looks in
/// the main frame, then in the frame that last played a video.
pub(crate) fn start(mtm: MainThreadMarker, web_key: &str, generation: u64, web: &WKWebView) -> Result<Value, String> {
    if active(web_key) {
        end(mtm, web_key, true);
        return Ok(json!({ "of": web_key, "active": false }));
    }
    // One at a time: another page's video goes home first.
    if let Some(other) = SESSION.with(|s| s.borrow().as_ref().map(|s| s.source.clone())) {
        end(mtm, &other, false);
    }
    let played = PLAYED.with(|p| p.borrow().get(web_key).cloned());
    let (k, wk) = (web_key.to_owned(), Weak::from(web));
    run_then(mtm, web, None, PICK_SCRIPT, move |r| {
        if r["result"] == "found" {
            return begin(&k, generation, &wk, None);
        }
        let (Some(frame), Some(mtm), Some(web)) = (played.clone(), MainThreadMarker::new(), wk.load()) else {
            return emit_event(&k, generation, "pip.start", r);
        };
        let (k2, wk2, f2) = (k.clone(), wk.clone(), frame.clone());
        run_then(mtm, &web, Some(&frame), PICK_SCRIPT, move |r| {
            if r["result"] == "found" {
                begin(&k2, generation, &wk2, Some(f2.clone()));
            } else {
                emit_event(&k2, generation, "pip.start", r);
            }
        });
    });
    Ok(json!({ "of": web_key, "active": true }))
}

/// A video is marked: the session starts and the page's mod opens a player.
fn begin(web_key: &str, generation: u64, web: &Weak<WKWebView>, frame: Option<Retained<WKFrameInfo>>) {
    let Some(w) = web.load() else { return };
    let Some(home) = (unsafe { w.superview() }) else { return };
    SESSION.with(|s| {
        *s.borrow_mut() = Some(Session {
            source: web_key.to_owned(),
            generation,
            web: web.clone(),
            home: Weak::from_retained(&home),
            frame,
            lifted: false,
            popped: None,
        })
    });
    emit_event(web_key, generation, "pip.start", json!({ "result": "found" }));
    emit_event(web_key, generation, "pip.enter", json!({ "of": web_key }));
    place(web_key);
}

/// Runs one of this module's scripts in `frame` (None: the main frame) of
/// the isolated world, handing the result (`{ result }` or `{ error }`) to `then`.
fn run_then(mtm: MainThreadMarker, web: &WKWebView, frame: Option<&WKFrameInfo>, script: &str, then: impl Fn(Value) + 'static) {
    let done = RcBlock::new(move |result: *mut AnyObject, error: *mut NSError| {
        let data = match unsafe { error.as_ref() } {
            Some(e) => json!({ "error": e.localizedDescription().to_string() }),
            None => {
                let s = unsafe { result.as_ref() }
                    .and_then(|r| r.downcast_ref::<NSString>())
                    .map(|s| s.to_string());
                json!({ "result": s })
            }
        };
        then(data);
    });
    unsafe {
        web.callAsyncJavaScript_arguments_inFrame_inContentWorld_completionHandler(
            &NSString::from_str(script),
            None,
            frame,
            &WKContentWorld::defaultClientWorld(mtm),
            Some(&done),
        );
    }
}

/// Lifts (or undoes the lift of) the session's video: in its frame, and for
/// a video in an iframe, that iframe in the main frame too.
fn set_lift(mtm: MainThreadMarker, web: &WKWebView, frame: Option<&WKFrameInfo>, on: bool, pause: bool) {
    let inner = if on { lift_script("data-herdr-pip") } else { unlift_script(pause) };
    run_then(mtm, web, frame, &inner, |_| {});
    let Some(frame) = frame.filter(|f| !unsafe { f.isMainFrame() }) else { return };
    if on {
        let url = unsafe { frame.request().URL() }.and_then(|u| u.absoluteString()).map(|s| s.to_string()).unwrap_or_default();
        let w = Weak::from(web);
        run_then(mtm, web, None, &mark_frame_script(&url), move |r| {
            if let (true, Some(web), Some(mtm)) = (r["result"] == "found", w.load(), MainThreadMarker::new()) {
                run_then(mtm, &web, None, &lift_script("data-herdr-pip-frame"), |_| {});
            }
        });
    } else {
        run_then(mtm, web, None, &unlift_script(false), |_| {});
    }
}

/// The web view or its page is gone (closed pane, crash): forget it.
pub(crate) fn web_gone(web_key: &str) {
    PLAYED.with(|p| p.borrow_mut().remove(web_key));
    if let Some(s) = take(web_key) {
        // The view goes with its entry; out of our player first.
        if let Some(w) = s.web.load() {
            w.removeFromSuperview();
        }
        close(s);
    }
}

/// A new page loaded in the web view: the video was the old page's.
pub(crate) fn navigated(web_key: &str) {
    PLAYED.with(|p| p.borrow_mut().remove(web_key));
    if let Some(s) = take(web_key) {
        go_home(&s);
        close(s);
    }
}

// ---- the session

fn active(web_key: &str) -> bool {
    SESSION.with(|s| s.try_borrow().is_ok_and(|s| s.as_ref().is_some_and(|s| s.source == web_key)))
}

/// Runs `f` on the session if it is `web_key`'s.
fn with_session<R>(web_key: &str, f: impl FnOnce(&mut Session) -> R) -> Option<R> {
    SESSION.with(|s| {
        let mut s = s.try_borrow_mut().ok()?;
        let s = s.as_mut().filter(|s| s.source == web_key)?;
        Some(f(s))
    })
}

fn take(web_key: &str) -> Option<Session> {
    SESSION.with(|s| {
        let mut s = s.borrow_mut();
        if s.as_ref().is_some_and(|s| s.source == web_key) { s.take() } else { None }
    })
}

/// Ends the session: the web view goes home, the lift is undone (`resume`:
/// the video plays on there, else it pauses).
fn end(mtm: MainThreadMarker, web_key: &str, resume: bool) {
    let Some(s) = take(web_key) else { return };
    go_home(&s);
    if let Some(web) = s.web.load() {
        set_lift(mtm, &web, s.frame.as_deref(), false, !resume);
    }
    close(s);
}

/// "Back": ends it playing on, and the page's pane takes focus (the host
/// shows its tab and space, as for a press on the page).
fn back(mtm: MainThreadMarker, web_key: &str) {
    let Some(g) = with_session(web_key, |s| s.generation) else { return };
    end(mtm, web_key, true);
    emit_event(web_key, g, "view.press", json!({}));
}

/// The web view back in its pane.
fn go_home(s: &Session) {
    if let (Some(web), Some(home)) = (s.web.load(), s.home.load())
        && !is_in(&web, &home)
    {
        put(&web, &home);
    }
}

/// An ended session: its window goes, its players and its page's mod are told.
fn close(s: Session) {
    if let Some(p) = &s.popped {
        p.panel.orderOut(None);
    }
    for (key, generation) in players_of(&s.source) {
        emit_event(&key, generation, "pip.ended", json!({}));
    }
    emit_event(&s.source, s.generation, "pip.leave", json!({}));
}

/// Puts the web view where it belongs now: in the popped-out window, else in
/// the player showing it. The first time, the video is lifted.
fn place(web_key: &str) {
    let Some(mtm) = MainThreadMarker::new() else { return };
    let todo = with_session(web_key, |s| {
        let holder = s.popped.as_ref().map(|p| p.host.clone()).or_else(|| holder(&s.source))?;
        let web = s.web.load()?;
        let from = unsafe { web.superview() };
        let moved = !is_in(&web, &holder);
        if moved {
            put(&web, &holder);
        }
        let lift = !s.lifted;
        s.lifted = true;
        Some((web, s.frame.clone(), lift, moved.then_some(from).flatten(), s.generation))
    })
    .flatten();
    let Some((web, frame, lift, from, generation)) = todo else { return };
    if lift {
        set_lift(mtm, &web, frame.as_deref(), true, false);
    }
    // The player it left (popped into a pane, or out of Herdr) can go; the
    // page hears where its video is now.
    if let Some(from) = from {
        let left: Vec<(String, u64)> = ATTACHED.with(|a| {
            a.borrow()
                .iter()
                .filter(|(_, p)| p.of == web_key && p.host.load().is_some_and(|h| std::ptr::eq(&*h, &*from)))
                .map(|(k, p)| (k.clone(), p.generation))
                .collect()
        });
        for (key, g) in left {
            emit_event(&key, g, "pip.moved", json!({}));
        }
        emit_event(web_key, generation, "pip.moved", json!({ "popped": with_session(web_key, |s| s.popped.is_some()).unwrap_or(false) }));
    }
}

/// The view the newest player gave for `web_key`'s video.
fn holder(web_key: &str) -> Option<Retained<NSView>> {
    ATTACHED.with(|a| {
        let a = a.borrow();
        let mut players: Vec<&Attached> = a.values().filter(|p| p.of == web_key).collect();
        players.sort_by_key(|p| std::cmp::Reverse(p.seq));
        players.into_iter().find_map(|p| p.host.load())
    })
}

fn players_of(web_key: &str) -> Vec<(String, u64)> {
    ATTACHED.with(|a| a.borrow().iter().filter(|(_, p)| p.of == web_key).map(|(k, p)| (k.clone(), p.generation)).collect())
}

fn put(view: &NSView, into: &NSView) {
    view.removeFromSuperview();
    view.setFrame(into.bounds());
    view.setAutoresizingMask(NSAutoresizingMaskOptions::ViewWidthSizable | NSAutoresizingMaskOptions::ViewHeightSizable);
    into.addSubview(view);
}

fn is_in(view: &NSView, holder: &NSView) -> bool {
    unsafe { view.superview() }.is_some_and(|s| std::ptr::eq(&*s, holder))
}

// ---- pip views

/// A `pip` view shows `of`'s video in `host` (from its load).
pub(crate) fn attach(key: &str, generation: u64, of: &str, host: &NSView) {
    let seq = SEQ.with(|s| {
        s.set(s.get() + 1);
        s.get()
    });
    ATTACHED.with(|a| {
        a.borrow_mut().insert(key.to_owned(), Attached { of: of.to_owned(), generation, host: Weak::from(host), seq })
    });
    // Back into Herdr: the popped-out window goes.
    if let Some(Some(p)) = with_session(of, |s| s.popped.take()) {
        p.panel.orderOut(None);
    }
    place(of);
}

/// The `pip` view `key`'s host got a new frame (macos.rs frame_end, after
/// setting it). A burst of changes (a resize being dragged) keeps the web
/// view at its settled size, drawn scaled into the host through the host's
/// bounds, so WebKit doesn't lay the page out on every step; once the size
/// has held for `resize::SETTLE`, the web view gets the real size, one
/// layout. A single change lays it out at once, as autoresizing always did.
pub(crate) fn host_framed(key: &str, host: &NSView) {
    let Some(web) = web_in(key, host) else {
        RESIZING.with(|r| r.borrow_mut().remove(key));
        return;
    };
    let now = std::time::Instant::now();
    let frame = host.frame().size;
    let step = RESIZING.with(|r| {
        let mut r = r.borrow_mut();
        let e = r.entry(key.to_owned()).or_insert(Resizing { last: now, settled: None, tick: 0 });
        let since = (e.tick > 0).then(|| now.duration_since(e.last));
        e.last = now;
        e.tick += 1;
        if !crate::resize::goes_live(e.settled.is_some(), since) {
            return None;
        }
        // Going live: the web view keeps the size it has now, and stops following the host.
        let settled = *e.settled.get_or_insert_with(|| web.frame().size);
        Some((settled, e.tick))
    });
    let Some((settled, tick)) = step else { return };
    web.setAutoresizingMask(NSAutoresizingMaskOptions::empty());
    web.setFrame(NSRect::new(NSPoint::new(0.0, 0.0), settled));
    let (bw, bh) = crate::resize::live_bounds((settled.width, settled.height), (frame.width, frame.height));
    host.setBoundsSize(NSSize::new(bw, bh));
    // Settle once no change follows this one for SETTLE.
    let (k, host_w, web_w) = (key.to_owned(), Weak::from(host), Weak::from(&*web));
    let block = RcBlock::new(move |_timer: std::ptr::NonNull<AnyObject>| {
        let due = RESIZING.with(|r| {
            let Ok(mut r) = r.try_borrow_mut() else { return false };
            match r.get_mut(&k) {
                Some(e) if e.tick == tick && crate::resize::settles(e.last.elapsed()) => {
                    e.settled = None;
                    true
                }
                _ => false,
            }
        });
        if due && let (Some(host), Some(web)) = (host_w.load(), web_w.load()) {
            settle(&host, &web);
        }
    });
    let Some(cls) = objc2::runtime::AnyClass::get(c"NSTimer") else { return };
    let _: Retained<AnyObject> = unsafe {
        msg_send![cls, scheduledTimerWithTimeInterval: crate::resize::SETTLE.as_secs_f64(), repeats: false, block: &*block]
    };
}

/// A resize ended: the host's bounds its frame again, the web view the host's
/// size (its one layout) and following the host as before.
fn settle(host: &NSView, web: &WKWebView) {
    host.setBoundsSize(host.frame().size);
    // Moved elsewhere meanwhile (`put` set it up there): leave it.
    if !is_in(web, host) {
        return;
    }
    web.setFrame(host.bounds());
    web.setAutoresizingMask(NSAutoresizingMaskOptions::ViewWidthSizable | NSAutoresizingMaskOptions::ViewHeightSizable);
}

/// The web view `key`'s host holds now, if any.
fn web_in(key: &str, host: &NSView) -> Option<Retained<WKWebView>> {
    let of = ATTACHED.with(|a| a.try_borrow().ok().and_then(|a| a.get(key).map(|p| p.of.clone())))?;
    let web = with_session(&of, |s| s.web.load()).flatten()?;
    is_in(&web, host).then_some(web)
}

/// A `pip` view went. If it was showing the video, the video goes home:
/// nothing would show it (a player closed by Herdr, e.g. a layout switch).
pub(crate) fn detach(key: &str) {
    RESIZING.with(|r| r.borrow_mut().remove(key));
    let Some(p) = ATTACHED.with(|a| a.borrow_mut().remove(key)) else { return };
    let showing = with_session(&p.of, |s| s.web.load().is_some_and(|w| p.host.load().is_some_and(|h| is_in(&w, &h))));
    if showing == Some(true)
        && let Some(mtm) = MainThreadMarker::new()
    {
        end(mtm, &p.of, false);
    }
}

/// A `pip` view's actions (`pip.toggle`, `pip.back`, `pip.close`, `pip.popOut`).
pub(crate) fn action(mtm: MainThreadMarker, key: &str, action: &str, args: &Value) -> Result<Value, String> {
    let (of, generation) = ATTACHED
        .with(|a| a.borrow().get(key).map(|p| (p.of.clone(), p.generation)))
        .ok_or("this view shows nothing")?;
    if !active(&of) {
        return Err("nothing of this page is in the player".into());
    }
    match action {
        "pip.toggle" | "pip.seek" | "pip.mute" | "pip.sync" => {
            let media = Media::parse(action, args)?;
            let (web, frame) = with_session(&of, |s| (s.web.load(), s.frame.clone())).ok_or("gone")?;
            let web = web.ok_or("the page is gone")?;
            let k = key.to_owned();
            run_then(mtm, &web, frame.as_deref(), &media.script(), move |r| emit_event(&k, generation, "pip.state", media_state(r)));
            Ok(Value::Null)
        }
        "pip.back" => {
            back(mtm, &of);
            Ok(Value::Null)
        }
        "pip.close" => {
            end(mtm, &of, false);
            Ok(Value::Null)
        }
        "pip.popOut" => {
            let host = ATTACHED.with(|a| a.borrow().get(key).and_then(|p| p.host.load())).ok_or("this view shows nothing")?;
            let rect = corner(&host).ok_or("this view is not on screen")?;
            let popped = Popped::new(mtm, &of, rect, &args["colors"]);
            let target = popped.target.clone();
            with_session(&of, |s| {
                if let Some(old) = s.popped.replace(popped) {
                    old.panel.orderOut(None);
                }
            });
            place(&of);
            // Its buttons start as the video is.
            target.media(Media::Sync);
            Ok(Value::Null)
        }
        a => Err(format!("`{a}` is unavailable right now")),
    }
}

/// For `state`.
pub(crate) fn state(key: &str) -> Value {
    let of = ATTACHED.with(|a| a.borrow().get(key).map(|p| p.of.clone()));
    let session = of.as_deref().and_then(|of| {
        with_session(of, |s| {
            let web = s.web.load();
            let showing = web.as_ref().is_some_and(|w| holder(&s.source).is_some_and(|h| is_in(w, &h)));
            let in_popped = web.as_ref().is_some_and(|w| s.popped.as_ref().is_some_and(|p| is_in(w, &p.host)));
            json!({ "lifted": s.lifted, "showing": showing, "popped": s.popped.is_some(), "inPopped": in_popped, "frame": s.frame.is_some() })
        })
    });
    json!({ "of": of, "session": session })
}

// ---- popped out: a square window above every app

const BAR: f64 = 22.0;
/// The window's 1 px border, and the bar: what isn't video.
const CHROME_W: f64 = 2.0;
const CHROME_H: f64 = BAR + 2.0;
/// The title keeps this much before the buttons (as the Herdr player's bar).
const TITLE_MIN: f64 = 70.0;
const TITLE: &str = "picture in picture";
// Copies of nocturne-pip's icons: the Nix app build leaves defaults/mods out of
// the crate's sources (they ship in the bundle), so the crate carries its own.
const VOLUME_SVG: &str = include_str!("../icons/volume.svg");
const VOLUME_X_SVG: &str = include_str!("../icons/volume-x.svg");

/// The popped-out player: the video under the Herdr player's bar, the same
/// controls in the same order (↩ « ❚❚ » sound ◧ ⤓ ⇲ ✕; ⇲ in the place of ⇱),
/// Nocturne's colors, square corners. It resizes keeping the video's shape.
struct Popped {
    panel: Retained<NSPanel>,
    host: Retained<NSView>,
    target: Retained<PopTarget>,
}

pub struct PopIvars {
    source: String,
    buttons: RefCell<Vec<Retained<PipButton>>>,
    title: RefCell<Option<Retained<NSTextField>>>,
    /// The video's width / height (0: not known yet).
    aspect: std::cell::Cell<f64>,
}

#[derive(Clone)]
struct Colors {
    background: Retained<NSColor>,
    foreground: Retained<NSColor>,
    dim: Retained<NSColor>,
    border: Retained<NSColor>,
    hover: Retained<NSColor>,
}

/// One control of the bar, as the Herdr player draws it: a glyph or an icon,
/// dim; hovered: bright on the hover color, its name in the bar's title.
pub struct ButtonIvars {
    id: &'static str,
    name: RefCell<String>,
    glyph: RefCell<String>,
    icon: RefCell<Option<Retained<NSImage>>>,
    hovered: std::cell::Cell<bool>,
    back: Retained<NSBox>,
    colors: Colors,
    title: Weak<NSTextField>,
}

define_class!(
    // SAFETY: NSButton may be subclassed; only mouse tracking is added; no Drop impl.
    #[unsafe(super(NSButton, NSControl, NSView, NSResponder, NSObject))]
    #[thread_kind = MainThreadOnly]
    #[ivars = ButtonIvars]
    struct PipButton;

    impl PipButton {
        #[unsafe(method(mouseEntered:))]
        fn mouse_entered(&self, _event: &NSEvent) {
            self.ivars().hovered.set(true);
            self.refresh();
        }

        #[unsafe(method(mouseExited:))]
        fn mouse_exited(&self, _event: &NSEvent) {
            self.ivars().hovered.set(false);
            self.refresh();
        }
    }
);

impl PipButton {
    fn new(mtm: MainThreadMarker, frame: NSRect, id: &'static str, back: Retained<NSBox>, colors: Colors, title: &NSTextField) -> Retained<Self> {
        let this = Self::alloc(mtm).set_ivars(ButtonIvars {
            id,
            name: RefCell::new(String::new()),
            glyph: RefCell::new(String::new()),
            icon: RefCell::new(None),
            hovered: std::cell::Cell::new(false),
            back,
            colors,
            title: Weak::from(title),
        });
        let this: Retained<Self> = unsafe { msg_send![super(this), initWithFrame: frame] };
        this.setBordered(false);
        let opts = NSTrackingAreaOptions::MouseEnteredAndExited | NSTrackingAreaOptions::ActiveAlways | NSTrackingAreaOptions::InVisibleRect;
        let area = unsafe { NSTrackingArea::initWithRect_options_owner_userInfo(NSTrackingArea::alloc(), NSRect::ZERO, opts, Some(&this), None) };
        this.addTrackingArea(&area);
        this
    }

    /// Its glyph (or icon) and name now.
    fn set(&self, glyph: &str, icon: Option<Retained<NSImage>>, name: &str) {
        *self.ivars().glyph.borrow_mut() = glyph.to_owned();
        *self.ivars().icon.borrow_mut() = icon;
        *self.ivars().name.borrow_mut() = name.to_owned();
        self.refresh();
    }

    fn refresh(&self) {
        let i = self.ivars();
        let on = i.hovered.get();
        let color = if on { &i.colors.foreground } else { &i.colors.dim };
        i.back.setHidden(!on);
        match i.icon.borrow().as_ref() {
            Some(img) => {
                self.setTitle(&NSString::from_str(""));
                self.setImage(Some(img));
                self.setImagePosition(NSCellImagePosition::ImageOnly);
                self.setContentTintColor(Some(color));
            }
            None => {
                self.setImage(None);
                set_title(self, &i.glyph.borrow(), color);
            }
        }
        // Its name where the title is, as the Herdr player does (a tooltip would
        // be drawn under the video there).
        if let Some(t) = i.title.load() {
            if on {
                t.setStringValue(&NSString::from_str(&i.name.borrow()));
                t.setTextColor(Some(&i.colors.foreground));
            } else {
                t.setStringValue(&NSString::from_str(TITLE));
                t.setTextColor(Some(&i.colors.dim));
            }
        }
    }
}

define_class!(
    // SAFETY: NSObject has no subclassing requirements; no Drop impl.
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[ivars = PopIvars]
    struct PopTarget;

    unsafe impl NSObjectProtocol for PopTarget {}

    unsafe impl NSWindowDelegate for PopTarget {
        /// Resizing (any edge or corner) keeps the video's shape.
        #[unsafe(method(windowWillResize:toSize:))]
        fn window_will_resize(&self, sender: &NSWindow, to: NSSize) -> NSSize {
            let now = sender.frame().size;
            fit_aspect(self.ivars().aspect.get(), now, to)
        }
    }

    impl PopTarget {
        #[unsafe(method(press:))]
        fn press(&self, sender: Option<&AnyObject>) {
            let Some(id) = sender.and_then(|s| s.downcast_ref::<PipButton>()).map(|b| b.ivars().id) else { return };
            let Some(mtm) = MainThreadMarker::new() else { return };
            let k = self.ivars().source.clone();
            match id {
                "back" => {
                    back(mtm, &k);
                    #[allow(deprecated)]
                    NSApplication::sharedApplication(mtm).activateIgnoringOtherApps(true);
                }
                "rewind" => self.media(Media::Seek(-10.0)),
                "toggle" => self.media(Media::Toggle),
                "forward" => self.media(Media::Seek(10.0)),
                "mute" => self.media(Media::Mute(None)),
                // Back into Herdr (as a window, or then into a pane or a chip):
                // the page's mod opens a player again; it takes the video.
                "home" | "pane" | "park" => {
                    let g = with_session(&k, |s| s.generation).unwrap_or(0);
                    let then = if id == "home" { Value::Null } else { json!(id) };
                    emit_event(&k, g, "pip.popIn", json!({ "of": k, "then": then }));
                    #[allow(deprecated)]
                    NSApplication::sharedApplication(mtm).activateIgnoringOtherApps(true);
                }
                "close" => end(mtm, &k, false),
                _ => {}
            }
        }
    }
);

/// The size a resize to `to` (from `now`) ends at, keeping the video's
/// `aspect` (width / height; 0: any) under the bar: the side moved most
/// leads. Never under `MIN_W` wide.
fn fit_aspect(aspect: f64, now: NSSize, to: NSSize) -> NSSize {
    let w = to.width.max(MIN_W);
    if aspect <= 0.0 {
        return NSSize::new(w, to.height);
    }
    let by_width = (w - now.width).abs() / now.width.max(1.0) >= (to.height - now.height).abs() / now.height.max(1.0);
    if by_width {
        NSSize::new(w, (w - CHROME_W) / aspect + CHROME_H)
    } else {
        let w = ((to.height - CHROME_H) * aspect + CHROME_W).max(MIN_W);
        NSSize::new(w, (w - CHROME_W) / aspect + CHROME_H)
    }
}

/// Room for the title's minimum and every control.
const MIN_W: f64 = 8.0 + TITLE_MIN + BAR * 9.0 + CHROME_W;

impl PopTarget {
    /// Does `m` to the video; the buttons then show how it is, and the
    /// window takes the video's shape.
    fn media(&self, m: Media) {
        let Some(mtm) = MainThreadMarker::new() else { return };
        let k = self.ivars().source.clone();
        let Some((Some(web), frame)) = with_session(&k, |s| (s.web.load(), s.frame.clone())) else { return };
        run_then(mtm, &web, frame.as_deref(), &m.script(), move |r| {
            let r = media_state(r);
            let me = with_session(&k, |s| s.popped.as_ref().map(|p| (p.target.clone(), p.panel.clone()))).flatten();
            if let Some((me, panel)) = me {
                me.show(r["result"] == "playing", r["muted"] == true);
                let (w, h) = (r["width"].as_f64().unwrap_or(0.0), r["height"].as_f64().unwrap_or(0.0));
                if w > 0.0 && h > 0.0 && (me.ivars().aspect.get() - w / h).abs() > 0.001 {
                    me.ivars().aspect.set(w / h);
                    // Its width stays, the height follows; the top edge stays put.
                    let f = panel.frame();
                    let size = fit_aspect(w / h, f.size, f.size);
                    let top = f.origin.y + f.size.height;
                    panel.setFrame_display(NSRect::new(NSPoint::new(f.origin.x, top - size.height), size), true);
                }
            }
        });
    }

    fn button(&self, id: &str) -> Option<Retained<PipButton>> {
        self.ivars().buttons.borrow().iter().find(|b| b.ivars().id == id).cloned()
    }

    fn show(&self, playing: bool, muted: bool) {
        if let Some(b) = self.button("toggle") {
            b.set(if playing { "❚❚" } else { "▶" }, None, if playing { "Pause" } else { "Play" });
        }
        if let Some(b) = self.button("mute") {
            b.set("", icon(if muted { VOLUME_X_SVG } else { VOLUME_SVG }), if muted { "Sound on" } else { "Sound off" });
        }
    }
}

/// One of the player's Lucide icons, 12 pt, tinted like text.
fn icon(svg: &str) -> Option<Retained<NSImage>> {
    let data = NSData::with_bytes(svg.as_bytes());
    let img = NSImage::initWithData(NSImage::alloc(), &data)?;
    img.setSize(NSSize::new(12.0, 12.0));
    img.setTemplate(true);
    Some(img)
}

impl Popped {
    /// `rect`: the Herdr player's video on screen; the window adds the bar
    /// and border around it.
    fn new(mtm: MainThreadMarker, source: &str, rect: NSRect, colors: &Value) -> Popped {
        let colors = Colors::parse(colors);
        let size = NSSize::new((rect.size.width + CHROME_W).max(MIN_W), rect.size.height + CHROME_H);
        let frame = NSRect::new(rect.origin, size);
        let style = NSWindowStyleMask::Borderless | NSWindowStyleMask::NonactivatingPanel | NSWindowStyleMask::Resizable;
        let panel = NSPanel::initWithContentRect_styleMask_backing_defer(NSPanel::alloc(mtm), frame, style, NSBackingStoreType::Buffered, false);
        unsafe { panel.setReleasedWhenClosed(false) };
        panel.setLevel(NSFloatingWindowLevel);
        panel.setCollectionBehavior(NSWindowCollectionBehavior::CanJoinAllSpaces | NSWindowCollectionBehavior::FullScreenAuxiliary);
        panel.setMovableByWindowBackground(true);
        panel.setHasShadow(false);
        panel.setHidesOnDeactivate(false);
        panel.setBackgroundColor(Some(&colors.background));
        let (w, h) = (size.width, size.height);
        let content = NSView::initWithFrame(NSView::alloc(mtm), NSRect::new(NSPoint::new(0.0, 0.0), size));
        panel.setContentView(Some(&content));
        let sizing = NSAutoresizingMaskOptions::ViewWidthSizable | NSAutoresizingMaskOptions::ViewHeightSizable;
        // The frame: a 1 px square border around the background.
        let frame_box = flat_box(mtm, NSRect::new(NSPoint::new(0.0, 0.0), size), &colors.background, Some(&colors.border));
        frame_box.setAutoresizingMask(sizing);
        content.addSubview(&frame_box);
        // The video, inside the border, under the bar.
        let host = NSView::initWithFrame(NSView::alloc(mtm), NSRect::new(NSPoint::new(1.0, 1.0), NSSize::new(w - CHROME_W, h - CHROME_H)));
        host.setAutoresizingMask(sizing);
        content.addSubview(&host);
        // The bar (22 px with its rule, as in Herdr): the title, then the controls flush right.
        let bar = NSView::initWithFrame(NSView::alloc(mtm), NSRect::new(NSPoint::new(1.0, h - 1.0 - BAR), NSSize::new(w - CHROME_W, BAR)));
        bar.setAutoresizingMask(NSAutoresizingMaskOptions::ViewWidthSizable | NSAutoresizingMaskOptions::ViewMinYMargin);
        content.addSubview(&bar);
        let rule = flat_box(mtm, NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(w - CHROME_W, 1.0)), &colors.border, None);
        rule.setAutoresizingMask(NSAutoresizingMaskOptions::ViewWidthSizable);
        bar.addSubview(&rule);
        let title = NSTextField::labelWithString(&NSString::from_str(TITLE), mtm);
        title.setFont(Some(&font()));
        title.setTextColor(Some(&colors.dim));
        let target = PopTarget::new(mtm, source);
        let controls: [(&'static str, &str, Option<&str>, &str); 9] = [
            ("back", "↩", None, "Back to the page"),
            ("rewind", "«", None, "Back 10 seconds"),
            ("toggle", "❚❚", None, "Pause"),
            ("forward", "»", None, "On 10 seconds"),
            ("mute", "", Some(VOLUME_SVG), "Sound off"),
            ("pane", "◧", None, "Into a pane"),
            ("park", "⤓", None, "Park as a chip"),
            ("home", "⇲", None, "Back into Herdr"),
            ("close", "✕", None, "Close"),
        ];
        let inner = w - CHROME_W;
        let mut x = inner - BAR * controls.len() as f64;
        // The title up to the controls, cut short (…) when the window is narrow.
        title.setFrame(NSRect::new(NSPoint::new(8.0, 3.0), NSSize::new((x - 12.0).max(0.0), 15.0)));
        title.setAutoresizingMask(NSAutoresizingMaskOptions::ViewWidthSizable);
        title.setLineBreakMode(objc2_app_kit::NSLineBreakMode::ByTruncatingTail);
        bar.addSubview(&title);
        for (id, glyph, svg, name) in controls {
            let cell = NSRect::new(NSPoint::new(x, 1.0), NSSize::new(BAR, BAR - 1.0));
            let back = flat_box(mtm, cell, &colors.hover, None);
            back.setHidden(true);
            back.setAutoresizingMask(NSAutoresizingMaskOptions::ViewMinXMargin);
            bar.addSubview(&back);
            let b = PipButton::new(mtm, cell, id, back, colors.clone(), &title);
            b.set(glyph, svg.and_then(icon), name);
            unsafe {
                b.setTarget(Some(&target));
                b.setAction(Some(sel!(press:)));
            }
            b.setAutoresizingMask(NSAutoresizingMaskOptions::ViewMinXMargin);
            bar.addSubview(&b);
            target.ivars().buttons.borrow_mut().push(b);
            x += BAR;
        }
        *target.ivars().title.borrow_mut() = Some(title);
        panel.setDelegate(Some(ProtocolObject::from_ref(&*target)));
        panel.setContentMinSize(NSSize::new(MIN_W, 100.0));
        panel.orderFrontRegardless();
        Popped { panel, host, target }
    }
}

impl PopTarget {
    fn new(mtm: MainThreadMarker, source: &str) -> Retained<Self> {
        let this = Self::alloc(mtm).set_ivars(PopIvars {
            source: source.to_owned(),
            buttons: RefCell::new(Vec::new()),
            title: RefCell::new(None),
            aspect: std::cell::Cell::new(0.0),
        });
        unsafe { msg_send![super(this), init] }
    }
}

impl Colors {
    /// `{ background, foreground, dim, border, hover }` as `#rrggbb[aa]`; Nocturne's dark defaults.
    fn parse(v: &Value) -> Colors {
        let get = |k: &str, d: &str| color(v.get(k).and_then(Value::as_str).and_then(hex).unwrap_or_else(|| hex(d).unwrap()));
        Colors {
            background: get("background", "#0b0b0d"),
            foreground: get("foreground", "#d6d6d6"),
            dim: get("dim", "#6b6b6b"),
            border: get("border", "#2a2a2e"),
            hover: get("hover", "#1c1c20"),
        }
    }
}

/// A square, flat rectangle: `fill`, and a 1 px `border` if given.
fn flat_box(mtm: MainThreadMarker, frame: NSRect, fill: &NSColor, border: Option<&NSColor>) -> Retained<NSBox> {
    let b = NSBox::initWithFrame(NSBox::alloc(mtm), frame);
    b.setBoxType(NSBoxType::Custom);
    b.setTitlePosition(NSTitlePosition::NoTitle);
    b.setCornerRadius(0.0);
    b.setFillColor(fill);
    match border {
        Some(c) => {
            b.setBorderColor(c);
            b.setBorderWidth(1.0);
        }
        None => b.setBorderWidth(0.0),
    }
    b.setContentViewMargins(NSSize::new(0.0, 0.0));
    b
}

/// `#rrggbb` or `#rrggbbaa` as 0–1 components.
pub(crate) fn hex(s: &str) -> Option<[f64; 4]> {
    let h = s.strip_prefix('#')?;
    if !(h.len() == 6 || h.len() == 8) || !h.is_ascii() {
        return None;
    }
    let n = |i: usize| u8::from_str_radix(&h[i..i + 2], 16).ok().map(|b| f64::from(b) / 255.0);
    Some([n(0)?, n(2)?, n(4)?, if h.len() == 8 { n(6)? } else { 1.0 }])
}

fn color([r, g, b, a]: [f64; 4]) -> Retained<NSColor> {
    NSColor::colorWithSRGBRed_green_blue_alpha(r, g, b, a)
}

/// Nocturne's font when the system has it, else the system's monospaced one.
fn font() -> Retained<NSFont> {
    NSFont::fontWithName_size(&NSString::from_str("Departure Mono"), 11.0)
        .unwrap_or_else(|| NSFont::monospacedSystemFontOfSize_weight(11.0, unsafe { objc2_app_kit::NSFontWeightRegular }))
}

fn set_title(b: &NSButton, text: &str, color: &NSColor) {
    let attrs = NSDictionary::<NSAttributedStringKey, AnyObject>::from_slices(
        &[unsafe { NSForegroundColorAttributeName }, unsafe { NSFontAttributeName }],
        &[color.as_ref(), font().as_ref()],
    );
    let s = unsafe { NSAttributedString::new_with_attributes(&NSString::from_str(text), &attrs) };
    b.setAttributedTitle(&s);
}

/// Where the popped-out window goes: the player's size, in the bottom right
/// corner of its screen (in place, it would look as if nothing happened).
fn corner(view: &NSView) -> Option<NSRect> {
    let rect = screen_rect(view)?;
    let Some(screen) = view.window().and_then(|w| w.screen()) else { return Some(rect) };
    let area = screen.visibleFrame();
    const MARGIN: f64 = 16.0;
    let x = area.origin.x + area.size.width - rect.size.width - MARGIN;
    let y = area.origin.y + MARGIN;
    Some(NSRect::new(NSPoint::new(x.max(area.origin.x), y), rect.size))
}

/// A view's rectangle in screen points.
fn screen_rect(view: &NSView) -> Option<NSRect> {
    let window = view.window()?;
    let in_window = view.convertRect_toView(view.bounds(), None);
    Some(window.convertRectToScreen(in_window))
}

#[cfg(test)]
mod tests {
    use super::{CHROME_H, CHROME_W, MIN_W, Media, fit_aspect, hex, media_state, seek_by};
    use objc2_foundation::NSSize;

    #[test]
    fn the_popped_window_keeps_the_videos_shape_from_any_edge() {
        let now = NSSize::new(400.0, 300.0);
        // Wider by its right edge: as much taller as a 4:3 video needs.
        let s = fit_aspect(4.0 / 3.0, now, NSSize::new(482.0, 300.0));
        assert_eq!((s.width, s.height), (482.0, 360.0 + CHROME_H));
        // Taller by its bottom edge: wider to match.
        let s = fit_aspect(4.0 / 3.0, now, NSSize::new(400.0, 300.0 + 60.0));
        assert!(((s.width - CHROME_W) / (s.height - CHROME_H) - 4.0 / 3.0).abs() < 1e-9);
        // Never narrower than its controls need; unknown shape: as dragged.
        assert_eq!(fit_aspect(16.0 / 9.0, now, NSSize::new(100.0, 100.0)).width, MIN_W);
        assert_eq!(fit_aspect(0.0, now, NSSize::new(500.0, 333.0)).height, 333.0);
    }
    use serde_json::json;

    #[test]
    fn media_actions_are_fixed_scripts_that_report_play_and_sound() {
        assert_eq!(Media::parse("pip.mute", &json!({})), Ok(Media::Mute(None)));
        assert_eq!(Media::parse("pip.mute", &json!({ "muted": true })), Ok(Media::Mute(Some(true))));
        assert_eq!(Media::parse("pip.seek", &json!({ "by": 10 })), Ok(Media::Seek(10.0)));
        assert!(Media::parse("pip.seek", &json!({})).is_err());
        for m in [Media::Toggle, Media::Seek(-10.0), Media::Mute(None), Media::Mute(Some(false)), Media::Sync] {
            assert!(m.script().contains("muted: v.muted"), "{m:?}");
        }
        assert!(Media::Sync.script().contains("width: v.videoWidth, height: v.videoHeight"));
        let r = media_state(json!({ "result": r#"{"result":"paused","muted":true}"# }));
        assert_eq!((r["result"].as_str(), r["muted"].as_bool()), (Some("paused"), Some(true)));
        assert_eq!(media_state(json!({ "result": "none" }))["result"], "none");
    }

    #[test]
    fn seek_takes_finite_seconds_within_an_hour() {
        assert_eq!(seek_by(&json!({ "by": -10 })), Ok(-10.0));
        assert_eq!(seek_by(&json!({ "by": 1e9 })), Ok(3600.0));
        assert!(seek_by(&json!({})).is_err());
        assert!(seek_by(&json!({ "by": "10; alert(1)" })).is_err());
    }

    #[test]
    fn theme_colors_parse_as_hex() {
        assert_eq!(hex("#ff0080"), Some([1.0, 0.0, 128.0 / 255.0, 1.0]));
        assert_eq!(hex("#00000080").map(|c| c[3]), Some(128.0 / 255.0));
        for bad in ["ff0080", "#ff00", "#gg0000", "border", "#ff00800"] {
            assert_eq!(hex(bad), None, "{bad}");
        }
    }
}

#[cfg(test)]
mod icon_copies {
    #[test]
    fn match_the_mods_icons() {
        assert_eq!(super::VOLUME_SVG, include_str!("../../../defaults/mods/nocturne-pip/icons/volume.svg"));
        assert_eq!(super::VOLUME_X_SVG, include_str!("../../../defaults/mods/nocturne-pip/icons/volume-x.svg"));
    }
}
