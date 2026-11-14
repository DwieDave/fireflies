//! The parking row: panes parked in a tab's bottom row (`pane.park`), drawn
//! as chips under the tab. A click on a chip puts its pane back; a drag moves
//! it along the row or drops it into the tab (pane_drag.rs). A pane dragged by
//! its grip onto the row's place parks there.
//!
//! The row takes its measures from the tab's pane frame, so it lines up with
//! the panes above it: chips sit one pane gap below them and apart, start at
//! the panes' left edge, and wear the frame's background, border and radius.
//! The frame's `parked` look can set their size and a mod to draw in each.
use super::*;
use crate::layout::{HeaderContent, ParkedLook};

const ROW: &str = "\u{0}parking-row";
/// The gap above and between chips when the frame sets none.
const DEFAULT_GAP: f32 = 4.;
/// A chip's height when neither the parked look nor a header sets one.
const DEFAULT_HEIGHT: f32 = 24.;
/// A mod chip's width when the parked look sets none.
const MOD_WIDTH: f32 = 180.;

fn chip_id(pane: &str) -> String {
    format!("\u{0}park:{pane}")
}

/// The mod a chip slot shows (`<pane>#park`).
pub(super) fn chip_slot(pane: &str) -> String {
    format!("{pane}#park")
}

/// The gap above and between chips, and a chip's height, unzoomed.
pub(super) fn metrics(frame: Option<&PaneFrame>) -> (f32, f32) {
    let gap = frame.and_then(|f| f.gap).unwrap_or(DEFAULT_GAP);
    let height = frame.and_then(|f| f.parked.as_ref()?.height)
        .or_else(|| frame.and_then(|f| f.header.as_ref()).map(pane_size::header_height))
        .unwrap_or(DEFAULT_HEIGHT);
    (gap, height)
}

/// The row's whole height, unzoomed: what the panes above give up.
pub(super) fn row_height(frame: Option<&PaneFrame>) -> f32 {
    let (gap, height) = metrics(frame);
    gap + height
}

/// The mod drawing each chip, if the frame's parked look names one.
fn chip_mod(look: Option<&ParkedLook>) -> Option<(&str, &Value)> {
    match look?.content.as_ref()? {
        HeaderContent::Mod { name, props } => Some((name, props)),
        HeaderContent::Builtin(_) => None,
    }
}

/// Where a drop at `x` lands among the row's chips (left to right, the dragged one left out).
pub(super) fn insert_index(chips: &[Bounds<Pixels>], x: Pixels) -> usize {
    chips.iter().filter(|b| b.center().x < x).count()
}

/// The bottom `row` of a tab's area: where a pane dragged there parks.
fn bottom_slice(mut area: Bounds<Pixels>, row: Pixels) -> Bounds<Pixels> {
    let row = row.min(area.size.height);
    area.origin.y += area.size.height - row;
    area.size.height = row;
    area
}

impl AppWindow {
    /// The shown tab block's pane frame, whether or not its panes are framed now.
    pub(super) fn tab_frame(&self) -> Option<&PaneFrame> {
        self.chrome.visible_blocks().into_iter().find_map(|n| match n.content() {
            Some(Content::Context { pane, .. }) => pane.as_ref(),
            _ => None,
        })
    }

    /// The chip mods of the shown tab's parked panes: (slot, instance).
    pub(super) fn chip_mods(&self) -> Vec<(String, Instance)> {
        let Some((name, props)) = chip_mod(self.tab_frame().and_then(|f| f.parked.as_ref())) else { return vec![] };
        let Some(tab) = self.model.active_tab() else { return vec![] };
        tab.parked.iter().map(|p| {
            let mut props = if props.is_object() { props.clone() } else { json!({}) };
            props["pane"] = json!(p.pane.id);
            props["terminal"] = json!(p.pane.terminal());
            (chip_slot(&p.pane.id), Instance { name: name.to_owned(), props })
        }).collect()
    }

