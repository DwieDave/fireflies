//! A right click's menu opens at the press, in the real engine: the Databases
//! window drawn 120 px in and 80 px down in its window (a window overlay sits
//! inside the app window like that, a pane elsewhere again), the pointer moved
//! over its top bar, then a right press on a cell of its Rows grid. The menu
//! must be that cell's, and stand at the press in the view's own px: not where
//! the view last heard the pointer, not offset by where the view sits. The
//! cell is found where the window says a key's menu would stand (menu-anchor.ts),
//! so the same press proves that rectangle is the cell's.
use super::*;
use gpui::{IntoElement, Modifiers, MouseButton, ParentElement, Render, Styled, VisualTestContext, div, point, px};
use gpui_shell::ShellRoot;
use std::{ops::Deref, time::Duration};

/// Where the view sits in the test window (window px).
const LEFT: f32 = 120.0;
const TOP: f32 = 80.0;
/// A window's border: its pointer events and its menu layer start inside it.
const BORDER: f32 = 1.0;

struct Offset(gpui::Entity<ShellRoot>);
impl Render for Offset {
    fn render(&mut self, _: &mut gpui::Window, _: &mut gpui::Context<Self>) -> impl IntoElement {
        div().size_full().pl(px(LEFT)).pt(px(TOP)).child(self.0.clone())
    }
}

#[gpui::test]
fn a_right_click_menu_opens_at_the_press_in_the_databases_window(cx: &mut TestAppContext) {
    cx.update(gpui_shell::init);
    let staged = Staged::new();
    let main = gpui_shell::typescript::default_entry(&staged.0.join("mods/databases"));
    std::fs::write(staged.0.join("main.js"), format!(
        r#"import Real from './mods/databases/{main}';
import {{ setShared }} from 'herdr';
import {{ keyedAnchor }} from './mods/databases/menu-anchor.ts';
export default class Scenario extends Real {{
  init(props, cx) {{
    super.init(props, cx);
    cx.timer.after(800, (cx) => {{ const v = this; {shown}; v.panel = 'main'; cx.notify(); }});
    cx.timer.every(50, () => {{
      const v = this;
      setShared('menu-probe', {{ cell: keyedAnchor(v), near: v.menu?.near ?? null, title: v.menu?.title ?? null, origin: v.origin }});
    }});
  }}
}}"#,
        shown = super::typing::SHOWN,
    )).unwrap();
    let calls = Rc::new(RefCell::new(Calls::default()));
    gpui_shell::policy::set_default(
        Policy::new()
            .with_storage_path(staged.0.join("menus-store.json"))
            .with_capabilities(Capabilities::new().storage(true).read_roots([staged.0.clone()]))
            .with_host_module(module(fixture(true, props(), updates("current", "current")), calls.clone()))
            .unwrap(),
    );
    let runtime = ShellRuntime::new_isolated().unwrap();
    let window = cx.add_window(|window, cx| Offset(runtime.try_load(&staged.0, window, cx).unwrap()));
    let mut visual = VisualTestContext::from_window(*window.deref(), cx);
    let frames = |visual: &mut VisualTestContext| {
        for _ in 0..3 {
            visual.update(|window, cx| {
                window.simulate_next_frame(cx);
                window.draw(cx).clear(cx);
            });
            visual.run_until_parked();
        }
    };
    let probe = |visual: &mut VisualTestContext| {
        visual.executor().advance_clock(Duration::from_millis(100));
        visual.run_until_parked();
        calls.borrow().shared.get("menu-probe").cloned().unwrap_or(Value::Null)
    };
    frames(&mut visual);
    visual.executor().advance_clock(Duration::from_millis(900));
    frames(&mut visual);
    let before = probe(&mut visual);
    let cell = &before["cell"];
    let n = |v: &Value| v.as_f64().unwrap_or(f64::NAN) as f32;
    assert!(cell.is_object(), "the grid's cursor cell isn't known: {before}");
    // The pointer over the view's top bar: the root hears it there and learns where the view sits.
    visual.simulate_mouse_move(point(px(LEFT + 40.0), px(TOP + 10.0)), None, Modifiers::default());
    frames(&mut visual);
    // A right press 10 px into the cell.
    let (x, y) = (n(&cell["x"]) + 10.0, n(&cell["y"]) + 10.0);
    visual.simulate_mouse_down(point(px(LEFT + BORDER + x), px(TOP + BORDER + y)), MouseButton::Right, Modifiers::default());
    frames(&mut visual);
    let after = probe(&mut visual);
    window.update(cx, |_, window, _| window.remove_window()).unwrap();
    cx.run_until_parked();
    assert_eq!((n(&after["origin"]["x"]), n(&after["origin"]["y"])), (LEFT + BORDER, TOP + BORDER), "{after}");
    assert_eq!(after["title"], json!("name · row 1"), "the press didn't reach the cell the window names: {after}");
    let near = &after["near"];
    assert!((n(&near["x"]) - x).abs() < 0.5 && (n(&near["y"]) - y).abs() < 0.5, "the menu stands at {near}, the press was at {x}, {y}");
    assert!(calls.borrow().unexpected.is_empty(), "{:?}", calls.borrow().unexpected);
}
