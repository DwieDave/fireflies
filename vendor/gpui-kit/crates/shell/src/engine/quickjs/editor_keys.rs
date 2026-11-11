// HERDR: a code editor's keystrokes, offered to its script first.
//
// `EditorState.on("key", handler)`: while that editor holds the keyboard,
// every keystroke goes to `handler` before the editor, its key bindings and
// the app's do; a handler returning true takes it (nothing else sees it, no
// text is typed). Built on GPUI's keystroke interceptors, which run before
// key bindings, so an editor's own bindings (Escape, Backspace) can be taken
// too. A modal editing scheme (vim) is the reason.

use std::{cell::RefCell, rc::Weak};

use gpui::{App, Focusable as _, WeakEntity};
use gpui_base::input::EditorState;
use rquickjs::{Function, Persistent};

use super::{InputCallbackOwner, ShellRuntime};

struct Entry {
    editor: WeakEntity<EditorState>,
    runtime: Weak<ShellRuntime>,
    handler: Persistent<Function<'static>>,
    owner: InputCallbackOwner,
}

thread_local! {
    static ENTRIES: RefCell<Vec<Entry>> = const { RefCell::new(Vec::new()) };
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
    ENTRIES.with_borrow_mut(|entries| {
        entries.retain(|e| e.editor.upgrade().is_some() && e.editor != editor);
        entries.push(Entry { editor, runtime, handler, owner });
    });
    INSTALLED.with_borrow_mut(|installed| {
        if installed.is_none() {
            *installed = Some(cx.intercept_keystrokes(|event, window, cx| {
                // The focused editor with a handler, if any.
                let found = ENTRIES.with_borrow(|entries| {
                    entries.iter().find_map(|e| {
                        let editor = e.editor.upgrade()?;
                        editor.read(cx).focus_handle(cx).is_focused(window).then(|| {
                            (e.runtime.clone(), e.handler.clone(), e.owner.clone_owner())
                        })
                    })
                });
                let Some((runtime, handler, owner)) = found else { return };
                let Some(runtime) = runtime.upgrade() else { return };
                if runtime.dispatch_editor_key(&handler, &owner, &event.keystroke, window, cx) {
                    cx.stop_propagation();
                }
            }));
        }
    });
}