    /// What a chip says: the terminal's name, its agent's, its title or its
    /// program's; a mod pane's title, else its mod.
    pub(super) fn parked_title(&self, n: &Node) -> String {
        match n.content() {
            Some(Content::Terminal { terminal }) => {
                let live = self.live.get(terminal);
                let text = |k: &str| live.and_then(|r| r.get(k)).and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty()).map(str::to_owned);
                text("name")
                    .or_else(|| self.model.agents.get(terminal).and_then(|a| a.app.as_deref()).map(crate::programs::name))
                    .or_else(|| text("title"))
                    .or_else(|| self.program(terminal).get("name").and_then(Value::as_str).map(str::to_owned))
                    .unwrap_or_else(|| terminal.clone())
            }
            Some(Content::Mod { name, .. }) => n.title.clone().unwrap_or_else(|| name.clone()),
            _ => n.id.clone(),
        }
    }

    /// The shown tab's parking zone: its row, or (none parked yet) the bottom of the tab.
    pub(super) fn park_zone(&self, tab: &Tab) -> Option<Bounds<Pixels>> {
        let bounds = self.bounds.borrow();
        if tab.parked.is_empty() {
            bounds.get(&tab.root.id).map(|b| bottom_slice(*b, settings::z(row_height(self.tab_frame()))))
        } else {
            bounds.get(ROW).copied()
        }
    }

    /// The row's chips' bounds, left to right, without `except`.
    pub(super) fn chip_bounds(&self, tab: &Tab, except: &str) -> Vec<Bounds<Pixels>> {
        let bounds = self.bounds.borrow();
        tab.parked.iter().filter(|p| p.pane.id != except).filter_map(|p| bounds.get(&chip_id(&p.pane.id)).copied()).collect()
    }

    /// A chip's box: a small pane frame (its background, border, radius, shadow).
    /// In the row it stretches to the row's height under the gap, so its bottom
    /// lands on the very pixel the panes' would (a height of its own rounds apart).
    fn chip_box(&self, lit: bool) -> Div {
        let frame = self.tab_frame();
        let mut el = div().flex().flex_none().items_center().overflow_hidden();
        match frame.and_then(|f| f.background.as_ref()) {
            Some(bg) => el = paint(el, bg),
            None => el = el.bg(c("background")),
        }
        let line = frame.and_then(|f| if lit { f.focus.as_ref().or(f.border.as_ref()) } else { f.border.as_ref() });
        el = match line {
            Some(l) => el.border(settings::z(l.width)).border_color(c(&l.color)),
            None => el.border(settings::z(1.)).border_color(if lit { c("accent") } else { c("border") }),
        };
        if let Some(r) = frame.and_then(|f| f.radius) {
            el = el.rounded(settings::z(r));
        }
        shadow(el, frame.and_then(|f| f.shadow.as_deref()))
    }

    /// The app's own chip content: a status dot and the pane's name.
    fn chip_label(&self, n: &Node) -> Div {
        let status = n.terminal().and_then(|t| self.model.status(t)).filter(|s| *s != "idle");
        let width = self.tab_frame().and_then(|f| f.parked.as_ref()?.width);
        div().flex().items_center().size_full().min_w_0().gap(settings::z(6.)).px(settings::z(8.))
            .when(width.is_none(), |d| d.max_w(settings::z(240.)))
            .text_size(settings::z(12.))
            .text_color(c("foreground"))
            .children(status.map(|s| div().flex_none().size(settings::z(6.)).bg(c(s))))
            .child(div().min_w_0().overflow_hidden().whitespace_nowrap().text_ellipsis().child(self.parked_title(n)))
    }

    /// A pane's chip as the app draws it (also under the pointer while dragged).
    pub(super) fn chip(&self, n: &Node, lit: bool) -> Div {
        let width = self.tab_frame().and_then(|f| f.parked.as_ref()?.width);
        let (_, height) = metrics(self.tab_frame());
        self.chip_box(lit).h(settings::z(height)).when_some(width, |d, w| d.w(settings::z(w))).child(self.chip_label(n))
    }

    /// The bottom row of a tab with parked panes: one pane gap below the
    /// panes, chips a gap apart from the panes' left edge.
    pub(super) fn parking_row(&self, tab: &Tab, cx: &mut Context<Self>) -> AnyElement {
        let frame = self.tab_frame();
        let (gap, height) = metrics(frame);
        let look = frame.and_then(|f| f.parked.as_ref());
        let drawn = chip_mod(look).is_some();
        let width = look.and_then(|l| l.width).or(drawn.then_some(MOD_WIDTH));
        let bounds = self.bounds.clone();
        let dragged = self.pane_drag.as_ref().filter(|d| d.moving()).map(|d| d.pane().to_owned());
        // Chips made parked (`pane.split {park: true}`): their mods drawn out of
        // sight, at the tab's size, so they run and their native views load
        // (hidden: nothing of them is visible), as a pane's would.
        let room = bounds.borrow().get(&tab.root.id).map(|b| b.size).unwrap_or_else(|| size(px(400.), px(300.)));
        let unseen: Vec<AnyElement> = tab.parked.iter().filter(|p| self.mod_chips.contains(&p.pane.id) && self.copies.contains_key(&p.pane.id)).map(|p| {
            div().absolute().top_0().left_0().size_0().overflow_hidden()
                .child(div().w(room.width).h(room.height).child(self.render_slot(&p.pane.id, cx)))
                .into_any_element()
        }).collect();
        let chips = tab.parked.iter().map(|p| {
            let pane = p.pane.id.clone();
            let id = chip_id(&pane);
            let (b, key) = (bounds.clone(), id.clone());
            let lifted = dragged.as_deref() == Some(pane.as_str());
            let lit = self.chip_hover.as_deref() == Some(pane.as_str());
            let inner = if drawn { self.render_slot(&chip_slot(&pane), cx) } else { self.chip_label(&p.pane).into_any_element() };
            let hp = pane.clone();
            self.chip_box(lit)
                .id(SharedString::from(id))
                .relative()
                .when_some(width, |d, w| d.w(settings::z(w)))
                .when(lifted, |d| d.opacity(0.35))
                .cursor(CursorStyle::PointingHand)
                .child(canvas(move |bb, _, _| { b.borrow_mut().insert(key, bb); }, |_, _, _, _| {}).absolute().size_full())
                .child(inner)
                .on_hover(cx.listener(move |this, on: &bool, _, cx| {
                    let now = if *on { Some(hp.clone()) } else { this.chip_hover.clone().filter(|x| *x != hp) };
                    if this.chip_hover != now { this.chip_hover = now; cx.notify(); }
                }))
                .on_mouse_down(MouseButton::Left, cx.listener(move |this, ev: &MouseDownEvent, _, cx| {
                    this.park_press(&pane, ev.position, cx);
                    cx.stop_propagation();
                }))
        });
        let b = bounds.clone();
        div()
            .id(SharedString::from(ROW))
            .relative()
            .flex_none()
            .h(settings::z(gap + height))
            .pt(settings::z(gap))
            .w_full()
            .flex()
            .items_stretch()
            .gap(settings::z(gap))
            .overflow_x_scroll()
            .child(canvas(move |bb, _, _| { b.borrow_mut().insert(ROW.to_owned(), bb); }, |_, _, _, _| {}).absolute().size_full())
            .children(chips)
            .children(unseen)
            .into_any_element()
    }

    /// The tab and, when it has parked panes, its parking row under it.
    pub(super) fn with_parking_row(&self, tab: &Tab, body: AnyElement, cx: &mut Context<Self>) -> AnyElement {
        if tab.parked.is_empty() {
            return body;
        }
        div()
            .size_full()
            .flex()
            .flex_col()
            .child(div().flex_1().min_h_0().flex().child(body))
            .child(self.parking_row(tab, cx))
            .into_any_element()
    }
}

