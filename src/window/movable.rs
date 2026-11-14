//! Windows: overlays a mod opens with `kind: "window"`. They stay until
//! closed, move where they're dropped (a press anywhere the mod doesn't keep
//! for itself drags), and the one pressed last is on top. With a `key` a
//! window remembers its spot, and opening that key again replaces it; with
//! `keep` it also reopens on the next start, in the layout that opened it.
//! A layout switch closes them (they belong to their layout, like its mods).
//! With `resizable`, their edges and corners resize them (keeping an aspect
//! ratio if asked, never below a minimum), and a keyed one remembers its size.
//! With `snap`, a window is magnetic to the eight places of the shown tab's
//! pane grid (its outer corners and edge middles): dragged within
//! `SNAP_CATCH` of one it lands exactly there, its outer edge on the grid's,
//! on whole device pixels, and stays anchored there (the grid or its size
//! changing) until dragged off; a keyed one opens on its last anchor.

use super::*;
pub use fireflies_native_view::snap::Place;
use fireflies_native_view::snap::{self, Dir};

/// How far the pointer moves before a press becomes a drag.
const DRAG_START: f32 = 4.0;
/// How much of a window stays on screen however far it's dragged, px.
const KEEP_SHOWN: f32 = 48.0;

/// The grips around a resizable window: this far out from its edges, px.
const GRIP: f32 = 6.0;

/// How near one of its places (px at zoom 1, on both axes) a dragged
/// snapping window is caught; further off it moves freely.
const SNAP_CATCH: f32 = 64.0;

pub struct WinDrag {
    pub id: String,
    /// The pointer's offset from the window's top left.
    grab: Point<Pixels>,
    down: Point<Pixels>,
    pointer: Point<Pixels>,
    moving: bool,
    /// Resizing from these edges (left, top, right, bottom), from the window's
    /// bounds when pressed; None: moving it.
    resize: Option<([bool; 4], Bounds<Pixels>)>,
    /// The app window's size when pressed (a window never outgrows it).
    room: Size<Pixels>,
    /// Device pixels to a point, for a snapped window's spot.
    scale: f32,
}

/// `resizable` on a window: its smallest size and, if any, the aspect ratio
/// (width / height) its size keeps once `chrome` (a bar, a border) is taken
/// off. Design px (at zoom 1).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Resize {
    pub min: (f32, f32),
    pub aspect: Option<f32>,
    pub chrome: (f32, f32),
}

impl Resize {
    /// `true`, or `{ min?: [w, h], aspect?, chrome?: [w, h] }`; anything else: not resizable.
    pub fn parse(v: Option<&Value>) -> Option<Resize> {
        let pair = |v: Option<&Value>, d: (f32, f32)| {
            v.and_then(Value::as_array)
                .and_then(|a| Some((a.first()?.as_f64()? as f32, a.get(1)?.as_f64()? as f32)))
                .filter(|(w, h)| w.is_finite() && h.is_finite() && *w >= 0.0 && *h >= 0.0)
                .unwrap_or(d)
        };
        match v? {
            Value::Bool(true) => Some(Resize { min: (120.0, 80.0), aspect: None, chrome: (0.0, 0.0) }),
            o @ Value::Object(_) => Some(Resize {
                min: pair(o.get("min"), (120.0, 80.0)),
                aspect: o.get("aspect").and_then(Value::as_f64).map(|a| a as f32).filter(|a| a.is_finite() && *a > 0.0),
                chrome: pair(o.get("chrome"), (0.0, 0.0)),
            }),
            _ => None,
        }
    }

    /// The window's new (x, y, width, height) when its `edges` (left, top,
    /// right, bottom) of `start` are dragged by (dx, dy), in px at `zoom`,
    /// inside a `room` (width, height) viewport. The opposite edges stay.
    pub fn resized(&self, start: (f32, f32, f32, f32), edges: [bool; 4], (dx, dy): (f32, f32), room: (f32, f32), zoom: f32) -> (f32, f32, f32, f32) {
        let (x0, y0, w0, h0) = start;
        let [left, top, right, bottom] = edges;
        let (cw, ch) = (self.chrome.0 * zoom, self.chrome.1 * zoom);
        let mut w = w0 + if right { dx } else if left { -dx } else { 0.0 };
        let mut h = h0 + if bottom { dy } else if top { -dy } else { 0.0 };
        let wide = |h: f32, a: f32| (h - ch).max(0.0) * a + cw;
        let tall = |w: f32, a: f32| (w - cw).max(0.0) / a + ch;
        let sideways = left || right;
        let upways = top || bottom;
        if let Some(a) = self.aspect {
            // A corner follows the side moved most; an edge sets the other side.
            let by_width = sideways && (!upways || (w - w0).abs() / w0.max(1.0) >= (h - h0).abs() / h0.max(1.0));
            if by_width { h = tall(w, a) } else { w = wide(h, a) }
        }
        let (min_w, min_h) = (self.min.0 * zoom, self.min.1 * zoom);
        let (max_w, max_h) = (room.0.max(min_w), room.1.max(min_h));
        if w < min_w { w = min_w; if let Some(a) = self.aspect { h = tall(w, a) } }
        if h < min_h { h = min_h; if let Some(a) = self.aspect { w = wide(h, a) } }
        if w > max_w { w = max_w; if let Some(a) = self.aspect { h = tall(w, a) } }
        if h > max_h { h = max_h; if let Some(a) = self.aspect { w = wide(h, a) } }
        let x = if left { x0 + w0 - w } else { x0 };
        let y = if top { y0 + h0 - h } else { y0 };
        (x, y, w, h)
    }
}

