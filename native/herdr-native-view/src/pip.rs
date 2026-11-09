//! Picture in Picture for web views (`pip: true`), and `pip` views.
//!
//! WebKit does the media work: a page's video goes into macOS's own Picture
//! in Picture window (`PIPPanel`, in this process). The video view inside it
//! (`WebVideoViewContainer`) is moved into the `pip` view showing that page's
//! video (or the popped-out panel) and the system window is kept out of sight.
//!
//! Taken out of the system window, WebKit can't bring the video home: it
//! leaves the page's video blank. So before any exit the video goes back into
//! the system window, that window is shown, and only then does WebKit exit
//! (`give_back`). Exits a site starts itself are announced by a page script.
//! The private classes are found by name; without them nothing is taken over.

use crate::macos::emit_event;
use block2::RcBlock;
use objc2::rc::{Retained, Weak};
use objc2::runtime::{AnyClass, AnyObject, ProtocolObject};
use objc2::runtime::{NSObject, NSObjectProtocol};
use objc2::{DefinedClass, MainThreadMarker, MainThreadOnly, define_class, msg_send, sel};
use objc2_app_kit::{
    NSApplication, NSAutoresizingMaskOptions, NSBackingStoreType, NSBox, NSBoxType, NSButton, NSColor, NSTitlePosition,
    NSFloatingWindowLevel, NSFont, NSFontAttributeName, NSForegroundColorAttributeName, NSPanel,
    NSTextField, NSView, NSWindow, NSWindowCollectionBehavior, NSWindowStyleMask,
};
use objc2_foundation::{
    NSAttributedString, NSAttributedStringKey, NSDictionary, NSError, NSNumber, NSPoint, NSRect,
    NSSize, NSString,
};
use std::cell::Cell;
use std::ptr::NonNull;
use std::time::{Duration, Instant};
use objc2_web_kit::{
    WKContentWorld, WKFrameInfo, WKScriptMessageHandler, WKUserContentController, WKUserScript,
    WKUserScriptInjectionTime, WKWebView, WKWebViewConfiguration,
};
use serde_json::{Value, json};
use std::cell::RefCell;
use std::collections::HashMap;

/// The message handler the page scripts post to: in WebKit's isolated client
/// world (pages can't reach it) and in the page world (exits only).
pub(crate) const HANDLER: &str = "herdrPip";
const PAGE_HANDLER: &str = "herdrPipPage";

/// Isolated world: reports playback and Picture in Picture, which pages can't fake.
const WATCH_SCRIPT: &str = r#"(() => {
  const post = (type) => { try { webkit.messageHandlers.herdrPip.postMessage(JSON.stringify({ type })); } catch {} };
  const pip = () => document.pictureInPictureElement || [...document.querySelectorAll("video")].find((v) => v.webkitPresentationMode === "picture-in-picture");
  let inPip = false;
  const check = () => { const now = !!pip(); if (now !== inPip) { inPip = now; post(now ? "enter" : "leave"); } };
  addEventListener("play", (e) => { if (e.target instanceof HTMLVideoElement) post("play"); }, true);
  for (const t of ["enterpictureinpicture", "leavepictureinpicture", "webkitpresentationmodechanged"]) addEventListener(t, check, true);
})();"#;

/// Page world: a site ending Picture in Picture itself says so first and
/// waits, so the video is back in macOS's window before WebKit takes it home
/// (taken out of it, WebKit leaves the page's video blank).
const EXIT_SCRIPT: &str = r#"(() => {
  const announce = () => new Promise((r) => { try { webkit.messageHandlers.herdrPipPage.postMessage("exiting"); } catch {} setTimeout(r, 350); });
  const exit = Document.prototype.exitPictureInPicture;
  if (exit) Document.prototype.exitPictureInPicture = async function () { await announce(); return exit.call(this); };
  const set = HTMLVideoElement.prototype.webkitSetPresentationMode;
  if (set) HTMLVideoElement.prototype.webkitSetPresentationMode = function (mode) {
    if (mode !== "picture-in-picture" && this.webkitPresentationMode === "picture-in-picture") { announce().then(() => set.call(this, mode)); return; }
    return set.call(this, mode);
  };
})();"#;