#[cfg(test)]
mod tests {
    use super::{bottom_slice, insert_index, metrics, row_height};
    use crate::layout::PaneFrame;
    use gpui::{Bounds, point, px, size};

    #[test]
    fn drops_land_between_the_chips_they_pass() {
        let chip = |x: f32| Bounds::new(point(px(x), px(0.)), size(px(40.), px(20.)));
        let chips = [chip(0.), chip(50.), chip(100.)];
        for (x, at) in [(-5., 0), (10., 0), (30., 1), (65., 1), (75., 2), (130., 3), (500., 3)] {
            assert_eq!(insert_index(&chips, px(x)), at, "x {x}");
        }
        assert_eq!(insert_index(&[], px(10.)), 0);
    }

    #[test]
    fn the_row_takes_the_frames_gap_and_header_height() {
        assert_eq!(metrics(None), (4., 24.));
        let nocturne: PaneFrame = serde_json::from_value(serde_json::json!({
            "gap": 8, "header": { "content": { "mod": "nocturne" }, "height": 24 }
        })).unwrap();
        assert_eq!(metrics(Some(&nocturne)), (8., 24.));
        assert_eq!(row_height(Some(&nocturne)), 32.);
        let tall: PaneFrame = serde_json::from_value(serde_json::json!({ "gap": 6, "parked": { "height": 30, "width": 200 } })).unwrap();
        assert_eq!(metrics(Some(&tall)), (6., 30.));
    }

    #[test]
    fn the_park_zone_is_the_bottom_of_the_tab() {
        let area = Bounds::new(point(px(10.), px(20.)), size(px(300.), px(200.)));
        assert_eq!(bottom_slice(area, px(28.)), Bounds::new(point(px(10.), px(192.)), size(px(300.), px(28.))));
        assert_eq!(bottom_slice(area, px(500.)), area);
    }
}
