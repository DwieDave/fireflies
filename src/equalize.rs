//! `pane.equalize`: even out the shares of a tab's panes.
//!
//! Panes sit in a weighted row/column tree (`layout::Size::Weight`). Splits
//! halve a share and closes hand it to a neighbor, so a tab drifts uneven;
//! these give siblings equal weights again. Fixed `px` sizes stay as they are.

use crate::layout::{Axis, Kind, Node, Size};

/// What `pane.equalize` evens out.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Scope {
    /// Every row and column of the tab, at every level.
    All,
    /// The siblings in the pane's nearest row (side by side).
    Row,
    /// The siblings in the pane's nearest column (stacked).
    Column,
}

impl Scope {
    pub fn parse(s: Option<&str>) -> Result<Scope, String> {
        match s {
            None | Some("all") => Ok(Scope::All),
            Some("row") => Ok(Scope::Row),
            Some("column") => Ok(Scope::Column),
            Some(other) => Err(format!("pane.equalize scope is \"all\", \"row\" or \"column\", not {other:?}")),
        }
    }
}

impl Node {
    /// Equal weights for the flexible children of this row/column (one level).
    /// They keep their total, so `px` siblings and the parent see no change.
    /// Returns whether a weight changed.
    pub fn equalize_children(&mut self) -> bool {
        if !matches!(self.kind, Kind::Row { .. } | Kind::Column { .. }) {
            return false;
        }
        let c = self.children_mut().unwrap();
        let weights: Vec<f32> = c.iter().filter_map(|n| flexible(n.size)).collect();
        if weights.len() < 2 {
            return false;
        }
        let even = weights.iter().sum::<f32>() / weights.len() as f32;
        let even = if even.is_finite() && even > 0.0 { even } else { 1.0 };
        // Already even (to rounding): left as is, so a repeat changes nothing.
        if weights.iter().all(|w| (w - even).abs() <= even * 1e-4) {
            return false;
        }
        for n in c.iter_mut().filter(|n| flexible(n.size).is_some()) {
            n.size = Some(Size::Weight { weight: even });
        }
        true
    }

    /// `equalize_children` at every row/column in this tree.
    pub fn equalize_all(&mut self) -> bool {
        let mut changed = self.equalize_children();
        if let Some(c) = self.children_mut() {
            for n in c.iter_mut() {
                changed |= n.equalize_all();
            }
        }
        changed
    }

    /// Equalizes the children of `id`'s nearest ancestor running along
    /// `axis`. `None` when `id` isn't here or has no such ancestor.
    pub fn equalize_around(&mut self, id: &str, axis: Axis) -> Option<bool> {
        let path = self.path_to(id)?;
        let parent = path[..path.len() - 1].iter().rev().find(|p| self.find(p).and_then(Node::axis) == Some(axis))?.clone();
        Some(self.find_mut(&parent)?.equalize_children())
    }

    /// `pane.equalize` on a tab's tree, around node `id`.
    pub fn equalize(&mut self, id: &str, scope: Scope) -> Option<bool> {
        match scope {
            Scope::All => Some(self.equalize_all()),
            Scope::Row => self.equalize_around(id, Axis::Row),
            Scope::Column => self.equalize_around(id, Axis::Column),
        }
    }
}

