//! The `app` kind: another application's window kept over a view's rect.
//!
//! macOS can't put another process's window inside ours, so the view itself
//! is an empty placeholder (its mod draws a status underneath) and the app's
//! real window is moved and sized to cover it, through the Accessibility API:
//!
//! - launch: the `.app` is opened (or, `instance: "shared"`, a running copy is
//!   used); its main window is found once it has one;
//! - pin: the window follows the placeholder's rect on screen, on every frame
//!   that moved it and on a timer (our window moving, the app moving its own);
//! - order: while Fireflies is the active app, its window sits just below the
//!   pinned one, or above it while a Fireflies overlay covers the view;
//! - hide: the app is hidden while the view is off screen (another tab, a
//!   folded pane) or Fireflies is hidden or minimized, and shown again after;
//! - focus: the app becoming active is reported as a press on the view, so
//!   the host focuses its pane;
//! - close: the app quits with the view, if this view launched it.
//!
//! Moving another app's windows needs the Accessibility permission; without it
//! the app still launches and the view says so (`app.permission`).

use crate::AppSource;
use crate::macos::emit_event as emit;
use block2::RcBlock;
use objc2::msg_send;
use objc2::rc::{Retained, Weak};
use objc2::runtime::{AnyClass, AnyObject};
use objc2_app_kit::NSView;
use objc2_foundation::{NSRect, NSString};
use serde_json::{Value, json};
use std::cell::{Cell, RefCell};
use std::collections::{HashMap, HashSet};
use std::ffi::c_void;
use std::ptr::NonNull;
use std::time::{Duration, Instant};

type CFTypeRef = *const c_void;
const AX_POINT: u32 = 1;
const AX_SIZE: u32 = 2;
/// How often pinned windows are checked between frames.
const TICK: f64 = 0.15;
/// How long a launch may take to show up as a running app.
const LAUNCH_TIMEOUT: Duration = Duration::from_secs(30);

#[link(name = "ApplicationServices", kind = "framework")]
unsafe extern "C" {
    fn AXUIElementCreateApplication(pid: i32) -> CFTypeRef;
    fn AXUIElementCopyAttributeValue(el: CFTypeRef, attr: CFTypeRef, value: *mut CFTypeRef) -> i32;
    fn AXUIElementSetAttributeValue(el: CFTypeRef, attr: CFTypeRef, value: CFTypeRef) -> i32;
    fn AXValueCreate(ty: u32, value: *const c_void) -> CFTypeRef;
    fn AXValueGetValue(value: CFTypeRef, ty: u32, out: *mut c_void) -> bool;
    fn AXIsProcessTrustedWithOptions(options: CFTypeRef) -> bool;
    /// Private but long-standing (yabai, Hammerspoon, Rectangle use it): the
    /// window server's id for an AX window, to order our window against it.
    fn _AXUIElementGetWindow(el: CFTypeRef, id: *mut u32) -> i32;
    fn CGWindowListCopyWindowInfo(option: u32, relative_to: u32) -> CFTypeRef;
}

#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    fn CFRelease(cf: CFTypeRef);
    fn CFRetain(cf: CFTypeRef) -> CFTypeRef;
    fn CFArrayGetCount(array: CFTypeRef) -> isize;
    fn CFArrayGetValueAtIndex(array: CFTypeRef, index: isize) -> CFTypeRef;
}

/// An owned Core Foundation reference.
struct Cf(CFTypeRef);

impl Drop for Cf {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe { CFRelease(self.0) };
        }
    }
}

fn cf_str(s: &str) -> Retained<NSString> {
    NSString::from_str(s)
}

fn ax_attr(el: CFTypeRef, name: &str) -> Option<Cf> {
    let n = cf_str(name);
    let mut out: CFTypeRef = std::ptr::null();
    let err = unsafe { AXUIElementCopyAttributeValue(el, Retained::as_ptr(&n).cast(), &mut out) };
    (err == 0 && !out.is_null()).then_some(Cf(out))
}

