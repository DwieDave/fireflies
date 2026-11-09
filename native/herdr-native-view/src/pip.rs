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
use objc2::{DefinedClass, MainThreadMarker, MainThreadOnly, define_class, msg_send, sel};
use objc2_app_kit::{
    NSApplication, NSAutoresizingMaskOptions, NSBackingStoreType, NSBox, NSBoxType, NSButton, NSColor, NSTitlePosition,
    NSFloatingWindowLevel, NSFont, NSFontAttributeName, NSForegroundColorAttributeName, NSPanel,
    NSTextField, NSView, NSWindowCollectionBehavior, NSWindowStyleMask,
};
use objc2_foundation::{
    NSAttributedString, NSAttributedStringKey, NSDictionary, NSError, NSPoint, NSRect,
    NSSize, NSString,
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

/// What the lift does to the page, while it lasts.
const LIFT_CSS: &str = "html[data-herdr-pip-on] { overflow: hidden !important; } \
[data-herdr-pip]:popover-open, [data-herdr-pip-frame]:popover-open { position: fixed !important; inset: 0 !important; \
width: 100vw !important; height: 100vh !important; max-width: none !important; max-height: none !important; \
min-width: 0 !important; min-height: 0 !important; margin: 0 !important; padding: 0 !important; border: 0 !important; \
transform: none !important; object-fit: contain !important; background: #000 !important; opacity: 1 !important; \
visibility: visible !important; display: block !important; } \
[data-herdr-pip]::backdrop, [data-herdr-pip-frame]::backdrop { background: #000; }";

/// Lifts the element marked `attr` (the video, or in the main frame the
/// iframe holding it) into the top layer, filling the view.
fn lift_script(attr: &str) -> String {
    format!(
        r#"const el = document.querySelector("[{attr}]");
  if (!el) return "none";
  if (!document.getElementById("herdr-pip-style")) {{
    const s = document.createElement("style"); s.id = "herdr-pip-style"; s.textContent = {css};
    (document.head || document.documentElement).appendChild(s);
  }}
  document.documentElement.setAttribute("data-herdr-pip-on", "");
  if (!el.hasAttribute("data-herdr-pip-was")) el.setAttribute("data-herdr-pip-was", el.getAttribute("popover") ?? "-");
  el.popover = "manual";
  try {{ if (!el.matches(":popover-open")) el.showPopover(); }} catch {{}}
  // The video went (the page replaced its player): say so once.
  if (el.tagName === "VIDEO" && !window.__herdrPipWatch) window.__herdrPipWatch = setInterval(() => {{
    if (!el.isConnected) {{ clearInterval(window.__herdrPipWatch); window.__herdrPipWatch = null; try {{ webkit.messageHandlers.herdrPip.postMessage(JSON.stringify({{ type: "lost" }})); }} catch {{}} }}
  }}, 500);
  return "lifted";"#,
        css = serde_json::to_string(LIFT_CSS).unwrap()
    )
}

/// Undoes `lift_script` (and pauses the video when `pause`).
fn unlift_script(pause: bool) -> String {
    format!(
        r#"const pause = {pause};
  if (window.__herdrPipWatch) {{ clearInterval(window.__herdrPipWatch); window.__herdrPipWatch = null; }}
  for (const el of document.querySelectorAll("[data-herdr-pip], [data-herdr-pip-frame]")) {{
    try {{ el.hidePopover(); }} catch {{}}
    const was = el.getAttribute("data-herdr-pip-was");
    if (was === "-" || was === null) el.removeAttribute("popover"); else el.setAttribute("popover", was);
    el.removeAttribute("data-herdr-pip-was");
    if (pause && el.tagName === "VIDEO") el.pause();
  }}
  document.documentElement.removeAttribute("data-herdr-pip-on");
  document.getElementById("herdr-pip-style")?.remove();
  return "done";"#
    )
}

/// In the main frame: marks the iframe whose page is `url` (the frame the video plays in).
fn mark_frame_script(url: &str) -> String {
    format!(
        r#"const want = new URL({url});
  const same = (src) => {{ try {{ const u = new URL(src, location.href); return u.origin === want.origin && u.pathname === want.pathname; }} catch {{ return false; }} }};
  const f = [...document.querySelectorAll("iframe")].find((f) => same(f.src));
  if (!f) return "none";
  for (const o of document.querySelectorAll("[data-herdr-pip-frame]")) o.removeAttribute("data-herdr-pip-frame");
  f.setAttribute("data-herdr-pip-frame", "");
  return "found";"#,
        url = serde_json::to_string(url).unwrap()
    )
}

const TOGGLE_SCRIPT: &str = r#"
  const v = document.querySelector("[data-herdr-pip]");
  if (!v) return "none";
  if (v.paused) { try { await v.play(); } catch {} } else v.pause();
  return v.paused ? "paused" : "playing";
"#;

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
}

