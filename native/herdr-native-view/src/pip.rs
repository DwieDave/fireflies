//! Picture in Picture for web views (`pip: true`), and `pip` views.
//!
//! WebKit does the media work: a page's video goes into macOS's own Picture
//! in Picture window (`PIPPanel`, in this process). This module tells the
//! page's mod when that happens and starts it on request.

use crate::macos::emit_event;
use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::{AnyObject, ProtocolObject};
use objc2::{MainThreadMarker, MainThreadOnly, msg_send};
use objc2_foundation::{NSError, NSNumber, NSString};
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

thread_local! {
    /// Per web view: the frame that last started a video (`web.pip` looks there first).
    static PLAYED: RefCell<HashMap<String, Retained<WKFrameInfo>>> = RefCell::new(HashMap::new());
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
        match serde_json::from_str::<Value>(body).ok().and_then(|v| v["type"].as_str().map(str::to_owned)) {
            Some(t) => match t.as_str() {
                "play" => "play",
                "enter" => "enter",
                "leave" => "leave",
                _ => return,
            },
            None => return,
        }
    };
    match kind {
        "play" => {
            PLAYED.with(|p| p.borrow_mut().insert(web_key.to_owned(), frame));
        }
        "enter" => {
            PLAYED.with(|p| p.borrow_mut().insert(web_key.to_owned(), frame));
            emit_event(web_key, generation, "pip.enter", json!({ "of": web_key }));
        }
        "leave" => emit_event(web_key, generation, "pip.leave", json!({})),
        _ => {}
    }
}

/// `web.pip`: toggles Picture in Picture for the page's video. Runs in the
/// frame that last played a video (an embedded player), else the main frame.
pub(crate) fn start(mtm: MainThreadMarker, web_key: &str, generation: u64, web: &WKWebView) -> Result<Value, String> {
    let frame = PLAYED.with(|p| p.borrow().get(web_key).cloned());
    run(mtm, web_key, generation, web, frame.as_deref(), PICK_SCRIPT, "pip.start");
    Ok(json!({ "of": web_key }))
}

/// Runs one of this module's scripts in `frame` (None: the main frame) of the
/// isolated world; its result or error comes back as `event`.
pub(crate) fn run(
    mtm: MainThreadMarker,
    web_key: &str,
    generation: u64,
    web: &WKWebView,
    frame: Option<&WKFrameInfo>,
    script: &str,
    event: &'static str,
) {
    let k = web_key.to_owned();
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
        emit_event(&k, generation, event, data);
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

/// The web view is gone: forget it.
pub(crate) fn web_gone(web_key: &str) {
    PLAYED.with(|p| p.borrow_mut().remove(web_key));
}
