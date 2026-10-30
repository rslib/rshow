# Changelog

Notable changes to rshow, the CLI and the Worker it ships.
The format follows [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/), and rshow uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/rslib/rshow/compare/v0.0.2...HEAD
[0.0.2]: https://github.com/rslib/rshow/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/rslib/rshow/releases/tag/v0.0.1
