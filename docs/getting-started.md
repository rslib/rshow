# Getting started

rshow publishes a folder of static files to a link you can send.
The files stay in a Cloudflare account you own, and [self-host.md](self-host.md) sets that up once.
This page goes from no install to a shared link.

## Install

rshow needs Node 26 or later.

```sh
npm i -g rshow
```

To try it without installing it:

```sh
npx rshow --help
```

For a coding agent, `rshow skills install` puts the three rshow skills where Claude Code, pi or codex read them; [skills.md](skills.md) has the flags.

## Point rshow at your host

`rshow init` writes `~/.config/rshow/config.json`, the file rshow reads first.

```sh
rshow init --url https://artd.example.com --art https://art.example.com
```

`--url` is the admin host: the JSON API and the web UI.
`--art` is the viewer host: the pages you publish.
Both are required, both are `https://`, and both are yours; see [self-host.md](self-host.md).

## Save a token

Make a token on the Tokens page of the admin host, `https://artd.example.com/tokens`.
Give it the `publish` scope, or `full` when you want to share, pin and delete as well.
Then save it:

```sh
rshow login
```

`rshow login` reads the token from stdin, with no echo on a terminal, checks it with `GET /api/me` and saves it in the macOS Keychain.
It prints the email and the scope it found.
In CI, set `RSHOW_TOKEN` instead. rshow never reads a token from a file or a flag.

## Check the setup

```sh
rshow doctor
```

`rshow doctor` prints one line per check, `ok|warn|fail  <check>  <detail>`, for node, the config files, the token, the API, the art host, the theme and the skills.
It exits 6 when a check fails, and it never prints the token.

## Publish a folder

An artifact is a folder with an `index.html` at its root.
Write one, or take the folder that Astro or Vite built.

```sh
rshow check ./hello
rshow publish ./hello --slug hello --label "first publish"
```

`rshow check` reads the folder against the page contract and prints one line per finding.
An error stops the publish, so fix it and run both again.

`rshow publish` prints the counts and two links:

```text
version-url: https://art.example.com/hello/v1/
live-url: https://art.example.com/hello/
```

The version URL never changes, because a version is immutable.
The live URL serves the newest version, or the pinned one.

Publishing the same unchanged folder again adds no version: `rshow publish` prints `unchanged: <slug> is already v<n>` instead.
`--force` publishes a version anyway.

## Share it

A new artifact is `private`: only you and the editors can read it.

```sh
rshow share hello --add a@example.com
rshow share hello --mode people
```

`people` means everyone you shared it with, as viewer or as editor, and `public` means anyone who holds the link.
`rshow show hello` prints the versions and the shares, and `rshow pin hello 2` serves version 2 at the live URL.

## Preview offline

```sh
rshow preview ./hello
```

It serves the folder on `http://127.0.0.1:4321` and reloads the page when a file changes.
`/_themes/...` is served from the built-in themes on disk, so the preview needs no network.
`--offline` turns off the proxy to the art host, and `/_data/...` reads and writes a store that lives only in that session.

## Next

- [how-it-works.md](how-it-works.md) explains artifacts, versions, modes and the two hosts.
- [themes.md](themes.md) covers the built-in theme, presets and linking a theme.
- [self-host.md](self-host.md) deploys the Worker, the database and the bucket.
- [Skills](skills.md) installs the three skills that teach a coding agent to publish.
- [reference/commands/index.md](reference/commands/index.md) lists every command with its summary.
