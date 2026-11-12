//! HUP (herdr-universal-preview): native content views for mods.
//!
//! The `herdr` module gains a `nativeView(id, props)` element plus
//! `nativeViewCapabilities`, `nativeViewCall` and `nextNativeViewEvent`
//! (interface `native-view/0`). The views themselves — WKWebView, PDFView,
//! AVPlayerView, QLPreviewView — live in the `herdr-native-view` crate; this
//! file only connects them to GPUI: it records where each element was painted
//! and, at the end of every window frame, moves the views there, hides views
//! whose mod is off screen, cuts holes where Fireflies overlays are drawn above
//! them (so the page keeps rendering around a menu or dialog), and drops views
//! whose mod copy is gone.

use gpui::{AnyElement, App, Bounds, IntoElement, ParentElement, Pixels, Styled, Window, canvas, div};
use serde_json::{Value, json};
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
    static COVERS: RefCell<Vec<Painted>> = const { RefCell::new(Vec::new()) };
    /// The layers of this frame's dialog backdrops.
    static DIMS: RefCell<Vec<usize>> = const { RefCell::new(Vec::new()) };
    /// The layer being painted now (`layer` marks where each one starts).
    static Z: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
    /// What the last frame gave each copy's views: its layer, covers and dim
    /// (`native.debug`, tests).
    static LAST: RefCell<HashMap<u64, (Layer, Vec<herdr_native_view::Cover>, bool)>> = RefCell::new(HashMap::new());
    /// Mod copies whose native view was pressed, for the window to focus their pane.
    static PRESSES: (async_channel::Sender<u64>, async_channel::Receiver<u64>) = async_channel::unbounded();
}

/// Copies whose native view was just pressed: their pane should take focus,
/// as a click on any other pane does (the view swallows the click itself).
pub fn presses() -> async_channel::Receiver<u64> {
    PRESSES.with(|(_, rx)| rx.clone())
}

/// Where a mod copy's native views are drawn, in paint order: `z` 0 is the
/// tabs' tree, `z` n the nth overlay painted (windows first, in the order
/// they were raised, then dialogs, popups and toasts, each in the order
/// opened). `float`: inside a floating block.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Layer {
    pub z: usize,
    pub float: bool,
}

/// What drew a cover: an overlay's card (and a window's resize grips), or a
/// floating block (drawn over the panes of its own layer).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum By {
    Overlay,
    Float,
}

/// A cover as painted: its layer and what drew it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Painted {
    pub z: usize,
    pub by: By,
    pub cover: herdr_native_view::Cover,
}

/// Whether what `by` painted on layer `z` is drawn above a view on `view`:
/// every later layer is; on its own layer only a float over a pane is (an
/// overlay never cuts the views inside it, nor a float the views in floats).
pub fn is_above(view: Layer, z: usize, by: By) -> bool {
    z > view.z || (z == view.z && by == By::Float && !view.float)
}

/// The holes and the dim a view on `view` gets from this frame's covers and
/// backdrops (`dims`: their layers; a backdrop sits under its own overlay).
pub fn cut(view: Layer, covers: &[Painted], dims: &[usize]) -> (Vec<herdr_native_view::Cover>, bool) {
    let holes = covers.iter().filter(|p| is_above(view, p.z, p.by)).map(|p| p.cover).collect();
    (holes, dims.iter().any(|z| *z > view.z))
}

/// Marks where layer `z` starts painting: the covers and backdrops painted
/// after it, until the next mark, are on that layer.
pub fn layer(z: usize) -> impl IntoElement {
    canvas(|_, _, _| {}, move |_, _, _, _| Z.with(|l| l.set(z))).absolute().size_full()
}

/// Records an overlay's card (`By::Overlay`) or a floating block
/// (`By::Float`) where it was painted: native views below it get a hole there.
pub fn cover_probe(radius: f32, by: By) -> impl IntoElement {
    canvas(
        |_, _, _| {},
        move |b, _, _, _| {
            let cover = herdr_native_view::Cover { rect: rect(b), radius: f64::from(radius) };
            let z = Z.with(|l| l.get());
            COVERS.with(|c| c.borrow_mut().push(Painted { z, by, cover }));
        },
    )
    .absolute()
    .top_0()
    .left_0()
    .size_full()
}