/// A child's weight, `None` for a fixed `px` size.
fn flexible(size: Option<Size>) -> Option<f32> {
    match size {
        Some(Size::Weight { weight }) => Some(weight),
        None => Some(1.0),
        Some(Size::Px { .. }) => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::layout::Content;

    fn term(id: &str) -> Node {
        Node::block(id, Content::Terminal { terminal: format!("t-{id}") })
    }

    fn sized(mut n: Node, size: Size) -> Node {
        n.size = Some(size);
        n
    }

    fn w(n: &Node, id: &str) -> Option<Size> {
        n.find(id).unwrap().size
    }

    const fn wt(weight: f32) -> Option<Size> {
        Some(Size::Weight { weight })
    }

    /// tab: column [ row [a .5, b .25, c .25] .7, row [d .5, e .5] .3 ]
    fn uneven() -> Node {
        let top = Node::container("top", Axis::Row, vec![
            sized(term("a"), Size::Weight { weight: 0.5 }),
            sized(term("b"), Size::Weight { weight: 0.25 }),
            sized(term("c"), Size::Weight { weight: 0.25 }),
        ]);
        let bottom = Node::container("bottom", Axis::Row, vec![
            sized(term("d"), Size::Weight { weight: 0.5 }),
            sized(term("e"), Size::Weight { weight: 0.5 }),
        ]);
        Node::container("tab", Axis::Column, vec![sized(top, Size::Weight { weight: 0.7 }), sized(bottom, Size::Weight { weight: 0.3 })])
    }

    #[test]
    fn scopes_parse_with_all_as_the_default() {
        assert_eq!(Scope::parse(None), Ok(Scope::All));
        assert_eq!(Scope::parse(Some("row")), Ok(Scope::Row));
        assert_eq!(Scope::parse(Some("column")), Ok(Scope::Column));
        assert!(Scope::parse(Some("grid")).unwrap_err().contains("\"grid\""));
    }

    #[test]
    fn all_evens_every_level_and_keeps_each_total() {
        let mut n = uneven();
        assert_eq!(n.equalize("b", Scope::All), Some(true));
        for id in ["a", "b", "c"] {
            assert_eq!(w(&n, id), wt(1.0 / 3.0));
        }
        assert_eq!((w(&n, "d"), w(&n, "e")), (wt(0.5), wt(0.5)));
        assert_eq!((w(&n, "top"), w(&n, "bottom")), (wt(0.5), wt(0.5)));
        // Again: nothing left to change.
        assert_eq!(n.equalize("b", Scope::All), Some(false));
    }

    #[test]
    fn row_evens_only_the_panes_side_by_side() {
        let mut n = uneven();
        assert_eq!(n.equalize("b", Scope::Row), Some(true));
        assert_eq!(w(&n, "a"), wt(1.0 / 3.0));
        assert_eq!((w(&n, "top"), w(&n, "bottom")), (wt(0.7), wt(0.3)));
    }

    #[test]
    fn column_evens_the_nearest_column_above_the_pane() {
        let mut n = uneven();
        assert_eq!(n.equalize("e", Scope::Column), Some(true));
        assert_eq!((w(&n, "top"), w(&n, "bottom")), (wt(0.5), wt(0.5)));
        assert_eq!(w(&n, "a"), wt(0.5));
    }

    #[test]
    fn a_missing_axis_or_pane_is_none() {
        let mut n = Node::container("tab", Axis::Row, vec![term("a"), term("b")]);
        assert_eq!(n.equalize("a", Scope::Column), None);
        assert_eq!(n.equalize("zz", Scope::Row), None);
        // Unsized children count as weight 1: already even.
        assert_eq!(n.equalize("a", Scope::Row), Some(false));
    }

    #[test]
    fn fixed_sizes_stay() {
        let mut n = Node::container("tab", Axis::Row, vec![
            sized(term("side"), Size::Px { px: 240.0 }),
            sized(term("a"), Size::Weight { weight: 2.0 }),
            sized(term("b"), Size::Weight { weight: 1.0 }),
            sized(term("c"), Size::Weight { weight: 3.0 }),
        ]);
        assert_eq!(n.equalize("a", Scope::All), Some(true));
        assert_eq!(w(&n, "side"), Some(Size::Px { px: 240.0 }));
        assert_eq!((w(&n, "a"), w(&n, "b"), w(&n, "c")), (wt(2.0), wt(2.0), wt(2.0)));
    }

    #[test]
    fn stacks_are_left_alone_but_their_insides_are_evened() {
        let inner = Node::container("r", Axis::Row, vec![sized(term("a"), Size::Weight { weight: 3.0 }), sized(term("b"), Size::Weight { weight: 1.0 })]);
        let mut n = Node::new("tab", Kind::Stack { children: vec![sized(inner, Size::Weight { weight: 5.0 }), term("x")], active: None, header: None });
        assert!(n.equalize_all());
        assert_eq!(w(&n, "r"), wt(5.0));
        assert_eq!((w(&n, "a"), w(&n, "b")), (wt(2.0), wt(2.0)));
    }
}
