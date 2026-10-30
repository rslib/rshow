# rshow

Publish and share static pages, decks and reports from your own Cloudflare account.
Every publish adds an immutable version, so a link you sent keeps working while you keep editing.

## Install

rshow needs Node 26 or later.

```sh
npm i -g rshow
```

To try it without installing it:

```sh
npx rshow --help
```

## Quickstart

```sh
npm i -g rshow
rshow init --url https://artd.example.com --art https://art.example.com
rshow login
rshow publish ./hello --slug hello --label "first publish"
rshow share hello --add a@example.com
```

`rshow init` writes the global config, `rshow login` saves a token in the macOS Keychain, and `rshow publish` prints the version URL and the live URL of the folder.
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
