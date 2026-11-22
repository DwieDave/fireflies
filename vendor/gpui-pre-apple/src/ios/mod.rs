//! iOS backend, the smallest that draws and takes touches.
//!
//! The host app owns UIKit: `UIApplicationMain`, a view whose `layerClass` is
//! `CAMetalLayer`, a `CADisplayLink` and the touch handlers. It hands the
//! layer to [`host::attach_layer`] and calls [`host::frame`] and
//! [`host::touch`]; everything GPUI asks of a platform is answered here.

pub mod host;
mod platform;
mod window;

pub use platform::IosPlatform;