// ---- windows.json: spots by key, and the kept windows of each layout

fn path() -> PathBuf {
    file("windows.json")
}

fn read() -> Value {
    std::fs::read_to_string(path()).ok().and_then(|s| serde_json::from_str(&s).ok()).filter(Value::is_object).unwrap_or_else(|| json!({}))
}

fn edit(f: impl FnOnce(&mut Value)) {
    let mut v = read();
    f(&mut v);
    if let Ok(s) = serde_json::to_string_pretty(&v) {
        let _ = crate::persist::write_atomic(&path(), s + "\n");
    }
}

pub fn place_of(key: &str) -> Option<Point<Pixels>> {
    let p = read().get("places")?.get(key)?.as_array()?.clone();
    Some(point(px(p.first()?.as_f64()? as f32), px(p.get(1)?.as_f64()? as f32)))
}

fn remember(key: &str, at: Point<Pixels>) {
    edit(|v| v["places"][key] = json!([f32::from(at.x).round(), f32::from(at.y).round()]));
}

/// A resizable window's size by key, design px.
pub fn size_of(key: &str) -> Option<Size<f32>> {
    let s = read().get("sizes")?.get(key)?.as_array()?.clone();
    Some(size(s.first()?.as_f64()? as f32, s.get(1)?.as_f64()? as f32)).filter(|s| s.width > 1.0 && s.height > 1.0)
}

fn remember_size(key: &str, s: Size<f32>) {
    edit(|v| v["sizes"][key] = json!([s.width.round(), s.height.round()]));
}

/// The place a keyed window was last anchored on: Some(None) when it was
/// last dropped off every place, None when nothing is known.
fn anchor_of(key: &str) -> Option<Option<Place>> {
    let v = read().get("anchors")?.get(key)?.clone();
    Some(v.as_str().and_then(Place::parse))
}

fn remember_anchor(key: &str, anchor: Option<Place>) {
    edit(|v| v["anchors"][key] = anchor.map_or(Value::Null, |p| json!(p.name())));
}

/// What a window opening with `snap` sits on: its key's last anchor; never
/// anchored before, bottom right; last dropped off every place, none (it
/// opens where it was dropped, `placed`; without a spot, bottom right).
pub fn opening_anchor(snap: bool, key: Option<&str>, placed: bool) -> Option<Place> {
    if !snap {
        return None;
    }
    match key.and_then(anchor_of) {
        Some(Some(p)) => Some(p),
        Some(None) if placed => None,
        _ => Some(Place::BottomRight),
    }
}

fn to_rect(b: Bounds<Pixels>) -> fireflies_native_view::Rect {
    fireflies_native_view::Rect { x: f64::from(f32::from(b.origin.x)), y: f64::from(f32::from(b.origin.y)), w: f64::from(f32::from(b.size.width)), h: f64::from(f32::from(b.size.height)) }
}

#[cfg(test)]
pub(super) fn to_rect_for_tests(b: Bounds<Pixels>) -> fireflies_native_view::Rect {
    to_rect(b)
}

/// A window's spot on `place` of `area` at `size`, on whole device pixels.
fn snapped(place: Place, area: fireflies_native_view::Rect, size: Size<Pixels>, scale: f32) -> Point<Pixels> {
    let (x, y) = snap::origin(place, area, (f64::from(f32::from(size.width)), f64::from(f32::from(size.height))), f64::from(scale));
    point(px(x as f32), px(y as f32))
}

/// The place within `SNAP_CATCH` of a window at `at` (top left) and its
/// spot there, if any.
fn caught(area: fireflies_native_view::Rect, at: Point<Pixels>, size: Size<Pixels>, scale: f32) -> Option<(Place, Point<Pixels>)> {
    let zoom = f64::from(f32::from(settings::z(1.0)));
    let (place, (x, y)) = snap::catch(
        area,
        (f64::from(f32::from(at.x)), f64::from(f32::from(at.y))),
        (f64::from(f32::from(size.width)), f64::from(f32::from(size.height))),
        f64::from(SNAP_CATCH) * zoom,
        f64::from(scale),
    )?;
    Some((place, point(px(x as f32), px(y as f32))))
}

