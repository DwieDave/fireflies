# Fireflies on iOS: UI/UX concept (nocturne)

Design only, no app code. Static pages, phone frames at 393x852, open from disk
in any browser; PNGs of every page in `shots/` (`./shoot.sh <page>` redraws one
with Playwright's headless Chromium, nothing installed). Features a to j are
those of `docs/ios-app.md`.

| Page | What it shows |
|---|---|
| `concept-a.html` | **The pick.** Night sky: home, a space's pane map, a terminal, git |
| `concept-b.html` | The alternative: machine map with a bottom dock, the same four screens |
| `a-panes.html` | Browser pane, GitHub, databases, k8s as touch mods |
| `a-terminal.html` | The terminal's keys: pad placement, folded, docked tray; the paged hotkey row |
| `a-reach.html` | Lock-screen notification and its long press, alerts, hosts with the VPN switch, first run |
| `a-states.html` | Empty, a machine out of reach, reconnecting, the reach and safe-area map |
| `flow.html` | Which screen leads where |

## The navigation model (concept A)

Home is nocturne's sidebar sky stretched to a phone: the clock and moon, the
count of who rests, works and needs you, then **every firefly on every machine,
ordered by need**, each with its machine tag. Machine chips under the sky filter
all / one machine, as the desktop sidebar's machine filter does.

Everything else is a **sheet over the sky**: spaces (the grabber at the bottom),
a space's pane map, a pane, a mod, alerts (the bell), hosts (the shield). One
axis of travel: deeper, or back to the sky with a swipe down. A notification
or a firefly row skips the stack and lands in its terminal.

Concept B (machines first, a five-place dock) is easier to learn and mirrors the
Mac's arrangement, but puts the agents that need you behind a badge and reads
more like a tool than like nocturne. A borrows B's best piece: the mods rail
(chips) at the top of a mod sheet.

## Gestures

- Tap a row: open it. Hold a row or pane: its actions, drawn where the thumb is.
- Swipe down on a sheet or the terminal's bar: back one level. Edge swipe: back.
- Swipe a git row right: stage; left: discard (asks).
- Swipe sideways on a space's tab chips: the next tab; on the hotkey row: its next page.
- Pane map: tap opens a pane full screen; hold: send keys, close, move to the dock.
- Terminal: drag the pad by its `::` grip; `‹` folds it to an edge nub; the pad's
  place is kept per device. Pinch in a log or diff: fit to width.
- Rotate the databases sheet: rows turn from cards into the desktop's grid.

## Keys, reach, safe areas

- **Hotkey row** above the keyboard, pages of six keys (54 px each): esc tab ctrl
  alt ⇧tab ~ | · ^C ^D ^R ^Z ^L ^A ^E · / - _ $ ` ' ". Ctrl latches for one chord,
  a hold locks it. The pad toggle ✥ is pinned at the row's right end, never paged away.
- **Pad** (arrows + Enter, a terminal-only thing): default place top right, over
  scrollback, never over the line being typed. With the keyboard down it docks
  into a tray at the thumb beside the six most used keys; that is how an agent's
  menu (↑↓ ⏎) is answered without the keyboard.
- **Reach**: the top third only shows (sky, clock, filters set once); rows start
  mid-screen; every action (grabber, +, commit, run, url bar, tray) sits in the
  bottom third. Nothing interactive in the 59 px top or 34 px bottom insets; the
  keyboard pushes a sheet's action bar up with it.

## Taken from desktop nocturne, and what changed

Kept as is: moonfly's colours and the status colours (working yellow, needs-you
pink, done green), Departure Mono, square corners, the 50% checker dither for
lit rows, plates and the scrim, the dithered moon and hills, the pixel agent
logos and the diamond pips (working breathes, blocked blinks), the blue edge of
the lit row, machine tags.

Changed for the phone:

- **The sidebar became the home screen**, the sky as tall as a third of it: on
  a phone the agents are the reason to open the app, not the panes.
- **Panes are shown one at a time**; the layout is a read-only map drawn to scale
  with a peek of each pane, because tiling a 393 px screen helps no one.
- **Rows are 52 to 56 px** (desktop: about 28), text 14 px, hit targets 44 px or more.
- **Actions moved to the bottom** (desktop: toolbars at the top); the URL bar too.
- **Dither is 1 CSS px** (3 device px), not 1 device px: at 460 ppi a device-pixel
  checker reads as flat grey. Animated dither runs only where it means something
  (pips), for the battery.
- **Notifications and the keyboard stay native** (system font, system look): they
  are iOS's surfaces, and nocturne inside them would read as a fake.
- **Web pages are the site's own**, no nocturne chrome inside the web view.
- Database rows become cards in portrait.

## Open questions for Developer

1. **A or B?** A is drawn out; B's four screens are there to compare.
2. **Replies from the lock screen** ("y" + Enter, esc to an agent without opening
   the app): allowed, and behind Face ID or not?
3. **Pane map: read-only, or edit too?** Closing a pane and moving it to the dock
   are drawn; splitting and resizing the Mac's panes from the phone are not.
4. **Which mods ship on the phone first?** Drawn: git, github, databases, k8s,
   alerts; files and usage are only in the flow.
5. **The hotkey row's pages**: are these the keys you reach for (esc, tab, ctrl,
   alt, ⇧tab, ~, |, then the ^ chords, then symbols)?
6. **Pairing**: a one-line `fireflies phone pair <code>` on the Mac (or a QR the
   desktop shows), with the phone's key in the Secure Enclave: right for you?