fn ax_string(el: CFTypeRef, name: &str) -> Option<String> {
    let v = ax_attr(el, name)?;
    let obj = unsafe { &*(v.0 as *const AnyObject) };
    let is_string: bool = AnyClass::get(c"NSString").is_some_and(|c| unsafe { msg_send![obj, isKindOfClass: c] });
    is_string.then(|| unsafe { &*(v.0 as *const NSString) }.to_string())
}

fn ax_pair(el: CFTypeRef, name: &str, ty: u32) -> Option<[f64; 2]> {
    let v = ax_attr(el, name)?;
    let mut out = [0f64; 2];
    unsafe { AXValueGetValue(v.0, ty, out.as_mut_ptr().cast()) }.then_some(out)
}

fn ax_set_pair(el: CFTypeRef, name: &str, ty: u32, value: [f64; 2]) -> bool {
    let v = unsafe { AXValueCreate(ty, value.as_ptr().cast()) };
    if v.is_null() {
        return false;
    }
    let v = Cf(v);
    let n = cf_str(name);
    unsafe { AXUIElementSetAttributeValue(el, Retained::as_ptr(&n).cast(), v.0) == 0 }
}

/// Whether Fireflies may move other apps' windows; `prompt` asks the person once.
fn ax_trusted(prompt: bool) -> bool {
    if !prompt {
        return unsafe { AXIsProcessTrustedWithOptions(std::ptr::null()) };
    }
    let Some(dict_class) = AnyClass::get(c"NSDictionary") else { return false };
    let Some(number_class) = AnyClass::get(c"NSNumber") else { return false };
    let yes: Retained<AnyObject> = unsafe { msg_send![number_class, numberWithBool: true] };
    let key = cf_str("AXTrustedCheckOptionPrompt");
    let options: Retained<AnyObject> = unsafe { msg_send![dict_class, dictionaryWithObject: &*yes, forKey: &*key] };
    unsafe { AXIsProcessTrustedWithOptions(Retained::as_ptr(&options).cast()) }
}

/// The app's main window: AXMainWindow, else its first standard window, else any.
fn main_window(pid: i32) -> Option<Cf> {
    let app = Cf(unsafe { AXUIElementCreateApplication(pid) });
    if app.0.is_null() {
        return None;
    }
    if let Some(w) = ax_attr(app.0, "AXMainWindow") {
        return Some(w);
    }
    let list = ax_attr(app.0, "AXWindows")?;
    let mut first = None;
    for i in 0..unsafe { CFArrayGetCount(list.0) } {
        let w = unsafe { CFArrayGetValueAtIndex(list.0, i) };
        if w.is_null() {
            continue;
        }
        if ax_string(w, "AXSubrole").as_deref() == Some("AXStandardWindow") {
            return Some(Cf(unsafe { CFRetain(w) }));
        }
        if first.is_none() {
            first = Some(Cf(unsafe { CFRetain(w) }));
        }
    }
    first
}

fn window_id(w: &Cf) -> u32 {
    let mut id = 0u32;
    if unsafe { _AXUIElementGetWindow(w.0, &mut id) } != 0 {
        return 0;
    }
    id
}

/// Whether window `ours` is on screen above window `theirs`.
fn above(ours: isize, theirs: u32) -> bool {
    // kCGWindowListOptionOnScreenAboveWindow
    let list = unsafe { CGWindowListCopyWindowInfo(1 << 1, theirs) };
    if list.is_null() {
        return false;
    }
    let list = Cf(list);
    let key = cf_str("kCGWindowNumber");
    (0..unsafe { CFArrayGetCount(list.0) }).any(|i| {
        let d = unsafe { CFArrayGetValueAtIndex(list.0, i) } as *const AnyObject;
        if d.is_null() {
            return false;
        }
        let n: Option<Retained<AnyObject>> = unsafe { msg_send![&*d, objectForKey: &*key] };
        n.is_some_and(|n| {
            let v: isize = unsafe { msg_send![&*n, integerValue] };
            v == ours
        })
    })
}

