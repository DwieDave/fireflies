//! Whether a working agent is waiting on a shell command it started.
//!
//! The 7501 word only says "working". Agents run their tool commands
//! (Claude Code's Bash, Codex's `bash -lc`, `hc wait` ...) as shell child
//! processes, so a shell under the agent's process that started with the
//! agent's current step (its 7501 message changed, or it started working)
//! means that step is a command still running. Shells started earlier (an
//! MCP server's wrapper, a dev server left in the background) belong to
//! older steps and don't count. Remote agents (`vps/t7`) can't be seen.

/// A process under the agent: its name and start, ms since the epoch.
#[derive(Clone, Debug, PartialEq)]
pub struct Proc {
    pub pid: u32,
    pub name: String,
    pub start_ms: u64,
}

/// A step's message can arrive after its command started (the app reads the
/// core every half second).
const SLACK_MS: u64 = 2000;
/// Quick commands (a grep) end before they're worth showing.
const MIN_AGE_MS: u64 = 1500;
/// Wrappers (`npx claude` → node) put the agent's shells a level or two lower.
const DEPTH: usize = 3;

fn is_shell(name: &str) -> bool {
    let name = name.trim_start_matches('-');
    let name = name.rsplit('/').next().unwrap_or(name);
    matches!(name, "sh" | "bash" | "zsh" | "fish" | "dash" | "ksh" | "nu" | "pwsh" | "powershell" | "cmd.exe")
}

/// The rule, over any process tree: a shell under `root`, started with the
/// step that began at `step_ms` and running for a moment.
pub fn waiting(children: impl Fn(u32) -> Vec<Proc>, root: u32, step_ms: u64, now_ms: u64) -> bool {
    let mut level = vec![root];
    for _ in 0..DEPTH {
        let mut next = Vec::new();
        for pid in level {
            for c in children(pid) {
                if is_shell(&c.name) && c.start_ms + SLACK_MS >= step_ms && now_ms.saturating_sub(c.start_ms) >= MIN_AGE_MS {
                    return true;
                }
                next.push(c.pid);
            }
        }
        if next.is_empty() {
            break;
        }
        level = next;
    }
    false
}

/// On this machine: the agent process `pid`.
pub fn running(pid: u64, step_ms: u64, now_ms: u64) -> bool {
    let Ok(pid) = u32::try_from(pid) else { return false };
    pid > 0 && waiting(children, pid, step_ms, now_ms)
}

#[cfg(target_os = "macos")]
fn children(pid: u32) -> Vec<Proc> {
    let mut pids = [0 as libc::pid_t; 256];
    let size = std::mem::size_of_val(&pids) as i32;
    let n = unsafe { libc::proc_listchildpids(pid as libc::pid_t, pids.as_mut_ptr().cast(), size) };
    if n <= 0 {
        return Vec::new();
    }
    pids[..(n as usize).min(pids.len())].iter().filter_map(|&p| info(p)).collect()
}

#[cfg(target_os = "macos")]
fn info(pid: libc::pid_t) -> Option<Proc> {
    let mut info = std::mem::MaybeUninit::<libc::proc_bsdinfo>::zeroed();
    let size = std::mem::size_of::<libc::proc_bsdinfo>() as i32;
    let read = unsafe { libc::proc_pidinfo(pid, libc::PROC_PIDTBSDINFO, 0, info.as_mut_ptr().cast(), size) };
    if read != size {
        return None;
    }
    let info = unsafe { info.assume_init() };
    let text = |chars: &[libc::c_char]| {
        let bytes: Vec<u8> = chars.iter().take_while(|c| **c != 0).map(|c| *c as u8).collect();
        String::from_utf8_lossy(&bytes).into_owned()
    };
    let name = Some(text(&info.pbi_name)).filter(|n| !n.is_empty()).unwrap_or_else(|| text(&info.pbi_comm));
    Some(Proc { pid: info.pbi_pid, name, start_ms: info.pbi_start_tvsec * 1000 + info.pbi_start_tvusec / 1000 })
}

