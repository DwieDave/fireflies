//! Snapping a window to the eight places of an area: its four corners and the
//! middles of its four edges. Picture in picture uses it twice: the Fireflies
//! window over the tab snaps to the shown tab's pane grid (the app's movable
//! windows, src/window/movable.rs), the window out of Fireflies to its
//! screen's usable area (pip.rs). Pure, so both are tested here, on every
//! platform.
//!
//! Coordinates are y-down (GPUI's): `top` is the smaller y. AppKit's y-up
//! rectangles go through [`flip`] first and back after.

use crate::Rect;

/// One of the eight places, by its column and row in a 3 × 3 grid whose
/// middle cell is no place.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Place {
    TopLeft,
    Top,
    TopRight,
    Right,
    BottomRight,
    Bottom,
    BottomLeft,
    Left,
}

/// Every place, clockwise from the top left.
pub const PLACES: [Place; 8] = [Place::TopLeft, Place::Top, Place::TopRight, Place::Right, Place::BottomRight, Place::Bottom, Place::BottomLeft, Place::Left];

/// A way to go from one place to the next.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Dir {
    Left,
    Right,
    Up,
    Down,
}

impl Dir {
    /// `left`, `right`, `up`, `down`.
    pub fn parse(s: &str) -> Option<Dir> {
        Some(match s {
            "left" => Dir::Left,
            "right" => Dir::Right,
            "up" => Dir::Up,
            "down" => Dir::Down,
            _ => return None,
        })
    }

    fn delta(self) -> (i8, i8) {
        match self {
            Dir::Left => (-1, 0),
            Dir::Right => (1, 0),
            Dir::Up => (0, -1),
            Dir::Down => (0, 1),
        }
    }
}

impl Place {
    /// `top-left`, `top`, `top-right`, `right`, `bottom-right`, `bottom`, `bottom-left`, `left`.
    pub fn name(self) -> &'static str {
        match self {
            Place::TopLeft => "top-left",
            Place::Top => "top",
            Place::TopRight => "top-right",
            Place::Right => "right",
            Place::BottomRight => "bottom-right",
            Place::Bottom => "bottom",
            Place::BottomLeft => "bottom-left",
            Place::Left => "left",
        }
    }

    pub fn parse(s: &str) -> Option<Place> {
        PLACES.into_iter().find(|p| p.name() == s)
    }

    /// Its column and row: -1, 0 or 1 each (left / middle / right, top / middle / bottom).
    fn cell(self) -> (i8, i8) {
        match self {
            Place::TopLeft => (-1, -1),
            Place::Top => (0, -1),
            Place::TopRight => (1, -1),
            Place::Right => (1, 0),
            Place::BottomRight => (1, 1),
            Place::Bottom => (0, 1),
            Place::BottomLeft => (-1, 1),
            Place::Left => (-1, 0),
        }
    }

    fn at(cell: (i8, i8)) -> Option<Place> {
        PLACES.into_iter().find(|p| p.cell() == cell)
    }

    /// The next place `dir` of this one: the middle is no place, so from an
    /// edge's middle across it goes on to the opposite one; past the area's
    /// side it stays.
    pub fn step(self, dir: Dir) -> Place {
        let ((c, r), (dc, dr)) = (self.cell(), dir.delta());
        let mut next = (c + dc, r + dr);
        if next == (0, 0) {
            next = (c + 2 * dc, r + 2 * dr);
        }
        Place::at(next).unwrap_or(self)
    }
}

/// `v` on whole device pixels (`scale` of them to a point).
pub fn device(v: f64, scale: f64) -> f64 {
    if scale > 0.0 { (v * scale).round() / scale } else { v }
}

/// Where a `w` × `h` window's top left goes for it to sit on `place` of
/// `area`: its outer edges on the area's (a corner: two, an edge's middle:
/// one, centred along it), on whole device pixels.
pub fn origin(place: Place, area: Rect, (w, h): (f64, f64), scale: f64) -> (f64, f64) {
    let (c, r) = place.cell();
    let along = |start: f64, room: f64, size: f64, k: i8| match k {
        -1 => start,
        0 => start + (room - size) / 2.0,
        _ => start + room - size,
    };
    (device(along(area.x, area.w, w, c), scale), device(along(area.y, area.h, h, r), scale))
}

