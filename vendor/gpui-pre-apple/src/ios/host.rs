//! What the UIKit host calls. One window: its state sits in a thread-local
//! on the main thread, where UIKit calls in.

use super::window::WindowState;
use gpui::{Pixels, Point, TouchEvent, TouchId, TouchPhase, px, size};
use std::{cell::RefCell, rc::Rc};

thread_local! {
    pub(super) static WINDOW: RefCell<Option<Rc<RefCell<WindowState>>>> = const { RefCell::new(None) };
    pub(super) static LAYER: RefCell<Option<objc2::rc::Retained<objc2_quartz_core::CAMetalLayer>>> = const { RefCell::new(None) };
    pub(super) static METRICS: RefCell<(f32, f32, f32)> = const { RefCell::new((390., 844., 3.)) };
}

/// The view's backing layer, its size in points and its scale. Call before
/// the app opens its window.
///
/// # Safety
/// `layer` is a live `CAMetalLayer`.
pub unsafe fn attach_layer(layer: *mut std::ffi::c_void, width: f32, height: f32, scale: f32) {
    let layer = unsafe { objc2::rc::Retained::retain(layer.cast::<objc2_quartz_core::CAMetalLayer>()) };
    LAYER.with(|l| *l.borrow_mut() = layer);
    METRICS.with(|m| *m.borrow_mut() = (width, height, scale));
}

/// The view changed size (rotation, split view).
pub fn resize(width: f32, height: f32, scale: f32) {
    METRICS.with(|m| *m.borrow_mut() = (width, height, scale));
    let state = WINDOW.with(|w| w.borrow().clone());
    if let Some(state) = state {
        let callback = {
            let mut s = state.borrow_mut();
            s.resize(size(px(width), px(height)), scale);
            s.on_resize.take()
        };
        if let Some(mut callback) = callback {
            callback(size(px(width), px(height)), scale);
            state.borrow_mut().on_resize = Some(callback);
        }
    }
}

/// The display link fired: GPUI lays out and draws if anything changed.
pub fn frame() {
    let state = WINDOW.with(|w| w.borrow().clone());
    let Some(state) = state else { return };
    let callback = state.borrow_mut().on_request_frame.take();
    if let Some(mut callback) = callback {
        callback(Default::default());
        state.borrow_mut().on_request_frame = Some(callback);
    }
}

/// One touch, in points from the view's top left. `phase`: 0 began, 1 moved,
/// 2 ended, 3 cancelled.
pub fn touch(id: u64, phase: u8, x: f32, y: f32) {
    let phase = match phase {
        0 => TouchPhase::Started,
        1 => TouchPhase::Moved,
        2 => TouchPhase::Ended,
        _ => TouchPhase::Cancelled,
    };
    let position: Point<Pixels> = Point::new(px(x), px(y));
    let state = WINDOW.with(|w| w.borrow().clone());
    let Some(state) = state else { return };
    let callback = state.borrow_mut().on_input.take();
    if let Some(mut callback) = callback {
        callback(gpui::PlatformInput::Touch(TouchEvent {
            id: TouchId(id),
            phase,
            position,
            predicted_position: None,
            force: None,
        }));
        state.borrow_mut().on_input = Some(callback);
    }
}
