//! App-owned pane grips and drag gestures, independent of header mods.
use super::*;
use crate::layout::Edge;

pub(super) struct PaneDrag {
    pane: String,
    tab: String,
    down: Point<Pixels>,
    at: Point<Pixels>,
    moving: bool,
    /// A chip from the parking row, not a placed pane's grip.
    parked: bool,
    target: Option<Drop>,
}

/// Where a dragged pane would land.
#[derive(Clone, Debug, PartialEq)]
pub(super) enum Drop {
    /// Beside a pane (an edge), or in its place (none).
    Pane(String, Option<Edge>),
    /// In the parking row, at this spot.
    Park(usize),
}

impl PaneDrag {
    pub(super) fn pane(&self) -> &str {
        &self.pane
    }

    pub(super) fn moving(&self) -> bool {
        self.moving
    }
}

fn edge_name(edge: Edge) -> &'static str {
    match edge {
        Edge::Top => "top",
        Edge::Right => "right",
        Edge::Bottom => "bottom",
        Edge::Left => "left",
    }
}

/// The outer quarter of a pane chooses its nearest edge; the middle swaps.
fn drop_zone(bounds: Bounds<Pixels>, at: Point<Pixels>) -> Option<Option<Edge>> {
    if !bounds.contains(&at) || bounds.size.width <= px(0.) || bounds.size.height <= px(0.) {
        return None;
    }
    let x = f32::from(at.x - bounds.origin.x) / f32::from(bounds.size.width);
    let y = f32::from(at.y - bounds.origin.y) / f32::from(bounds.size.height);
    let (distance, edge) = [(x, Edge::Left), (1. - x, Edge::Right), (y, Edge::Top), (1. - y, Edge::Bottom)]
        .into_iter().min_by(|a, b| a.0.total_cmp(&b.0)).unwrap();
    Some((distance < 0.25).then_some(edge))
}

/// The top row of a pane without a top header.
const STRIP: f32 = 18.;

fn top_strip(mut bounds: Bounds<Pixels>, row: f32, at: Point<Pixels>) -> bool {
    bounds.size.height = bounds.size.height.min(settings::z(row));
    bounds.contains(&at)
}

fn inherited_movable(root: &Node, id: &str) -> Option<bool> {
    root.path_to(id)?.iter().rev().find_map(|id| root.find(id)?.movable)
}

impl AppWindow {
    pub(super) fn pane_movable(&self, pane: &str) -> bool {
        let Some(tab) = self.model.active_tab() else { return false };
        if tab.zoomed.is_some() || tab.root.panes().len() < 2 || !tab.root.find(pane).is_some_and(Node::is_pane) {
            return false;
        }
        let owner = self.chrome.visible_blocks().into_iter().find(|n| matches!(n.content(), Some(Content::Context { .. })));
        inherited_movable(&tab.root, pane)
            .or_else(|| owner.and_then(|n| inherited_movable(&self.chrome, &n.id)))
            .unwrap_or(true)
    }

    pub(super) fn pane_grip(&self, pane: &str, header: Option<f32>, cx: &mut Context<Self>) -> Option<AnyElement> {
        let row = header.unwrap_or(STRIP).max(STRIP);
        self.pane_grip_rows.borrow_mut().insert(pane.to_owned(), row);
        if !self.pane_movable(pane) { return None; }
        let dragging = self.pane_drag.as_ref().is_some_and(|d| d.pane == pane);
        if self.pane_grip_hover.as_deref() != Some(pane) && !dragging { return None; }
        let pane = pane.to_owned();
        Some(div().id(SharedString::from(format!("grip-{pane}")))
            .absolute().top(settings::z((row - 18.) / 2.)).left(relative(0.5)).ml(-settings::z(14.))
            .w(settings::z(28.)).h(settings::z(18.)).rounded(settings::z(4.))
            .bg(c("background").opacity(0.85))
            .hover(|s| s.bg(c("hover")))
            .flex().flex_col().items_center().justify_center().gap(settings::z(3.)).occlude()
            .group("pane-grip")
            .cursor(if dragging { CursorStyle::ClosedHand } else { CursorStyle::OpenHand })
            .on_mouse_down(MouseButton::Left, cx.listener(move |this, ev: &MouseDownEvent, _, cx| {
                this.pane_press(&pane, ev.position, cx);
                cx.stop_propagation();
            }))
            .children((0..2).map(|_| div().flex().gap(settings::z(3.)).children((0..3).map(|_| div().size(settings::z(2.)).rounded_full()
                .bg(if dragging { c("foreground") } else { c("dim") })
                .group_hover("pane-grip", |s| s.bg(c("foreground")))))))
            .into_any_element())
    }