/// `web.pip`: the frame's biggest video (a playing one first) goes into
/// Picture in Picture, or comes back from it.
const PICK_SCRIPT: &str = r#"
  const now = document.pictureInPictureElement || [...document.querySelectorAll("video")].find((v) => v.webkitPresentationMode === "picture-in-picture");
  if (now) { if (document.exitPictureInPicture) await document.exitPictureInPicture(); else now.webkitSetPresentationMode("inline"); return "exited"; }
  const area = (v) => v.clientWidth * v.clientHeight;
  const vs = [...document.querySelectorAll("video")].filter((v) => v.readyState > 0 && area(v) > 0);
  vs.sort((a, b) => (b.paused ? 0 : 1) - (a.paused ? 0 : 1) || area(b) - area(a));
  const v = vs[0];
  if (!v) return "none";
  try { await v.requestPictureInPicture(); }
  catch (e) { if (v.webkitSupportsPresentationMode?.("picture-in-picture")) v.webkitSetPresentationMode("picture-in-picture"); else throw e; }
  return "entered";
"#;


/// Ends Picture in Picture from the isolated world; `resume` plays the video
/// on in the page if it was playing (WebKit pauses it on exit).
fn exit_script(resume: bool) -> String {
    format!(
        r#"const resume = {resume};
  const v = document.pictureInPictureElement || [...document.querySelectorAll("video")].find((v) => v.webkitPresentationMode === "picture-in-picture");
  if (!v) return "none";
  const playing = !v.paused;
  if (document.pictureInPictureElement) await document.exitPictureInPicture(); else v.webkitSetPresentationMode("inline");
  if (resume && playing) {{ await new Promise((r) => setTimeout(r, 400)); try {{ await v.play(); }} catch {{}} }}
  return playing ? "playing" : "paused";"#
    )
}

const TOGGLE_SCRIPT: &str = r#"
  const v = document.pictureInPictureElement || [...document.querySelectorAll("video")].find((v) => v.webkitPresentationMode === "picture-in-picture");
  if (!v) return "none";
  if (v.paused) { try { await v.play(); } catch {} } else v.pause();
  return v.paused ? "paused" : "playing";
"#;

/// How long a give-back waits for WebKit's exit before taking the video again
/// (an exit that never came, e.g. a page announcing one it doesn't make).
const RETURN_GRACE: f64 = 2.0;
/// With no player to take it, the system window stays hidden this long (the
/// page's mod opens one), then shows: the video is never lost from view.
const PLAYER_GRACE: Duration = Duration::from_millis(1500);

/// The one video in Picture in Picture.
struct Session {
    /// The web view it came from, and that view's load generation.
    source: String,
    generation: u64,
    web: Weak<WKWebView>,
    /// The frame whose video it is (exits and play/pause run there).
    frame: Retained<WKFrameInfo>,
    /// macOS's own window and WebKit's video view, once found.
    panel: Option<Retained<NSWindow>>,
    video: Option<Retained<NSView>>,
    /// Given back to the system window; WebKit is about to exit.
    returning: bool,
    /// Counts give-backs, so a late timer for an earlier one does nothing.
    serial: u64,
    started: Instant,
    /// Polls while the session lives (the panel appears after `enter`).
    timer: Option<Retained<AnyObject>>,
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
    /// Per web view: the frame that last started a video (`web.pip` looks there first).
    static PLAYED: RefCell<HashMap<String, Retained<WKFrameInfo>>> = RefCell::new(HashMap::new());
    static SESSION: RefCell<Option<Session>> = const { RefCell::new(None) };
    static ATTACHED: RefCell<HashMap<String, Attached>> = RefCell::new(HashMap::new());
}

/// Lets a `pip: true` web view's page use Picture in Picture and report it.
pub(crate) fn configure(
    mtm: MainThreadMarker,
    config: &WKWebViewConfiguration,
    handler: &ProtocolObject<dyn WKScriptMessageHandler>,
) {
    unsafe {
        let yes = NSNumber::new_bool(true);
        let _: () = msg_send![&*config.preferences(), setValue: &*yes, forKey: &*NSString::from_str("allowsPictureInPictureMediaPlayback")];
        let content = config.userContentController();
        let client = WKContentWorld::defaultClientWorld(mtm);
        let page = WKContentWorld::pageWorld(mtm);
        for (src, world) in [(WATCH_SCRIPT, &client), (EXIT_SCRIPT, &page)] {
            let script = WKUserScript::initWithSource_injectionTime_forMainFrameOnly_inContentWorld(
                WKUserScript::alloc(mtm),
                &NSString::from_str(src),
                WKUserScriptInjectionTime::AtDocumentStart,
                false,
                world,
            );
            content.addUserScript(&script);
        }
        content.addScriptMessageHandler_contentWorld_name(handler, &client, &NSString::from_str(HANDLER));
        content.addScriptMessageHandler_contentWorld_name(handler, &page, &NSString::from_str(PAGE_HANDLER));
    }
}

