//! HUP (herdr-universal-preview): native content views for mods.
//!
//! The `herdr` module gains a `nativeView(id, props)` element plus
//! `nativeViewCapabilities`, `nativeViewCall` and `nextNativeViewEvent`
//! (interface `native-view/0`). The views themselves — WKWebView, PDFView,
//! AVPlayerView, QLPreviewView — live in the `herdr-native-view` crate; this
//! file only connects them to GPUI: it records where each element was painted
//! and, at the end of every window frame, moves the views there, hides views
//! whose mod is off screen, cuts holes where Herdr overlays are drawn above
//! them (so the page keeps rendering around a menu or dialog), and drops views
//! whose mod copy is gone.

use gpui::{AnyElement, App, Bounds, IntoElement, ParentElement, Pixels, Styled, Window, canvas, div};
use serde_json::Value;
#[cfg(not(target_os = "macos"))]
use serde_json::json;
use std::cell::RefCell;
use std::collections::{HashMap, HashSet};

thread_local! {
    /// Each mod copy's event channel (`nextNativeViewEvent`).
    static EVENTS: RefCell<HashMap<u64, async_channel::Sender<String>>> = RefCell::new(HashMap::new());
    static SINK_SET: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
    /// This frame's overlay cards and whether a dialog's backdrop is up. The
    /// overlays are drawn by the window itself every frame, so these are
    /// fresh at frame_end (mod panes are cached views: their paint can be
    /// replayed without running closures, so nothing here relies on them).
    static COVERS: RefCell<Vec<herdr_native_view::Cover>> = const { RefCell::new(Vec::new()) };
    static DIM: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

/// Records an overlay's card where it was painted: native views outside
/// overlays get a hole there.
pub fn cover_probe(radius: f32) -> impl IntoElement {
    canvas(
        |_, _, _| {},
        move |b, _, _, _| {
            let cover = herdr_native_view::Cover { rect: rect(b), radius: f64::from(radius) };
            COVERS.with(|c| c.borrow_mut().push(cover));
        },
    )
    .absolute()
    .top_0()
    .left_0()
    .size_full()
}

/// Records a dialog's backdrop: native views outside overlays are dimmed too.
pub fn dim_probe() -> impl IntoElement {
    canvas(
        |_, _, _| {},
        |_, _, _, _| DIM.with(|d| d.set(true)),
    )
    .absolute()
    .top_0()
    .left_0()
    .size_full()
}

/// A view's key: its mod copy and the id the mod gave the element.
pub fn key(copy: u64, id: &str) -> String {
    format!("{copy}:{id}")
}

fn copy_of(key: &str) -> Option<u64> {
    key.split_once(':').and_then(|(c, _)| c.parse().ok())
}

/// Registers a copy's event channel (called when its `herdr` module is built).
pub fn register_events(copy: u64, tx: async_channel::Sender<String>) {
    EVENTS.with(|e| e.borrow_mut().insert(copy, tx));
    #[cfg(target_os = "macos")]
    if !SINK_SET.with(|s| s.replace(true)) {
        herdr_native_view::macos::set_event_sink(|ev| {
            let Some(copy) = copy_of(&ev.key) else { return };
            let line = ev.to_json().to_string();
            EVENTS.with(|e| {
                if let Some(tx) = e.borrow().get(&copy) {
                    let _ = tx.try_send(line);
                }
            });
        });
    }
}

pub fn capabilities() -> Value {
    herdr_native_view::capabilities()
}

#[cfg(target_os = "macos")]
fn gpui_ns_view(window: &Window) -> Option<*mut std::ffi::c_void> {
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    // GPUI's inherent `window_handle()` is something else; use the trait's.
    let raw = HasWindowHandle::window_handle(window).ok()?;
    match raw.as_raw() {
        RawWindowHandle::AppKit(h) => Some(h.ns_view.as_ptr()),
        _ => None,
    }
}

/// Completes a keyboard pane switch when a native view owns AppKit focus.
pub fn release_keyboard(window: &Window) {
    #[cfg(target_os = "macos")]
    if let Some(view) = gpui_ns_view(window) {
        herdr_native_view::macos::release_keyboard(view);
    }
}

fn rect(b: Bounds<Pixels>) -> herdr_native_view::Rect {
    herdr_native_view::Rect { x: f64::from(b.origin.x), y: f64::from(b.origin.y), w: f64::from(b.size.width), h: f64::from(b.size.height) }
}

/// The `nativeView` element: the mod's children (drawn underneath, e.g. a
/// loading or "covered by a menu" label) plus a probe that records where the
/// element was painted, clipped to what is visible of it.
pub fn element(copy: u64, id: &str, props: Value, children: Vec<AnyElement>, window: &mut Window, _cx: &mut App) -> AnyElement {
    let key = key(copy, id);
    #[cfg(target_os = "macos")]
    let status: Result<u64, String> = match gpui_ns_view(window) {
        Some(v) => herdr_native_view::macos::ensure(&key, v, &props),
        None => Err("this window has no native view".into()),
    };
    #[cfg(not(target_os = "macos"))]
    let status: Result<u64, String> = {
        let _ = (&props, &window);
        Err("native views are macOS only".into())
    };
    // The probe goes first and is pinned to the element's top-left: an absolute
    // child without insets would sit at its static position, below the children.
    let probe = canvas(
        |_, _, _| {},
        move |b, _, window, _| {
            let clip = window.content_mask().bounds;
            let visible = rect(b).intersect(&rect(clip));
            if std::env::var_os("HUP_NATIVE_TRACE").is_some() {
                eprintln!("hup native paint {key}: bounds={b:?} clip={clip:?}");
            }
            #[cfg(target_os = "macos")]
            herdr_native_view::macos::painted(&key, visible);
            #[cfg(not(target_os = "macos"))]
            let _ = (&key, visible);
        },
    )
    .absolute()
    .top_0()
    .left_0()
    .size_full();
    let mut el = div().size_full().relative().child(probe).children(children);
    if let Err(e) = status {
        el = el.child(div().p_2().child(format!("Native view unavailable: {e}")));
    }
    el.into_any_element()
}

/// Painted last in the window: applies frames, visibility and overlay holes
/// for this window's views. `in_overlay`: copies drawn inside an overlay,
/// which its own hole must not cut.
pub fn frame_end(alive: HashSet<u64>, shown: HashSet<u64>, in_overlay: HashSet<u64>, suppressed: bool) -> impl IntoElement {
    canvas(
        |_, _, _| {},
        move |_, _, window, _| {
            EVENTS.with(|e| e.borrow_mut().retain(|c, tx| alive.contains(c) && !tx.is_closed()));
            let covers = COVERS.with(|c| std::mem::take(&mut *c.borrow_mut()));
            let dim = DIM.with(|d| d.replace(false));
            #[cfg(target_os = "macos")]
            if let Some(v) = gpui_ns_view(window) {
                let is_alive = |k: &str| copy_of(k).is_some_and(|c| alive.contains(&c));
                let is_shown = |k: &str| copy_of(k).is_some_and(|c| shown.contains(&c));
                let above = |k: &str| {
                    if copy_of(k).is_some_and(|c| in_overlay.contains(&c)) {
                        return (Vec::new(), false);
                    }
                    (covers.clone(), dim)
                };
                herdr_native_view::macos::frame_end(v, &is_alive, &is_shown, suppressed, &above);
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (window, &shown, &in_overlay, suppressed, covers, dim);
        },
    )
    .absolute()
    .size_full()
}

/// `nativeViewCall(id, action, args)` from a mod: only its own views.
pub fn call(copy: u64, id: &str, action: &str, args: &Value) -> Result<Value, String> {
    call_key(&key(copy, id), action, args)
}

/// `herdr-app do native.call {key, action, args}` (the test harness).
pub fn call_key(key: &str, action: &str, args: &Value) -> Result<Value, String> {
    #[cfg(target_os = "macos")]
    return herdr_native_view::macos::call(key, action, args);
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (key, action, args);
        Err("native views are macOS only".into())
    }
}

/// `herdr-app do native.debug`: every view's frame, visibility and content state.
pub fn debug() -> Value {
    #[cfg(target_os = "macos")]
    return herdr_native_view::macos::debug();
    #[cfg(not(target_os = "macos"))]
    json!({ "interface": herdr_native_view::INTERFACE, "views": {}, "available": false })
}
