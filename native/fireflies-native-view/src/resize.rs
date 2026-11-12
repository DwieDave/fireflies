//! A picture-in-picture host being resized: the decisions, kept pure.
//!
//! The video in a `pip` view is a whole WKWebView (pip.rs moves the page in).
//! Every size it gets makes WebKit lay the page out again in its own process
//! and commit later, so during a drag the video trails the window's edge,
//! jumps and snaps. While a host's size keeps changing, the web view keeps
//! its last settled size instead and is drawn scaled into the host (the
//! host's bounds stay that size, so AppKit scales it into the frame); once
//! the size has held for `SETTLE`, it gets the real size, one layout.
//!
//! Only a burst counts: a change within `BURST` of the one before. A single
//! change (the video moving in, a pane laid out) lays the page out at once,
//! exactly as before.

use std::time::Duration;

/// How long the host's size must hold before the web view gets it.
pub const SETTLE: Duration = Duration::from_millis(150);
/// Two changes this close are a resize under way (a drag sends one per frame).
pub const BURST: Duration = Duration::from_millis(100);

/// Whether a size change goes live (the web view kept, drawn scaled), given
/// whether the host is live already and how long ago its size last changed.
pub fn goes_live(live: bool, since_last: Option<Duration>) -> bool {
    live || since_last.is_some_and(|d| d <= BURST)
}

/// Whether a live host has held its size long enough to settle.
pub fn settles(since_last: Duration) -> bool {
    since_last >= SETTLE
}

/// The host's bounds while live: the settled web view's size, stretched on
/// one side so the scale into `frame` is the same both ways (the video keeps
/// its shape; the bit beyond the web view is the host's own black).
/// `settled`, `frame`: (width, height); zero or negative sizes: the frame.
pub fn live_bounds(settled: (f64, f64), frame: (f64, f64)) -> (f64, f64) {
    let (sw, sh) = settled;
    let (fw, fh) = frame;
    if !(sw > 0.0 && sh > 0.0 && fw > 0.0 && fh > 0.0) {
        return frame;
    }
    // The scale that fits the settled view inside the frame.
    let s = (fw / sw).min(fh / sh);
    (fw / s, fh / s)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_burst_of_changes_goes_live() {
        // The first change (the video moving in, a pane laid out): laid out at once.
        assert!(!goes_live(false, None));
        assert!(!goes_live(false, Some(Duration::from_millis(400))));
        // A drag: one change a frame.
        assert!(goes_live(false, Some(Duration::from_millis(16))));
        assert!(goes_live(false, Some(BURST)));
        // Live stays live until it settles.
        assert!(goes_live(true, Some(Duration::from_millis(140))));
    }

    #[test]
    fn it_settles_once_the_size_has_held() {
        assert!(!settles(Duration::from_millis(16)));
        assert!(!settles(Duration::from_millis(149)));
        assert!(settles(SETTLE));
        assert!(settles(Duration::from_millis(400)));
    }

    #[test]
    fn the_bounds_scale_the_settled_view_into_the_frame_the_same_both_ways() {
        // Bigger, same shape: the bounds are the settled size (one scale, 1.5).
        assert_eq!(live_bounds((384.0, 214.0), (576.0, 321.0)), (384.0, 214.0));
        // Smaller: the same.
        assert_eq!(live_bounds((384.0, 214.0), (192.0, 107.0)), (384.0, 214.0));
        // A frame a pixel taller than the shape (rounding): the scale is the
        // width's, the bounds a little taller, nothing squeezed.
        let (bw, bh) = live_bounds((400.0, 225.0), (800.0, 451.0));
        assert_eq!(bw, 400.0);
        assert!((bh - 225.5).abs() < 1e-9);
        assert!((800.0 / bw - 451.0 / bh).abs() < 1e-9);
        // Nothing settled yet, or an empty frame: the frame itself.
        assert_eq!(live_bounds((0.0, 0.0), (300.0, 200.0)), (300.0, 200.0));
        assert_eq!(live_bounds((300.0, 200.0), (0.0, 10.0)), (0.0, 10.0));
    }
}
