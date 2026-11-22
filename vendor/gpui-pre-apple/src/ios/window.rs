//! The one window: the host view's CAMetalLayer drawn by the shared Metal
//! renderer; callbacks are kept for [`super::host`] to call.

use super::host::{LAYER, METRICS, WINDOW};
use crate::metal_renderer::{Context, MetalRenderer};
use anyhow::{Context as _, Result};
use futures::channel::oneshot;
use gpui::{
    AnyWindowHandle, Bounds, Capslock, DevicePixels, DispatchEventResult, DisplayId, GpuSpecs,
    Modifiers, Pixels, PlatformAtlas, PlatformDisplay, PlatformInput, PlatformInputHandler,
    PlatformWindow, Point, PromptButton, PromptLevel, RequestFrameOptions, Scene, Size,
    WindowAppearance, WindowBackgroundAppearance, WindowBounds, WindowControlArea,
    WindowVisibility, point, px, size,
};
use std::{cell::RefCell, rc::Rc, sync::Arc};

#[derive(Debug)]
pub struct IosDisplay;

impl PlatformDisplay for IosDisplay {
    fn id(&self) -> DisplayId {
        DisplayId::new(1)
    }
    fn uuid(&self) -> Result<uuid::Uuid> {
        Ok(uuid::Uuid::nil())
    }
    fn bounds(&self) -> Bounds<Pixels> {
        let (w, h, _) = METRICS.with(|m| *m.borrow());
        Bounds::new(point(px(0.), px(0.)), size(px(w), px(h)))
    }
}

pub(super) struct WindowState {
    renderer: MetalRenderer,
    size: Size<Pixels>,
    scale: f32,
    input_handler: Option<PlatformInputHandler>,
    pub(super) on_request_frame: Option<Box<dyn FnMut(RequestFrameOptions)>>,
    pub(super) on_input: Option<Box<dyn FnMut(PlatformInput) -> DispatchEventResult>>,
    pub(super) on_resize: Option<Box<dyn FnMut(Size<Pixels>, f32)>>,
}

impl WindowState {
    pub(super) fn resize(&mut self, size: Size<Pixels>, scale: f32) {
        self.size = size;
        self.scale = scale;
        self.renderer.update_drawable_size(Size {
            width: DevicePixels((f32::from(size.width) * scale) as i32),
            height: DevicePixels((f32::from(size.height) * scale) as i32),
        });
    }
}

pub(super) struct IosWindow {
    state: Rc<RefCell<WindowState>>,
}

impl IosWindow {
    pub(super) fn open(_handle: AnyWindowHandle, context: Context) -> Result<Self> {
        let layer = LAYER
            .with(|l| l.borrow().clone())
            .context("host::attach_layer was not called before the window opened")?;
        let (w, h, scale) = METRICS.with(|m| *m.borrow());
        let renderer = MetalRenderer::from_layer(context, &layer, false);
        let mut state = WindowState {
            renderer,
            size: size(px(w), px(h)),
            scale,
            input_handler: None,
            on_request_frame: None,
            on_input: None,
            on_resize: None,
        };
        state.resize(size(px(w), px(h)), scale);
        let state = Rc::new(RefCell::new(state));
        WINDOW.with(|win| *win.borrow_mut() = Some(state.clone()));
        Ok(Self { state })
    }
}

impl raw_window_handle::HasWindowHandle for IosWindow {
    fn window_handle(
        &self,
    ) -> Result<raw_window_handle::WindowHandle<'_>, raw_window_handle::HandleError> {
        Err(raw_window_handle::HandleError::NotSupported)
    }
}

impl raw_window_handle::HasDisplayHandle for IosWindow {
    fn display_handle(
        &self,
    ) -> Result<raw_window_handle::DisplayHandle<'_>, raw_window_handle::HandleError> {
        Err(raw_window_handle::HandleError::NotSupported)
    }
}

