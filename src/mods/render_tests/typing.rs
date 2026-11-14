//! Typed text reaches a mod's focused input. A key a view's on_key_down
//! takes (cx.stop_propagation) is handled: GPUI never hands its character to
//! the input (the macOS keyDown returns before insertText, and the test
//! window's dispatch_keystroke does the same). So a window that claims every
//! key while one of its text fields has the keyboard drops what is typed.
//! These load the shipped mod in the engine, open the field, type through
//! GPUI's keystroke path and read the field back.
use super::*;
use gpui::{IntoElement, Render, VisualTestContext};
use gpui_shell::ShellRoot;
use std::{ops::Deref, time::Duration};

struct Mounted(gpui::Entity<ShellRoot>);
impl Render for Mounted {
    fn render(&mut self, _: &mut gpui::Window, _: &mut gpui::Context<Self>) -> impl IntoElement {
        self.0.clone()
    }
}

/// A field to type into: what the scenario imports, what it does once the
/// window has settled (`v` is the view, `cx` a Context), and the field's text.
struct Field {
    name: &'static str,
    imports: String,
    open: String,
    value: &'static str,
}

/// Mounts `entry` with `field` opened, types `typed`, and returns what the field holds
/// (with what the mod asked of the host that the fixture doesn't answer, if anything).
fn typed_into(cx: &mut TestAppContext, staged: &Staged, entry: &str, field: &Field, typed: &str) -> Value {
    let main = gpui_shell::typescript::default_entry(&staged.0.join(entry));
    // The window takes the keyboard again up to 600 ms after it opens (main.ts init): open later.
    std::fs::write(staged.0.join("main.js"), format!(
        r#"import Real from './{entry}/{main}';
import {{ setShared }} from 'herdr';
{imports}
export default class Scenario extends Real {{
  init(props, cx) {{
    super.init(props, cx);
    cx.timer.after(800, (cx) => {{ const v = this; {open}; cx.notify(); }});
    cx.timer.every(50, () => {{ const v = this; setShared('typing-probe', {value} ?? null); }});
  }}
}}"#,
        imports = field.imports,
        open = field.open,
        value = field.value,
    )).unwrap();
    let calls = Rc::new(RefCell::new(Calls::default()));
    static NEXT_STORE: AtomicU64 = AtomicU64::new(0);
    gpui_shell::policy::set_default(
        Policy::new()
            .with_storage_path(staged.0.join(format!("typing-store-{}.json", NEXT_STORE.fetch_add(1, Ordering::Relaxed))))
            .with_capabilities(Capabilities::new().storage(true).read_roots([staged.0.clone()]))
            .with_host_module(module(fixture(true, props(), updates("current", "current")), calls.clone()))
            .unwrap(),
    );
    let runtime = ShellRuntime::new_isolated().unwrap();
    let window = cx.add_window(|window, cx| Mounted(runtime.try_load(&staged.0, window, cx).unwrap()));
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
    frames(&mut visual);
    visual.executor().advance_clock(Duration::from_millis(900));
    frames(&mut visual);
    visual.simulate_input(typed);
    frames(&mut visual);
    visual.executor().advance_clock(Duration::from_millis(100));
    visual.run_until_parked();
    let probe = calls.borrow().shared.get("typing-probe").cloned().unwrap_or(Value::Null);
    window.update(cx, |_, window, _| window.remove_window()).unwrap();
    cx.run_until_parked();
    // A typed letter the window ran as its own key can reach for a client: say so with the field.
    let unexpected = &calls.borrow().unexpected;
    if unexpected.is_empty() { probe } else { json!({"held": probe, "ran": unexpected}) }
}

const DB: &str = "mods/databases";

/// A table shown in the Rows grid (made up: nothing runs).
const SHOWN: &str = "v.active = { id: 'sq-1', name: 'lamps', kind: 'sqlite', path: '/var/tmp/no-such.db', readonly: false, secret: 'none', origin: 'saved' };
    v.catalog = { tables: [{ schema: null, name: 'lamps', type: 'table', rows: 1 }], error: null, busy: false };
    v.rows = { ...v.rows, browse: { table: { schema: null, name: 'lamps' }, sort: null, filter: '', offset: 0, limit: 100 }, set: { columns: ['name'], rows: [['a']] }, total: 1 };";