/// The outer border of `panes` together, from where each was drawn.
fn grid_of(bounds: &HashMap<String, Bounds<Pixels>>, panes: &[String]) -> Option<fireflies_native_view::Rect> {
    panes.iter().filter_map(|p| bounds.get(p).copied()).reduce(|a, b| a.union(&b)).map(to_rect)
}

pub fn keep(layout: &str, key: &str, spec: &Value) {
    edit(|v| v["kept"][layout][key] = spec.clone());
}

pub fn forget(layout: &str, key: &str) {
    if read().get("kept").and_then(|k| k.get(layout)).and_then(|l| l.get(key)).is_none() {
        return;
    }
    edit(|v| {
        if let Some(l) = v["kept"].get_mut(layout).and_then(Value::as_object_mut) {
            l.remove(key);
        }
    });
}

fn kept(layout: &str) -> Vec<Value> {
    read().get("kept").and_then(|k| k.get(layout)).and_then(Value::as_object).map(|l| l.values().cloned().collect()).unwrap_or_default()
}

impl AppWindow {
    /// The panes a snapping window snaps to: the shown tab's, as drawn (only
    /// the zoomed one while one is), none while no tab shows.
    fn snap_panes(&self) -> Vec<String> {
        if !self.shows_tab() {
            return vec![];
        }
        let Some(tab) = self.model.active_tab() else { return vec![] };
        tab.shown().visible_blocks().into_iter().filter(|n| n.is_pane()).map(|n| n.id.clone()).collect()
    }

    /// The shown tab's pane grid: the outer border of its panes together (not
    /// the sidebar, the tab strip or the parked row), as last drawn.
    pub(super) fn snap_area(&self) -> Option<fireflies_native_view::Rect> {
        grid_of(&self.bounds.borrow(), &self.snap_panes())
    }

    /// The windows a layout keeps, reopened (at start, or on switching to it).
    pub(super) fn open_kept_windows(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        for spec in kept(&self.layout_name) {
            self.open_overlay(mods::new_overlay_id(), spec, window, cx);
        }
    }

    /// Leaving a layout: its windows close (the kept ones come back with it).
    pub(super) fn close_windows(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        // The layout's windows go with it; the app's own (What's new) stay.
        let ids: Vec<String> = self.overlays.iter().filter(|o| o.kind == OverlayKind::Window && !o.frame).map(|o| o.id.clone()).collect();
        for id in ids {
            self.remove_overlay(&id, window, cx);
        }
    }

