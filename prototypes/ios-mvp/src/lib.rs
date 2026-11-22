//! Fireflies iOS MVP: GPUI draws one full-screen view on iOS and counts taps.
//! The Swift host (`host/main.swift`) owns UIKit and calls these functions.

#[cfg(target_os = "ios")]
mod app {
    use gpui::{
        App, AppContext as _, Application, ApplicationHandle, Context, IntoElement,
        InteractiveElement as _, ParentElement as _, Render, StatefulInteractiveElement as _,
        Styled as _, Window, WindowOptions, div, px, rgb,
    };
    use gpui_apple::ios::{IosPlatform, IosTextSystem, host};
    use std::{cell::RefCell, ffi::c_void, rc::Rc, sync::Arc};

    thread_local! {
        static APP: RefCell<Option<ApplicationHandle>> = const { RefCell::new(None) };
    }

    struct Counter {
        taps: usize,
    }

    impl Render for Counter {
        fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
            div()
                .size_full()
                .bg(rgb(0x0b0f1a))
                .flex()
                .flex_col()
                .items_center()
                .justify_center()
                .gap(px(24.))
                .font_family("Helvetica Neue")
                .text_color(rgb(0xe8e6e3))
                .child(div().text_size(px(28.)).font_weight(gpui::FontWeight::SEMIBOLD).child("Fireflies on iOS"))
                .child(div().text_size(px(15.)).text_color(rgb(0x8b93a7)).child("GPUI · Metal · UIKit touch"))
                .child(
                    div()
                        .id("tap-target")
                        .size(px(200.))
                        .rounded(px(24.))
                        .bg(if self.taps % 2 == 0 { rgb(0xf2c14e) } else { rgb(0x4ecdc4) })
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.taps += 1;
                            cx.notify();
                        })),
                )
                .child(div().text_size(px(20.)).child(format!("taps: {}", self.taps)))
                .child(
                    div()
                        .flex()
                        .flex_wrap()
                        .gap(px(8.))
                        .w(px(300.))
                        .justify_center()
                        .children((0..self.taps).map(|_| div().size(px(20.)).rounded(px(4.)).bg(rgb(0xe8e6e3)))),
                )
        }
    }

    pub fn start(layer: *mut c_void, width: f32, height: f32, scale: f32, taps: usize) {
        unsafe { host::attach_layer(layer, width, height, scale) };
        let platform = Rc::new(IosPlatform::new(Arc::new(IosTextSystem::new())));
        let handle = Application::with_platform(platform).run_embedded(move |cx: &mut App| {
            cx.open_window(WindowOptions::default(), |_, cx| cx.new(|_| Counter { taps }))
                .expect("open the window");
        });
        APP.with(|a| *a.borrow_mut() = Some(handle));
    }
}

/// # Safety
/// `layer` is the host view's live `CAMetalLayer`; call once, on the main thread.
#[cfg(target_os = "ios")]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn ffm_start(layer: *mut std::ffi::c_void, width: f32, height: f32, scale: f32) {
    app::start(layer, width, height, scale, 0);
}

#[cfg(target_os = "ios")]
#[unsafe(no_mangle)]
pub extern "C" fn ffm_frame() {
    gpui_apple::ios::host::frame();
}

#[cfg(target_os = "ios")]
#[unsafe(no_mangle)]
pub extern "C" fn ffm_resize(width: f32, height: f32, scale: f32) {
    gpui_apple::ios::host::resize(width, height, scale);
}

/// `phase`: 0 began, 1 moved, 2 ended, 3 cancelled; points from the top left.
#[cfg(target_os = "ios")]
#[unsafe(no_mangle)]
pub extern "C" fn ffm_touch(id: u64, phase: u8, x: f32, y: f32) {
    gpui_apple::ios::host::touch(id, phase, x, y);
}
