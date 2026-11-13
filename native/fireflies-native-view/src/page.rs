//! What a `pip: true` web view's page says about itself: whether it has a
//! `<video>` (event `web.video { present }`), so the mod shows its picture in
//! picture button only then; and the icon it names (event `web.icon { href }`),
//! so the mod can show its favicon on the page's tab.
//!
//! A script in every frame (WebKit's isolated client world: pages can't reach
//! the handler) watches its document with a MutationObserver and reports its
//! own yes/no when that changes. The view has a video while any frame says yes.
//! A second script, in the main frame only, reports the document's
//! `link[rel~=icon]` once it is parsed (null: none, the mod asks the origin's
//! `/favicon.ico`). Nothing is fetched here: the mod fetches the icon itself.

use crate::macos::emit_event;
use objc2::{MainThreadMarker, MainThreadOnly};
use objc2::runtime::ProtocolObject;
use objc2_foundation::NSString;
use objc2_web_kit::{
    WKContentWorld, WKScriptMessageHandler, WKUserScript, WKUserScriptInjectionTime,
    WKWebViewConfiguration,
};
use serde_json::{Value, json};
use std::cell::RefCell;
use std::collections::{HashMap, HashSet};

pub(crate) const HANDLER: &str = "herdrPage";

/// Per frame document: a random id, and a debounced check after DOM changes
/// (one querySelector per 150 ms at most, however busy the page is).
const VIDEO_SCRIPT: &str = r#"(() => {
  const id = Math.random().toString(36).slice(2);
  let has = false, queued = false;
  const post = (v) => { try { webkit.messageHandlers.herdrPage.postMessage(JSON.stringify({ type: "video", id, has: v })); } catch {} };
  const check = () => { queued = false; const now = document.querySelector("video") !== null; if (now !== has) { has = now; post(now); } };
  const soon = () => { if (!queued) { queued = true; setTimeout(check, 150); } };
  new MutationObserver(soon).observe(document, { childList: true, subtree: true });
  addEventListener("pagehide", () => { if (has) { has = false; post(false); } });
  addEventListener("pageshow", (e) => { if (e.persisted) check(); });
})();"#;

/// The main frame's icon link, once the document is parsed: an `http(s)` one,
/// 32 px or 16 px if the page says, else an SVG, else the first.
const ICON_SCRIPT: &str = r#"(() => {
  const post = () => {
    const links = [...document.querySelectorAll('link[rel~="icon" i]')].filter((l) => /^https?:/i.test(l.href));
    const sized = (n) => links.find((l) => (l.getAttribute("sizes") || "").toLowerCase().split(/\s+/).includes(n));
    const best = sized("32x32") || sized("16x16") || links.find((l) => /svg/i.test(l.type || l.href)) || links[0];
    try { webkit.messageHandlers.herdrPage.postMessage(JSON.stringify({ type: "icon", href: best ? best.href : null })); } catch {}
  };
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", post, { once: true }); else post();
})();"#;

thread_local! {
    /// Per web view: the frame documents that have a video now.
    static VIDEOS: RefCell<HashMap<String, HashSet<String>>> = RefCell::new(HashMap::new());
}

/// Adds the video watch to a `pip: true` web view's configuration.
/// `crate::pip::unconfigure` removes its handler with the others.
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
            &NSString::from_str(VIDEO_SCRIPT),
            WKUserScriptInjectionTime::AtDocumentStart,
            false,
            &client,
        );
        content.addUserScript(&script);
        let icon = WKUserScript::initWithSource_injectionTime_forMainFrameOnly_inContentWorld(
            WKUserScript::alloc(mtm),
            &NSString::from_str(ICON_SCRIPT),
            WKUserScriptInjectionTime::AtDocumentStart,
            true,
            &client,
        );
        content.addUserScript(&icon);
        content.addScriptMessageHandler_contentWorld_name(
            handler,
            &client,
            &NSString::from_str(HANDLER),
        );
    }
}

/// Whether the web view's page has a video now.
pub(crate) fn has_video(web_key: &str) -> bool {
    VIDEOS.with(|v| v.borrow().get(web_key).is_some_and(|s| !s.is_empty()))
}

/// Applies one change; returns the view's new answer when it changed.
fn update(web_key: &str, change: impl FnOnce(&mut HashSet<String>)) -> Option<bool> {
    VIDEOS.with(|v| {
        let mut v = v.borrow_mut();
        let docs = v.entry(web_key.to_owned()).or_default();
        let before = !docs.is_empty();
        change(docs);
        let now = !docs.is_empty();
        if docs.is_empty() {
            v.remove(web_key);
        }
        (now != before).then_some(now)
    })
}

/// The `web.icon` event an icon message makes: its `href` (an `http(s)` URL),
/// else null. None: not an icon message.
fn icon_event(m: &Value) -> Option<Value> {
    if m["type"] != "icon" {
        return None;
    }
    let href = m["href"]
        .as_str()
        .filter(|h| h.len() <= 4096 && (h.starts_with("https://") || h.starts_with("http://")));
    Some(json!({ "href": href }))
}

/// A message from the page scripts.
pub(crate) fn on_message(web_key: &str, generation: u64, body: &str) {
    let Ok(m) = serde_json::from_str::<Value>(body) else { return };
    if let Some(icon) = icon_event(&m) {
        emit_event(web_key, generation, "web.icon", icon);
        return;
    }
    if m["type"] != "video" {
        return;
    }
    let (Some(id), Some(has)) = (m["id"].as_str(), m["has"].as_bool()) else { return };
    let changed = update(web_key, |docs| {
        if has {
            docs.insert(id.to_owned());
        } else {
            docs.remove(id);
        }
    });
    if let Some(now) = changed {
        emit_event(web_key, generation, "web.video", json!({ "present": now }));
    }
}

/// A new page (or a crashed one): the old documents' videos are gone. The
/// new page's frames report their own.
pub(crate) fn navigated(web_key: &str, generation: u64) {
    if update(web_key, HashSet::clear) == Some(false) {
        emit_event(web_key, generation, "web.video", json!({ "present": false }));
    }
}

/// The view is disposed.
pub(crate) fn web_gone(web_key: &str) {
    VIDEOS.with(|v| v.borrow_mut().remove(web_key));
}

#[cfg(test)]
mod tests {
    use super::icon_event;
    use serde_json::json;

    #[test]
    fn icon_messages_carry_an_http_href_or_null() {
        let ev = |m| icon_event(&m);
        assert_eq!(ev(json!({ "type": "icon", "href": "https://a.example/i.png" })), Some(json!({ "href": "https://a.example/i.png" })));
        assert_eq!(ev(json!({ "type": "icon", "href": null })), Some(json!({ "href": null })));
        // Not a web address (data:, javascript:, file:): none, the mod asks the origin.
        assert_eq!(ev(json!({ "type": "icon", "href": "data:image/png;base64,AA" })), Some(json!({ "href": null })));
        assert_eq!(ev(json!({ "type": "icon", "href": "file:///etc/passwd" })), Some(json!({ "href": null })));
        assert_eq!(ev(json!({ "type": "video", "id": "x", "has": true })), None);
    }
}