/// Records a dialog's backdrop: native views below it are dimmed too.
pub fn dim_probe() -> impl IntoElement {
    canvas(
        |_, _, _| {},
        |_, _, _, _| {
            let z = Z.with(|l| l.get());
            DIMS.with(|d| d.borrow_mut().push(z));
        },
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
            if ev.name == "view.press" {
                PRESSES.with(|(tx, _)| {
                    let _ = tx.try_send(copy);
                });
                return;
            }
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
/// for this window's views. `layers`: each live copy's layer (copies not in
/// it are on the tree's); a view is cut by the covers above its layer only.
pub fn frame_end(alive: HashSet<u64>, shown: HashSet<u64>, layers: HashMap<u64, Layer>, suppressed: bool) -> impl IntoElement {
    canvas(
        |_, _, _| {},
        move |_, _, window, _| {
            EVENTS.with(|e| e.borrow_mut().retain(|c, tx| alive.contains(c) && !tx.is_closed()));
            let covers = COVERS.with(|c| std::mem::take(&mut *c.borrow_mut()));
            let dims = DIMS.with(|d| std::mem::take(&mut *d.borrow_mut()));
            Z.with(|l| l.set(0));
            let layer_of = |c: u64| layers.get(&c).copied().unwrap_or_default();
            LAST.with(|l| {
                *l.borrow_mut() = alive
                    .iter()
                    .map(|c| {
                        let (holes, dim) = cut(layer_of(*c), &covers, &dims);
                        (*c, (layer_of(*c), holes, dim))
                    })
                    .collect();
            });
            #[cfg(target_os = "macos")]
            if let Some(v) = gpui_ns_view(window) {
                let is_alive = |k: &str| copy_of(k).is_some_and(|c| alive.contains(&c));
                let is_shown = |k: &str| copy_of(k).is_some_and(|c| shown.contains(&c));
                let above = |k: &str| cut(copy_of(k).map(layer_of).unwrap_or_default(), &covers, &dims);
                herdr_native_view::macos::frame_end(v, &is_alive, &is_shown, suppressed, &above);
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (window, &shown, suppressed);
        },
    )
    .absolute()
    .size_full()
}

/// What the last frame gave a copy's views: its layer, the holes cut in them
/// and whether a backdrop dims them.
pub fn last_frame(copy: u64) -> Option<(Layer, Vec<herdr_native_view::Cover>, bool)> {
    LAST.with(|l| l.borrow().get(&copy).cloned())
}

/// `nativeViewCall(id, action, args)` from a mod: only its own views. A page
/// a backdrop dimmed last frame (behind a dialog or a window with a scrim)
/// doesn't take the keyboard (`focus` does nothing): a web pane claiming it on
/// a timer would get the keys typed into the window above.
pub fn call(copy: u64, id: &str, action: &str, args: &Value) -> Result<Value, String> {
    if !may_take_keyboard(action, last_frame(copy).is_some_and(|(_, _, dim)| dim)) {
        return Ok(Value::Null);
    }
    call_key(&key(copy, id), action, args)
}

/// `focus` from a copy whose views are under a backdrop: refused.
fn may_take_keyboard(action: &str, dimmed: bool) -> bool {
    action != "focus" || !dimmed
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
/// `layers`: per mod copy, its layer and what the last frame cut out of its
/// views (`covers`: [x, y, w, h] in window points) and whether it dims them.
pub fn debug() -> Value {
    #[cfg(target_os = "macos")]
    let mut out = herdr_native_view::macos::debug();
    #[cfg(not(target_os = "macos"))]
    let mut out = json!({ "interface": herdr_native_view::INTERFACE, "views": {}, "available": false });
    let layers: serde_json::Map<String, Value> = LAST.with(|l| {
        l.borrow()
            .iter()
            .map(|(c, (layer, covers, dim))| {
                let covers: Vec<Value> = covers.iter().map(|v| json!([v.rect.x, v.rect.y, v.rect.w, v.rect.h])).collect();
                (c.to_string(), json!({ "z": layer.z, "float": layer.float, "covers": covers, "dim": dim }))
            })
            .collect()
    });
    out["layers"] = Value::Object(layers);
    out
}

#[cfg(test)]
mod tests {
    use super::{By, Layer, Painted, cut, is_above, may_take_keyboard};
    use herdr_native_view::{Cover, Rect};

    fn at(z: usize, by: By, x: f64) -> Painted {
        Painted { z, by, cover: Cover { rect: Rect { x, y: 0.0, w: 10.0, h: 10.0 }, radius: 0.0 } }
    }
    const PANE: Layer = Layer { z: 0, float: false };
    const FLOAT: Layer = Layer { z: 0, float: true };

    #[test]
    fn an_overlay_cuts_every_view_painted_before_it_and_none_after() {
        // A player window (layer 1) and a dialog over it (layer 2).
        let (player, dialog) = (Layer { z: 1, float: false }, Layer { z: 2, float: false });
        assert!(is_above(PANE, 1, By::Overlay) && is_above(PANE, 2, By::Overlay));
        assert!(is_above(FLOAT, 1, By::Overlay), "a floating block is under every overlay");
        assert!(is_above(player, 2, By::Overlay), "the dialog opened over the player cuts it");
        assert!(!is_above(player, 1, By::Overlay), "an overlay's own card never cuts its views");
        assert!(!is_above(dialog, 1, By::Overlay) && !is_above(dialog, 2, By::Overlay), "the player is under the dialog");
    }

    #[test]
    fn a_float_cuts_the_panes_of_its_layer_only() {
        assert!(is_above(PANE, 0, By::Float));
        assert!(!is_above(FLOAT, 0, By::Float), "nor itself, nor another float");
        // A float inside an overlay's layout: over that overlay's panes, under the next overlay.
        assert!(is_above(Layer { z: 1, float: false }, 1, By::Float));
        assert!(!is_above(Layer { z: 2, float: false }, 1, By::Float));
    }

    #[test]
    fn raising_a_window_swaps_which_one_is_cut() {
        // The player opened first, then the git window: git (2) cuts the player (1).
        let covers = |player: usize, git: usize| [at(player, By::Overlay, 0.0), at(git, By::Overlay, 100.0)];
        let x = |c: &[Cover]| c.iter().map(|c| c.rect.x).collect::<Vec<_>>();
        let (cv, dim) = cut(Layer { z: 1, float: false }, &covers(1, 2), &[2]);
        assert_eq!((x(&cv), dim), (vec![100.0], true), "the git window's card and its dim, on the player");
        // The player pressed: it's painted last now, above git and its dim.
        let (cv, dim) = cut(Layer { z: 2, float: false }, &covers(2, 1), &[1]);
        assert_eq!((x(&cv), dim), (vec![], false));
        // The git window's own views get the player's hole.
        let (cv, _) = cut(Layer { z: 1, float: false }, &covers(2, 1), &[1]);
        assert_eq!(x(&cv), vec![0.0]);
    }

    #[test]
    fn a_backdrop_dims_what_is_under_its_overlay_only() {
        // A dialog's backdrop is painted on its own layer, under its card.
        assert_eq!(cut(PANE, &[], &[1]), (vec![], true));
        assert_eq!(cut(Layer { z: 1, float: false }, &[], &[1]), (vec![], false), "the dialog's own views aren't dimmed");
        assert_eq!(cut(Layer { z: 1, float: false }, &[], &[2]), (vec![], true), "a dialog over the player dims it");
        assert_eq!(cut(PANE, &[], &[]), (vec![], false));
    }

    #[test]
    fn a_page_behind_a_backdrop_never_takes_the_keyboard() {
        assert!(may_take_keyboard("focus", false), "no backdrop over it: any page");
        assert!(!may_take_keyboard("focus", true), "a pane's page behind a window with a scrim");
        assert!(may_take_keyboard("browser.navigate", true), "only the keyboard is held back");
    }
}
