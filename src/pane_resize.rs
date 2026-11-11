//! `pane.resize`: move a pane's divider one step from the keyboard.
//!
//! The arrow moves a divider on its axis (left / right: a side-by-side split,
//! up / down: a stacked one) in its direction, as tmux and vim do: with a
//! neighbour on the arrow's side the pane grows that way; at the tab's edge
//! on that side its other divider moves instead, so it shrinks. The nearest
//! split around the pane that can move that way is the one that moves.
//! Sizes are stored as a drag stores them (`split`), with the drag's minimum.

use crate::layout::{Axis, Node, Size};

/// One press: this share of the tab's width (left / right) or height
/// (up / down). Ten presses take a divider across half the tab.
pub const STEP: f32 = 0.05;

/// What a drag leaves on each side of a divider, in designed (unzoomed) px.
pub const MIN: f32 = 24.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Direction {
    Left,
    Right,
    Up,
    Down,
}

impl Direction {
    pub fn parse(s: Option<&str>) -> Result<Direction, String> {
        match s {
            Some("left") => Ok(Direction::Left),
            Some("right") => Ok(Direction::Right),
            Some("up") => Ok(Direction::Up),
            Some("down") => Ok(Direction::Down),
            other => Err(format!("pane.resize direction is \"left\", \"right\", \"up\" or \"down\", not {}", other.map_or("nothing".into(), |o| format!("{o:?}")))),
        }
    }

    /// Left / right move a side-by-side split (a row), up / down a stacked one.
    pub fn axis(self) -> Axis {
        match self {
            Direction::Left | Direction::Right => Axis::Row,
            Direction::Up | Direction::Down => Axis::Column,
        }
    }

    /// Toward the later sibling (right, down).
    fn forward(self) -> bool {
        matches!(self, Direction::Right | Direction::Down)
    }
}

/// A divider: between the shown children `index` and `index + 1` of `container`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Divider {
    pub container: String,
    pub index: usize,
}

impl Node {
    /// The divider an arrow moves for node `id`: the nearest one on the
    /// arrow's side (the pane grows); none on that side up to the tab's edge,
    /// the nearest one on the other side (it shrinks). `None`: the pane is in
    /// no split on that axis (or isn't here).
    pub fn resize_divider(&self, id: &str, dir: Direction) -> Option<Divider> {
        let path = self.path_to(id)?;
        // Each split on the arrow's axis around `id`, nearest first:
        // (container, where `id`'s branch sits among its shown children, how many).
        let levels: Vec<(&str, usize, usize)> = path.windows(2).rev().filter_map(|w| {
            let n = self.find(&w[0])?;
            if n.axis() != Some(dir.axis()) || !n.resizable() {
                return None;
            }
            let shown: Vec<&Node> = n.children().iter().filter(|c| !c.hidden).collect();
            let i = shown.iter().position(|c| c.id == w[1])?;
            Some((n.id.as_str(), i, shown.len()))
        }).collect();
        let ahead = |&&(_, i, n): &&(&str, usize, usize)| if dir.forward() { i + 1 < n } else { i > 0 };
        if let Some(&(c, i, _)) = levels.iter().find(ahead) {
            return Some(Divider { container: c.to_owned(), index: if dir.forward() { i } else { i - 1 } });
        }
        // At the tab's edge on the arrow's side: the divider behind moves.
        let behind = |&&(_, i, n): &&(&str, usize, usize)| if dir.forward() { i > 0 } else { i + 1 < n };
        let &(c, i, _) = levels.iter().find(behind)?;
        Some(Divider { container: c.to_owned(), index: if dir.forward() { i - 1 } else { i } })
    }
}

/// Where `a`'s far edge sits for `a` and `b` (the two sides of a divider)
/// sharing `total` designed px, clamped as a drag clamps it: each side keeps
/// MIN, `a` its own min / max. `None` when they can't both keep MIN.
pub fn clamp(a: &Node, total: f32, new_a: f32) -> Option<f32> {
    // Squeezed and zero-size siblings cannot both keep the minimum.
    if total <= 2.0 * MIN {
        return None;
    }
    let mut new_a = new_a.clamp(MIN, total - MIN);
    if let Some(min) = a.min {
        new_a = new_a.max(min);
    }
    if let Some(max) = a.max {
        new_a = new_a.min(max);
    }
    Some(new_a.min(total - MIN))
}