    /// A window at its spot: where it was dropped, else centered once its size
    /// is known (it stays invisible until then), always partly on screen.
    pub(super) fn render_window(&self, o: &Overlay, body: Stateful<Div>, viewport: Size<Pixels>, scale: f32, cx: &mut Context<Self>) -> AnyElement {
        let measured = self.bounds.borrow().get(&o.slot).map(|b| b.size);
        let mut size = measured.unwrap_or_default();
        let resizing = self.win_drag.as_ref().filter(|d| d.id == o.id && d.moving).and_then(|d| Some((d, d.resize?, o.resize?)));
        // Snapping: the shown tab's pane grid, as last drawn.
        let panes = if o.snap { self.snap_panes() } else { vec![] };
        let area = grid_of(&self.bounds.borrow(), &panes);
        let anchored = o.anchor.zip(area);
        let mut body = body;
        let at = match (&self.win_drag, o.place) {
            _ if resizing.is_some() => {
                let (d, (edges, b), r) = resizing.unwrap();
                let (x, y, w, h) = r.resized(
                    (f32::from(b.origin.x), f32::from(b.origin.y), f32::from(b.size.width), f32::from(b.size.height)),
                    edges,
                    (f32::from(d.pointer.x - d.down.x), f32::from(d.pointer.y - d.down.y)),
                    (f32::from(viewport.width), f32::from(viewport.height)),
                    f32::from(settings::z(1.0)),
                );
                size = gpui::size(px(w), px(h));
                body = body.w(px(w)).h(px(h)).max_h(px(h));
                // Anchored: it grows and shrinks on its place.
                match anchored {
                    Some((p, a)) => snapped(p, a, size, scale),
                    None => point(px(x), px(y)),
                }
            }
            (Some(d), _) if d.id == o.id && d.moving => {
                let free = d.pointer - d.grab;
                area.and_then(|a| caught(a, free, size, scale)).map_or(free, |(_, at)| at)
            }
            _ if anchored.is_some() && measured.is_some() => {
                let (p, a) = anchored.unwrap();
                snapped(p, a, size, scale)
            }
            (_, Some(p)) => p,
            _ => point((viewport.width - size.width) / 2.0, (viewport.height - size.height) / 2.0),
        };
        let keep = px(KEEP_SHOWN);
        let x = at.x.min(viewport.width - keep).max(keep - size.width);
        let y = at.y.min(viewport.height - keep).max(px(0.0));
        let measure = {
            let (bounds, slot, known) = (self.bounds.clone(), o.slot.clone(), measured.is_some());
            canvas(
                move |b, window, _| {
                    // Unmeasured, or the grid it snaps to drawn elsewhere this
                    // frame (a resize, the sidebar folding, another tab): once more.
                    if !known || (!panes.is_empty() && grid_of(&bounds.borrow(), &panes) != area) {
                        window.request_animation_frame();
                    }
                    bounds.borrow_mut().insert(slot, b);
                },
                |_, _, _, _| {},
            )
            .absolute()
            .size_full()
        };
        let (raise, press) = (o.id.clone(), o.id.clone());
        let body = body
            .relative()
            .child(measure)
            // Pressed anywhere, even on the mod's own controls: to the front.
            .capture_any_mouse_down(cx.listener(move |this, _, _, cx| this.raise_window(&raise, cx)))
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(move |this, ev: &MouseDownEvent, window, cx| {
                    cx.stop_propagation();
                    this.window_press(&press, ev.position, window.scale_factor(), cx);
                }),
            );
        let grips = o.resize.is_some().then(|| self.grips(&o.id, cx));
        div().absolute().left(x).top(y).when(measured.is_none(), |d| d.opacity(0.0)).child(body).children(grips.into_iter().flatten()).into_any_element()
    }

    /// The edges and corners that resize a window, just outside it (inside,
    /// a native view would take the press), each a hole in native views below.
    fn grips(&self, id: &str, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let g = settings::z(GRIP);
        // (left, top, right, bottom) edges each grip moves.
        let all: [[bool; 4]; 8] = [
            [true, false, false, false], [false, true, false, false], [false, false, true, false], [false, false, false, true],
            [true, true, false, false], [false, true, true, false], [false, false, true, true], [true, false, false, true],
        ];
        all.into_iter()
            .enumerate()
            .map(|(i, e)| {
                let [l, t, r, b] = e;
                let id = id.to_owned();
                let corner = (l || r) && (t || b);
                let mut d = div().id(SharedString::from(format!("grip-{id}-{i}"))).absolute().occlude();
                d = if l { d.left(-g).w(g) } else if r { d.right(-g).w(g) } else { d.left_0().right_0() };
                d = if t { d.top(-g).h(g) } else if b { d.bottom(-g).h(g) } else { d.top_0().bottom_0() };
                d = match (corner, l || r, (l && t) || (r && b)) {
                    (true, _, true) => d.cursor_nwse_resize(),
                    (true, _, false) => d.cursor_nesw_resize(),
                    (false, true, _) => d.cursor_ew_resize(),
                    (false, false, _) => d.cursor_ns_resize(),
                };
                d.child(crate::native_view::cover_probe(0.0, crate::native_view::By::Overlay))
                    .on_mouse_down(
                        MouseButton::Left,
                        cx.listener(move |this, ev: &MouseDownEvent, window, cx| {
                            cx.stop_propagation();
                            this.raise_window(&id, cx);
                            this.resize_press(&id, e, ev.position, window.viewport_size(), window.scale_factor(), cx);
                        }),
                    )
                    .into_any_element()
            })
            .collect()
    }

    /// `overlay.resizable`: how a window resizes from now on; with an aspect,
    /// it takes that shape at its width now (a video's real one, once known).
    pub(super) fn window_resizable(&mut self, id: &str, spec: Option<&Value>, room: Size<Pixels>) -> Result<(), String> {
        let measured = self.bounds.borrow().get(&format!("overlay:{id}")).copied();
        let o = self.overlays.iter_mut().find(|o| o.id == id && o.kind == OverlayKind::Window).ok_or_else(|| format!("no window {id:?}"))?;
        o.resize = Resize::parse(spec);
        let (Some(r), Some(b)) = (o.resize, measured) else { return Ok(()) };
        if r.aspect.is_none() {
            return Ok(());
        }
        let zoom = f32::from(settings::z(1.0));
        let (_, _, w, h) = r.resized(
            (0.0, 0.0, f32::from(b.size.width), f32::from(b.size.height)),
            [false, false, true, false],
            (0.0, 0.0),
            (f32::from(room.width), f32::from(room.height)),
            zoom,
        );
        o.size = size((w / zoom).max(1.01), (h / zoom).max(1.01));
        o.fit = false;
        // Stays where it is (a centered one would move by half the change).
        o.place.get_or_insert(b.origin);
        if let Some(k) = &o.key {
            remember_size(k, o.size);
        }
        Ok(())
    }

    fn resize_press(&mut self, id: &str, edges: [bool; 4], at: Point<Pixels>, room: Size<Pixels>, scale: f32, cx: &mut Context<Self>) {
        let Some(b) = self.bounds.borrow().get(&format!("overlay:{id}")).copied() else { return };
        self.win_drag = Some(WinDrag { id: id.to_owned(), grab: at - b.origin, down: at, pointer: at, moving: false, resize: Some((edges, b)), room, scale });
        cx.notify();
    }

    pub(super) fn raise_window(&mut self, id: &str, cx: &mut Context<Self>) {
        let Some(i) = self.overlays.iter().position(|o| o.id == id) else { return };
        if i + 1 < self.overlays.len() {
            let o = self.overlays.remove(i);
            self.overlays.push(o);
            cx.notify();
        }
    }

    fn window_press(&mut self, id: &str, at: Point<Pixels>, scale: f32, cx: &mut Context<Self>) {
        // A terminal in the window keeps its presses (selecting text).
        let on_terminal = self.overlays.iter().find(|o| o.id == id).and_then(|o| o.layout.as_ref()).is_some_and(|l| {
            let bounds = self.bounds.borrow();
            l.visible_blocks().iter().any(|n| matches!(n.content(), Some(Content::Terminal { .. })) && bounds.get(&n.id).is_some_and(|b| b.contains(&at)))
        });
        if on_terminal {
            return;
        }
        let Some(b) = self.bounds.borrow().get(&format!("overlay:{id}")).copied() else { return };
        self.win_drag = Some(WinDrag { id: id.to_owned(), grab: at - b.origin, down: at, pointer: at, moving: false, resize: None, room: Size::default(), scale });
        cx.notify();
    }

    fn window_move(&mut self, at: Point<Pixels>, pressed: bool, cx: &mut Context<Self>) {
        let Some(d) = &mut self.win_drag else { return };
        if !pressed {
            self.win_drag = None;
            cx.notify();
            return;
        }
        d.pointer = at;
        let dist = f32::from((at.x - d.down.x).abs()).max(f32::from((at.y - d.down.y).abs()));
        if d.moving || dist >= DRAG_START {
            d.moving = true;
            cx.notify();
        }
    }

    /// Ends a press: a drag leaves the window there (and remembers it under its
    /// key); returns true so the release doesn't also click what's under it.
    fn window_release(&mut self, cx: &mut Context<Self>) -> bool {
        let Some(d) = self.win_drag.take() else { return false };
        cx.notify();
        if !d.moving {
            return false;
        }
        let zoom = f32::from(settings::z(1.0));
        let viewport = d.room;
        let area = self.snap_area();
        let measured = self.bounds.borrow().get(&format!("overlay:{}", d.id)).map(|b| b.size);
        let scale = d.scale;
        let Some(o) = self.overlays.iter_mut().find(|o| o.id == d.id) else { return true };
        let area = area.filter(|_| o.snap);
        let at = match (d.resize, o.resize) {
            (Some((edges, b)), Some(r)) => {
                let (x, y, w, h) = r.resized(
                    (f32::from(b.origin.x), f32::from(b.origin.y), f32::from(b.size.width), f32::from(b.size.height)),
                    edges,
                    (f32::from(d.pointer.x - d.down.x), f32::from(d.pointer.y - d.down.y)),
                    (f32::from(viewport.width), f32::from(viewport.height)),
                    zoom,
                );
                // Kept as design px (more than 1: not a share of the window).
                o.size = size((w / zoom).max(1.01), (h / zoom).max(1.01));
                o.fit = false;
                if let Some(k) = &o.key {
                    remember_size(k, o.size);
                }
                // Anchored: it stays on its place at its new size.
                match o.anchor.zip(area) {
                    Some((p, a)) => snapped(p, a, gpui::size(px(w), px(h)), scale),
                    None => point(px(x), px(y)),
                }
            }
            _ => {
                let free = d.pointer - d.grab;
                // Dropped on a place: anchored there; anywhere else: free.
                let on = area.zip(measured).and_then(|(a, s)| caught(a, free, s, scale));
                if o.snap {
                    o.anchor = on.map(|(p, _)| p);
                    if let Some(k) = &o.key {
                        remember_anchor(k, o.anchor);
                    }
                }
                on.map_or(free, |(_, at)| at)
            }
        };
        o.place = Some(at);
        if let Some(k) = &o.key {
            remember(k, at);
        }
        true
    }

    /// `overlay.focus`: the keyboard to a window (`id`), or to the next or
    /// previous one (`dir`) in the order they opened; past the last (or
    /// `dir: "none"`) back to the pane. It comes to the front; a mod gets
    /// `focus` from `nextCommand()`. Not while a dialog or popup holds the keys.
    /// While a window with a scrim shows there's no pane to go back to: the
    /// cycle stays among the windows and `dir: "none"` is refused.
    pub(super) fn focus_window_cmd(&mut self, id: Option<String>, dir: &str, window: &mut Window, cx: &mut Context<Self>) -> Result<(), String> {
        if self.overlays.iter().any(|o| o.kind.modal_keys()) {
            return Err("a dialog holds the keyboard".into());
        }
        let mut wins: Vec<(u64, String)> = self.overlays.iter().filter(|o| o.kind == OverlayKind::Window).map(|o| (o.opened, o.id.clone())).collect();
        wins.sort();
        let modal = self.top_scrim_window().is_some();
        let to = match id {
            Some(id) if wins.iter().any(|(_, w)| *w == id) => Some(id),
            Some(id) => return Err(format!("no window {id:?}")),
            None => {
                let at = wins.iter().position(|(_, w)| self.window_has_keys(w, window, cx));
                let next = if modal { cycle_modal(at, wins.len(), dir)? } else { cycle(at, wins.len(), dir)? };
                next.map(|i| wins[i].1.clone())
            }
        };
        match to {
            Some(id) => self.give_window_keys(&id, window, cx),
            None => self.restore_focus(window, cx),
        }
        cx.notify();
        Ok(())
    }

    /// The window (or something in it) holds the keyboard.
    pub(super) fn window_has_keys(&self, id: &str, window: &Window, cx: &App) -> bool {
        self.overlays.iter().find(|o| o.id == id).is_some_and(|o| o.focus.contains_focused(window, cx))
    }

    fn give_window_keys(&mut self, id: &str, window: &mut Window, cx: &mut Context<Self>) {
        self.raise_window(id, cx);
        self.hand_window(id, window, cx);
    }

    /// The keyboard to a window, where it is in the stack: its first terminal,
    /// else its frame, and its mod gets `focus` (`nextCommand()`).
    pub(super) fn hand_window(&mut self, id: &str, window: &mut Window, cx: &mut Context<Self>) {
        if id == "terminal-peek" {
            return self.focus_float_view(window, cx);
        }
        let Some(o) = self.overlays.iter().find(|o| o.id == id) else { return };
        // A window of blocks: its first terminal.
        if let Some(t) = o.layout.as_ref().and_then(|l| l.visible_blocks().into_iter().find_map(|n| self.terms.get(&n.id))) {
            return t.focus.focus(window, cx);
        }
        crate::native_view::release_keyboard(window);
        o.focus.focus(window, cx);
        if let Some(copy) = self.copies.get(&o.slot) {
            mods::send_command_to(copy.id, "focus");
        }
    }

    /// `overlay.move`: moves a window by `dx`/`dy` and, when it's resizable,
    /// sizes it by `dw`/`dh` (design px, its right and bottom edges; within
    /// its limits). Default: the window holding the keyboard, else the top one.
    /// Kept like a drag (under its key).
    pub(super) fn move_window_cmd(&mut self, id: Option<String>, d: [f32; 4], room: Size<Pixels>, window: &Window, cx: &mut Context<Self>) -> Result<(), String> {
        let id = match id {
            Some(id) => id,
            None => {
                let wins = self.overlays.iter().filter(|o| o.kind == OverlayKind::Window);
                let held = wins.clone().find(|o| o.focus.contains_focused(window, cx));
                held.or_else(|| wins.last()).map(|o| o.id.clone()).ok_or("no window open")?
            }
        };
        let b = self.bounds.borrow().get(&format!("overlay:{id}")).copied().ok_or_else(|| format!("no window {id:?} on screen"))?;
        let o = self.overlays.iter_mut().find(|o| o.id == id && o.kind == OverlayKind::Window).ok_or_else(|| format!("no window {id:?}"))?;
        let zoom = f32::from(settings::z(1.0));
        let [dx, dy, dw, dh] = d.map(|v| v * zoom);
        let (mut x, mut y) = (f32::from(b.origin.x) + dx, f32::from(b.origin.y) + dy);
        if dw != 0.0 || dh != 0.0 {
            let r = o.resize.ok_or("this window doesn't resize")?;
            let (rx, ry, w, h) = r.resized(
                (x, y, f32::from(b.size.width), f32::from(b.size.height)),
                [false, false, true, true],
                (dw, dh),
                (f32::from(room.width), f32::from(room.height)),
                zoom,
            );
            (x, y) = (rx, ry);
            o.size = size((w / zoom).max(1.01), (h / zoom).max(1.01));
            o.fit = false;
            if let Some(k) = &o.key {
                remember_size(k, o.size);
            }
        }
        // Partly on screen, as a drag leaves it.
        let keep = KEEP_SHOWN;
        let x = x.min(f32::from(room.width) - keep).max(keep - f32::from(b.size.width));
        let y = y.min(f32::from(room.height) - keep).max(0.0);
        let at = point(px(x), px(y));
        o.place = Some(at);
        if let Some(k) = &o.key {
            remember(k, at);
        }
        // Moved (not only sized): off its place, as a drag takes it.
        if (dx != 0.0 || dy != 0.0) && o.anchor.take().is_some()
            && let Some(k) = &o.key
        {
            remember_anchor(k, None);
        }
        cx.notify();
        Ok(())
    }

    /// `overlay.snap`: a window's snapping `on` or off, and/or onto a place
    /// `to` (a place's name, or `left`/`right`/`up`/`down`: the next place
    /// that way from the one it's on, else from the nearest). Default: the
    /// window holding the keyboard, else the top one. Off, it stays where it is.
    pub(super) fn snap_window_cmd(&mut self, id: Option<String>, on: Option<bool>, to: Option<&str>, room: Size<Pixels>, window: &Window, cx: &mut Context<Self>) -> Result<(), String> {
        let id = match id {
            Some(id) => id,
            None => {
                let wins = self.overlays.iter().filter(|o| o.kind == OverlayKind::Window);
                let held = wins.clone().find(|o| o.focus.contains_focused(window, cx));
                held.or_else(|| wins.last()).map(|o| o.id.clone()).ok_or("no window open")?
            }
        };
        let b = self.bounds.borrow().get(&format!("overlay:{id}")).copied();
        let area = self.snap_area();
        let scale = window.scale_factor();
        let o = self.overlays.iter_mut().find(|o| o.id == id && o.kind == OverlayKind::Window).ok_or_else(|| format!("no window {id:?}"))?;
        if let Some(on) = on {
            o.snap = on;
            if !on {
                // Where it shows now (an anchored window follows its place, not `place`).
                if let Some(b) = b.filter(|_| o.anchor.is_some()) {
                    o.place = Some(b.origin);
                    if let Some(k) = &o.key {
                        remember(k, b.origin);
                    }
                }
                o.anchor = None;
            }
        }
        if let Some(to) = to {
            let place = Place::parse(to);
            let dir = Dir::parse(to);
            if place.is_none() && dir.is_none() {
                return Err(format!("overlay.snap to is a place (top-left, top, top-right, right, bottom-right, bottom, bottom-left, left) or left, right, up, down, not {to:?}"));
            }
            let area = area.ok_or("no pane grid shown to snap to")?;
            let b = b.ok_or_else(|| format!("no window {id:?} on screen"))?;
            let r = to_rect(b);
            let place = place.unwrap_or_else(|| {
                let from = o.anchor.unwrap_or_else(|| snap::closest(area, (r.x, r.y), (r.w, r.h), f64::from(scale)));
                from.step(dir.unwrap())
            });
            let at = snapped(place, area, b.size, scale);
            let keep = px(KEEP_SHOWN);
            let at = point(at.x.min(room.width - keep).max(keep - b.size.width), at.y.min(room.height - keep).max(px(0.0)));
            o.place = Some(at);
            o.anchor = o.snap.then_some(place);
            if let Some(k) = &o.key {
                remember(k, at);
            }
        }
        if let Some(k) = o.key.clone().filter(|_| o.snap) {
            remember_anchor(&k, o.anchor);
        }
        cx.notify();
        Ok(())
    }

    /// While a window is pressed: follows the pointer anywhere in the app.
    pub(super) fn window_tracker(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        self.win_drag.as_ref()?;
        let this = cx.entity().downgrade();
        Some(
            canvas(
                |_, _, _| {},
                move |_, _, window, _| {
                    let t = this.clone();
                    window.on_mouse_event(move |ev: &MouseMoveEvent, phase, _, cx| {
                        if phase == DispatchPhase::Capture {
                            let _ = t.update(cx, |this, cx| this.window_move(ev.position, ev.pressed_button == Some(MouseButton::Left), cx));
                        }
                    });
                    let t = this.clone();
                    window.on_mouse_event(move |ev: &MouseUpEvent, phase, _, cx| {
                        if phase == DispatchPhase::Capture && ev.button == MouseButton::Left && t.update(cx, |this, cx| this.window_release(cx)).unwrap_or(false) {
                            cx.stop_propagation();
                        }
                    });
                },
            )
            .absolute()
            .size_full()
            .into_any_element(),
        )
    }
}