/// The place a window whose top left is at `at` sits nearest to, and how far
/// off it is (the larger of the two axes, as the edges that meet see it).
fn closest_with(area: Rect, at: (f64, f64), size: (f64, f64), scale: f64) -> (Place, (f64, f64), f64) {
    PLACES
        .into_iter()
        .map(|p| {
            let o = origin(p, area, size, scale);
            (p, o, (o.0 - at.0).abs().max((o.1 - at.1).abs()))
        })
        .fold(None, |best: Option<(Place, (f64, f64), f64)>, c| match best {
            Some(b) if b.2 <= c.2 => Some(b),
            _ => Some(c),
        })
        .expect("eight places")
}

/// The place nearest a window at `at`, however far.
pub fn closest(area: Rect, at: (f64, f64), size: (f64, f64), scale: f64) -> Place {
    closest_with(area, at, size, scale).0
}

/// Magnetic: a window dragged to `at` lands on the place within `threshold`
/// of it (on both axes), with that place's top left; further from every
/// place it isn't caught (None) and moves freely.
pub fn catch(area: Rect, at: (f64, f64), size: (f64, f64), threshold: f64, scale: f64) -> Option<(Place, (f64, f64))> {
    let (p, o, off) = closest_with(area, at, size, scale);
    (off <= threshold).then_some((p, o))
}

/// A y-up rectangle (AppKit's, in screen points) as y-down, and back: the
/// same flip both ways.
pub fn flip(r: Rect) -> Rect {
    Rect { x: r.x, y: -(r.y + r.h), w: r.w, h: r.h }
}

#[cfg(test)]
mod tests {
    use super::*;

    const AREA: Rect = Rect { x: 10.0, y: 20.0, w: 1000.0, h: 600.0 };
    const SIZE: (f64, f64) = (300.0, 200.0);

    #[test]
    fn names_go_both_ways() {
        for p in PLACES {
            assert_eq!(Place::parse(p.name()), Some(p));
        }
        assert_eq!(Place::parse("middle"), None);
        assert_eq!(Dir::parse("up"), Some(Dir::Up));
        assert_eq!(Dir::parse("north"), None);
    }

    #[test]
    fn each_place_puts_the_windows_outer_edges_on_the_areas() {
        let o = |p| origin(p, AREA, SIZE, 1.0);
        assert_eq!(o(Place::TopLeft), (10.0, 20.0));
        assert_eq!(o(Place::TopRight), (10.0 + 1000.0 - 300.0, 20.0));
        assert_eq!(o(Place::BottomRight), (710.0, 20.0 + 600.0 - 200.0));
        assert_eq!(o(Place::BottomLeft), (10.0, 420.0));
        // An edge's middle: on that edge, centred along it.
        assert_eq!(o(Place::Top), (10.0 + 350.0, 20.0));
        assert_eq!(o(Place::Bottom), (360.0, 420.0));
        assert_eq!(o(Place::Left), (10.0, 20.0 + 200.0));
        assert_eq!(o(Place::Right), (710.0, 220.0));
        // The far edges meet exactly: the window's right and bottom are the area's.
        let (x, y) = o(Place::BottomRight);
        assert_eq!((x + SIZE.0, y + SIZE.1), (AREA.x + AREA.w, AREA.y + AREA.h));
    }

    #[test]
    fn on_whole_device_pixels_at_zoom_09_and_1() {
        // At zoom 0.9 on a 2× screen GPUI lays panes out on half points: a
        // grid from 12.5 to 1003 (device pixels 25 to 2006), a window 345.5 wide.
        let area = Rect { x: 12.5, y: 40.5, w: 990.5, h: 600.0 };
        for size in [(345.5, 214.0), (384.0, 238.0), (346.0, 215.5)] {
            for p in PLACES {
                let (x, y) = origin(p, area, size, 2.0);
                assert_eq!(((x * 2.0).fract(), (y * 2.0).fract()), (0.0, 0.0), "{p:?} {size:?}: ({x}, {y})");
            }
            // Corners: both meeting edges exact (the area and window are on device pixels already).
            let (x, y) = origin(Place::BottomRight, area, size, 2.0);
            assert_eq!((x + size.0, y + size.1), (area.x + area.w, area.y + area.h));
            assert_eq!(origin(Place::TopLeft, area, size, 2.0), (area.x, area.y));
        }
        // An odd middle rounds to a device pixel, never a quarter point.
        assert_eq!(origin(Place::Top, Rect { x: 0.0, y: 0.0, w: 101.0, h: 50.0 }, (50.0, 20.0), 2.0).0, 25.5);
        assert_eq!(origin(Place::Top, Rect { x: 0.0, y: 0.0, w: 101.0, h: 50.0 }, (50.0, 20.0), 1.0).0, 26.0);
    }

