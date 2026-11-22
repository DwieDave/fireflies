# The Fireflies iOS app: what is feasible, and the proof that GPUI draws there

The evaluation Developer asked for on 2026-11-22 (features a to j of his scratchpad task), the pieces an own iOS backend for `vendor/gpui-pre-apple` needs, and the result of the smallest proof (its code is in `prototypes/ios-mvp` and `vendor/gpui-pre-apple/src/ios`).

The UI concept Developer picked on 2026-11-22 (concept A, the night sky) is in [prototypes/ios-concept](../prototypes/ios-concept/README.md); the simulator screenshots are in [ios-app/](ios-app/).

| # | Feature (Developer's words, shortened) | Feasible | How | What is possible if not fully | Compromises |
|---|---|---|---|---|---|
| a | View terminals via a bundled Ghostty lib | yes | libghostty-vt cross-compiled for iOS (vendor/ghostty `GhosttyLibVt.zig` has `ios`/`ios_simulator` targets); the same path desktop uses (`crates/ghostty-sys` builds `-Demit-lib-vt` and draws cells itself); bytes from herdr-core over SSH (russh or libssh2 in-process) | — | Full libghostty (its Metal renderer, Surface) refuses iOS (`src/build/Config.zig:132`): we draw the grid ourselves, as on desktop |
| b | Layout of panes on my machines, one pane at a time | yes | `herdr-app ls` (spaces > tabs > terminals, pane IDs) and the layout documents read over SSH; phone shows a tree/minimap, tap opens one pane full-screen | — | Read-only layout on the phone (resizing/splitting the Mac's panes from it is extra work); spaces only when Fireflies runs on that machine (herdr.dev/mobile says the same for Herdr) |
| c | Browser windows, as if on that machine | yes (Developer accepts: same environment, session not shared) | Local `WKWebView` on the phone opening the pane's URL; `localhost:port` rewritten to an in-app SSH `-L` tunnel or the VPN address | — | Own cookies/logins on the phone (separate `WKWebsiteDataStore`), no CEF: accepted |
| d | Bundled mods with touch-optimized UI (mods code extended) | yes (Developer accepts: files and processes over SSH) | Mods already build GPUI element trees in TS on QuickJS (`defaults/AGENTS.md` "UI"); on iOS GPUI the same `main.ts` runs; core already turns taps into clicks and pans into scrolls (`gestures.rs`); add a form-factor flag + bigger hit targets to the mod API (core change: AGENTS.md three questions); a mod's disk/exec calls go to the machine over SSH | — | Mac-only mods (native browser/CEF, pip, lazygit) drop or degrade; QuickJS JIT tier off on iOS (no executable memory for App Store apps, from memory): interpreter only, slower |
| e | Mods bundled into the iOS app to share code | yes | Embed `defaults/mods` + `defaults/lib` like desktop does; App Store 2.5.2 allows interpreted code shipped in the bundle (from memory) | — | Only if the app is GPUI (mods emit GPUI trees); in a SwiftUI app shared code is limited to TS logic, every view rewritten; no installing new mods at runtime under App Store rules (fine via TestFlight/own builds) |
| f | Nocturne + basic herdr-inspired themes | yes | `@fireflies/look`, `layout-look`, `tones` are mod libs: run as is under GPUI-on-iOS | — | SwiftUI route: re-implement tokens in Swift and keep them in sync by hand |
| g | Nocturne dithered theme (touch-friendly) + Themeable task's default theme | yes (Developer accepts phone layouts as new design work) | `dither()` (`defaults/mods/nocturne/kit.ts`) is GPUI elements: renders on iOS Metal; new phone-width layouts for nocturne's dock/header/dialogs | — | Default theme depends on the Themeable task landing (not checked); dither redraws cost battery, tune frame rate |
| h | Native notifications with icon, machine, agent title, message | yes | APNs `.p8` key from his account; a small sender on each machine (a mod or `bin/` script watching herdr-core agent states) POSTs to APNs HTTP/2 directly: no third-party server; Notification Service Extension + communication notification (`INSendMessageIntent`) shows the agent/machine icon (from memory); tap opens that pane | — | A machine that sleeps or is offline sends nothing; the APNs key lives on his machines; Pushover becomes redundant |
| i | Toggleable floating arrow/Enter pad for terminals, repositionable | yes | In-app: a draggable floating pad (arrows + Enter) over terminal panes, sending the escape sequences to the terminal; toggled from the `inputAccessoryView` hotkey row or a toolbar; position kept per device; hardware keyboard via `UIKeyCommand`/`pressesBegan` | — | Terminal panes only (other panes are touch-optimized instead); no system keyboard extension (not asked) |
| j | Local host (homelab.local) + WireGuard on cellular, auto-switch, VPN native in-app | yes | Packet Tunnel Provider extension (his account grants the Network Extension entitlement) with WireGuardKit (wireguard-apple); `NETunnelProviderManager.onDemandRules`: `NEOnDemandRuleConnect` on `.cellular`, `NEOnDemandRuleDisconnect` on Wi-Fi `ssidMatch` home: iOS switches by itself, no WireGuard app; per-host profile {local addr, VPN addr}, picked by `NWPathMonitor` + a quick probe of the local name | — | iOS runs one VPN at a time: replaces Tailscale/WireGuard app while on; `.local` mDNS only on home Wi-Fi; the tunnel carries the whole phone's traffic to the home subnets you route (split tunnel via AllowedIPs) |
| k | Mosh for terminals, bundled, SSH fallback (roams Wi-Fi ↔ cellular, survives sleep) | yes | Phone: a mosh client library (Blink's blinksh/mosh, GPL-3.0; or mosh-go, MIT, see below); machine: `mosh-server` bundled in the desktop app and the Linux CLI build, run as `fireflies mosh-server new -- fireflies attach <t>` over the app's SSH session, then UDP; mosh-client's screen output feeds libghostty-vt; if mosh fails the same `fireflies attach <t>` runs over an SSH pty | — | GPL: the iOS app's source offered under GPLv3 if it links Blink's library; no mosh scrollback (history from herdr-core over SSH); one machine address per session (mosh roams the phone's address, not the machine's: from memory); macOS firewall may ask once, Linux firewalls need UDP opened (root, once); one mosh-server and UDP port per open terminal |

**Mosh (k) beside the rest:** mosh carries a terminal's screen state only (its own protocol, predicted local echo, roaming client), so it suits the terminal panes and nothing else; the mods' channel (`fireflies serve --stdio`, docs/ios-mods-over-ssh.md) stays on SSH, and over the WireGuard tunnel its TCP survives a Wi-Fi ↔ cellular move because the tunnel keeps the inner addresses (a longer drop: reconnect, resubscribe, replay by id). Recommended: mosh for terminals now (proven on iOS by Blink, already served by his machines, `hc attach` is a plain pty program, reasoned, not run under mosh here), scrollback fetched from herdr-core; not our own prediction protocol, which would rebuild mosh. From memory: mosh's server follows the client's newest authenticated address but the client never changes the server's; predicted echo and the UDP port range; unchecked: whether `fireflies attach` draws well inside mosh's terminal (mosh's own emulator sits between).


### Mosh: bundling, fallback, license

Developer's words: "I want it bundled (not need to install anything ideally
besides desktop app and ios app)"; "Terminal only via mosh with a ssh
fallback if mosh doesnt work"; "what about the licensing? … Or can we load it
as a bundle similiar to chromium?" License lines are this agent's reading of
the texts, **not legal advice**.

| question | answer | known / guessed |
|---|---|---|
| ship mosh-server in the desktop app | yes: a separate executable in the bundle (macOS `Contents/MacOS/`, Linux beside the CLI), started as `fireflies mosh-server …` (src/cli.rs routes a word to a binary as it routes `core`), so nothing is on PATH; the phone's bootstrap runs `~/.local/bin/fireflies mosh-server new -c 256 -- fireflies attach <t>` by path | route: read in src/cli.rs; the CLI link's location: core_bin.rs `install_cli_link` |
| its dependencies | protobuf, ncurses (terminfo), zlib, OpenSSL or nettle (mosh build docs; buildroot picks either) | known |
| self-contained | Linux: static with musl works in practice (dtinth/mosh-static; Blink publishes static server builds); macOS: protobuf/ncurses/zlib/crypto static, libSystem dynamic (macOS has no fully static binaries); a nix derivation beside modules/herdr-app.nix's | Linux known; macOS link and size guessed (a few MB, protobuf dominates) |
| UTF-8 locale | mosh-server refuses a non-UTF-8 locale: the wrapper sets `LC_ALL=C.UTF-8` (Linux) / `en_US.UTF-8` (macOS) | from memory |
| a Linux server with only herdr-core + CLI | distribution/install.sh installs the app and, if missing, the core (into `~/.local/bin`); a CLI-only install that carries `mosh-server` too is new | install.sh read; the CLI-only path is a proposal |
| not zero-setup: sshd | needed for the bootstrap and the fallback: Remote Login on macOS, sshd on Linux | known |
| not zero-setup: macOS firewall | off by default; when on, an incoming-connection prompt per binary, once; "automatically allow signed software" should cover a Developer-ID-signed helper inside our signed app; `socketfilterfw --add` needs root (practice; Apple's docs don't say), so no silent pre-authorisation | Apple docs for the prompt and the signed option; helper/UDP coverage and sudo guessed |
| not zero-setup: Linux firewall | ufw/firewalld must allow UDP 60000–61000, or one fixed port (`-p 60001`); root, once | known |

| fallback step (phone) | how |
|---|---|
| 1. show the terminal at once | open `fireflies attach <t>` over an SSH pty channel first (it is the same herdr-core terminal either way, attach only views it: nothing is lost on a switch) |
| 2. start mosh beside it | `fireflies mosh-server new …` over the same SSH session; a missing binary, a non-zero exit or no `MOSH CONNECT <port> <key>` line within 5 s: stay on SSH ("mosh: no server") |
| 3. the UDP handshake is the probe | no separate probe: no authenticated reply within 3 s → stay on SSH ("mosh: UDP blocked"), kill that mosh-server over SSH (it prints its pid) |
| 4. upgrade | first reply: swap the pane's stream to mosh, close the SSH pty; remember the result per network (SSID or cellular) for an hour |
| what Developer sees | the pane opens immediately; a small `SSH` or `mosh` mark in its corner; the reason in the pane's menu with "try mosh again" |
| versions | both ends from our builds at one pinned mosh version; a system mosh-server on PATH is never used |

| license question | reading |
|---|---|
| a) desktop, mosh-server beside the app | an aggregate (GPLv3 §5): Fireflies stays Apache-2.0. Duties: mosh's GPLv3 text and copyright notices in the bundle; its corresponding source at the exact version (tag + our build recipe and patches) offered for as long as we ship it (§6, a link we host); a `licenses/inventory.json` component and `licenses/mosh-COPYING.txt`, its static deps' notices (protobuf BSD-3, ncurses MIT-style, zlib, OpenSSL Apache-2.0 or nettle LGPL) in THIRD-PARTY-NOTICES, `tests/notices.rs` then checks them in full; mosh's OpenSSL exception covers the OpenSSL link |
| b) iOS, Blink's client library linked in | the app binary becomes one GPLv3 work: its complete corresponding source (our Rust, Swift, build scripts, vendored crates) offered under GPLv3; our files keep their Apache-2.0 headers (Apache-2.0 code may go into a GPLv3 work); every linked piece must be GPLv3-compatible: libghostty-vt MIT, WireGuardKit MIT, quickjs-jit MIT, Effect MIT, the vendored GPUI crates Apache-2.0 (`vendor/gpui-pre*/Cargo.toml`, `LICENSE-APACHE`): all fine; herdr-core is not in the iOS app (it runs on the machine) |
| b) App Store / TestFlight | mosh's COPYING.iOS: its copyright holders "committed not to pursue any license violation that results solely from the conflict between the GPLv3" and Apple's terms, "as long as you comply with the GPL in all other respects" (source and license text). It binds only mosh's holders: no other GPL code may enter the app |
| c) download at first use, like CEF | desktop: we would still convey mosh (our URL, our pick of version): same duties, only moved; a few MB saved against CEF's hundreds, and a download step is the opposite of "nothing to install": not worth it. iOS: closed. App Review 2.5.2 forbids downloading executable code, and iOS only maps code signed into the app bundle (from memory) |
| d) no GPL in the iOS app | **mosh-go** (github.com/unixshells/mosh-go, MIT): pure Go client and server, says it is wire-compatible (AES-128-OCB3, SSP); on iOS through gomobile's c-archive (a Go runtime in the app); young, maturity unknown. It could also be the bundled server (one static Go binary per platform, none of protobuf's linking pain). **moshpit** (Rust, MIT/Apache-2.0): its own protocol and key auth, not mosh-compatible; fine since we ship both ends, but young. A client out of process: impossible on iOS (no helper processes). Our own roaming transport: rebuilding SSP (UDP, OCB, screen-state sync, predicted echo, roaming): weeks to months |

