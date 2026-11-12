//! Tabs for a `tabs: true` web view: what a browser opens in a new tab comes to
//! the mod as `web.newTab { url, background, from }` instead, and the mod opens
//! it (in a tab of its own pane):
//!
//! - `from: "window"`: `target=_blank` and `window.open` (only user-initiated
//!   ones reach WebKit's UI delegate: JavaScript can't open windows by itself).
//!   In front.
//! - `from: "click"`: a middle click or a Cmd click on a link, seen in the
//!   navigation policy (`crate::click_opens_tab`). In the background; Shift
//!   brings it to the front.
//! - `from: "menu"`: the link menu's "Open Link in New Tab" (WebKit's "… in New
//!   Window" items, renamed). WebKit's own item still runs (it knows the link),
//!   through a target here that marks the new window it asks for as the menu's.
//!   In the background.
//!
//! A view without `tabs` keeps loading a new window in place.

use crate::macos::{emit_event, web_view_key};
use objc2::rc::Retained;
use objc2::runtime::{AnyObject, NSObject, NSObjectProtocol, Sel};
use objc2::{DefinedClass, MainThreadMarker, MainThreadOnly, define_class, msg_send, sel};
use objc2_app_kit::{NSApplication, NSEvent, NSEventModifierFlags, NSMenu, NSResponder, NSUserInterfaceItemIdentification, NSView};
use objc2_foundation::{NSRect, NSString};
use objc2_web_kit::{WKNavigationAction, WKNavigationType, WKWebView, WKWebViewConfiguration};
use serde_json::json;
use std::cell::RefCell;
use std::collections::HashMap;
use std::time::{Duration, Instant};

thread_local! {
    /// Web views whose menu item just asked for a new window, and when: the
    /// new window comes back from the page's process a moment later.
    static FROM_MENU: RefCell<HashMap<String, Instant>> = RefCell::new(HashMap::new());
    /// The targets of the open menu's items (a menu item holds its target weakly).
    static TARGETS: RefCell<Vec<Retained<MenuTab>>> = const { RefCell::new(Vec::new()) };
}

/// How long a menu's request for a new window waits for it.
const MENU_WAIT: Duration = Duration::from_secs(3);

/// A web view that renames its link menu's "… in New Window" items when its
/// mod keeps tabs.
pub(crate) fn new_web_view(mtm: MainThreadMarker, frame: NSRect, config: &WKWebViewConfiguration) -> Retained<WKWebView> {
    let this = WebPage::alloc(mtm).set_ivars(());
    let this: Retained<WebPage> = unsafe { msg_send![super(this), initWithFrame: frame, configuration: config] };
    Retained::into_super(this)
}

/// The navigation policy: whether this navigation opens a tab instead (then
/// it is cancelled here and the mod is told).
pub(crate) fn click(key: &str, generation: u64, tabs: bool, action: &WKNavigationAction) -> bool {
    if !tabs {
        return false;
    }
    let (link, button, flags) = unsafe { (action.navigationType() == WKNavigationType::LinkActivated, action.buttonNumber(), action.modifierFlags()) };
    let Some(background) = crate::click_opens_tab(
        link,
        button as i64,
        flags.contains(NSEventModifierFlags::Command),
        flags.contains(NSEventModifierFlags::Shift),
    ) else {
        return false;
    };
    let Some(url) = url_of(action) else { return false };
    emit_event(key, generation, "web.newTab", json!({ "url": url, "background": background, "from": "click" }));
    true
}

/// A new window (`target=_blank`, `window.open`, the menu's item): a tab, when
/// the mod keeps them. False: load it in place, as without tabs.
pub(crate) fn new_window(key: &str, generation: u64, tabs: bool, action: &WKNavigationAction) -> bool {
    if !tabs {
        return false;
    }
    let menu = FROM_MENU.with(|m| m.borrow_mut().remove(key)).is_some_and(|t| t.elapsed() < MENU_WAIT);
    // window.open("") and the like: nothing to load in a tab of its own.
    let Some(url) = url_of(action) else { return true };
    let from = if menu { "menu" } else { "window" };
    emit_event(key, generation, "web.newTab", json!({ "url": url, "background": menu, "from": from }));
    true
}

