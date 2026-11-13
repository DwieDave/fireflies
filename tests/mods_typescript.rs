//! The shipped mods' TypeScript at Developer's bar (docs/mods-typescript.md):
//! `tsc -p defaults/tsconfig.json` (every .ts file, at full strictness, against
//! the typings this binary writes with `herdr-app types`) and `oxlint` with
//! anti-slop (oxlint.config.ts). The same as `just typecheck` and `just lint`.
//! The tools are the exact versions in package.json, installed by
//! `bun install --frozen-lockfile` when node_modules lacks them. CI has no bun
//! there and skips these.
use std::path::Path;
use std::process::Command;

fn tool(root: &Path, name: &str) -> Option<std::path::PathBuf> {
    let path = root.join("node_modules/.bin").join(name);
    if !path.is_file() {
        match Command::new("bun").args(["install", "--frozen-lockfile"]).current_dir(root).output() {
            Ok(installed) => assert!(installed.status.success(), "bun install: {}", String::from_utf8_lossy(&installed.stderr)),
            Err(_) if std::env::var_os("CI").is_some() => return None,
            Err(error) => panic!("the mods' TypeScript checks need bun (to install package.json's tools): {error}"),
        }
    }
    Some(path)
}

fn passes(command: &mut Command, what: &str) {
    let output = command.output().unwrap();
    assert!(
        output.status.success(),
        "{what} failed:\n{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
fn shipped_typescript_mods_type_check() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let Some(tsc) = tool(root, "tsc") else { return eprintln!("CI: the mods' type check is skipped") };
    let types = root.join("target/mod-types");
    passes(Command::new(env!("CARGO_BIN_EXE_herdr-app")).arg("types").arg(&types), "herdr-app types");
    passes(Command::new(tsc).arg("-p").arg(root.join("defaults/tsconfig.json")).arg("--pretty").arg("false"), "tsc -p defaults/tsconfig.json");
}

#[test]
fn shipped_typescript_mods_lint() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let Some(oxlint) = tool(root, "oxlint") else { return eprintln!("CI: the mods' lint is skipped") };
    passes(Command::new(oxlint).current_dir(root).args(["--deny-warnings", "defaults/mods", "defaults/frame"]), "oxlint defaults/mods defaults/frame");
}