/// Every text field of the Databases window, opened as its keys open it.
fn database_fields() -> Vec<Field> {
    let shown = |then: &str| format!("{SHOWN} {then}");
    vec![
        Field {
            name: "connection form: name",
            imports: "import { openForm } from './mods/databases/conn-form.ts';".into(),
            open: "openForm(v, null, cx)".into(),
            value: "v.form?.inputs.get('name')?.value()",
        },
        Field {
            name: "connection form: host",
            imports: "import { openForm } from './mods/databases/conn-form.ts';".into(),
            open: "openForm(v, null, cx); v.form.at = 2; v.form.focusStop()".into(),
            value: "v.form?.inputs.get('host')?.value()",
        },
        Field {
            name: "export form: file name",
            imports: "import { openExport } from './mods/databases/export-form.ts';".into(),
            open: shown("openExport(v, { table: v.catalog.tables[0] }, cx); const f = v.exporting; f.toFile = true; f.name.set_value(''); f.at = f.stops().findIndex((s) => s.id === 'name'); f.focus()"),
            value: "v.exporting?.name.value()",
        },
        Field {
            name: "password ask",
            imports: "import { askPassword } from './mods/databases/conns.ts';".into(),
            open: "askPassword(v, { id: 'pg-1', name: 'lantern', kind: 'postgres', host: 'db.invalid', readonly: false, secret: 'ask', origin: 'saved' }, false, cx, () => {})".into(),
            value: "v.password?.input.value()",
        },
        Field {
            name: "destructive ask: the name typed",
            imports: "import { InputState } from 'gpui-base';".into(),
            open: "v.ask = { verdict: { risk: 'destructive', verb: 'drop', target: 'lamps' }, text: 'Drop lamps?', step: 2, input: InputState.new({}), go: () => {} }; v.ask.input.focus()".into(),
            value: "v.ask?.input?.value()",
        },
        Field {
            name: "tables: find line",
            imports: "import { act } from './mods/databases/actions.ts';".into(),
            open: shown("v.panel = 'tables'; act(v, 'tables', 'table-find', cx)"),
            value: "v.tableFind?.value()",
        },
        Field {
            name: "rows: WHERE filter",
            imports: "import { openFilter } from './mods/databases/act-grid.ts';".into(),
            open: shown("v.panel = 'main'; openFilter(v)"),
            value: "v.filterInput?.value()",
        },
        Field {
            name: "rows: in-cell edit",
            imports: "import { InputState } from 'gpui-base';".into(),
            open: shown("v.panel = 'main'; v.cellEdit = { row: 0, col: 0, column: 'name', input: InputState.new({}), isNull: false }; v.cellEdit.input.focus()"),
            value: "v.cellEdit?.input.value()",
        },
        Field {
            name: "query tab: its new name",
            imports: "import { startRename } from './mods/databases/menus.ts';".into(),
            open: shown("const q = v.addQuery('', cx); startRename(v, q); v.rename.input.set_value('')"),
            value: "v.rename?.input.value()",
        },
        Field {
            name: "query editor",
            imports: "".into(),
            open: shown("v.addQuery('', cx); v.panel = 'main'; v.shownQuery()?.editor.focus()"),
            value: "v.shownQuery()?.editor.value()",
        },
    ]
}

#[gpui::test]
fn typed_text_reaches_the_databases_windows_fields(cx: &mut TestAppContext) {
    cx.update(gpui_shell::init);
    let staged = Staged::new();
    // Letters the window binds (? keys, q close, j / k move, n new, e edit, o sort, O the column's
    // menu, { } widths, H hide, V a row, T the tab's menu, x, D, J, K, m, P pin, # count, b the
    // server's databases, C the connection's menu…) are typed like any other.
    let typed = "lantern?qjkneoO{}HVTxDJKmP#bC";
    let wrong: Vec<String> = database_fields()
        .iter()
        .filter_map(|f| {
            let got = typed_into(cx, &staged, DB, f, typed);
            (got != json!(typed)).then(|| format!("{}: {got}", f.name))
        })
        .collect();
    assert!(wrong.is_empty(), "typed {typed:?}, the fields hold:\n{}", wrong.join("\n"));
}
