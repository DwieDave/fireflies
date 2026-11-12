# Security and privacy

## Mods have your access

A mod is trusted JavaScript running inside Fireflies. It can run programs with your environment, fetch URLs and read files.
The built-in file API limits writes to the app home, but a mod can run a program to write elsewhere. That is not a security boundary.
Mods can also run programs on connected machines.

There is no permission prompt for each program or network request. Read a mod before installing it, and treat it like a shell script you would run yourself.
Layouts can load mods. Check those references too.

## What stays on disk

The default app home is `~/.config/herdr-app`, including on macOS and Windows (under your user home).
`XDG_CONFIG_HOME` changes the config root. `HERDR_APP_HOME` selects an app home directly and takes precedence.

This folder holds your settings, keys, layouts, mods, generated agent guide and API types.
It also holds mod data, shared state, window positions, this screen's focus and zoom, update notes and cached media.
Mods may store sensitive data here. Fireflies does not encrypt this folder.
The [installed guide's file map](../defaults/AGENTS.md#the-files) explains the files.

Spaces, tabs and splits are stored in each machine's core document, not in the app home.
Terminals and their output belong to [herdr-core](https://github.com/herdrdev/herdr-core).
Removing the app home does not stop the core or erase its data.

The app exposes a local control socket in its home so agents can inspect and drive the window.
Treat access to that home as access to the window and its commands.
Remote connections use SSH through the core.

## Updates and signing

Fireflies has no releases yet, and a build from source does not update itself.
The updater it keeps from Herdr serves Herdr's installed releases: it checks Herdr's release service, downloads an update, and checks its SHA-256 checksum against the release manifest before unpacking it.
The app switches to the downloaded version on quit.
Core updates are handled separately by the core's updater.

A checksum from the same service detects a damaged download; it is not an independent signature on the manifest.
The app does not verify a separate cryptographic signature on update manifests.

Herdr's release pipeline supports Apple Developer ID signing on macOS and Azure artifact signing on Windows when their credentials are configured.
Without them, packages can be unsigned or ad hoc signed.
On macOS the installer and updater verify certificate-signed bundles and preserve their signatures.
Apple notarization is tested separately; it is not required for publishing a release.
Do not assume every download is notarized or signed.

## Telemetry

Fireflies collects and sends no usage data: no reports, no install ID.
Earlier versions kept an install ID and unsent reports in a `telemetry` folder in the app home; Fireflies deletes it on start.
A `telemetry` key left in `settings.json` is ignored.

On its own, Fireflies only goes online for update checks (release info, notes and their media); mods and web panes make their own requests.
Feedback is not uploaded by Fireflies: Send feedback opens a prefilled GitHub issue on DwieDave/fireflies that you review and submit on GitHub.

[Back to Fireflies](../README.md)