/// The sizes a drag stores for `a` taking `new_a` of the `total` it shares
/// with `b`: a px side keeps px (the other follows the flex), else both
/// weights split their sum.
pub fn sizes(a: &Node, b: &Node, total: f32, new_a: f32) -> Vec<(String, Size)> {
    match (a.size, b.size) {
        (Some(Size::Px { .. }), _) => vec![(a.id.clone(), Size::Px { px: new_a.round() })],
        (_, Some(Size::Px { .. })) => vec![(b.id.clone(), Size::Px { px: (total - new_a).round() })],
        (sa, sb) => {
            let sum = weight(sa) + weight(sb);
            vec![
                (a.id.clone(), Size::Weight { weight: sum * new_a / total }),
                (b.id.clone(), Size::Weight { weight: sum * (total - new_a) / total }),
            ]
        }
    }
}

/// Where the divider between `a` and `b` sits now, by their stored sizes:
/// `a`'s share of their `total` designed px.
pub fn position(a: &Node, b: &Node, total: f32) -> f32 {
    match (a.size, b.size) {
        (Some(Size::Px { px }), _) => px,
        (_, Some(Size::Px { px })) => total - px,
        (sa, sb) => {
            let (wa, wb) = (weight(sa), weight(sb));
            if wa + wb > 0.0 { total * wa / (wa + wb) } else { total / 2.0 }
        }
    }
}

fn weight(size: Option<Size>) -> f32 {
    match size {
        Some(Size::Weight { weight }) => weight,
        _ => 1.0,
    }
}