    fn pane_hover(&mut self, at: Point<Pixels>, cx: &mut Context<Self>) {
        let hovered = self.model.active_tab().and_then(|tab| {
            let bounds = self.bounds.borrow();
            let rows = self.pane_grip_rows.borrow();
            tab.shown().visible_blocks().into_iter().find_map(|n| {
                let b = bounds.get(&n.id)?;
                let row = rows.get(&n.id).copied().unwrap_or(STRIP);
                (self.pane_movable(&n.id) && top_strip(*b, row, at)).then(|| n.id.clone())
            })
        });
        if hovered != self.pane_grip_hover {
            self.pane_grip_hover = hovered;
            cx.notify();
        }
    }

    pub(super) fn pane_press(&mut self, pane: &str, at: Point<Pixels>, cx: &mut Context<Self>) {
        if self.pane_movable(pane) {
            self.pane_drag = Some(PaneDrag {
                pane: pane.to_owned(), tab: self.model.active_tab().unwrap().id.clone(),
                down: at, at, moving: false, parked: false, target: None,
            });
            cx.notify();
        }
    }

    /// A press on a parking row chip: a click puts it back, a drag moves it.
    pub(super) fn park_press(&mut self, pane: &str, at: Point<Pixels>, cx: &mut Context<Self>) {
        let Some(tab) = self.model.active_tab().filter(|t| t.parked_index(pane).is_some()) else { return };
        self.pane_drag = Some(PaneDrag { pane: pane.to_owned(), tab: tab.id.clone(), down: at, at, moving: false, parked: true, target: None });
        cx.notify();
    }

    fn pane_target(&self, at: Point<Pixels>) -> Option<Drop> {
        let d = self.pane_drag.as_ref()?;
        let tab = self.model.active_tab().filter(|t| t.id == d.tab && t.zoomed.is_none())?;
        if self.park_zone(tab).is_some_and(|z| z.contains(&at)) {
            return Some(Drop::Park(parking::insert_index(&self.chip_bounds(tab, &d.pane), at.x)));
        }
        let bounds = self.bounds.borrow();
        tab.shown().visible_blocks().into_iter().filter(|n| n.is_pane() && n.id != d.pane)
            .find_map(|n| Some(Drop::Pane(n.id.clone(), drop_zone(*bounds.get(&n.id)?, at)?)))
    }

    fn pane_move(&mut self, at: Point<Pixels>, pressed: bool, cx: &mut Context<Self>) {
        let Some(d) = self.pane_drag.as_mut() else { return };
        if !pressed {
            self.cancel_pane_drag(cx);
            return;
        }
        if !d.moving && (at.x - d.down.x).abs().max((at.y - d.down.y).abs()) < settings::z(4.) {
            return;
        }
        d.moving = true;
        d.at = at;
        let target = self.pane_target(at);
        self.pane_drag.as_mut().unwrap().target = target;
        cx.notify();
    }

    pub(super) fn cancel_pane_drag(&mut self, cx: &mut Context<Self>) {
        if self.pane_drag.take().is_some() {
            cx.notify();
        }
    }

    fn pane_release(&mut self, at: Point<Pixels>, window: &mut Window, cx: &mut Context<Self>) -> bool {
        let target = self.pane_target(at);
        let Some(d) = self.pane_drag.take() else { return false };
        if !d.moving {
            // A click on a chip puts its pane back.
            if d.parked {
                self.run("pane.unpark", json!({ "pane": d.pane }), window, cx);
            }
            cx.notify();
            return true;
        }
        match target {
            Some(Drop::Park(i)) if d.parked || self.pane_movable(&d.pane) => {
                self.run("pane.park", json!({ "pane": d.pane, "index": i + 1 }), window, cx);
            }
            Some(Drop::Pane(target, edge)) if d.parked => {
                self.run("pane.unpark", json!({ "pane": d.pane, "target": target, "edge": edge.map(edge_name) }), window, cx);
            }
            Some(Drop::Pane(target, edge)) => {
                if self.pane_movable(&d.pane) && self.model.move_pane(&d.pane, &target, edge) {
                    self.sync(window, cx);
                }
            }
            _ => {}
        }
        cx.defer_in(window, |this, window, cx| this.restore_focus(window, cx));
        cx.notify();
        true
    }

