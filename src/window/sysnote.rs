//! A toast also goes to the system's notification center (macOS's
//! UNUserNotificationCenter, Linux's and Windows' through GPUI) while the
//! window isn't the one in front, so the person sees it from another app. In
//! front the toast is enough. One per toast, with the toast's title and body
//! (it can show on the lock screen: nothing more), silent (the app's own
//! sound has played). A click brings the window forward and does what a
//! click on the toast does. settings.json `system_notifications: false`
//! turns it off. A build run outside an app bundle posts nothing (GPUI's
//! guard); the first one posted from the bundle asks for macOS's permission.
use super::*;

/// The toasts posted to the system, newest last: tag (the toast's overlay id)
/// and what a click does. Only the newest are kept; an older click still
/// brings the window forward.
#[derive(Default)]
pub(super) struct Posted(Vec<(String, Option<(String, Value)>)>);

const KEPT: usize = 32;

/// What the system shows for a toast, or None: in front, switched off, or
/// nothing to show.
pub(super) fn system_note(tag: &str, notification: Option<&Value>, active: bool, enabled: bool) -> Option<SystemNotification> {
    if active || !enabled {
        return None;
    }
    let n = notification?;
    let text = |k: &str| n.get(k).and_then(Value::as_str).map(str::trim).unwrap_or_default().to_owned();
    let title = text("title");
    if title.is_empty() {
        return None;
    }
    Some(SystemNotification { tag: tag.to_owned().into(), title: title.into(), body: text("body").into(), actions: Vec::new() })
}

/// The toast's click: its `action` as a command name and args.
fn action_of(notification: Option<&Value>) -> Option<(String, Value)> {
    let a = notification?.get("action")?;
    let name = a.get("name").and_then(Value::as_str).filter(|n| !n.is_empty())?;
    Some((name.to_owned(), a.get("args").cloned().unwrap_or_else(|| json!({}))))
}

/// Hands a click on one of this window's notifications to it.
pub(super) fn listen(me: WeakEntity<AppWindow>, handle: AnyWindowHandle, cx: &mut App) {
    cx.on_system_notification_response(move |response, cx| {
        let tag = response.tag.to_string();
        let me = me.clone();
        let _ = handle.update(cx, |_, window, cx| {
            let _ = me.update(cx, |this, cx| this.system_note_clicked(&tag, window, cx));
        });
    });
}

impl AppWindow {
    /// A toast opening: posted to the system too when the window isn't in front.
    pub(super) fn post_system_note(&mut self, id: &str, notification: Option<&Value>, window: &mut Window, cx: &mut Context<Self>) {
        let Some(note) = system_note(id, notification, window.is_window_active(), self.person.system_notifications) else {
            return;
        };
        let posted = &mut self.system_notes.0;
        posted.push((id.to_owned(), action_of(notification)));
        if posted.len() > KEPT {
            posted.remove(0);
        }
        cx.show_system_notification(note);
    }

    /// The person clicked a system notification: the window comes forward and
    /// does what the toast's click does.
    fn system_note_clicked(&mut self, tag: &str, window: &mut Window, cx: &mut Context<Self>) {
        cx.activate(true);
        window.activate_window();
        let posted = &mut self.system_notes.0;
        let Some(at) = posted.iter().position(|(t, _)| t == tag) else {
            return;
        };
        if let (_, Some((name, args))) = posted.remove(at) {
            self.run(&name, args, window, cx);
        }
    }
}

#[cfg(test)]
mod tests {
    // Not `super::*`: gpui's `test` macro would shadow #[test].
    use super::{action_of, system_note};
    use serde_json::json;

    #[test]
    fn only_while_the_window_is_not_in_front_and_switched_on() {
        let n = json!({ "title": "Claude needs you", "body": "work / api", "level": "error" });
        assert!(system_note("t1", Some(&n), true, true).is_none(), "in front: the toast is enough");
        assert!(system_note("t1", Some(&n), false, false).is_none(), "switched off");
        let s = system_note("t1", Some(&n), false, true).expect("not in front: posted");
        assert_eq!((s.tag.as_ref(), s.title.as_ref(), s.body.as_ref()), ("t1", "Claude needs you", "work / api"));
        assert!(s.actions.is_empty());
        assert!(system_note("t1", Some(&json!({ "body": "no title" })), false, true).is_none());
        assert!(system_note("t1", None, false, true).is_none());
        let bare = system_note("t2", Some(&json!({ "title": "Saved", "body": null })), false, true).unwrap();
        assert_eq!(bare.body.as_ref(), "", "no body: none");
    }

    #[test]
    fn the_click_goes_where_the_toasts_goes() {
        let n = json!({ "title": "x", "action": { "name": "agent.focus", "args": { "terminal": "t9" } } });
        assert_eq!(action_of(Some(&n)), Some(("agent.focus".into(), json!({ "terminal": "t9" }))));
        assert_eq!(action_of(Some(&json!({ "title": "x", "action": { "name": "app.settings" } }))), Some(("app.settings".into(), json!({}))));
        assert_eq!(action_of(Some(&json!({ "title": "x" }))), None);
    }
}