/// `pane.resize` on a tab's tree: moves the divider the arrow picks for
/// `pane` by `step` (a share of the tab, `root`) toward `dir`. `length(id)`
/// is a node's designed length on the arrow's axis as last drawn.
/// Ok(false): nothing moved (no split on that axis, already at the minimum).
pub fn resize(root: &mut Node, pane: &str, dir: Direction, step: f32, length: impl Fn(&str) -> Option<f32>) -> Result<bool, String> {
    let Some(d) = root.resize_divider(pane, dir) else { return Ok(false) };
    let Some(container) = root.find(&d.container) else { return Ok(false) };
    let shown: Vec<&Node> = container.children().iter().filter(|c| !c.hidden).collect();
    let (Some(a), Some(b)) = (shown.get(d.index), shown.get(d.index + 1)) else { return Ok(false) };
    let (Some(la), Some(lb), Some(tab)) = (length(&a.id), length(&b.id), length(&root.id)) else {
        return Err("pane.resize: the tab isn't drawn yet (show it first)".into());
    };
    let total = la + lb;
    let now = position(a, b, total);
    let by = if dir.forward() { step * tab } else { -step * tab };
    let Some(to) = clamp(a, total, now + by) else { return Ok(false) };
    // At the minimum (or a's min / max) already: stays as it is.
    if (to - now).abs() < 0.5 || (to - now).signum() != by.signum() {
        return Ok(false);
    }
    for (id, size) in sizes(a, b, total, to) {
        if let Some(n) = root.find_mut(&id) {
            n.size = Some(size);
        }
    }
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::layout::Content;
    use std::collections::HashMap;

    fn term(id: &str) -> Node {
        Node::block(id, Content::Terminal { terminal: format!("t-{id}") })
    }

    fn sized(mut n: Node, size: Size) -> Node {
        n.size = Some(size);
        n
    }

    fn div(container: &str, index: usize) -> Option<Divider> {
        Some(Divider { container: container.into(), index })
    }

    /// row [a, b, c]
    fn three() -> Node {
        Node::container("tab", Axis::Row, vec![term("a"), term("b"), term("c")])
    }

    /// row [ a, column [ b, row [c, d] ] ]
    fn nested() -> Node {
        let inner = Node::container("cd", Axis::Row, vec![term("c"), term("d")]);
        let col = Node::container("right", Axis::Column, vec![term("b"), inner]);
        Node::container("tab", Axis::Row, vec![term("a"), col])
    }

    #[test]
    fn directions_parse() {
        assert_eq!(Direction::parse(Some("left")), Ok(Direction::Left));
        assert_eq!(Direction::parse(Some("down")).map(Direction::axis), Ok(Axis::Column));
        assert!(Direction::parse(Some("north")).unwrap_err().contains("\"north\""));
        assert!(Direction::parse(None).is_err());
    }

    #[test]
    fn a_neighbour_on_the_arrows_side_grows_the_pane_that_way() {
        let n = three();
        assert_eq!(n.resize_divider("b", Direction::Right), div("tab", 1));
        assert_eq!(n.resize_divider("b", Direction::Left), div("tab", 0));
        assert_eq!(n.resize_divider("a", Direction::Right), div("tab", 0));
        assert_eq!(n.resize_divider("c", Direction::Left), div("tab", 1));
    }

    #[test]
    fn at_the_tabs_edge_the_other_divider_moves() {
        let n = three();
        // c is at the right edge: right moves its left divider right (it shrinks).
        assert_eq!(n.resize_divider("c", Direction::Right), div("tab", 1));
        assert_eq!(n.resize_divider("a", Direction::Left), div("tab", 0));
    }

    #[test]
    fn no_split_on_the_axis_is_none() {
        let n = three();
        assert_eq!(n.resize_divider("a", Direction::Up), None);
        assert_eq!(n.resize_divider("zz", Direction::Left), None);
        let one = Node::container("tab", Axis::Row, vec![term("a")]);
        assert_eq!(one.resize_divider("a", Direction::Left), None);
        assert_eq!(one.resize_divider("a", Direction::Right), None);
    }

    #[test]
    fn nested_splits_take_the_nearest_one_that_can_move_that_way() {
        let n = nested();
        // c: left is its own row's divider (c|d); right too (c is first there).
        assert_eq!(n.resize_divider("c", Direction::Right), div("cd", 0));
        assert_eq!(n.resize_divider("c", Direction::Left), div("tab", 0));
        // d is last in cd and at the tab's right edge: left grows it, right shrinks it, both at c|d.
        assert_eq!(n.resize_divider("d", Direction::Left), div("cd", 0));
        assert_eq!(n.resize_divider("d", Direction::Right), div("cd", 0));
        // Up / down: the column between b and the cd row.
        assert_eq!(n.resize_divider("c", Direction::Up), div("right", 0));
        assert_eq!(n.resize_divider("b", Direction::Down), div("right", 0));
        // b at the top edge: up moves its lower divider up.
        assert_eq!(n.resize_divider("b", Direction::Up), div("right", 0));
        // a: no stacked split around it.
        assert_eq!(n.resize_divider("a", Direction::Down), None);
        // b right: no neighbour right of the column, so the a|column divider moves right.
        assert_eq!(n.resize_divider("b", Direction::Right), div("tab", 0));
    }

    #[test]
    fn hidden_siblings_dont_count() {
        let mut n = three();
        n.find_mut("c").unwrap().hidden = true;
        assert_eq!(n.resize_divider("b", Direction::Right), div("tab", 0));
    }

    /// Lengths as a 1000 px wide row of even panes would draw them.
    fn lengths(n: &Node, total: f32) -> HashMap<String, f32> {
        let w: Vec<f32> = n.children().iter().map(|c| weight(c.size)).collect();
        let sum: f32 = w.iter().sum();
        let mut out: HashMap<String, f32> = n.children().iter().zip(&w).map(|(c, w)| (c.id.clone(), total * w / sum)).collect();
        out.insert(n.id.clone(), total);
        out
    }

    fn share(n: &Node, id: &str) -> f32 {
        let sum: f32 = n.children().iter().map(|c| weight(c.size)).sum();
        weight(n.find(id).unwrap().size) / sum
    }

    #[test]
    fn a_step_moves_a_divider_by_a_twentieth_of_the_tab() {
        let mut n = Node::container("tab", Axis::Row, vec![term("a"), term("b")]);
        let len = lengths(&n, 1000.0);
        assert_eq!(resize(&mut n, "a", Direction::Right, STEP, |id| len.get(id).copied()), Ok(true));
        assert!((share(&n, "a") - 0.55).abs() < 1e-4);
        // Weights keep their sum, as a drag keeps it.
        assert!((weight(n.find("a").unwrap().size) + weight(n.find("b").unwrap().size) - 2.0).abs() < 1e-4);
        // At the edge: b right shrinks b (the divider goes right again).
        assert_eq!(resize(&mut n, "b", Direction::Right, STEP, |id| len.get(id).copied()), Ok(true));
        assert!((share(&n, "a") - 0.60).abs() < 1e-4);
        // Ten presses from even cross half the tab: left from 0.6 to the minimum.
        for _ in 0..10 {
            resize(&mut n, "a", Direction::Left, STEP, |id| len.get(id).copied()).unwrap();
        }
        assert!((share(&n, "a") - 0.10).abs() < 1e-4);
    }

    #[test]
    fn panes_keep_the_drag_minimum() {
        let mut n = Node::container("tab", Axis::Row, vec![term("a"), term("b")]);
        let len = lengths(&n, 400.0);
        let at = |id: &str| len.get(id).copied();
        let mut moved = 0;
        while resize(&mut n, "a", Direction::Left, STEP, at).unwrap() {
            moved += 1;
            assert!(moved < 50);
        }
        // 200 → 24 in 20 px steps: nine presses, the last one short.
        assert_eq!(moved, 9);
        assert!((share(&n, "a") * 400.0 - MIN).abs() < 0.01);
        // At the minimum: nothing changes.
        assert_eq!(resize(&mut n, "a", Direction::Left, STEP, at), Ok(false));
        // A pane's own min holds too.
        n.find_mut("a").unwrap().min = Some(100.0);
        assert_eq!(resize(&mut n, "a", Direction::Left, STEP, at), Ok(false));
        assert_eq!(resize(&mut n, "a", Direction::Right, STEP, at), Ok(true));
        assert!((share(&n, "a") * 400.0 - 100.0).abs() < 0.01);
        // Too narrow for two minimums: left alone.
        let mut tight = Node::container("tab", Axis::Row, vec![term("a"), term("b")]);
        let small = lengths(&tight, 40.0);
        assert_eq!(resize(&mut tight, "a", Direction::Right, STEP, |id| small.get(id).copied()), Ok(false));
    }

    #[test]
    fn a_px_side_stays_px() {
        let mut n = Node::container("tab", Axis::Row, vec![sized(term("a"), Size::Px { px: 300.0 }), term("b")]);
        let len: HashMap<String, f32> = [("a", 300.0), ("b", 700.0), ("tab", 1000.0)].into_iter().map(|(k, v)| (k.to_owned(), v)).collect();
        assert_eq!(resize(&mut n, "b", Direction::Left, STEP, |id| len.get(id).copied()), Ok(true));
        assert_eq!(n.find("a").unwrap().size, Some(Size::Px { px: 250.0 }));
        assert_eq!(n.find("b").unwrap().size, None);
    }

    #[test]
    fn nested_steps_are_a_share_of_the_whole_tab() {
        let mut n = nested();
        // Tab 1000 wide, 800 tall: a 500, right 500 (b 400 tall over cd 400; c, d 250 wide).
        let len: HashMap<String, f32> = [("tab", 1000.0), ("a", 500.0), ("right", 500.0), ("c", 250.0), ("d", 250.0), ("cd", 500.0), ("b", 400.0)]
            .into_iter().map(|(k, v)| (k.to_owned(), v)).collect();
        assert_eq!(resize(&mut n, "c", Direction::Right, STEP, |id| len.get(id).copied()), Ok(true));
        // c|d moved 50 px (5% of the tab's 1000), not 5% of their 500.
        let cd = n.find("cd").unwrap();
        assert!((share(cd, "c") * 500.0 - 300.0).abs() < 0.01);
        assert_eq!(n.find("a").unwrap().size, None);
        // Up / down use the tab's height.
        let tall: HashMap<String, f32> = [("tab", 800.0), ("b", 400.0), ("cd", 400.0)].into_iter().map(|(k, v)| (k.to_owned(), v)).collect();
        assert_eq!(resize(&mut n, "c", Direction::Up, STEP, |id| tall.get(id).copied()), Ok(true));
        let right = n.find("right").unwrap();
        assert!((share(right, "b") * 800.0 - 360.0).abs() < 0.01);
    }

    #[test]
    fn an_undrawn_tab_says_so() {
        let mut n = three();
        assert!(resize(&mut n, "a", Direction::Right, STEP, |_| None).unwrap_err().contains("drawn"));
        // Nothing to move needs no drawing.
        assert_eq!(resize(&mut n, "a", Direction::Up, STEP, |_| None), Ok(false));
    }
}