    #[test]
    fn a_dragged_window_is_caught_within_the_threshold_and_free_beyond() {
        // 20 px from the bottom right on both axes: caught, exactly there.
        assert_eq!(catch(AREA, (690.0, 400.0), SIZE, 24.0, 1.0), Some((Place::BottomRight, (710.0, 420.0))));
        // 30 px off on one axis: free (the mode never traps it).
        assert_eq!(catch(AREA, (680.0, 420.0), SIZE, 24.0, 1.0), None);
        // An edge's middle catches too, measured on its centre along the edge.
        assert_eq!(catch(AREA, (370.0, 30.0), SIZE, 24.0, 1.0), Some((Place::Top, (360.0, 20.0))));
        // In the open: nothing.
        assert_eq!(catch(AREA, (200.0, 150.0), SIZE, 24.0, 1.0), None);
        // Outside the area (dragged past its edge) it's caught the same.
        assert_eq!(catch(AREA, (-5.0, 10.0), SIZE, 24.0, 1.0), Some((Place::TopLeft, (10.0, 20.0))));
        // The nearest, however far, for keys from a free window.
        assert_eq!(closest(AREA, (600.0, 30.0), SIZE, 1.0), Place::TopRight);
    }

    #[test]
    fn keys_step_from_place_to_place() {
        use Place::*;
        let (l, r, u, d) = (Dir::Left, Dir::Right, Dir::Up, Dir::Down);
        assert_eq!(BottomRight.step(l), Bottom);
        assert_eq!(Bottom.step(l), BottomLeft);
        assert_eq!(BottomLeft.step(l), BottomLeft, "past the side it stays");
        assert_eq!(BottomRight.step(u), Right);
        assert_eq!(Right.step(u), TopRight);
        assert_eq!(TopRight.step(u), TopRight);
        // Across the middle, on to the opposite edge's middle.
        assert_eq!(Right.step(l), Left);
        assert_eq!(Top.step(d), Bottom);
        assert_eq!(Left.step(r), Right);
        // Along an edge from its middle.
        assert_eq!(Top.step(r), TopRight);
        assert_eq!(Left.step(d), BottomLeft);
    }

    #[test]
    fn a_window_keeps_its_anchor_through_a_resize_and_a_new_area() {
        // Anchored bottom right: the area shrinks (the sidebar folds out, the
        // window gets smaller), the video is resized: still on the corner.
        for (area, size) in [(AREA, (400.0, 250.0)), (Rect { x: 200.0, y: 20.0, w: 700.0, h: 500.0 }, SIZE)] {
            let (x, y) = origin(Place::BottomRight, area, size, 2.0);
            assert_eq!((x + size.0, y + size.1), (area.x + area.w, area.y + area.h));
        }
    }

    #[test]
    fn appkit_rectangles_flip_both_ways() {
        // A screen's usable area, y-up: from 0 to 900 above a 25 pt menu bar.
        let up = Rect { x: 0.0, y: 70.0, w: 1440.0, h: 805.0 };
        assert_eq!(flip(flip(up)), up);
        // The top left in y-down is the y-up area's top (70 + 805): the window's top there.
        let down = flip(up);
        let (x, y) = origin(Place::TopLeft, down, SIZE, 2.0);
        let window_up = flip(Rect { x, y, w: SIZE.0, h: SIZE.1 });
        assert_eq!((window_up.x, window_up.y + window_up.h), (0.0, 875.0));
        let (x, y) = origin(Place::BottomRight, down, SIZE, 2.0);
        let window_up = flip(Rect { x, y, w: SIZE.0, h: SIZE.1 });
        assert_eq!((window_up.x + SIZE.0, window_up.y), (1440.0, 70.0));
    }
}