/// Undoes `configure` (the controller holds the handler, which would keep it alive).
pub(crate) fn unconfigure(content: &WKUserContentController) {
    unsafe { content.removeAllScriptMessageHandlers() };
}

/// A message from a page script. `name`: the handler it came through.
pub(crate) fn on_message(web_key: &str, generation: u64, name: &str, body: &str, frame: Retained<WKFrameInfo>) {
    let kind = if name == PAGE_HANDLER {
        // The page world can post anything: only ever an exit announcement.
        "exiting"
    } else {
        match serde_json::from_str::<Value>(body).ok().and_then(|v| v["type"].as_str().map(str::to_owned)).as_deref() {
            Some("play") => "play",
            Some("enter") => "enter",
            Some("leave") => "leave",
            _ => return,
        }
    };
    match kind {
        "play" => {
            PLAYED.with(|p| p.borrow_mut().insert(web_key.to_owned(), frame));
        }
        "enter" => {
            PLAYED.with(|p| p.borrow_mut().insert(web_key.to_owned(), frame.clone()));
            begin(web_key, generation, frame);
            emit_event(web_key, generation, "pip.enter", json!({ "of": web_key }));
        }
        "leave" => {
            finish(web_key);
            emit_event(web_key, generation, "pip.leave", json!({}));
        }
        "exiting" => {
            let Some(mtm) = MainThreadMarker::new() else { return };
            with_session(web_key, |s| give_back(mtm, s));
        }
        _ => {}
    }
}

/// `web.pip`: toggles Picture in Picture for the page's video. Runs in the
/// frame that last played a video (an embedded player), else the main frame.
pub(crate) fn start(mtm: MainThreadMarker, web_key: &str, generation: u64, web: &WKWebView) -> Result<Value, String> {
    if active(web_key) {
        end(mtm, web_key, false);
        return Ok(json!({ "of": web_key, "active": false }));
    }
    let frame = PLAYED.with(|p| p.borrow().get(web_key).cloned());
    run(mtm, web, frame.as_deref(), PICK_SCRIPT, web_key, generation, "pip.start");
    Ok(json!({ "of": web_key, "active": true }))
}

/// Runs one of this module's scripts in `frame` (None: the main frame) of the
/// isolated world; its result or error comes back to `key` as `event`.
fn run(
    mtm: MainThreadMarker,
    web: &WKWebView,
    frame: Option<&WKFrameInfo>,
    script: &str,
    key: &str,
    generation: u64,
    event: &'static str,
) {
    let k = key.to_owned();
    run_then(mtm, web, frame, script, move |data| emit_event(&k, generation, event, data));
}

/// `run`, handing the result (`{ result }` or `{ error }`) to `then`.
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