fn class(name: &std::ffi::CStr) -> Option<&'static AnyClass> {
    AnyClass::get(name)
}

fn running_apps(bundle_id: &str) -> Vec<Retained<AnyObject>> {
    let Some(cls) = class(c"NSRunningApplication") else { return Vec::new() };
    let id = cf_str(bundle_id);
    let list: Retained<AnyObject> = unsafe { msg_send![cls, runningApplicationsWithBundleIdentifier: &*id] };
    let n: usize = unsafe { msg_send![&*list, count] };
    (0..n)
        .map(|i| unsafe { msg_send![&*list, objectAtIndex: i] })
        .filter(|a: &Retained<AnyObject>| {
            let gone: bool = unsafe { msg_send![&**a, isTerminated] };
            !gone
        })
        .collect()
}

fn pid_of(app: &AnyObject) -> i32 {
    unsafe { msg_send![app, processIdentifier] }
}

fn name_of(app: &AnyObject) -> String {
    let n: Option<Retained<NSString>> = unsafe { msg_send![app, localizedName] };
    n.map(|n| n.to_string()).unwrap_or_default()
}

fn bundle_id(bundle: &std::path::Path) -> Option<String> {
    let cls = class(c"NSBundle")?;
    let path = cf_str(&bundle.to_string_lossy());
    let b: Option<Retained<AnyObject>> = unsafe { msg_send![cls, bundleWithPath: &*path] };
    let id: Option<Retained<NSString>> = unsafe { msg_send![&*b?, bundleIdentifier] };
    id.map(|i| i.to_string())
}

/// Opens the app without waiting for it (the timer picks it up once it runs).
fn open(bundle: &std::path::Path, new_instance: bool) -> Result<(), String> {
    let config_class = class(c"NSWorkspaceOpenConfiguration").ok_or("no NSWorkspaceOpenConfiguration")?;
    let workspace_class = class(c"NSWorkspace").ok_or("no NSWorkspace")?;
    let url_class = class(c"NSURL").ok_or("no NSURL")?;
    let path = cf_str(&bundle.to_string_lossy());
    unsafe {
        let config: Retained<AnyObject> = msg_send![config_class, configuration];
        // Fireflies keeps the keyboard; the pane shows the app where it is.
        let _: () = msg_send![&*config, setActivates: false];
        let _: () = msg_send![&*config, setCreatesNewApplicationInstance: new_instance];
        let url: Retained<AnyObject> = msg_send![url_class, fileURLWithPath: &*path];
        let ws: Retained<AnyObject> = msg_send![workspace_class, sharedWorkspace];
        // Called on a background queue; it captures nothing.
        let done = RcBlock::new(|_app: *mut AnyObject, _error: *mut AnyObject| {});
        let _: () = msg_send![&*ws, openApplicationAtURL: &*url, configuration: &*config, completionHandler: &*done];
    }
    Ok(())
}

/// One view's app.
struct Hosted {
    generation: u64,
    source: AppSource,
    bundle_id: String,
    /// The NSRunningApplication, once it runs.
    app: Option<Retained<AnyObject>>,
    /// Launching: the pids of that app that ran before, and since when.
    launching: Option<(HashSet<i32>, Instant)>,
    /// This view started it (it quits with the view).
    owned: bool,
    window: Option<Cf>,
    window_id: u32,
    /// The placeholder, its rect, and what the host last said about it.
    view: Option<Weak<NSView>>,
    visible: bool,
    covered: bool,
    /// The last rect the window was pinned to (AX coordinates).
    pinned: Option<[f64; 4]>,
    hidden_by_us: bool,
    was_active: bool,
    trusted: bool,
}

thread_local! {
    static APPS: RefCell<HashMap<String, Hosted>> = RefCell::new(HashMap::new());
    static TIMER: Cell<bool> = const { Cell::new(false) };
}

