// Who has the keyboard while a window overlay shows (floatfocus). A window
// with a scrim (Git, GitHub) is modal: no key reaches a pane behind it,
// whatever happens behind it or inside it. One without (the PiP player) may
// hand the keyboard back to the pane.

/// A window's mod: focuses itself on start (unless `win.passive`) and on
/// `focus`; `inner` hands the keyboard to an element inside it, `drop` stops
/// drawing that element (a list row or input a redraw replaces).
const WIN_JS: &str = r#"import { View, div } from "gpui-kit"; import { nextCommand, shared, setShared } from "herdr";
export default class W extends View {
  init(_p, cx) {
    this.handle = cx.focus_handle(); this.inner = cx.focus_handle(); this.showInner = true;
    if (!shared("win.passive")) this.handle.focus();
    cx.spawn(async (cx) => { for (;;) { const c = String(await nextCommand());
      if (c === "focus") { setShared("win.focus", (shared("win.focus") ?? 0) + 1); this.handle.focus(); }
      else if (c === "inner") { this.showInner = true; this.inner.focus(); }
      else if (c === "drop") this.showInner = false;
      cx.notify(); } });
  }
  render() { return div().size_full().track_focus(this.handle).child(this.showInner ? div().size_full().track_focus(this.inner) : div()); }
}"#;

/// A focusable mod pane behind the window: records the keys it gets, and
/// takes the keyboard on `grab` (a mod behind focusing itself on a timer).
const KEYS_JS: &str = r#"import { View, div } from "gpui-kit"; import { nextCommand, shared, setShared } from "herdr";
export default class K extends View {
  init(_p, cx) {
    this.handle = cx.focus_handle();
    cx.spawn(async (cx) => { for (;;) { const c = String(await nextCommand()); if (c === "grab" || c === "focus") this.handle.focus(); cx.notify(); } });
  }
  render() { return div().size_full().track_focus(this.handle).on_key_down((e) => setShared("typed", (shared("typed") ?? "") + e.key)); }
}"#;

