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

/// One finding of `oxlint -c oxlint.size.json` as tests/mods_over_limits.txt
/// writes it: the path for a file over 750 lines, the path and the function's
/// name (`(anonymous)` without one) for a function over 80 code lines.
fn over_limit(diagnostic: &serde_json::Value) -> String {
    let file = diagnostic["filename"].as_str().unwrap_or_default();
    let message = diagnostic["message"].as_str().unwrap_or_default();

    if diagnostic["code"] == "eslint(max-lines)" {
        return file.to_string();
    }

    let name = message.split('`').nth(1).unwrap_or("(anonymous)");
    format!("{file} {name}")
}

/// The size ratchet (docs/mods-splitting.md): everything in the mods over the
/// limits is on tests/mods_over_limits.txt, and everything on it is still over.
/// The list only shrinks: a new large file or long function fails here, and so
/// does an entry that was split and not taken off.
#[test]
fn mods_stay_under_the_size_limits() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let Some(oxlint) = tool(root, "oxlint") else { return eprintln!("CI: the mods' size check is skipped") };
    let output = Command::new(oxlint)
        .current_dir(root)
        .args(["-c", "oxlint.size.json", "--format", "json", "defaults/mods"])
        .output()
        .unwrap();
    let report: serde_json::Value = serde_json::from_slice(&output.stdout)
        .unwrap_or_else(|error| panic!("oxlint -c oxlint.size.json: {error}\n{}", String::from_utf8_lossy(&output.stderr)));
    let mut found: Vec<String> = report["diagnostics"].as_array().unwrap().iter().map(over_limit).collect();
    let listed_text = std::fs::read_to_string(root.join("tests/mods_over_limits.txt")).unwrap();
    let mut listed: Vec<String> = listed_text
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .map(String::from)
        .collect();
    found.sort();
    listed.sort();

    let mut new = Vec::new();
    let mut gone = listed.clone();

    for entry in &found {
        match gone.iter().position(|l| l == entry) {
            Some(i) => {
                gone.remove(i);
            }
            None => new.push(entry.clone()),
        }
    }

    assert!(
        new.is_empty() && gone.is_empty(),
        "the mods' size limits (docs/mods-splitting.md, `node_modules/.bin/oxlint -c oxlint.size.json defaults/mods` shows the lengths):\n\
         over a limit and not on tests/mods_over_limits.txt (split it; the list never grows):\n  {}\n\
         on the list and no longer over (take these lines off tests/mods_over_limits.txt):\n  {}",
        new.join("\n  "),
        gone.join("\n  ")
    );
}
