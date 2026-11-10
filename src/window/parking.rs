//! The parking row: panes parked in a tab's bottom row (`pane.park`), drawn
//! as chips under the tab. A click on a chip puts its pane back; a drag moves
//! it along the row or drops it into the tab (pane_drag.rs). A pane dragged by
//! its grip onto the row's place parks there.
use super::*;

/// The row's height, unzoomed. Terminals in a tab with parked panes are this much shorter.
pub(super) const PARK_ROW: f32 = 28.;
const CHIP: f32 = 20.;
const ROW: &str = "\u{0}parking-row";

fn chip_id(pane: &str) -> String {
    format!("\u{0}park:{pane}")
}

/// Where a drop at `x` lands among the row's chips (left to right, the dragged one left out).
pub(super) fn insert_index(chips: &[Bounds<Pixels>], x: Pixels) -> usize {
    chips.iter().filter(|b| b.center().x < x).count()
}

/// The bottom `PARK_ROW` of a tab's area: where a pane dragged there parks.
fn bottom_slice(mut area: Bounds<Pixels>, row: Pixels) -> Bounds<Pixels> {
    let row = row.min(area.size.height);
    area.origin.y += area.size.height - row;
    area.size.height = row;
    area
}

impl AppWindow {
    /// What a chip says: the terminal's title, else its program, else the mod's name.
    pub(super) fn parked_title(&self, n: &Node) -> String {
        match n.content() {
            Some(Content::Terminal { terminal }) => {
                let live = self.live.get(terminal);
                let text = |k: &str| live.and_then(|r| r.get(k)).and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty()).map(str::to_owned);
                text("title")
                    .or_else(|| text("name"))
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
            bounds.get(&tab.root.id).map(|b| bottom_slice(*b, settings::z(PARK_ROW)))
        } else {
            bounds.get(ROW).copied()
        }
    }

    /// The row's chips' bounds, left to right, without `except`.
    pub(super) fn chip_bounds(&self, tab: &Tab, except: &str) -> Vec<Bounds<Pixels>> {
        let bounds = self.bounds.borrow();
        tab.parked.iter().filter(|p| p.pane.id != except).filter_map(|p| bounds.get(&chip_id(&p.pane.id)).copied()).collect()
    }

    /// A pane's chip, also drawn under the pointer while it's dragged.
    pub(super) fn chip(&self, n: &Node, dragging: bool) -> Div {
        let status = n.terminal().and_then(|t| self.model.status(t));
        let dot = div().flex_none().size(settings::z(6.)).rounded_full().bg(match status {
            Some(s) => c(s),
            None => c("dim"),
        });
        div()
            .flex()
            .flex_none()
            .items_center()
            .gap(settings::z(6.))
            .h(settings::z(CHIP))
            .max_w(settings::z(220.))
            .px(settings::z(8.))
            .rounded(settings::z(5.))
            .border_1()
            .border_color(if dragging { c("accent") } else { c("border") })
            .bg(c("raised"))
            .text_color(c("foreground"))
            .text_size(settings::z(12.))
            .child(dot)
            .child(div().min_w_0().overflow_hidden().whitespace_nowrap().text_ellipsis().child(self.parked_title(n)))
    }

    /// The bottom row of a tab with parked panes.
    pub(super) fn parking_row(&self, tab: &Tab, cx: &mut Context<Self>) -> AnyElement {
        let bounds = self.bounds.clone();
        let dragged = self.pane_drag.as_ref().filter(|d| d.moving()).map(|d| d.pane().to_owned());
        let chips = tab.parked.iter().map(|p| {
            let pane = p.pane.id.clone();
            let id = chip_id(&pane);
            let (b, key) = (bounds.clone(), id.clone());
            let lifted = dragged.as_deref() == Some(pane.as_str());
            self.chip(&p.pane, false)
                .id(SharedString::from(id))
                .relative()
                .when(lifted, |d| d.opacity(0.35))
                .hover(|s| s.bg(c("hover")))
                .cursor(CursorStyle::PointingHand)
                .child(canvas(move |bb, _, _| { b.borrow_mut().insert(key, bb); }, |_, _, _, _| {}).absolute().size_full())
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
            .h(settings::z(PARK_ROW))
            .w_full()
            .flex()
            .items_center()
            .gap(settings::z(6.))
            .px(settings::z(6.))
            .overflow_x_scroll()
            .border_t_1()
            .border_color(c("border"))
            .child(canvas(move |bb, _, _| { b.borrow_mut().insert(ROW.to_owned(), bb); }, |_, _, _, _| {}).absolute().size_full())
            .children(chips)
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
    use super::{bottom_slice, insert_index};
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
    fn the_park_zone_is_the_bottom_of_the_tab() {
        let area = Bounds::new(point(px(10.), px(20.)), size(px(300.), px(200.)));
        assert_eq!(bottom_slice(area, px(28.)), Bounds::new(point(px(10.), px(192.)), size(px(300.), px(28.))));
        assert_eq!(bottom_slice(area, px(500.)), area);
    }
}