/// The view is disposed.
pub(crate) fn web_gone(key: &str) {
    FROM_MENU.with(|m| m.borrow_mut().remove(key));
}

fn url_of(action: &WKNavigationAction) -> Option<String> {
    let url = unsafe { action.request().URL()?.absoluteString()? }.to_string();
    (!url.is_empty() && url != "about:blank").then_some(url)
}

/// WebKit's "Open Link in New Window" (and image, media, frame): their
/// identifiers, `WKMenuItemIdentifierOpen…InNewWindow`.
fn opens_window(id: &str) -> bool {
    id.starts_with("WKMenuItemIdentifierOpen") && id.ends_with("InNewWindow")
}

define_class!(
    // SAFETY: WKWebView may be subclassed; only the menu hook is added, and it
    // calls super first; no ivars, no Drop impl.
    #[unsafe(super(WKWebView, NSView, NSResponder, NSObject))]
    #[thread_kind = MainThreadOnly]
    struct WebPage;

    impl WebPage {
        #[unsafe(method(willOpenMenu:withEvent:))]
        fn will_open_menu(&self, menu: &NSMenu, event: &NSEvent) {
            let _: () = unsafe { msg_send![super(self), willOpenMenu: menu, withEvent: event] };
            let web: &WKWebView = self;
            let Some((key, tabs)) = web_view_key(web) else { return };
            let mtm = self.mtm();
            let mut targets = Vec::new();
            if tabs {
                for item in menu.itemArray().iter() {
                    let Some(id) = item.identifier() else { continue };
                    if !opens_window(&id.to_string()) {
                        continue;
                    }
                    if let Some(t) = crate::tab_menu_title(&item.title().to_string()) {
                        item.setTitle(&NSString::from_str(&t));
                    }
                    let target = MenuTab::new(mtm, &key, item.target(), item.action());
                    unsafe {
                        item.setTarget(Some(&target));
                        item.setAction(Some(sel!(openInTab:)));
                    }
                    targets.push(target);
                }
            }
            TARGETS.with(|t| *t.borrow_mut() = targets);
        }
    }
);

pub struct MenuTabIvars {
    key: String,
    target: Option<Retained<AnyObject>>,
    action: Option<Sel>,
}

define_class!(
    // SAFETY: NSObject has no subclassing requirements; no Drop impl.
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[ivars = MenuTabIvars]
    struct MenuTab;

    unsafe impl NSObjectProtocol for MenuTab {}

    impl MenuTab {
        /// The item was chosen: mark the new window it asks for, then let
        /// WebKit's own action run.
        #[unsafe(method(openInTab:))]
        fn open_in_tab(&self, sender: &AnyObject) {
            let i = self.ivars();
            FROM_MENU.with(|m| m.borrow_mut().insert(i.key.clone(), Instant::now()));
            if let Some(action) = i.action {
                let app = NSApplication::sharedApplication(self.mtm());
                unsafe { app.sendAction_to_from(action, i.target.as_deref(), Some(sender)) };
            }
        }
    }
);

impl MenuTab {
    fn new(mtm: MainThreadMarker, key: &str, target: Option<Retained<AnyObject>>, action: Option<Sel>) -> Retained<Self> {
        let this = Self::alloc(mtm).set_ivars(MenuTabIvars { key: key.to_owned(), target, action });
        unsafe { msg_send![super(this), init] }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn new_window_items_are_known_by_their_identifiers() {
        for id in ["WKMenuItemIdentifierOpenLinkInNewWindow", "WKMenuItemIdentifierOpenImageInNewWindow", "WKMenuItemIdentifierOpenMediaInNewWindow", "WKMenuItemIdentifierOpenFrameInNewWindow"] {
            assert!(super::opens_window(id), "{id}");
        }
        for id in ["WKMenuItemIdentifierOpenLink", "WKMenuItemIdentifierDownloadLinkedFile", "WKMenuItemIdentifierCopyLink"] {
            assert!(!super::opens_window(id), "{id}");
        }
    }
}
