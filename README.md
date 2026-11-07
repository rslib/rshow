# rshow

Publish and share static pages, decks and reports from your own Cloudflare account.
Every publish adds an immutable version, so a link you sent keeps working while you keep editing.

## Install

With curl, as one file that needs no Node at all (linux-x64, linux-arm64 and macOS on arm64):

```sh
curl -fsSL https://rslib.github.io/rshow/install.sh | sh
```

The installer checks the download against the release `SHA256SUMS` and puts `rshow` in `~/.local/bin`; `RSHOW_VERSION`, `RSHOW_INSTALL_DIR` and `RSHOW_DOWNLOAD_BASE` change what it fetches and where it writes.
It also writes the bash, zsh and fish completions for `rshow completion bash|zsh|fish`; `RSHOW_NO_COMPLETIONS=1` leaves them out.
`rshow upgrade` moves an installed rshow to the newest release, and `rshow upgrade --check` prints the current and the newest version and changes nothing.

With npm, which needs Node 22 or later:

```sh
npm i -g rshow
```

An npm install writes the same scripts itself:

```sh
rshow completion bash > ~/.local/share/bash-completion/completions/rshow
rshow completion zsh > ~/.local/share/zsh/site-functions/_rshow   # that folder must be on $fpath
rshow completion fish > ~/.config/fish/completions/rshow.fish
```

From a clone of this repository, which links the CLI and the skills into place:

```sh
./install.sh
```

To try it without installing it:

```sh
npx rshow --help
```

## Quickstart

```sh
rshow init --url https://artd.example.com --art https://art.example.com
rshow login                          # or RSHOW_TOKEN in CI
rshow skills install                 # the three skills, for a coding agent
rshow publish ./hello --slug hello --label "first publish"
rshow share hello --add a@example.com
rshow doctor
```

`rshow init` writes the global config, `rshow login` saves a token in the macOS Keychain, and `rshow publish` prints the version URL and the live URL of the folder.
`rshow doctor` then says whether node, the config, the token, the API, the art host, the theme and the skills are in order.
The [docs site](https://rslib.github.io/rshow) takes it from there.

## Docs

- [docs/getting-started.md](docs/getting-started.md) goes from no install to a shared link.
- [docs/how-it-works.md](docs/how-it-works.md) explains artifacts, versions, modes and the two hosts.
- [docs/self-host.md](docs/self-host.md) deploys the Worker, the database and the bucket.
- [docs/themes.md](docs/themes.md) covers the built-in theme, presets and linking a theme.
- [docs/skills.md](docs/skills.md) installs the three skills for a coding agent.
- [docs/reference](docs/reference) is the generated command reference, the theme tokens and the exit codes.
- The same pages are at https://rslib.github.io/rshow.

## License

MIT.