/// The window with tab tb1 (terminal pane p1, focused, and the `keys` mod
/// pane pk) and tab tb2 (terminal pane p2); p1 has the keyboard.
fn floatfocus_window(cx: &mut gpui::TestAppContext) -> (gpui::Entity<super::AppWindow>, &mut gpui::VisualTestContext) {
    use serde_json::json;
    let keys = crate::mods::app_dir().join("mods/keys");
    std::fs::create_dir_all(&keys).unwrap();
    std::fs::write(keys.join("mod.json"), r#"{ "place": "none", "focusable": true }"#).unwrap();
    std::fs::write(keys.join("main.js"), KEYS_JS).unwrap();
    let (view, cx) = open_window(cx, "win", WIN_JS, json!({ "id": "root", "type": "block", "content": { "tab": "active" } }));
    cx.update(|window, cx| view.update(cx, |this, cx| {
        use crate::layout::{Axis, Content, Node};
        this.model.add_space("sp1", "", "/tmp", crate::model::Tab::new("tb1", "", "p1", "t1"));
        this.model.add_tab("sp1", crate::model::Tab::new("tb2", "", "p2", "t2"));
        this.model.select_tab("tb1");
        assert!(this.model.split_with("p1", Axis::Row, Node::block("pk", Content::Mod { name: "keys".into(), props: json!({}) })));
        this.model.focus_pane("p1");
        this.sync(window, cx);
        let f = this.pane_focus("p1", cx).unwrap();
        f.focus(window, cx);
    }));
    settle(cx);
    assert!(pane_has_keys(&view, "p1", cx), "the pane has the keyboard at the start");
    (view, cx)
}

/// Commands run, frames drawn (focus-lost listeners and the guard run on a draw).
fn settle(cx: &mut gpui::VisualTestContext) {
    for _ in 0..3 {
        cx.run_until_parked();
        cx.update(|window, cx| window.draw(cx).clear(cx));
    }
    cx.run_until_parked();
}

fn pane_has_keys(view: &gpui::Entity<super::AppWindow>, pane: &str, cx: &mut gpui::VisualTestContext) -> bool {
    cx.update(|window, cx| view.read(cx).pane_focus(pane, cx).is_some_and(|f| f.is_focused(window)))
}

fn window_has_keys(view: &gpui::Entity<super::AppWindow>, id: &str, cx: &mut gpui::VisualTestContext) -> bool {
    cx.update(|window, cx| view.read(cx).window_has_keys(id, window, cx))
}

fn open(view: &gpui::Entity<super::AppWindow>, id: &str, spec: serde_json::Value, cx: &mut gpui::VisualTestContext) {
    cx.update(|window, cx| view.update(cx, |this, cx| this.open_overlay(id.into(), spec, window, cx)));
    settle(cx);
}

fn scrim_window() -> serde_json::Value {
    serde_json::json!({ "mod": "win", "kind": "window", "scrim": true, "width": 400, "height": 300 })
}

fn send(view: &gpui::Entity<super::AppWindow>, slot: &str, command: &str, cx: &mut gpui::VisualTestContext) {
    let copy = cx.update(|_, cx| view.read(cx).copies[slot].id);
    assert!(crate::mods::send_command_to(copy, command), "{slot} takes commands");
    settle(cx);
}

#[test]
fn an_element_a_scrim_window_stops_drawing_leaves_the_keyboard_in_it() {
    in_own_process("floatfocus_focus_lost");
}

/// Path 1: the mod's focused element goes away on a redraw (a row or input
/// replaced, a form closed, a render error). GPUI's focus falls to nothing and
/// `restore_focus` used to hand it to the pane behind the window.
#[gpui::test]
fn floatfocus_focus_lost(cx: &mut gpui::TestAppContext) {
    if !running_alone("floatfocus_focus_lost") {
        return;
    }
    let (view, cx) = floatfocus_window(cx);
    open(&view, "w", scrim_window(), cx);
    assert!(window_has_keys(&view, "w", cx));
    send(&view, "overlay:w", "inner", cx);
    assert!(window_has_keys(&view, "w", cx), "the element inside it has the keys");
    send(&view, "overlay:w", "drop", cx);
    assert!(window_has_keys(&view, "w", cx), "still the window's, not the pane's");
    assert!(!pane_has_keys(&view, "p1", cx));
    assert!(crate::mods::shared("win.focus").and_then(|v| v.as_u64()).unwrap_or(0) >= 1, "its mod was told to take the keyboard");
}

#[test]
fn a_dialog_or_popup_closed_over_a_window_gives_it_the_keyboard_back() {
    in_own_process("floatfocus_popup_back");
}

/// Path 2: a dialog or popup opened over a window (the palette, a confirm, a
/// menu) gave the keyboard to the pane behind when it closed.
#[gpui::test]
fn floatfocus_popup_back(cx: &mut gpui::TestAppContext) {
    use serde_json::json;
    if !running_alone("floatfocus_popup_back") {
        return;
    }
    let (view, cx) = floatfocus_window(cx);
    for (id, scrim) in [("w", true), ("pip", false)] {
        let mut spec = scrim_window();
        spec["scrim"] = json!(scrim);
        open(&view, id, spec, cx);
        cx.update(|window, cx| view.update(cx, |this, cx| this.focus_window_cmd(Some(id.into()), "next", window, cx))).unwrap();
        settle(cx);
        assert!(window_has_keys(&view, id, cx), "{id} has the keys");
        for kind in ["popup", "dialog"] {
            open(&view, "menu", json!({ "kind": kind }), cx);
            assert!(!window_has_keys(&view, id, cx), "the {kind} has them");
            cx.update(|window, cx| view.update(cx, |this, cx| this.close_overlay("menu", window, cx)));
            settle(cx);
            assert!(window_has_keys(&view, id, cx), "back to {id} after the {kind}");
            assert!(!pane_has_keys(&view, "p1", cx));
        }
        cx.update(|window, cx| view.update(cx, |this, cx| this.close_overlay(id, window, cx)));
        settle(cx);
    }
    // A popup over the pane: back to the pane, as before.
    cx.update(|window, cx| view.update(cx, |this, cx| this.pane_focus("p1", cx).unwrap().focus(window, cx)));
    open(&view, "menu", json!({ "kind": "popup" }), cx);
    cx.update(|window, cx| view.update(cx, |this, cx| this.close_overlay("menu", window, cx)));
    settle(cx);
    assert!(pane_has_keys(&view, "p1", cx));
}

#[test]
fn changes_behind_a_scrim_window_leave_the_keyboard_in_it() {
    in_own_process("floatfocus_behind");
}

/// Path 3: the focused pane changing behind the window (agent.next, a tab or
/// space switch, a pane closing, `pane.focus` from an agent, a focusable mod
/// pane) handed the keyboard to the new pane while the window still showed.
#[gpui::test]
fn floatfocus_behind(cx: &mut gpui::TestAppContext) {
    use serde_json::json;
    if !running_alone("floatfocus_behind") {
        return;
    }
    let (view, cx) = floatfocus_window(cx);
    open(&view, "w", scrim_window(), cx);
    assert!(window_has_keys(&view, "w", cx));
    let step = |what: &str, cx: &mut gpui::VisualTestContext, f: &dyn Fn(&mut super::AppWindow, &mut gpui::Window, &mut gpui::Context<super::AppWindow>)| {
        cx.update(|window, cx| view.update(cx, |this, cx| f(this, window, cx)));
        settle(cx);
        assert!(window_has_keys(&view, "w", cx), "after {what}");
    };
    step("a tab switch", cx, &|this, window, cx| this.run("tab.select", json!({ "id": "tb2" }), window, cx));
    assert!(!pane_has_keys(&view, "p2", cx));
    step("a switch back", cx, &|this, window, cx| this.run("tab.select", json!({ "id": "tb1" }), window, cx));
    step("pane.focus", cx, &|this, window, cx| this.run("pane.focus", json!({ "pane": "p1" }), window, cx));
    step("a focusable mod pane focused", cx, &|this, window, cx| { this.model.focus_pane("pk"); this.sync(window, cx); });
    step("a pane closing", cx, &|this, window, cx| { this.model.remove_pane("pk"); this.sync(window, cx); });
    assert!(!pane_has_keys(&view, "p1", cx));
    // Without a scrim the pane may take it back (the PiP player stays up beside the work).
    cx.update(|window, cx| view.update(cx, |this, cx| this.close_overlay("w", window, cx)));
    settle(cx);
    let mut pip = scrim_window();
    pip["scrim"] = json!(false);
    open(&view, "pip", pip, cx);
    cx.update(|window, cx| view.update(cx, |this, cx| this.focus_window_cmd(Some("pip".into()), "next", window, cx))).unwrap();
    settle(cx);
    cx.update(|window, cx| view.update(cx, |this, cx| this.run("tab.select", json!({ "id": "tb2" }), window, cx)));
    settle(cx);
    assert!(pane_has_keys(&view, "p2", cx), "a window without a scrim isn't modal");
}

#[test]
fn close_keys_close_a_scrim_window_not_the_tab_behind_it() {
    in_own_process("floatfocus_close_keys");
}

/// Path 4: cmd-w / cmd-shift-w with the GitHub window up closed the tab or
/// pane behind it (with its agent), and the window stayed.
#[gpui::test]
fn floatfocus_close_keys(cx: &mut gpui::TestAppContext) {
    use serde_json::json;
    if !running_alone("floatfocus_close_keys") {
        return;
    }
    let (view, cx) = floatfocus_window(cx);
    for name in ["tab.close", "pane.close"] {
        open(&view, "w", scrim_window(), cx);
        cx.update(|window, cx| view.update(cx, |this, cx| this.run_key(name, json!({}), window, cx)));
        settle(cx);
        cx.update(|_, cx| {
            let this = view.read(cx);
            assert!(!this.overlays.iter().any(|o| o.id == "w"), "{name} closed the window");
            assert!(this.model.tab("tb1").is_some() && this.model.tab_of("p1").is_some(), "{name} left the tab and pane");
        });
    }
}