impl PlatformWindow for IosWindow {
    fn bounds(&self) -> Bounds<Pixels> {
        Bounds::new(Point::default(), self.state.borrow().size)
    }
    fn is_maximized(&self) -> bool {
        true
    }
    fn window_bounds(&self) -> WindowBounds {
        WindowBounds::Fullscreen(self.bounds())
    }
    fn content_size(&self) -> Size<Pixels> {
        self.state.borrow().size
    }
    fn resize(&mut self, _: Size<Pixels>) {}
    fn scale_factor(&self) -> f32 {
        self.state.borrow().scale
    }
    fn appearance(&self) -> WindowAppearance {
        WindowAppearance::Dark
    }
    fn display(&self) -> Option<Rc<dyn PlatformDisplay>> {
        Some(Rc::new(IosDisplay))
    }
    fn mouse_position(&self) -> Point<Pixels> {
        Point::default()
    }
    fn modifiers(&self) -> Modifiers {
        Modifiers::default()
    }
    fn capslock(&self) -> Capslock {
        Capslock::default()
    }
    fn set_input_handler(&mut self, input_handler: PlatformInputHandler) {
        self.state.borrow_mut().input_handler = Some(input_handler);
    }
    fn take_input_handler(&mut self) -> Option<PlatformInputHandler> {
        self.state.borrow_mut().input_handler.take()
    }
    fn prompt(
        &self,
        _: PromptLevel,
        _: &str,
        _: Option<&str>,
        _: &[PromptButton],
    ) -> Option<oneshot::Receiver<usize>> {
        None
    }
    fn activate(&self) {}
    fn is_active(&self) -> bool {
        true
    }
    fn visibility(&self) -> WindowVisibility {
        WindowVisibility::Visible
    }
    fn is_hovered(&self) -> bool {
        false
    }
    fn background_appearance(&self) -> WindowBackgroundAppearance {
        WindowBackgroundAppearance::Opaque
    }
    fn set_title(&mut self, _: &str) {}
    fn set_background_appearance(&self, _: WindowBackgroundAppearance) {}
    fn minimize(&self) {}
    fn zoom(&self) {}
    fn toggle_fullscreen(&self) {}
    fn is_fullscreen(&self) -> bool {
        true
    }
    fn on_request_frame(&self, callback: Box<dyn FnMut(RequestFrameOptions)>) {
        self.state.borrow_mut().on_request_frame = Some(callback);
    }
    fn on_input(&self, callback: Box<dyn FnMut(PlatformInput) -> DispatchEventResult>) {
        self.state.borrow_mut().on_input = Some(callback);
    }
    fn on_active_status_change(&self, _: Box<dyn FnMut(bool)>) {}
    fn on_visibility_change(&self, _: Box<dyn FnMut(WindowVisibility)>) {}
    fn on_hover_status_change(&self, _: Box<dyn FnMut(bool)>) {}
    fn on_resize(&self, callback: Box<dyn FnMut(Size<Pixels>, f32)>) {
        self.state.borrow_mut().on_resize = Some(callback);
    }
    fn on_moved(&self, _: Box<dyn FnMut()>) {}
    fn on_should_close(&self, _: Box<dyn FnMut() -> bool>) {}
    fn on_hit_test_window_control(&self, _: Box<dyn FnMut() -> Option<WindowControlArea>>) {}
    fn on_close(&self, _: Box<dyn FnOnce()>) {}
    fn on_appearance_changed(&self, _: Box<dyn FnMut()>) {}
    fn draw(&self, scene: &Scene) {
        self.state.borrow_mut().renderer.draw(scene);
    }
    fn sprite_atlas(&self) -> Arc<dyn PlatformAtlas> {
        self.state.borrow().renderer.sprite_atlas().clone()
    }
    fn is_subpixel_rendering_supported(&self) -> bool {
        false
    }
    fn gpu_specs(&self) -> Option<GpuSpecs> {
        None
    }
    fn update_ime_position(&self, _: Bounds<Pixels>) {}
}