    pub(super) fn pane_drag_layer(&self, cx: &mut Context<Self>) -> AnyElement {
        let preview = self.pane_drag.as_ref().and_then(|d| d.target.as_ref()).and_then(|t| {
            let Drop::Pane(id, edge) = t else { return self.park_preview() };
            let mut b = *self.bounds.borrow().get(id)?;
            match edge {
                Some(Edge::Left) => b.size.width /= 2.,
                Some(Edge::Right) => { b.size.width /= 2.; b.origin.x += b.size.width; }
                Some(Edge::Top) => b.size.height /= 2.,
                Some(Edge::Bottom) => { b.size.height /= 2.; b.origin.y += b.size.height; }
                None => {}
            }
            Some(div().absolute().left(b.origin.x).top(b.origin.y).w(b.size.width).h(b.size.height)
                .bg(c("accent").opacity(0.18)).border_2().border_color(c("accent")).into_any_element())
        });
        // A chip being dragged follows the pointer.
        let ghost = self.pane_drag.as_ref().filter(|d| d.parked && d.moving).and_then(|d| {
            let tab = self.model.tab(&d.tab)?;
            let n = &tab.parked.get(tab.parked_index(&d.pane)?)?.pane;
            Some(self.chip(n, true).absolute().left(d.at.x + px(8.)).top(d.at.y + px(8.)).opacity(0.9).into_any_element())
        });
        let this = cx.entity().downgrade();
        div().id("pane-drag-layer").absolute().inset_0()
            .when(self.pane_drag.is_some(), |d| d.occlude().cursor(CursorStyle::ClosedHand))
            .children(preview).children(ghost).child(canvas(
            |_, _, _| {},
            move |_, _, window, _| {
                let t = this.clone();
                window.on_mouse_event(move |ev: &MouseMoveEvent, phase, _, cx| {
                    if phase == DispatchPhase::Capture {
                        let _ = t.update(cx, |this, cx| {
                            this.pane_hover(ev.position, cx);
                            this.pane_move(ev.position, ev.pressed_button == Some(MouseButton::Left), cx);
                        });
                    }
                });
                let t = this.clone();
                window.on_mouse_event(move |ev: &MouseUpEvent, phase, window, cx| {
                    if phase == DispatchPhase::Capture && ev.button == MouseButton::Left
                        && t.update(cx, |this, cx| this.pane_release(ev.position, window, cx)).unwrap_or(false)
                    { cx.stop_propagation(); }
                });
            },
        ).absolute().size_full()).into_any_element()
    }
}

impl AppWindow {
    /// Where a drop in the parking row goes: a bar between chips, or the
    /// whole zone when nothing is parked yet.
    fn park_preview(&self) -> Option<AnyElement> {
        let d = self.pane_drag.as_ref()?;
        let Some(Drop::Park(i)) = d.target else { return None };
        let tab = self.model.tab(&d.tab)?;
        let zone = self.park_zone(tab)?;
        let chips = self.chip_bounds(tab, &d.pane);
        if chips.is_empty() && tab.parked.iter().all(|p| p.pane.id == d.pane) {
            return Some(div().absolute().left(zone.origin.x).top(zone.origin.y).w(zone.size.width).h(zone.size.height)
                .bg(c("accent").opacity(0.18)).border_2().border_color(c("accent"))
                .flex().items_center().justify_center().text_size(settings::z(12.)).text_color(c("foreground"))
                .child("Park here").into_any_element());
        }
        let x = match chips.get(i) {
            Some(b) => b.origin.x - px(4.),
            None => chips.last().map_or(zone.origin.x + px(6.), |b| b.origin.x + b.size.width + px(2.)),
        };
        Some(div().absolute().left(x).top(zone.origin.y + px(4.)).w(px(2.)).h(zone.size.height - px(8.))
            .bg(c("accent")).into_any_element())
    }
}

#[cfg(test)]
mod tests {
    use super::{STRIP, drop_zone, inherited_movable, top_strip};
    use crate::layout::{Axis, Content, Edge, Node};
    use gpui::{Bounds, point, px, size};
    #[test]
    fn zones_are_relative_to_the_pane_and_outside_cancels() {
        let b = Bounds::new(point(px(100.), px(200.)), size(px(800.), px(400.)));
        for (x, y, expected) in [(500., 400., Some(None)), (110., 400., Some(Some(Edge::Left))),
            (890., 400., Some(Some(Edge::Right))), (500., 210., Some(Some(Edge::Top))),
            (500., 590., Some(Some(Edge::Bottom))), (99., 400., None)] {
            assert_eq!(drop_zone(b, point(px(x), px(y))), expected);
        }
    }
    #[test]
    fn hover_strip_is_only_the_panes_top_edge() {
        let b = Bounds::new(point(px(100.), px(200.)), size(px(800.), px(400.)));
        assert!(top_strip(b, STRIP, point(px(110.), px(201.))));
        assert!(!top_strip(b, STRIP, point(px(110.), px(250.))));
        assert!(!top_strip(b, STRIP, point(px(99.), px(201.))));
        assert!(!top_strip(b, STRIP, point(px(500.), px(199.))));
        // A 40px top header is the whole row.
        assert!(top_strip(b, 40., point(px(110.), px(235.))));
        assert!(!top_strip(b, 40., point(px(110.), px(245.))));
    }
    #[test]
    fn movable_uses_the_nearest_explicit_ancestor() {
        let mut root = Node::container("root", Axis::Row, vec![Node::container("inner", Axis::Column,
            vec![Node::block("pane", Content::Terminal { terminal: "t1".into() })])]);
        assert_eq!(inherited_movable(&root, "pane"), None);
        root.movable = Some(false);
        assert_eq!(inherited_movable(&root, "pane"), Some(false));
        root.find_mut("inner").unwrap().movable = Some(true);
        assert_eq!(inherited_movable(&root, "pane"), Some(true));
    }
}