/// The web view or its page is gone: forget it (its video went with it).
pub(crate) fn web_gone(web_key: &str) {
    PLAYED.with(|p| p.borrow_mut().remove(web_key));
    finish(web_key);
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

/// A page's video went into Picture in Picture.
fn begin(web_key: &str, generation: u64, frame: Retained<WKFrameInfo>) {
    let Some(mtm) = MainThreadMarker::new() else { return };
    // One at a time: another page's video goes home first.
    let other = SESSION.with(|s| s.borrow().as_ref().map(|s| s.source.clone())).filter(|o| o != web_key);
    if let Some(o) = other {
        end(mtm, &o, false);
        finish(&o);
    }
    let same = with_session(web_key, |s| {
        // Another video of the same page: find its view again.
        s.frame = frame.clone();
        s.video = None;
        s.returning = false;
        s.started = Instant::now();
    });
    if same.is_none() {
        let web = unsafe { frame.webView() }.map(|w| Weak::from_retained(&w)).unwrap_or_default();
        let timer = repeat(0.1, tick);
        SESSION.with(|s| {
            *s.borrow_mut() = Some(Session {
                source: web_key.to_owned(),
                generation,
                web,
                frame,
                panel: None,
                video: None,
                returning: false,
                serial: 0,
                started: Instant::now(),
                timer: Some(timer),
                popped: None,
            })
        });
    }
    tick();
}

/// Picture in Picture ended (or its page went): drop the session, tell its players.
fn finish(web_key: &str) {
    let Some(s) = SESSION.with(|s| {
        let mut s = s.borrow_mut();
        if s.as_ref().is_some_and(|s| s.source == web_key) { s.take() } else { None }
    }) else {
        return;
    };
    if let Some(t) = &s.timer {
        let _: () = unsafe { msg_send![&**t, invalidate] };
    }
    if let Some(p) = &s.popped {
        p.panel.orderOut(None);
    }
    // An exit nobody announced: the video is still out; put it back anyway.
    if let (Some(panel), Some(video)) = (&s.panel, &s.video)
        && let Some(content) = panel.contentView()
        && !is_in(video, &content)
    {
        put(video, &content);
    }
    for (key, generation) in players_of(web_key) {
        emit_event(&key, generation, "pip.ended", json!({}));
    }
}

/// Exits Picture in Picture the safe way: video back into the system window
/// first, then WebKit's exit. `resume`: the page plays on.
fn end(mtm: MainThreadMarker, web_key: &str, resume: bool) {
    let Some((web, frame)) = with_session(web_key, |s| {
        give_back(mtm, s);
        (s.web.load(), s.frame.clone())
    }) else {
        return;
    };
    let Some(web) = web else { return };
    let k = web_key.to_owned();
    after(0.35, move || {
        let Some(mtm) = MainThreadMarker::new() else { return };
        let g = with_session(&k, |s| s.generation).unwrap_or(0);
        run(mtm, &web, Some(&frame), &exit_script(resume), &k, g, "pip.exit");
    });
}

/// Puts the video back into the shown system window (see the module docs).
fn give_back(_mtm: MainThreadMarker, s: &mut Session) {
    s.returning = true;
    s.serial += 1;
    let serial = s.serial;
    let k = s.source.clone();
    if let (Some(panel), Some(video)) = (&s.panel, &s.video)
        && let Some(content) = panel.contentView()
    {
        if !is_in(video, &content) {
            put(video, &content);
        }
        panel.orderFront(None);
    }
    if let Some(p) = &s.popped {
        p.panel.orderOut(None);
    }
    after(RETURN_GRACE, move || {
        with_session(&k, |s| {
            if s.serial == serial {
                s.returning = false;
            }
        });
    });
}

/// Keeps the video where it belongs: in the player showing it, else (for a
/// moment, until a player opens) hidden in the system window.
fn tick() {
    let Some(mtm) = MainThreadMarker::new() else { return };
    SESSION.with(|cell| {
        let Ok(mut guard) = cell.try_borrow_mut() else { return };
        let Some(s) = guard.as_mut() else { return };
        if s.returning {
            return;
        }
        if s.panel.is_none() {
            s.panel = find_panel(mtm);
        }
        let Some(panel) = s.panel.clone() else { return };
        if s.video.is_none() {
            s.video = panel.contentView().and_then(|c| find_video(&c));
        }
        let Some(video) = s.video.clone() else { return };
        let popped = s.popped.as_ref().map(|p| (p.host.clone(), p.panel.clone()));
        if let Some((_, p)) = &popped
            && !p.isVisible()
        {
            p.orderFront(None);
        }
        match popped.map(|(h, _)| h).or_else(|| holder(&s.source)) {
            Some(holder) => {
                if !is_in(&video, &holder) {
                    put(&video, &holder);
                }
                if panel.isVisible() {
                    panel.orderOut(None);
                }
            }
            None => {
                let Some(content) = panel.contentView() else { return };
                if !is_in(&video, &content) {
                    // Its player went without closing it: back to the system window.
                    put(&video, &content);
                }
                if s.started.elapsed() < PLAYER_GRACE {
                    if panel.isVisible() {
                        panel.orderOut(None);
                    }
                } else if !panel.isVisible() {
                    panel.orderFront(None);
                }
            }
        }
    });
}

/// The view a player gave for `web_key`'s video.
fn holder(web_key: &str) -> Option<Retained<NSView>> {
    ATTACHED.with(|a| a.borrow().values().filter(|p| p.of == web_key).find_map(|p| p.host.load()))
}

fn players_of(web_key: &str) -> Vec<(String, u64)> {
    ATTACHED.with(|a| a.borrow().iter().filter(|(_, p)| p.of == web_key).map(|(k, p)| (k.clone(), p.generation)).collect())
}

fn put(video: &NSView, into: &NSView) {
    video.removeFromSuperview();
    video.setFrame(into.bounds());
    video.setAutoresizingMask(NSAutoresizingMaskOptions::ViewWidthSizable | NSAutoresizingMaskOptions::ViewHeightSizable);
    into.addSubview(video);
}

fn is_in(video: &NSView, holder: &NSView) -> bool {
    unsafe { video.superview() }.is_some_and(|s| std::ptr::eq(&*s, holder))
}

fn class_is(obj: &AnyObject, name: &std::ffi::CStr) -> bool {
    AnyClass::get(name).is_some_and(|c| unsafe { msg_send![obj, isKindOfClass: c] })
}

fn find_panel(mtm: MainThreadMarker) -> Option<Retained<NSWindow>> {
    let windows = NSApplication::sharedApplication(mtm).windows();
    windows.iter().filter(|w| class_is(w, c"PIPPanel")).last()
}

fn find_video(view: &NSView) -> Option<Retained<NSView>> {
    for sub in view.subviews().iter() {
        if class_is(&sub, c"WebVideoViewContainer") {
            return Some(sub);
        }
        if let Some(v) = find_video(&sub) {
            return Some(v);
        }
    }
    None
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
    tick();
}

/// A `pip` view went. If it was showing the video, Picture in Picture ends:
/// nothing would show it (a player closed by Herdr, e.g. a layout switch).
pub(crate) fn detach(key: &str) {
    let Some(p) = ATTACHED.with(|a| a.borrow_mut().remove(key)) else { return };
    let showing = with_session(&p.of, |s| {
        !s.returning && s.video.as_ref().is_some_and(|v| p.host.load().is_some_and(|h| is_in(v, &h)))
    });
    if showing == Some(true)
        && let Some(mtm) = MainThreadMarker::new()
    {
        end(mtm, &p.of, false);
    }
}

/// A `pip` view's actions (`pip.toggle`, `pip.back`, `pip.close`).
pub(crate) fn action(mtm: MainThreadMarker, key: &str, action: &str, args: &Value) -> Result<Value, String> {
    let (of, generation) = ATTACHED
        .with(|a| a.borrow().get(key).map(|p| (p.of.clone(), p.generation)))
        .ok_or("this view shows nothing")?;
    if !active(&of) {
        return Err("nothing of this page is in picture in picture".into());
    }
    match action {
        "pip.toggle" => {
            let (web, frame) = with_session(&of, |s| (s.web.load(), s.frame.clone())).ok_or("gone")?;
            let web = web.ok_or("the page is gone")?;
            run(mtm, &web, Some(&frame), TOGGLE_SCRIPT, key, generation, "pip.state");
            Ok(Value::Null)
        }
        "pip.back" => {
            end(mtm, &of, true);
            // The page's pane takes focus, as a press on it would (the host does it).
            let g = with_session(&of, |s| s.generation).unwrap_or(0);
            emit_event(&of, g, "view.press", json!({}));
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
            with_session(&of, |s| s.popped = Some(popped));
            tick();
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
            let showing = s.video.as_ref().is_some_and(|v| holder(&s.source).is_some_and(|h| is_in(v, &h)));
            json!({ "found": s.video.is_some(), "showing": showing, "returning": s.returning, "popped": s.popped.is_some() })
        })
    });
    json!({ "of": of, "session": session })
}

