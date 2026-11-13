//! Mods written in TypeScript: the runtime strips their types at load (see
//! gpui_shell::typescript). These run the real engine, the way a mod copy runs
//! in the window: `try_load`, a save, `reload_now`.
use super::*;
use gpui::TestAppContext;
use gpui_shell::{ShellRuntime, plugin::DescriptionSession, policy::Policy};
use std::sync::atomic::{AtomicU64, Ordering};

struct Tree(PathBuf);
impl Tree {
    fn new() -> Self {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let path = PathBuf::from(format!("/var/tmp/herdr-ts-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed)));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).unwrap();
        Self(path)
    }
    fn write(&self, name: &str, text: &str) {
        std::fs::write(self.0.join(name), text).unwrap();
    }
    /// The path the engine names a file by (macOS's /var is /private/var).
    fn real(&self, name: &str) -> String {
        self.0.canonicalize().unwrap().join(name).display().to_string()
    }
}
impl Drop for Tree {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

struct Empty;
impl gpui::Render for Empty {
    fn render(&mut self, _: &mut gpui::Window, _: &mut gpui::Context<Self>) -> impl gpui::IntoElement {
        gpui::Empty
    }
}

/// What a converted mod is made of: typed parameters, an interface, a generic,
/// `import type`, a type-only specifier, `satisfies`, `!`, a declared field.
const MAIN: &str = r#"import { View, div } from "gpui-kit";
import { v_flex } from "gpui-base";
import type { Caption } from "./caption.ts";
import { caption, type Shout } from "./caption.ts";

interface Row { label: string; count: number }

function first<T>(items: T[], fallback: T): T {
  return items.length > 0 ? items[0]! : fallback;
}

export default class Panel extends View {
  rows: Row[] = [];
  declare loud: Shout;

  init(): void {
    this.rows = [{ label: "row", count: 1 } satisfies Row];
  }

  render() {
    const text: Caption = caption(first<Row>(this.rows, { label: "none", count: 0 }).label);
    return v_flex().child(div().child(text as string));
  }
}
"#;

fn caption(word: &str) -> String {
    format!(
        "export type Caption = string;\n\
         export type Shout = Uppercase<string>;\n\
         export const caption = (label: string): Caption => `{word}:${{label}}`;\n"
    )
}

fn describe(runtime: &Rc<ShellRuntime>, dir: &Path, window: &mut gpui::Window, cx: &mut gpui::App) -> Result<String, String> {
    let mut session = DescriptionSession::load(runtime.clone(), dir, Policy::new(), window, cx).map_err(|e| format!("{e:#}"))?;
    session.describe(window, cx).map_err(|e| format!("{e:#}"))
}

use std::rc::Rc;

#[gpui::test]
fn a_typescript_mod_loads_renders_reloads_and_keeps_its_last_good_build(cx: &mut TestAppContext) {
    cx.update(gpui_shell::init);
    let tree = Tree::new();
    tree.write("main.ts", MAIN);
    tree.write("caption.ts", &caption("before"));
    let runtime = ShellRuntime::new_isolated().unwrap();
    let window = cx.add_window(|_, _| Empty);
    window.update(cx, |_, window, cx| {
        assert!(describe(&runtime, &tree.0, window, cx).unwrap().contains("before:row"));

        // As the window runs a mod: try_load, then a save and reload_now.
        let root = runtime.try_load(&tree.0, window, cx).expect("a main.ts mod loads");
        tree.write("caption.ts", &caption("after"));
        runtime.reload_now(&root, window, cx).expect("a saved .ts change reloads");
        assert!(describe(&runtime, &tree.0, window, cx).unwrap().contains("after:row"));

        // A save the loader refuses is a failed reload: the copy keeps its
        // last good build, and the error names the file, line and construct.
        tree.write("caption.ts", &format!("{}\nexport enum Mood {{ Calm }}\n", caption("enum")));
        let error = format!("{:#}", runtime.reload_now(&root, window, cx).expect_err("an enum is refused"));
        assert!(error.contains(&format!("{}:5:8: TypeScript enum is not supported", tree.real("caption.ts"))), "{error}");
        assert!(error.contains("const object instead of an enum"), "{error}");
        assert!(DescriptionSession::load(runtime.clone(), &tree.0, Policy::new(), window, cx).is_err(), "the broken revision does not load");

        // Fixed again: the next save loads.
        tree.write("caption.ts", &caption("fixed"));
        runtime.reload_now(&root, window, cx).expect("the fixed save reloads");
        assert!(describe(&runtime, &tree.0, window, cx).unwrap().contains("fixed:row"));
    }).unwrap();
    window.update(cx, |_, window, _| window.remove_window()).unwrap();
    cx.run_until_parked();
}

#[gpui::test]
fn a_runtime_error_in_a_typescript_mod_names_the_ts_line(cx: &mut TestAppContext) {
    cx.update(gpui_shell::init);
    let tree = Tree::new();
    // Wide types before the throw: their blanks keep the line and the column.
    tree.write(
        "main.ts",
        "import { View, div } from \"gpui-kit\";\n\
         interface Big<T extends Record<string, unknown>> { value: T }\n\
         type Pair = [left: number, right: number];\n\
         export default class Broken extends View {\n\
           render(): never {\n\
             const pair: Pair = [1, 2] as Pair;\n\
             throw new Error(`broken at ${pair.length}`);\n\
           }\n\
         }\n",
    );
    let runtime = ShellRuntime::new_isolated().unwrap();
    let window = cx.add_window(|_, _| Empty);
    window.update(cx, |_, window, cx| {
        let error = describe(&runtime, &tree.0, window, cx).expect_err("render throws");
        assert!(error.contains("broken at 2"), "{error}");
        // The module's name carries its revision (`?v=`), as a .js module's does.
        assert!(error.contains(&format!("{}?v=", tree.real("main.ts"))) && error.contains(":7:11)"), "the stack names the .ts line and column: {error}");
    }).unwrap();
    window.update(cx, |_, window, _| window.remove_window()).unwrap();
    cx.run_until_parked();
}

#[gpui::test]
fn javascript_mods_are_never_stripped(cx: &mut TestAppContext) {
    cx.update(gpui_shell::init);
    let tree = Tree::new();
    // A type annotation in a .js file stays a syntax error: .js is read as is.
    tree.write("main.js", "import { View, div } from \"gpui-kit\";\nlet typed: number = 1;\nexport default class Plain extends View { render() { return div(); } }\n");
    // With both entries, main.js is the one that runs.
    tree.write("main.ts", "this is not even TypeScript");
    let runtime = ShellRuntime::new_isolated().unwrap();
    let window = cx.add_window(|_, _| Empty);
    window.update(cx, |_, window, cx| {
        let error = describe(&runtime, &tree.0, window, cx).expect_err("types in .js do not parse");
        assert!(error.contains("main.js"), "{error}");
        assert!(!error.contains("erasableSyntaxOnly") && !error.contains("main.ts"), "{error}");
        tree.write("main.js", "import { View, div } from \"gpui-kit\";\nexport default class Plain extends View { render() { return div().child('plain'); } }\n");
        assert!(describe(&runtime, &tree.0, window, cx).unwrap().contains("plain"));
    }).unwrap();
    window.update(cx, |_, window, _| window.remove_window()).unwrap();
    cx.run_until_parked();
}

/// What the engine has of the web's globals, which bun (the mods' tests) has
/// all of: a mod may use atob, btoa, URL, URLSearchParams, crypto, Buffer,
/// queueMicrotask, fetch. setTimeout and setInterval are stubs that throw
/// (`cx.timer` instead); TextDecoder, TextEncoder, structuredClone are absent.
/// defaults/AGENTS.md and the generated typings say the same.
#[gpui::test]
fn the_engine_globals_mods_may_use(cx: &mut TestAppContext) {
    cx.update(gpui_shell::init);
    let tree = Tree::new();
    tree.write(
        "main.ts",
        "import { View, div } from \"gpui-kit\";\n\
         const names: string[] = [\"atob\", \"btoa\", \"URL\", \"URLSearchParams\", \"crypto\", \"Buffer\", \"setTimeout\", \"setInterval\", \"queueMicrotask\", \"TextDecoder\", \"TextEncoder\", \"structuredClone\", \"fetch\"];\n\
         const has = names.map((n) => `${n}=${typeof (globalThis as any)[n]}`).join(\" \");\n\
         let timer = \"\";\n\
         try { (globalThis as any).setTimeout(() => {}, 1); } catch (e) { timer = String((e as Error).message); }\n\
         const work = `${atob(\"aGk=\")} ${new URL(\"https://a.example/x?y=1\").searchParams.get(\"y\")} ${timer}`;\n\
         export default class Probe extends View { render() { return div().child(has + \" \" + work); } }\n",
    );
    let runtime = ShellRuntime::new_isolated().unwrap();
    let window = cx.add_window(|_, _| Empty);
    window.update(cx, |_, window, cx| {
        let tree = describe(&runtime, &tree.0, window, cx).unwrap();
        for present in ["atob=function", "btoa=function", "URL=function", "URLSearchParams=function", "crypto=object", "Buffer=function", "hi 1"] {
            assert!(tree.contains(present), "{present}: {tree}");
        }
        assert!(tree.contains("`setTimeout` is not available in the shell: use cx.timer.after"), "{tree}");
        for absent in ["TextDecoder=undefined", "TextEncoder=undefined", "structuredClone=undefined"] {
            assert!(tree.contains(absent), "{absent}: {tree}");
        }
    }).unwrap();
    window.update(cx, |_, window, _| window.remove_window()).unwrap();
    cx.run_until_parked();
}

#[test]
fn a_folder_with_main_ts_is_a_mod() {
    let tree = Tree::new();
    for (name, entry) in [("typed", "main.ts"), ("plain", "main.js"), ("none", "notes.md")] {
        std::fs::create_dir_all(tree.0.join(name)).unwrap();
        std::fs::write(tree.0.join(name).join(entry), "").unwrap();
    }
    let mut found: Vec<_> = scan_dir(&tree.0, "").into_iter().map(|f| f.id).collect();
    found.sort();
    assert_eq!(found, ["plain", "typed"]);
    assert_eq!(gpui_shell::typescript::default_entry(&tree.0.join("typed")), "main.ts");
    assert_eq!(gpui_shell::typescript::default_entry(&tree.0.join("plain")), "main.js");
}

mod strip {
    use gpui_shell::typescript::{is_source, strip};
    use std::path::Path;

    #[test]
    fn types_become_spaces_and_lines_stay() {
        let source = "import type { A } from \"./a.ts\";\n\
                      import { b, type C } from \"./b.ts\";\n\
                      interface X { a: number }\n\
                      export function f<T>(x: T, y?: number): T { return x as T; }\n\
                      const z = f!;\n\
                      class K { declare d: string; e?: number; abstract_like(): void {} }\n";
        let stripped = strip(Path::new("/x/types.ts"), source).expect("erasable syntax strips");
        assert_eq!(stripped.len(), source.len(), "byte offsets are kept");
        assert_eq!(stripped.lines().count(), source.lines().count());
        assert!(stripped.contains("export function f   (x   , y         )    { return x     ; }"), "{stripped}");
        assert!(!stripped.contains("interface") && !stripped.contains("import type"), "{stripped}");
    }

    #[test]
    fn what_cannot_be_erased_names_file_line_and_construct() {
        let error = strip(Path::new("/x/enum.ts"), "const a = 1;\n\nenum Color { Red }\n").expect_err("an enum needs code generated");
        assert!(error.starts_with("/x/enum.ts:3:1: TypeScript enum is not supported"), "{error}");
        assert!(error.contains("a const object instead of an enum"), "{error}");

        let error = strip(Path::new("/x/p.ts"), "class A {\n  constructor(private x: number) {}\n}\n").expect_err("parameter properties generate assignments");
        assert!(error.starts_with("/x/p.ts:2:") && error.contains("parameter property"), "{error}");

        let error = strip(Path::new("/x/n.ts"), "namespace N { export const a = 1; }\n").expect_err("namespaces generate objects");
        assert!(error.starts_with("/x/n.ts:1:1:") && error.contains("namespace"), "{error}");

        let error = strip(Path::new("/x/c.ts"), "const a = 1;\nconst b = <string>a;\n").expect_err("<T>x is refused");
        assert!(error.starts_with("/x/c.ts:2:11:"), "{error}");
    }

    #[test]
    fn a_syntax_error_names_its_line_without_the_strip_hint() {
        let error = strip(Path::new("/x/s.ts"), "const a = 1;\nconst b = ;\n").expect_err("broken");
        assert!(error.starts_with("/x/s.ts:2:"), "{error}");
        assert!(!error.contains("erasableSyntaxOnly"), "{error}");
    }

    #[test]
    fn a_changed_file_is_stripped_again() {
        let path = Path::new("/x/cached.ts");
        assert_eq!(strip(path, "let a: number = 1;\n").unwrap(), "let a         = 1;\n");
        assert_eq!(strip(path, "let a: number = 1;\n").unwrap(), "let a         = 1;\n", "unchanged: from the cache");
        assert_eq!(strip(path, "let a: string = \"\";\n").unwrap(), "let a         = \"\";\n");
    }

    #[test]
    fn what_counts_as_source() {
        for name in ["main.js", "kit.mjs", "main.ts", "kit.mts"] {
            assert!(is_source(name), "{name}");
        }
        for name in ["gpui-kit.d.ts", "types.d.ts", "jsconfig.json", "README.md", "main.tsx"] {
            assert!(!is_source(name), "{name}");
        }
    }
}

/// The editor configuration the runtime writes into a mod folder on load:
/// a strict tsconfig.json for a TypeScript mod, the jsconfig.json of before
/// upgraded to allow .ts imports, the author's own left alone.
#[test]
fn editor_configs_for_typescript_mods() {
    let write = |dir: &Path| gpui_shell::write_type_declarations_with_components(dir, &gpui_shell::FrozenComponentRegistry::default()).unwrap();
    let read = |path: PathBuf| std::fs::read_to_string(path).unwrap_or_default();

    let typed = Tree::new();
    typed.write("main.ts", "");
    write(&typed.0);
    assert!(read(typed.0.join("tsconfig.json")).contains("\"exactOptionalPropertyTypes\": true"));
    assert!(!typed.0.join("jsconfig.json").exists(), "a TypeScript mod gets tsconfig.json alone");

    // An installed mod's jsconfig.json from before TypeScript: generated, so upgraded.
    let plain = Tree::new();
    plain.write("main.js", "");
    plain.write("jsconfig.json", include_str!("../../tests/fixtures/jsconfig-0.7.1.json"));
    write(&plain.0);
    assert!(read(plain.0.join("jsconfig.json")).contains("\"allowImportingTsExtensions\": true"));
    assert!(!plain.0.join("tsconfig.json").exists());

    // The same, converted to TypeScript: the strict tsconfig.json beside it.
    std::fs::rename(plain.0.join("main.js"), plain.0.join("main.ts")).unwrap();
    write(&plain.0);
    assert!(read(plain.0.join("tsconfig.json")).contains("\"noUncheckedIndexedAccess\": true"));

    // An author's own jsconfig.json is theirs: nothing is added over it.
    let own = Tree::new();
    own.write("main.ts", "");
    own.write("jsconfig.json", "{ \"compilerOptions\": { \"checkJs\": false } }\n");
    write(&own.0);
    assert_eq!(read(own.0.join("jsconfig.json")), "{ \"compilerOptions\": { \"checkJs\": false } }\n");
    assert!(!own.0.join("tsconfig.json").exists());
}
