//! Feedback goes to GitHub issues: a new-issue page prefilled with the
//! person's words and the versions, opened for them to read, add screenshots
//! and submit there. Herdr itself uploads nothing.

/// Where new issues are filed.
pub const ISSUES: &str = "https://github.com/DwieDave/fireflies/issues/new";
/// GitHub refuses longer new-issue links (about 8 KB); keep a margin.
const MAX_URL: usize = 7500;
const MAX_TITLE: usize = 80;
const SHORTENED: &str = "\n\n[shortened to fit in a link]";

/// What the page is prefilled with.
#[derive(Debug, PartialEq)]
pub struct Issue {
    pub title: String,
    pub body: String,
    pub url: String,
}

/// A release version (`0.2.0`, `0.2.0-rc.1`), else `other`: never a free string.
pub(crate) fn release_version(v: &str) -> String {
    let v = v.trim().trim_start_matches("hc ").trim_start_matches('v');
    let number = |s: &str| !s.is_empty() && s.len() <= 4 && s.bytes().all(|b| b.is_ascii_digit());
    let (core, pre) = v.split_once('-').map_or((v, None), |(c, p)| (c, Some(p)));
    let parts: Vec<&str> = core.split('.').collect();
    let pre_ok = pre.is_none_or(|p| {
        let (label, n) = p.split_once('.').map_or((p, None), |(l, n)| (l, Some(n)));
        matches!(label, "alpha" | "beta" | "rc" | "preview") && n.is_none_or(number)
    });
    if parts.len() == 3 && parts.iter().all(|p| number(p)) && pre_ok { v.to_owned() } else { "other".into() }
}

/// Percent-encodes everything but RFC 3986's unreserved characters.
fn encode(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for b in text.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

fn encoded_len(text: &str) -> usize {
    text.bytes().map(|b| if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') { 1 } else { 3 }).sum()
}

fn footer(from: &str, core: Option<&str>) -> String {
    let mut f = String::from("\n\n---\n");
    if from == "agent" {
        f.push_str("_Drafted by an agent._\n");
    }
    f.push_str(&format!("- Herdr: {}\n", env!("CARGO_PKG_VERSION")));
    f.push_str(&format!("- herdr-core: {}\n", core.map(release_version).unwrap_or_else(|| "unknown".into())));
    f.push_str(&format!("- OS: {} {}\n", std::env::consts::OS, std::env::consts::ARCH));
    f.push_str("\nScreenshots help: paste or drop them into this issue.");
    f
}

/// The new-issue page for `message`. The title is `title`, else the
/// message's first line; a long message is cut to keep the link working.
pub fn issue(title: &str, message: &str, from: &str, core: Option<&str>) -> Issue {
    let message = message.trim();
    let title = Some(title.trim()).filter(|t| !t.is_empty()).or_else(|| message.lines().next().map(str::trim)).unwrap_or_default();
    let title: String = match title.char_indices().nth(MAX_TITLE) {
        Some((i, _)) => format!("{}…", title[..i].trim_end()),
        None => title.to_owned(),
    };
    let footer = footer(from, core);
    let head = format!("{ISSUES}?title={}&body=", encode(&title));
    let room = MAX_URL.saturating_sub(head.len() + encoded_len(&footer));
    let mut kept = message.len();
    if encoded_len(message) > room {
        let room = room.saturating_sub(encoded_len(SHORTENED));
        let mut used = 0;
        kept = 0;
        for (i, c) in message.char_indices() {
            used += encoded_len(c.encode_utf8(&mut [0; 4]));
            if used > room {
                break;
            }
            kept = i + c.len_utf8();
        }
    }
    let shortened = if kept < message.len() { SHORTENED } else { "" };
    let body = format!("{}{shortened}{footer}", &message[..kept]);
    let url = format!("{head}{}", encode(&body));
    Issue { title, body, url }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn decode(text: &str) -> String {
        let bytes = text.as_bytes();
        let mut out = Vec::new();
        let mut i = 0;
        while i < bytes.len() {
            if bytes[i] == b'%' {
                out.push(u8::from_str_radix(&text[i + 1..i + 3], 16).unwrap());
                i += 3;
            } else {
                out.push(bytes[i]);
                i += 1;
            }
        }
        String::from_utf8(out).unwrap()
    }

    #[test]
    fn the_page_holds_the_message_and_versions() {
        let i = issue("", "  Tabs flicker\nwhen I resize & drag  ", "agent", Some("hc 0.4.2"));
        assert_eq!(i.title, "Tabs flicker");
        assert!(i.body.starts_with("Tabs flicker\nwhen I resize & drag\n\n---\n"), "{}", i.body);
        for part in ["Drafted by an agent", concat!("- Herdr: ", env!("CARGO_PKG_VERSION")), "- herdr-core: 0.4.2", std::env::consts::OS, "Screenshots"] {
            assert!(i.body.contains(part), "{part}: {}", i.body);
        }
        let (head, query) = i.url.split_once('?').unwrap();
        assert_eq!(head, ISSUES);
        let (title, body) = query.strip_prefix("title=").unwrap().split_once("&body=").unwrap();
        assert_eq!((decode(title), decode(body)), (i.title.clone(), i.body.clone()));
        assert_eq!(i.url.matches('&').count(), 1);
        assert!(!i.url.contains([' ', '\n', '#']), "{}", i.url);
    }

    #[test]
    fn a_given_title_wins_and_long_titles_are_cut() {
        assert_eq!(issue("Crash on quit", "details", "person", None).title, "Crash on quit");
        assert!(issue("", "details", "person", None).body.contains("- herdr-core: unknown"));
        assert!(!issue("", "details", "person", None).body.contains("agent"));
        let long = issue(&"t".repeat(200), "x", "person", None).title;
        assert_eq!(long.chars().count(), MAX_TITLE + 1);
    }

    #[test]
    fn long_messages_are_shortened_to_fit_a_link() {
        for c in ["a", "ü", "😀", "a &"] {
            let i = issue("", &c.repeat(20_000), "person", Some("0.1.0"));
            assert!(i.url.len() <= MAX_URL, "{c}: {}", i.url.len());
            assert!(i.body.contains("[shortened to fit in a link]") && i.body.contains("- OS:"), "{c}");
        }
        let short = issue("", "fine", "person", None);
        assert!(!short.body.contains("shortened"));
    }

    #[test]
    fn versions_are_releases_or_other() {
        assert_eq!(release_version("0.2.0"), "0.2.0");
        assert_eq!(release_version("hc 0.1.5"), "0.1.5");
        assert_eq!(release_version("0.2.0-rc.1"), "0.2.0-rc.1");
        assert_eq!(release_version("0.2.0-my/secret path"), "other");
        assert_eq!(release_version("hc 0.1.5-acmeclient"), "other");
        assert_eq!(release_version("0.1.5-rc.x"), "other");
        assert_eq!(release_version("dev"), "other");
    }
}