thread_local! {
    /// Per web view: the frame that last started a video (`web.pip` looks there second).
    static PLAYED: RefCell<HashMap<String, Retained<WKFrameInfo>>> = RefCell::new(HashMap::new());
    static SESSION: RefCell<Option<Session>> = const { RefCell::new(None) };
    static ATTACHED: RefCell<HashMap<String, Attached>> = RefCell::new(HashMap::new());
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
        if !is_in(&web, &holder) {
            put(&web, &holder);
        }
        let lift = !s.lifted;
        s.lifted = true;
        Some((web, s.frame.clone(), lift))
    })
    .flatten();
    if let Some((web, frame, true)) = todo {
        set_lift(mtm, &web, frame.as_deref(), true, false);
    }
}

/// The view a player gave for `web_key`'s video.
fn holder(web_key: &str) -> Option<Retained<NSView>> {
    ATTACHED.with(|a| a.borrow().values().filter(|p| p.of == web_key).find_map(|p| p.host.load()))
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
    ATTACHED.with(|a| {
        a.borrow_mut().insert(key.to_owned(), Attached { of: of.to_owned(), generation, host: Weak::from(host) })
    });
    // Back into Herdr: the popped-out window goes.
    if let Some(Some(p)) = with_session(of, |s| s.popped.take()) {
        p.panel.orderOut(None);
    }
    place(of);
}