#[cfg(target_os = "linux")]
fn children(pid: u32) -> Vec<Proc> {
    let listed = std::fs::read_to_string(format!("/proc/{pid}/task/{pid}/children")).ok();
    let pids: Vec<u32> = match listed {
        Some(s) => s.split_whitespace().filter_map(|p| p.parse().ok()).collect(),
        // Kernels without the children file: every process's parent.
        None => std::fs::read_dir("/proc")
            .into_iter()
            .flatten()
            .flatten()
            .filter_map(|e| e.file_name().to_str()?.parse::<u32>().ok())
            .filter(|p| stat(*p).is_some_and(|(_, ppid, _)| ppid == pid))
            .collect(),
    };
    let boot = boot_ms();
    pids.into_iter()
        .filter_map(|p| {
            let (name, _, ticks) = stat(p)?;
            // Clock ticks are 100 a second on every Linux Fireflies runs on.
            Some(Proc { pid: p, name, start_ms: boot? + ticks * 10 })
        })
        .collect()
}

/// A process's name, parent and start (clock ticks since boot).
#[cfg(target_os = "linux")]
fn stat(pid: u32) -> Option<(String, u32, u64)> {
    let s = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    let (open, close) = (s.find('(')?, s.rfind(')')?);
    let name = s[open + 1..close].to_owned();
    let rest: Vec<&str> = s[close + 1..].split_whitespace().collect();
    // After the name: state, ppid, ... starttime is field 22 overall (index 19 here).
    Some((name, rest.get(1)?.parse().ok()?, rest.get(19)?.parse().ok()?))
}

#[cfg(target_os = "linux")]
fn boot_ms() -> Option<u64> {
    let s = std::fs::read_to_string("/proc/stat").ok()?;
    let secs: u64 = s.lines().find_map(|l| l.strip_prefix("btime "))?.trim().parse().ok()?;
    Some(secs * 1000)
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
fn children(_pid: u32) -> Vec<Proc> {
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tree(procs: Vec<(u32, u32, &str, u64)>) -> impl Fn(u32) -> Vec<Proc> {
        move |parent| {
            procs
                .iter()
                .filter(|p| p.1 == parent)
                .map(|p| Proc { pid: p.0, name: p.2.into(), start_ms: p.3 })
                .collect()
        }
    }

    #[test]
    fn a_shell_started_with_the_step_is_a_running_command() {
        let t = tree(vec![(2, 1, "zsh", 10_000)]);
        assert!(waiting(&t, 1, 10_500, 15_000));
    }

    #[test]
    fn a_command_still_starting_is_not_shown_yet() {
        let t = tree(vec![(2, 1, "zsh", 10_000)]);
        assert!(!waiting(&t, 1, 10_000, 10_800));
    }

    #[test]
    fn shells_from_older_steps_dont_count() {
        // An MCP server's wrapper from the start, a dev server put in the background.
        let t = tree(vec![(2, 1, "sh", 1_000), (3, 1, "bash", 20_000)]);
        assert!(!waiting(&t, 1, 40_000, 60_000));
    }

    #[test]
    fn other_children_are_not_commands() {
        let t = tree(vec![(2, 1, "caffeinate", 10_000), (3, 1, "node", 10_000)]);
        assert!(!waiting(&t, 1, 10_000, 20_000));
    }

    #[test]
    fn shells_under_a_wrapper_count() {
        let t = tree(vec![(2, 1, "node", 1_000), (3, 2, "-bash", 10_000)]);
        assert!(waiting(&t, 1, 10_000, 20_000));
    }

    #[test]
    fn shell_names() {
        assert!(is_shell("/bin/zsh") && is_shell("-zsh") && is_shell("bash"));
        assert!(!is_shell("claude") && !is_shell("zshrc"));
    }

    #[cfg(any(target_os = "linux", target_os = "macos"))]
    #[test]
    fn sees_a_real_shell_child() {
        let mut child = std::process::Command::new("/bin/sh").args(["-c", "sleep 5; true"]).spawn().unwrap();
        let now = |off: u64| std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as u64 + off;
        let me = std::process::id();
        let found = children(me);
        let _ = child.kill();
        let _ = child.wait();
        let sh = found.iter().find(|p| p.pid == child.id()).expect("the shell is listed");
        assert!(is_shell(&sh.name), "{sh:?}");
        assert!(sh.start_ms.abs_diff(now(0)) < 5_000, "{sh:?}");
        assert!(waiting(tree_of(found), me, now(0) - 1_000, now(MIN_AGE_MS)));
    }

    #[cfg(any(target_os = "linux", target_os = "macos"))]
    fn tree_of(found: Vec<Proc>) -> impl Fn(u32) -> Vec<Proc> {
        let me = std::process::id();
        move |p| if p == me { found.clone() } else { Vec::new() }
    }
}