**Recommendation:** bundle C mosh-server in the desktop app and a CLI-only
Linux build (aggregation, notices, source link), with the SSH-first,
mosh-upgrade fallback above. On the phone, Blink's library if the iOS app's
source may be public under GPLv3 (fewest unknowns; the fork is public
already); otherwise mosh-go, after a test that it talks to C mosh-server.

**Developer's decisions:** the iOS app's source public under GPLv3, or
mosh-go to avoid it; C mosh-server or mosh-go as the bundled server; a fixed
UDP port or the 60000–61000 range; whether a CLI-only Linux install is
wanted; accepting one macOS firewall prompt (his nix config pre-allows the
nix mosh-server today).

**Own minimal iOS backend for vendor/gpui-pre-apple** (the core in `vendor/gpui-pre` already speaks mobile: `Touch(TouchEvent)`, `LongPress`, `TouchDrag`, `Pinch` inputs; a portable gesture arena in `gestures.rs` turning tap into `ClickEvent::Touch` and pan into `ScrollWheelEvent`; `AppLifecyclePhase`, `insets()`, `show_soft_keyboard()`, `on_memory_warning` in `platform.rs` with their iOS mapping documented. Missing is only the platform crate.)

| Piece | What exists in our snapshot | What we must write | What Fireflies can leave out | Take from the ports |
|---|---|---|---|---|
| Renderer + atlas | `gpui-pre-apple/src/metal_renderer.rs`, `metal_atlas.rs` (`cfg(target_os = "ios")` paths already) | Hand it a `CAMetalLayer` from our view; drawable size on rotation | — | Nothing (gpui-mobile renders through `gpui_wgpu`, a second renderer we don't want) |
| Dispatcher / executors | `gpui-pre-apple/src/dispatcher.rs` (GCD) | Swap `NSActivityOptions` in `AppleActivity` for `beginBackgroundTask`/`isIdleTimerDisabled` | Idle-sleep prevention beyond the screen | — |
| Window = `UIWindow` + root `UIViewController` + `UIView` (`PlatformWindow`) | macOS `window.rs` (4139 lines, AppKit) as a model only | One full-screen window: bounds, scale, appearance (`traitCollection`), `on_request_frame`/`on_resize`/`on_input`/`draw` callbacks | Multiple windows, titlebar, tabs, fullscreen, minimize/zoom, decorations, traffic lights, drag-out, window state restore | `ios/window.rs` view-controller wiring |
| Frame clock | macOS `display_link.rs` (CVDisplayLink) | `CADisplayLink` on the main run loop, ProMotion `preferredFrameRateRange` | — | Their display-link glue |
| Touch → events | Gesture arena + `TouchEvent` in core | `touchesBegan/Moved/Ended/Cancelled` → `PlatformInput::Touch` with ids; trackpad/mouse on iPad via `UIHoverGestureRecognizer` → `MouseMove` | Pressure, force touch | `ios/` touch translation |
| Text input / IME | `PlatformInputHandler`, `set_text_input_configuration`, `text_input_state_changed` in core | A `UIView` adopting `UITextInput` (marked text, selection rects, `insertText`, `deleteBackward`) bridging to the input handler; `inputAccessoryView` hook for row i | Dictation, autocorrect tuning, character palette | Their `UITextInput` adapter: the hardest piece, take as much as works |
| Hardware keyboard | macOS `keyboard.rs` (Carbon layouts) | `pressesBegan/Ended` (`UIKey.keyCode`, modifiers) → `KeyDown/KeyUp`; trivial `PlatformKeyboardLayout`/`Mapper` | Layout-change notifications, dead-key edge cases | — |
| Safe areas + keyboard insets | `insets()`/`on_insets_changed` in core | `safeAreaInsets` + `keyboardWillChangeFrame` → `WindowInsets` | Inset animation curves | — |
| App lifecycle | `on_app_lifecycle`, `AppLifecyclePhase` in core | `UIApplicationMain` + scene delegate → phases; drop the Metal drawable in background; `on_memory_warning` | Quit/restart, reopen, dock menu, menus, jump lists, activation policy | Their `UIApplicationMain` bootstrap from Rust |
| Text system | macOS `text_system.rs` (CoreText + font-kit, one `cocoa` import) | Port to iOS (CoreText is there): replace the `cocoa::appkit::CGFloat` import, bundle fonts (nocturne ships its own) | System font enumeration UI | — |
| Clipboard | macOS `pasteboard.rs` (NSPasteboard) | `UIPasteboard` strings (+ images if wanted) | Primary selection, find pasteboard | — |
| Displays | macOS `display.rs` | One `UIScreen` display | Multi-display, screen capture | — |
| Rest of `Platform` | — | `open_url` (`UIApplication.open`), credentials via Keychain (SSH keys!), `app_path` = bundle | Path prompts (or `UIDocumentPicker` later), reveal/open-with, menus, cursor styles, system notifications (h goes through APNs), accessibility (later) | — |

**Own backend, not a port:** the gesture, inset and lifecycle work already sits in our core; what's left is roughly the size of macOS's `window.rs` + `events.rs` minus desktop windowing, drawn with the Metal renderer we already ship. gpui-mobile runs its own wgpu renderer against unpublished upstream crates, and Glass-HQ/gpui is a whole fork; so we copy their `UITextInput` and bootstrap code rather than depend on either.

- **The decision:** "GPUI/Swift" means GPUI on iOS through that own platform crate, with Swift for the edges (Packet Tunnel extension, Notification Service extension, accessory/floating keys if UIKit is easier there). A SwiftUI app with Rust/Zig libraries keeps a, b, c, h, i, j, k but loses d, e, f, g as shared code.
- **Risk 1:** `UITextInput` + terminal input (IME, selection, Ctrl chords) is the piece most likely to eat weeks.
- **Risk 2:** mods assume they run beside the machine they act on; on the phone each file/exec call needs an SSH-backed path.
- **Risk 3:** none left from the account: his paid membership covers the Network Extension entitlement, APNs keys, TestFlight and his own builds. What remains is App Review if he ever ships publicly (bundled JS mods, VPN apps need an organisation account for the App Store, from memory).
- **Not checked:** Zed PR #43655's state and whether Zed plans an official `gpui_ios`; Glass-HQ's renderer; `NEOnDemandRuleInterfaceType.cellular` (from memory); quickjs-jit's interpreter-only build; the Themeable task; herdr-core's remote protocol beyond `ls`.

## ios-mvp: GPUI draws and takes taps on the iOS Simulator (branch feat/ios-mvp, not merged)

**Screenshot:** `ios-app/ios-mvp-3-text-five-taps.png` (also `ios-mvp-1-elements.png` with no taps, `ios-mvp-2-three-taps.png`), iPhone 18 Pro, iOS 27.0.

**Run it** (absolute paths, from any folder):
1. `/Volumes/data/coding/fireflies-wt/ios-mvp/prototypes/ios-mvp/build.sh` (nix toolchain from `toolchain.nix`, cargo for `aarch64-apple-ios-sim`, swiftc, ad-hoc codesign)
2. `xcrun simctl boot FB0DE3E0-C039-4EA1-8FC2-3F027DC1DD33; xcrun simctl install booted /Volumes/data/coding/fireflies-wt/ios-mvp/prototypes/ios-mvp/target/FirefliesMVP.app && xcrun simctl launch booted dev.fireflies.ios-mvp -taps 5` (`open -a Simulator` to watch and tap it yourself)
3. `xcrun simctl io booted screenshot shot.png && xcrun simctl shutdown booted`

**Works:** our `vendor/gpui-pre` core and `gpui-pre-apple`'s Metal renderer, unchanged, draw a full-screen GPUI view in a UIKit `CAMetalLayer` view (layout, rounded boxes, colours, CoreText text in Helvetica Neue); `CADisplayLink` drives frames; touches go `touchesBegan/Ended` → `ffm_touch` → `PlatformInput::Touch` → the core's gesture arena → `on_click`, which raises the counter and redraws. New code: `vendor/gpui-pre-apple/src/ios/` (platform, window, host entry points, text system copied from gpui-pre-macos with three imports changed), all `cfg(target_os = "ios")`; `prototypes/ios-mvp/` (Rust staticlib with the view, Swift host `host/main.swift` with the UIScene lifecycle iOS 27 demands). The Mac app `cargo check`s clean; `Cargo.lock` gains only the iOS-only dependencies.

**Faked:** the taps in the screenshots are injected by the `-taps N` launch argument through the same `ffm_touch` path real touches take (simctl has no headless tap); a real finger in Simulator.app or on a phone is untested. Shaders compile at runtime (`runtime_shaders`) because Xcode's Metal Toolchain component is not installed. Clipboard is in memory, appearance fixed to dark, one display, no window resize test (rotation path written, not exercised).

**Not done / walls hit:** no text input, keyboard, IME, safe-area insets (the status bar draws over the view), lifecycle/background handling, real device build or signing. Two walls cleared on the way: iOS 27 aborts apps without the scene lifecycle; the `io-surface` crate drags in macOS-only OpenGL symbols (linked with `-dead_strip`).

**Installed:** iOS 27.0 Simulator runtime (7.5 GB, on the boot disk at `/System/Library/AssetsV2/...`, kept per Developer; a copy of the download at `/Volumes/data/coding/ios-runtime`); simulator device data ~220 MB under `~/Library/Developer/CoreSimulator/Devices/FB0DE3E0-…`; Rust 1.95 with the iOS std in the nix store (`prototypes/ios-mvp/.rust`). Nothing in `~/.rustup`.

## Effect mods on iOS: they run (branch feat/ios-mvp, integrate merged in)

**Screenshot:** `ios-app/ios-mvp-4-effect-mod.png`: the MVP view with an Effect-written mod's panel drawn by GPUI ("decoded nocturne, busy true", "caught DecodeError") and "effect + kit + mod loaded in 490 ms".

1. **The engine compiles for `aarch64-apple-ios-sim`:** gpui-shell with its default `quickjs` feature, i.e. quickjs-jit, the JIT runtime (`vendor/quickjs-jit-runtime`, `compiler` feature) and the LLRT stdlib facade. Two fixes, both prototype-only: quickjs-jit-sys ships no prebuilt bindings for iOS, so its `bindgen` feature generates them (Xcode's libclang, `LIBCLANG_PATH` in build.sh); `gpui-pre-platform`'s `current_platform` had no iOS branch, so `prototypes/ios-mvp/patches/gpui-pre-platform` adds one returning `IosPlatform`. The JIT compiles and links; whether it emitted machine code on the simulator was not measured. On a device App Store apps get no executable memory (from memory), so there it must run as the interpreter.
2. + 3. **One Effect mod, the real path:** `defaults/lib` (effect@4 bundle, `effect/http`, `@fireflies/kit` and the other libraries) is copied into the app and served through `gpui_shell::library_modules::export_libraries`, as `src/mods.rs` does; `ShellRuntime::new` → `load_application(mod, "main.ts")` → `mount_application` gives a `ScriptView` the MVP view embeds. The mod (`prototypes/ios-mvp/mod/main.ts`, TypeScript blanked by the engine) builds `modRuntime(Layer.empty)` from the kit, runs an `Effect.gen` with two `decodeJson(Schema.Struct …)` decodes, one failing and caught with `Effect.catch`, and renders the result with gpui-kit's `div()`. Load time for effect + kit + mod: 490 ms on the simulator, debug build (docs/effect-mods.md measured 0.4 s for the first mod on the desktop, also debug).

**Real:** GPUI, the Metal renderer, gpui-shell's QuickJS engine with its TextEncoder and library modules, the Effect bundle, @fireflies/kit's runtime and Schema helpers, the mod loader. **Stubbed or left out:** the app's `herdr` host module (so the usage pilot itself was not run: it imports `herdr`, `@fireflies/kit/live` and `@fireflies/usage-limits`); the mod is a stand-in. No mod settings, storage path or capabilities were set beyond gpui-shell's defaults.

**Verdict:** Effect mods run on iOS: yes, with the app's `herdr` module still to provide (over SSH to the machine) and the JIT to be off on a device.