type Pending = Vec<(String, u64, &'static str, Value)>;

/// Starts (or attaches to) the app for `key`'s view.
pub(crate) fn start(key: &str, generation: u64, source: &AppSource) {
    stop(key);
    let mut events: Pending = Vec::new();
    let bundle_id = bundle_id(&source.bundle).unwrap_or_default();
    let trusted = ax_trusted(true);
    if !trusted {
        events.push((key.to_owned(), generation, "app.permission", json!({ "granted": false })));
    }
    let mut hosted = Hosted {
        generation,
        source: source.clone(),
        bundle_id: bundle_id.clone(),
        app: None,
        launching: None,
        owned: false,
        window: None,
        window_id: 0,
        view: None,
        visible: false,
        covered: false,
        pinned: None,
        hidden_by_us: false,
        was_active: false,
        trusted,
    };
    let running = if bundle_id.is_empty() { Vec::new() } else { running_apps(&bundle_id) };
    match running.first().filter(|_| !source.new_instance) {
        Some(app) => {
            events.push((key.to_owned(), generation, "app.launched", json!({ "pid": pid_of(app), "name": name_of(app), "launched": false })));
            hosted.app = Some(app.clone());
        }
        None => match open(&source.bundle, source.new_instance) {
            Ok(()) => hosted.launching = Some((running.iter().map(|a| pid_of(a)).collect(), Instant::now())),
            Err(e) => events.push((key.to_owned(), generation, "load.error", json!({ "message": e }))),
        },
    }
    APPS.with(|a| a.borrow_mut().insert(key.to_owned(), hosted));
    ensure_timer();
    for (k, g, name, data) in events {
        emit(&k, g, name, data);
    }
}

/// The view goes: the app quits if this view started it, else it is left as it was.
pub(crate) fn stop(key: &str) {
    let Some(h) = APPS.with(|a| a.try_borrow_mut().ok().and_then(|mut a| a.remove(key))) else { return };
    let Some(app) = h.app else { return };
    unsafe {
        if h.owned && h.source.quit_on_close {
            let _: bool = msg_send![&*app, terminate];
        } else if h.hidden_by_us {
            let _: bool = msg_send![&*app, unhide];
        }
    }
}

/// The host's view of the placeholder this frame. True when the window needs pinning again.
pub(crate) fn place(key: &str, view: &NSView, visible: bool, covered: bool) -> bool {
    APPS.with(|a| {
        let Ok(mut a) = a.try_borrow_mut() else { return false };
        let Some(h) = a.get_mut(key) else { return false };
        let same_view = h.view.as_ref().and_then(Weak::load).is_some_and(|v| std::ptr::eq(Retained::as_ptr(&v), view));
        if !same_view {
            h.view = Some(Weak::new(view));
        }
        let changed = !same_view || h.visible != visible || h.covered != covered;
        h.visible = visible;
        h.covered = covered;
        changed || target_rect(view).is_some_and(|r| h.pinned != Some(r))
    })
}

/// Gives the app the keyboard (the pane's `focus`, `app.activate`).
pub(crate) fn activate(key: &str) -> Result<Value, String> {
    let app = APPS.with(|a| a.borrow().get(key).and_then(|h| h.app.clone())).ok_or("the app isn't running")?;
    unsafe {
        // Cooperative activation (macOS 14+): we're active, so we hand it over.
        if let Some(ns_app_class) = class(c"NSApplication") {
            let ns_app: Retained<AnyObject> = msg_send![ns_app_class, sharedApplication];
            let can_yield: bool = msg_send![&*ns_app, respondsToSelector: objc2::sel!(yieldActivationToApplication:)];
            if can_yield {
                let _: () = msg_send![&*ns_app, yieldActivationToApplication: &*app];
            }
        }
        let modern: bool = msg_send![&*app, respondsToSelector: objc2::sel!(activateFromApplication:options:)];
        let _: bool = if modern {
            let me: Retained<AnyObject> = msg_send![class(c"NSRunningApplication").ok_or("no NSRunningApplication")?, currentApplication];
            msg_send![&*app, activateFromApplication: &*me, options: 0usize]
        } else {
            // NSApplicationActivateIgnoringOtherApps
            msg_send![&*app, activateWithOptions: 2usize]
        };
    }
    Ok(Value::Null)
}

/// `app.quit`: asks the app to quit, whoever started it.
pub(crate) fn quit(key: &str) -> Result<Value, String> {
    let app = APPS.with(|a| a.borrow().get(key).and_then(|h| h.app.clone())).ok_or("the app isn't running")?;
    let asked: bool = unsafe { msg_send![&*app, terminate] };
    Ok(json!(asked))
}

pub(crate) fn state(key: &str) -> Value {
    APPS.with(|a| {
        let Ok(a) = a.try_borrow() else { return Value::Null };
        let Some(h) = a.get(key) else { return Value::Null };
        json!({
            "app": h.source.bundle.file_name().map(|n| n.to_string_lossy().into_owned()),
            "bundleId": h.bundle_id,
            "pid": h.app.as_deref().map(pid_of),
            "name": h.app.as_deref().map(name_of),
            "launching": h.launching.is_some(),
            "owned": h.owned,
            "window": h.window.is_some(),
            "trusted": h.trusted,
            "visible": h.visible,
            "covered": h.covered,
            "hidden": h.hidden_by_us,
        })
    })
}

/// The placeholder's rect on screen, in AX coordinates (top-left of the main display, y down).
fn target_rect(view: &NSView) -> Option<[f64; 4]> {
    let window = view.window()?;
    let in_window = view.convertRect_toView(view.bounds(), None);
    let on_screen: NSRect = unsafe { msg_send![&*window, convertRectToScreen: in_window] };
    let screen_class = class(c"NSScreen")?;
    let screens: Retained<AnyObject> = unsafe { msg_send![screen_class, screens] };
    let main: Option<Retained<AnyObject>> = unsafe { msg_send![&*screens, firstObject] };
    let main_frame: NSRect = unsafe { msg_send![&*main?, frame] };
    let top = main_frame.size.height - (on_screen.origin.y + on_screen.size.height);
    Some([on_screen.origin.x.round(), top.round(), on_screen.size.width.round(), on_screen.size.height.round()])
}

/// Our window is showing: not hidden, not minimized, the app not hidden.
fn our_window_shows(view: &NSView) -> bool {
    let Some(window) = view.window() else { return false };
    let Some(ns_app_class) = class(c"NSApplication") else { return false };
    unsafe {
        let ns_app: Retained<AnyObject> = msg_send![ns_app_class, sharedApplication];
        let hidden: bool = msg_send![&*ns_app, isHidden];
        let mini: bool = msg_send![&*window, isMiniaturized];
        let on: bool = msg_send![&*window, isVisible];
        !hidden && !mini && on
    }
}

fn we_are_active() -> bool {
    let Some(ns_app_class) = class(c"NSApplication") else { return false };
    unsafe {
        let ns_app: Retained<AnyObject> = msg_send![ns_app_class, sharedApplication];
        msg_send![&*ns_app, isActive]
    }
}

/// Brings every hosted app in line with its placeholder.
pub(crate) fn sync() {
    let mut events: Pending = Vec::new();
    APPS.with(|a| {
        // A timer fires from the run loop; never fight another borrow.
        let Ok(mut a) = a.try_borrow_mut() else { return };
        for (key, h) in a.iter_mut() {
            step(key, h, &mut events);
        }
    });
    for (k, g, name, data) in events {
        emit(&k, g, name, data);
    }
}

fn step(key: &str, h: &mut Hosted, events: &mut Pending) {
    let say = |events: &mut Pending, name: &'static str, data: Value| events.push((key.to_owned(), h.generation, name, data));
    if !h.trusted && ax_trusted(false) {
        h.trusted = true;
        say(events, "app.permission", json!({ "granted": true }));
    }
    // Launching: the new process shows up among that app's running ones.
    if let Some((before, since)) = &h.launching {
        if let Some(app) = running_apps(&h.bundle_id).into_iter().find(|a| !before.contains(&pid_of(a))) {
            say(events, "app.launched", json!({ "pid": pid_of(&app), "name": name_of(&app), "launched": true }));
            h.app = Some(app);
            h.owned = true;
            h.launching = None;
        } else if since.elapsed() > LAUNCH_TIMEOUT {
            say(events, "load.error", json!({ "message": "The app didn't start." }));
            h.launching = None;
        }
    }
    let Some(app) = h.app.clone() else { return };
    let terminated: bool = unsafe { msg_send![&*app, isTerminated] };
    if terminated {
        say(events, "app.terminated", json!({}));
        h.app = None;
        h.window = None;
        h.window_id = 0;
        h.pinned = None;
        return;
    }
    // The app came forward (a click on its window): its pane takes focus.
    let active: bool = unsafe { msg_send![&*app, isActive] };
    if active && !h.was_active {
        say(events, "view.press", json!({}));
    }
    h.was_active = active;

    let Some(view) = h.view.as_ref().and_then(Weak::load) else { return };
    let show = h.visible && our_window_shows(&view);
    if !show {
        if !h.hidden_by_us {
            let _: bool = unsafe { msg_send![&*app, hide] };
            h.hidden_by_us = true;
        }
        return;
    }
    if h.hidden_by_us {
        let _: bool = unsafe { msg_send![&*app, unhide] };
        h.hidden_by_us = false;
    }
    if !h.trusted {
        return;
    }
    // The window (again, if it closed or the app replaced it).
    let pid = pid_of(&app);
    if h.window.as_ref().is_none_or(|w| ax_pair(w.0, "AXPosition", AX_POINT).is_none()) {
        h.window = main_window(pid);
        h.window_id = h.window.as_ref().map(window_id).unwrap_or(0);
        h.pinned = None;
        if h.window.is_some() {
            say(events, "app.window", json!({ "id": h.window_id }));
        }
    }
    let Some(window) = &h.window else { return };
    // Pin: only when off target (the app may move or resize itself, or refuse a size).
    if let Some(r) = target_rect(&view) {
        let at = ax_pair(window.0, "AXPosition", AX_POINT);
        let size = ax_pair(window.0, "AXSize", AX_SIZE);
        let off = |a: Option<[f64; 2]>, b: [f64; 2]| a.is_none_or(|a| (a[0] - b[0]).abs() > 1.0 || (a[1] - b[1]).abs() > 1.0);
        if h.pinned != Some(r) || off(at, [r[0], r[1]]) || off(size, [r[2], r[3]]) {
            // Size, place, size: a window clamped to its screen fits after it moved.
            ax_set_pair(window.0, "AXSize", AX_SIZE, [r[2], r[3]]);
            ax_set_pair(window.0, "AXPosition", AX_POINT, [r[0], r[1]]);
            ax_set_pair(window.0, "AXSize", AX_SIZE, [r[2], r[3]]);
            h.pinned = Some(r);
        }
    }
    // Order: just below the app's window, or above it while an overlay covers the view.
    if h.window_id != 0
        && we_are_active()
        && let Some(ours) = view.window()
    {
        let number: isize = unsafe { msg_send![&*ours, windowNumber] };
        if above(number, h.window_id) != h.covered {
            // NSWindowAbove = 1, NSWindowBelow = -1
            let mode: isize = if h.covered { 1 } else { -1 };
            let _: () = unsafe { msg_send![&*ours, orderWindow: mode, relativeTo: h.window_id as isize] };
        }
    }
}

fn ensure_timer() {
    if TIMER.with(|t| t.replace(true)) {
        return;
    }
    let block = RcBlock::new(|timer: NonNull<AnyObject>| {
        sync();
        let empty = APPS.with(|a| a.try_borrow().is_ok_and(|a| a.is_empty()));
        if empty {
            let _: () = unsafe { msg_send![timer.as_ref(), invalidate] };
            TIMER.with(|t| t.set(false));
        }
    });
    let Some(cls) = class(c"NSTimer") else { return };
    let _: Retained<AnyObject> = unsafe { msg_send![cls, scheduledTimerWithTimeInterval: TICK, repeats: true, block: &*block] };
}