/// A `pip` view went. If it was showing the video, the video goes home:
/// nothing would show it (a player closed by Herdr, e.g. a layout switch).
pub(crate) fn detach(key: &str) {
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
        "pip.toggle" => {
            let (web, frame) = with_session(&of, |s| (s.web.load(), s.frame.clone())).ok_or("gone")?;
            let web = web.ok_or("the page is gone")?;
            let k = key.to_owned();
            run_then(mtm, &web, frame.as_deref(), TOGGLE_SCRIPT, move |r| emit_event(&k, generation, "pip.state", r));
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
            let rect = screen_rect(&host).ok_or("this view is not on screen")?;
            let popped = Popped::new(mtm, &of, rect, &args["colors"]);
            with_session(&of, |s| {
                if let Some(old) = s.popped.replace(popped) {
                    old.panel.orderOut(None);
                }
            });
            place(&of);
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

/// The popped-out player: the video under a 22 px bar (back to the page,
/// back into Herdr, play/pause, close), Nocturne's colors, square corners.
struct Popped {
    panel: Retained<NSPanel>,
    host: Retained<NSView>,
    target: Retained<PopTarget>,
}

pub struct PopIvars {
    source: String,
    play: RefCell<Option<Retained<NSButton>>>,
    colors: RefCell<Colors>,
}

#[derive(Clone)]
struct Colors {
    background: Retained<NSColor>,
    foreground: Retained<NSColor>,
    dim: Retained<NSColor>,
    border: Retained<NSColor>,
}

define_class!(
    // SAFETY: NSObject has no subclassing requirements; no Drop impl.
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[ivars = PopIvars]
    struct PopTarget;

    unsafe impl NSObjectProtocol for PopTarget {}

    impl PopTarget {
        #[unsafe(method(back:))]
        fn back(&self, _sender: Option<&AnyObject>) {
            let Some(mtm) = MainThreadMarker::new() else { return };
            back(mtm, &self.ivars().source.clone());
            #[allow(deprecated)]
            NSApplication::sharedApplication(mtm).activateIgnoringOtherApps(true);
        }

        #[unsafe(method(home:))]
        fn home(&self, _sender: Option<&AnyObject>) {
            let Some(mtm) = MainThreadMarker::new() else { return };
            let k = self.ivars().source.clone();
            let g = with_session(&k, |s| s.generation).unwrap_or(0);
            // The page's mod opens a player in Herdr again; it takes the video.
            emit_event(&k, g, "pip.popIn", json!({ "of": k }));
            #[allow(deprecated)]
            NSApplication::sharedApplication(mtm).activateIgnoringOtherApps(true);
        }

        #[unsafe(method(toggle:))]
        fn toggle(&self, _sender: Option<&AnyObject>) {
            let Some(mtm) = MainThreadMarker::new() else { return };
            let k = self.ivars().source.clone();
            let Some((Some(web), frame)) = with_session(&k, |s| (s.web.load(), s.frame.clone())) else { return };
            run_then(mtm, &web, frame.as_deref(), TOGGLE_SCRIPT, move |r| {
                let me = with_session(&k, |s| s.popped.as_ref().map(|p| p.target.clone())).flatten();
                if let Some(me) = me {
                    me.show_playing(r["result"] == "playing");
                }
            });
        }

        #[unsafe(method(close:))]
        fn close(&self, _sender: Option<&AnyObject>) {
            let Some(mtm) = MainThreadMarker::new() else { return };
            end(mtm, &self.ivars().source.clone(), false);
        }
    }
);

impl PopTarget {
    fn show_playing(&self, playing: bool) {
        if let Some(b) = self.ivars().play.borrow().as_ref() {
            let c = self.ivars().colors.borrow().clone();
            set_title(b, if playing { "❚❚" } else { "▶" }, &c.foreground);
        }
    }
}

impl Popped {
    /// `rect`: the Herdr player's video on screen; the window adds its bar above.
    fn new(mtm: MainThreadMarker, source: &str, rect: NSRect, colors: &Value) -> Popped {
        let colors = Colors::parse(colors);
        let frame = NSRect::new(rect.origin, NSSize::new(rect.size.width, rect.size.height + BAR));
        let style = NSWindowStyleMask::Borderless | NSWindowStyleMask::NonactivatingPanel | NSWindowStyleMask::Resizable;
        let panel = NSPanel::initWithContentRect_styleMask_backing_defer(NSPanel::alloc(mtm), frame, style, NSBackingStoreType::Buffered, false);
        unsafe { panel.setReleasedWhenClosed(false) };
        panel.setLevel(NSFloatingWindowLevel);
        panel.setCollectionBehavior(NSWindowCollectionBehavior::CanJoinAllSpaces | NSWindowCollectionBehavior::FullScreenAuxiliary);
        panel.setMovableByWindowBackground(true);
        panel.setHasShadow(false);
        panel.setHidesOnDeactivate(false);
        panel.setBackgroundColor(Some(&colors.background));
        let w = frame.size.width;
        let h = frame.size.height;
        let content = NSView::initWithFrame(NSView::alloc(mtm), NSRect::new(NSPoint::new(0.0, 0.0), frame.size));
        panel.setContentView(Some(&content));
        let sizing = NSAutoresizingMaskOptions::ViewWidthSizable | NSAutoresizingMaskOptions::ViewHeightSizable;
        // The frame: a 1 px square border around the background.
        let frame_box = flat_box(mtm, NSRect::new(NSPoint::new(0.0, 0.0), frame.size), &colors.background, Some(&colors.border));
        frame_box.setAutoresizingMask(sizing);
        content.addSubview(&frame_box);
        // The video, inside the border, under the bar.
        let host = NSView::initWithFrame(NSView::alloc(mtm), NSRect::new(NSPoint::new(1.0, 1.0), NSSize::new(w - 2.0, h - BAR - 1.0)));
        host.setAutoresizingMask(sizing);
        content.addSubview(&host);
        // The bar: a dim title, then the buttons on the right.
        let bar = NSView::initWithFrame(NSView::alloc(mtm), NSRect::new(NSPoint::new(1.0, h - BAR), NSSize::new(w - 2.0, BAR - 1.0)));
        bar.setAutoresizingMask(NSAutoresizingMaskOptions::ViewWidthSizable | NSAutoresizingMaskOptions::ViewMinYMargin);
        content.addSubview(&bar);
        let rule = flat_box(mtm, NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(w - 2.0, 1.0)), &colors.border, None);
        rule.setAutoresizingMask(NSAutoresizingMaskOptions::ViewWidthSizable);
        bar.addSubview(&rule);
        let title = NSTextField::labelWithString(&NSString::from_str("picture in picture"), mtm);
        title.setFont(Some(&font()));
        title.setTextColor(Some(&colors.dim));
        title.setFrame(NSRect::new(NSPoint::new(8.0, 3.0), NSSize::new(160.0, 15.0)));
        bar.addSubview(&title);
        let target = PopTarget::new(mtm, source, colors.clone());
        let buttons = [("↩", sel!(back:)), ("⇲", sel!(home:)), ("❚❚", sel!(toggle:)), ("✕", sel!(close:))];
        let mut x = w - 2.0 - 24.0 * buttons.len() as f64 - 4.0;
        for (label, action) in buttons {
            let b = NSButton::initWithFrame(NSButton::alloc(mtm), NSRect::new(NSPoint::new(x, 0.0), NSSize::new(24.0, BAR - 1.0)));
            b.setBordered(false);
            set_title(&b, label, &colors.foreground);
            unsafe {
                b.setTarget(Some(&target));
                b.setAction(Some(action));
            }
            b.setAutoresizingMask(NSAutoresizingMaskOptions::ViewMinXMargin);
            bar.addSubview(&b);
            if label == "❚❚" {
                *target.ivars().play.borrow_mut() = Some(b.clone());
            }
            x += 24.0;
        }
        panel.orderFrontRegardless();
        Popped { panel, host, target }
    }
}

impl PopTarget {
    fn new(mtm: MainThreadMarker, source: &str, colors: Colors) -> Retained<Self> {
        let this = Self::alloc(mtm).set_ivars(PopIvars { source: source.to_owned(), play: RefCell::new(None), colors: RefCell::new(colors) });
        unsafe { msg_send![super(this), init] }
    }
}

impl Colors {
    /// `{ background, foreground, dim, border }` as `#rrggbb[aa]`; Nocturne's dark defaults.
    fn parse(v: &Value) -> Colors {
        let get = |k: &str, d: &str| color(v.get(k).and_then(Value::as_str).and_then(hex).unwrap_or_else(|| hex(d).unwrap()));
        Colors {
            background: get("background", "#0b0b0d"),
            foreground: get("foreground", "#d6d6d6"),
            dim: get("dim", "#6b6b6b"),
            border: get("border", "#2a2a2e"),
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

/// A view's rectangle in screen points.
fn screen_rect(view: &NSView) -> Option<NSRect> {
    let window = view.window()?;
    let in_window = view.convertRect_toView(view.bounds(), None);
    Some(window.convertRectToScreen(in_window))
}

#[cfg(test)]
mod tests {
    use super::hex;

    #[test]
    fn theme_colors_parse_as_hex() {
        assert_eq!(hex("#ff0080"), Some([1.0, 0.0, 128.0 / 255.0, 1.0]));
        assert_eq!(hex("#00000080").map(|c| c[3]), Some(128.0 / 255.0));
        for bad in ["ff0080", "#ff00", "#gg0000", "border", "#ff00800"] {
            assert_eq!(hex(bad), None, "{bad}");
        }
    }
}