/// The window after (or before) `at` of `n` (None: none has the keys);
/// past either end, None: the keyboard goes back to the pane.
fn cycle(at: Option<usize>, n: usize, dir: &str) -> Result<Option<usize>, String> {
    Ok(match (dir, at) {
        _ if n == 0 => None,
        ("none", _) => None,
        ("next", None) => Some(0),
        ("next", Some(i)) => (i + 1 < n).then_some(i + 1),
        ("prev", None) => Some(n - 1),
        ("prev", Some(i)) => i.checked_sub(1),
        _ => return Err(format!("dir is \"next\", \"prev\" or \"none\", not {dir:?}")),
    })
}

/// `cycle` while a window with a scrim shows: round the windows, never out
/// to the pane behind them.
fn cycle_modal(at: Option<usize>, n: usize, dir: &str) -> Result<Option<usize>, String> {
    if dir == "none" {
        return Err("a window with a scrim holds the keyboard: close it to get back to the pane".into());
    }
    Ok(cycle(at, n, dir)?.or_else(|| match dir {
        "prev" => n.checked_sub(1),
        _ => (n > 0).then_some(0),
    }))
}

#[cfg(test)]
mod cycle_tests {
    use super::{cycle, cycle_modal};

    #[test]
    fn with_a_scrim_window_cycling_stays_among_the_windows() {
        assert_eq!(cycle_modal(Some(2), 3, "next"), Ok(Some(0)), "after the last: the first, not the pane");
        assert_eq!(cycle_modal(Some(0), 3, "prev"), Ok(Some(2)));
        assert_eq!(cycle_modal(Some(0), 1, "next"), Ok(Some(0)), "one window keeps the keys");
        assert_eq!(cycle_modal(None, 2, "next"), Ok(Some(0)));
        assert!(cycle_modal(Some(0), 2, "none").is_err(), "no pane to go back to");
        assert!(cycle_modal(Some(0), 2, "sideways").is_err());
    }

