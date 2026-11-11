// HERDR: a code editor's keystrokes, offered to its script first.
//
// `EditorState.on("key", handler)`: while that editor holds the keyboard,
// every keystroke goes to `handler` before the editor, its key bindings and
// the app's do; a handler returning true takes it (nothing else sees it, no
// text is typed). Built on GPUI's keystroke interceptors, which run before
// key bindings, so an editor's own bindings (Escape, Backspace) can be taken
// too. A modal editing scheme (vim) is the reason.
//
// The handlers live in their runtime (released with it: a script value must
// not outlive its runtime); this registry only knows which runtime to ask.

use std::{
    cell::RefCell,
    rc::{Rc, Weak},
};

use gpui::{App, Focusable as _, WeakEntity};
use gpui_base::input::EditorState;
use rquickjs::{Function, Persistent};

use super::{InputCallbackOwner, ShellRuntime};

thread_local! {
    static RUNTIMES: RefCell<Vec<Weak<ShellRuntime>>> = const { RefCell::new(Vec::new()) };
    static INSTALLED: RefCell<Option<gpui::Subscription>> = const { RefCell::new(None) };
}

/// Gives `editor`'s keystrokes to `handler` (replacing an earlier one).
pub(super) fn register(
    editor: WeakEntity<EditorState>,
    runtime: Weak<ShellRuntime>,
    handler: Persistent<Function<'static>>,
    owner: InputCallbackOwner,
    cx: &mut App,
) {
    let Some(rt) = runtime.upgrade() else { return };
    {
        let mut keys = rt.editor_keys.borrow_mut();
        keys.retain(|(e, _, _)| e.upgrade().is_some() && *e != editor);
        keys.push((editor, handler, owner));
    }
    RUNTIMES.with_borrow_mut(|list| {
        list.retain(|r| r.upgrade().is_some());
        if !list.iter().any(|r| r.ptr_eq(&runtime)) {
            list.push(runtime);
        }
    });
    INSTALLED.with_borrow_mut(|installed| {
        if installed.is_none() {
            *installed = Some(cx.intercept_keystrokes(|event, window, cx| {
                let runtimes: Vec<Rc<ShellRuntime>> = RUNTIMES.with_borrow(|list| list.iter().filter_map(Weak::upgrade).collect());
                for rt in runtimes {
                    // The focused editor with a handler in this runtime, if any.
                    let found = rt.editor_keys.borrow().iter().find_map(|(e, handler, owner)| {
                        let editor = e.upgrade()?;
                        editor.read(cx).focus_handle(cx).is_focused(window).then(|| (handler.clone(), owner.clone_owner()))
                    });
                    let Some((handler, owner)) = found else { continue };
                    if rt.dispatch_editor_key(&handler, &owner, &event.keystroke, window, cx) {
                        cx.stop_propagation();
                    }
                    return;
                }
            }));
        }
    });
}