// ---- timers

fn after(secs: f64, f: impl FnOnce() + 'static) {
    let f = Cell::new(Some(f));
    let block = RcBlock::new(move |_t: NonNull<AnyObject>| {
        if let Some(f) = f.take() {
            f();
        }
    });
    let Some(cls) = AnyClass::get(c"NSTimer") else { return };
    let _: Retained<AnyObject> = unsafe { msg_send![cls, scheduledTimerWithTimeInterval: secs, repeats: false, block: &*block] };
}

fn repeat(secs: f64, f: fn()) -> Retained<AnyObject> {
    let block = RcBlock::new(move |_t: NonNull<AnyObject>| f());
    let cls = AnyClass::get(c"NSTimer").expect("NSTimer");
    unsafe { msg_send![cls, scheduledTimerWithTimeInterval: secs, repeats: true, block: &*block] }
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
            let k = self.ivars().source.clone();
            end(mtm, &k, true);
            let g = with_session(&k, |s| s.generation).unwrap_or(0);
            emit_event(&k, g, "view.press", json!({}));
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
            run_then(mtm, &web, Some(&frame), TOGGLE_SCRIPT, move |r| {
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
        let panel = unsafe {
            NSPanel::initWithContentRect_styleMask_backing_defer(NSPanel::alloc(mtm), frame, style, NSBackingStoreType::Buffered, false)
        };
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