    #[test]
    fn cycling_goes_through_every_window_then_back_to_the_pane() {
        assert_eq!(cycle(None, 3, "next"), Ok(Some(0)));
        assert_eq!(cycle(Some(0), 3, "next"), Ok(Some(1)));
        assert_eq!(cycle(Some(2), 3, "next"), Ok(None), "after the last: the pane");
        assert_eq!(cycle(None, 3, "prev"), Ok(Some(2)));
        assert_eq!(cycle(Some(0), 3, "prev"), Ok(None), "before the first: the pane");
        assert_eq!(cycle(Some(1), 3, "none"), Ok(None));
        assert_eq!(cycle(None, 0, "next"), Ok(None), "no windows: the pane");
        assert!(cycle(None, 2, "up").is_err());
    }
}

#[cfg(test)]
mod resize_tests {
    use super::Resize;
    use serde_json::json;

    const ROOM: (f32, f32) = (2000.0, 1200.0);

    #[test]
    fn resizable_takes_true_or_its_limits() {
        assert!(Resize::parse(None).is_none());
        assert!(Resize::parse(Some(&json!(false))).is_none());
        assert_eq!(Resize::parse(Some(&json!(true))).unwrap().aspect, None);
        let r = Resize::parse(Some(&json!({ "min": [200, 130], "aspect": 1.7777, "chrome": [2, 24] }))).unwrap();
        assert_eq!((r.min, r.chrome), ((200.0, 130.0), (2.0, 24.0)));
        assert!(Resize::parse(Some(&json!({ "aspect": -1 }))).unwrap().aspect.is_none());
    }

