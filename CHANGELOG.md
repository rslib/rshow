# Changelog

Notable changes to rshow, the CLI and the Worker it ships.
The format follows [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/), and rshow uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.0.8] - 2026-11-07

### Changed

- Teach agents to link themes as `@latest`, so a theme fix reaches their pages with no republish.

### Added

- Add `rshow delete <slug> --version <n>` and a delete button on each version.
  A public version can stay visible for up to 5 minutes after the delete.
- Add `/_themes/<name>@latest/`, which follows the current theme version.

### Fixed

- Stop `rshow delete` from removing a theme that pages link to, unless you pass `--force`.

## [0.0.7] - 2026-11-05

### Added

- Add LaTeX math to pages and decks with KaTeX, written as `<span class="math">` or `<div class="math">`, and make `rshow check` report bad LaTeX.

### Fixed

- Fix text in a deck that could not be selected or copied, because a click or a drag on it moved to the next slide.
- Fix the deck address that kept an old slide number after quick key presses, which in Safari could send the deck back to an old slide.

## [0.0.6] - 2026-10-31

### Changed

- Ship each release binary as `rshow-<target>.tar.gz` with its completions, and make the curl installer set up completions for bash, zsh and fish.

### Added

- Add `rshow completion bash|zsh|fish` to print a shell completion script.
- Add keyboard control to mockups: pan with w, a, s, d or the arrows, jump between screens with [ and ], open one with Enter, pick a state with 1 to 9 and press ? for the list.

### Fixed

- Fix the curl installer telling Linux users to set RSHOW_TOKEN, since `rshow login` works there.
- Fix the state buttons above a mockup screen, which did not take a click on the canvas.
- Fix the admin web app on a phone.
  The search box no longer covers the page, each artifact shows as a card and the menu fits on one row.
- Fix decks, mockups and terminals on a phone.
  An upright phone reads a deck as a page of slides at readable sizes, a mockup opens one screen at a time and a terminal scrolls inside its frame.

## [0.0.5] - 2026-10-31

### Changed

- Let agents add their own layouts and inline CSS on top of the theme, such as a new deck layout or a mockup part the kit lacks.
  The skills still require theme tokens so dark mode and theme swaps keep working.

## [0.0.4] - 2026-10-31

### Fixed

- Fix `rshow login` on a Linux keyring that cannot store a secret.
  rshow now warns and keeps the token in `~/.config/rshow/credentials` with mode 600.

## [0.0.3] - 2026-10-31

### Changed

- Make `rshow doctor` name where the token came from, such as the macOS Keychain, the Linux keyring or a file.

### Added

- Add `rshow login` on Linux.
  It keeps the token in the Linux keyring when one runs, and else in `~/.config/rshow/credentials` with mode 600.
- Add proxy support through `https_proxy`, `http_proxy` and `no_proxy`.
  An npm install needs `NODE_USE_ENV_PROXY=1` as well.
- Add `RSHOW_EXTRA_CA_FILE` to trust an extra root certificate, and `RSHOW_SYSTEM_CA=0` to stop rshow from using the system certificates.

### Fixed

- Fix `network error: fetch failed` on networks that inspect HTTPS with their own root certificate.
  rshow now trusts the system certificates, as curl does.
- Fix network errors to name the host and the cause, such as `certificate not trusted` or `host not found`, with a hint on what to try.

## [0.0.2] - 2026-10-30

### Changed

- Lower the Node requirement of the npm package from 26 to 22.

### Added

- Add single-file `rshow` binaries for Linux x86-64, Linux arm64 and macOS arm64 to each GitHub release, with a `SHA256SUMS` file.
  They need no Node and unpack the theme, the skills and the Worker to `~/.cache/rshow/<version>/` on first run.
- Add a curl installer that picks the binary for your machine, checks its hash and puts it in `~/.local/bin`.
  Run `curl -fsSL https://rslib.github.io/rshow/install.sh | sh`.
- Add `rshow skills install`, `uninstall` and `status` to install the agent skills for Claude, pi and Codex.
- Add a `skills` line to `rshow doctor`.

## [0.0.1] - 2026-10-30

### Added

- Publish a folder or a single file, each publish as an immutable numbered version, with pins to choose which version the live link serves.
- Share an artifact as private, to the people you name, or public, and give each person a viewer or editor role.
- Group artifacts into projects, which share them at once, and tag them for filtering.
- A `_data` store per artifact, so a published page keeps a small JSON value that survives publishes.
- Themes with presets: pick a built-in look, adjust tokens, select colour pairs, and publish your own theme that pages link by version.
- Offline preview that serves a folder on your machine with live reload and no network.
- `check` for the page contract, `handoff` to write a design folder from a published design, and `compare` to diff an implementation against it.
- `login` and `logout`, which keep the API token in the macOS Keychain.
- `init` to write the config file once, and `doctor` to say what is wrong when it is.
- Skills that teach a coding agent to publish, plus an install script for them.
- A self-hostable Worker, bundled in the npm package with its migrations and the default theme, for your own Cloudflare account.
- A publish of a folder that did not change adds no version: `publish` and `theme publish` name the version that is already live, and `--force` publishes anyway.
- `rshow --version` prints the version, and `doctor` opens with it.

[Unreleased]: https://github.com/rslib/rshow/compare/v0.0.8...HEAD
[0.0.8]: https://github.com/rslib/rshow/compare/v0.0.7...v0.0.8
[0.0.7]: https://github.com/rslib/rshow/compare/v0.0.6...v0.0.7
[0.0.6]: https://github.com/rslib/rshow/compare/v0.0.5...v0.0.6
[0.0.5]: https://github.com/rslib/rshow/compare/v0.0.4...v0.0.5
[0.0.4]: https://github.com/rslib/rshow/compare/v0.0.3...v0.0.4
[0.0.3]: https://github.com/rslib/rshow/compare/v0.0.2...v0.0.3
[0.0.2]: https://github.com/rslib/rshow/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/rslib/rshow/releases/tag/v0.0.1