    #[test]
    fn the_far_edges_move_and_the_aspect_holds_past_the_chrome() {
        let r = Resize { min: (200.0, 100.0), aspect: Some(2.0), chrome: (0.0, 20.0) };
        // The right edge: wider, and as much taller as the video needs.
        assert_eq!(r.resized((10.0, 10.0, 400.0, 220.0), [false, false, true, false], (100.0, 0.0), ROOM, 1.0), (10.0, 10.0, 500.0, 270.0));
        // The top left corner: the bottom right stays where it was.
        let (x, y, w, h) = r.resized((10.0, 10.0, 400.0, 220.0), [true, true, false, false], (-100.0, -10.0), ROOM, 1.0);
        assert_eq!((w, h, x + w, y + h), (500.0, 270.0, 410.0, 230.0));
        // The bottom edge sets the width.
        assert_eq!(r.resized((0.0, 0.0, 400.0, 220.0), [false, false, false, true], (0.0, 50.0), ROOM, 1.0).2, 500.0);
    }

    #[test]
    fn a_new_aspect_refits_the_height_at_the_same_width() {
        // As overlay.resizable and a remembered size do: no drag, the width leads.
        let r = Resize { min: (240.0, 158.0), aspect: Some(4.0 / 3.0), chrome: (2.0, 24.0) };
        assert_eq!(r.resized((0.0, 0.0, 386.0, 238.0), [false, false, true, false], (0.0, 0.0), ROOM, 1.0), (0.0, 0.0, 386.0, 312.0));
    }

    #[test]
    fn never_smaller_than_the_minimum_nor_bigger_than_the_window() {
        let r = Resize { min: (200.0, 100.0), aspect: Some(2.0), chrome: (0.0, 20.0) };
        assert_eq!(r.resized((0.0, 0.0, 400.0, 220.0), [false, false, true, true], (-900.0, -900.0), ROOM, 1.0), (0.0, 0.0, 200.0, 120.0));
        let (_, _, w, h) = r.resized((0.0, 0.0, 400.0, 220.0), [false, false, true, false], (5000.0, 0.0), ROOM, 1.0);
        assert!(w <= ROOM.0 && h <= ROOM.1);
        // At zoom 2 the limits double.
        assert_eq!(r.resized((0.0, 0.0, 800.0, 440.0), [false, false, true, false], (-900.0, 0.0), ROOM, 2.0).2, 400.0);
        // Without an aspect, each side on its own.
        let free = Resize { min: (100.0, 50.0), aspect: None, chrome: (0.0, 0.0) };
        assert_eq!(free.resized((0.0, 0.0, 300.0, 200.0), [false, false, true, false], (40.0, 0.0), ROOM, 1.0), (0.0, 0.0, 340.0, 200.0));
    }
}
