# Getting started

rshow publishes a folder of static files to a link you can send.
The files stay in a Cloudflare account you own, and [self-host.md](self-host.md) sets that up once.
This page goes from no install to a shared link.

## Install

Three ways in, and the first three commands of each are the same.

With curl, as one file that carries its own Node, so no Node is needed on the machine (linux-x64, linux-arm64 and macOS on arm64):

```sh
curl -fsSL https://rslib.github.io/rshow/install.sh | sh
```

The installer reads `uname` to pick the tarball, checks it against the `SHA256SUMS` of the release, unpacks it and writes `rshow` into `~/.local/bin`, mode 755.
It writes the bash, zsh and fish completions of that tarball too, and says where each one went; `RSHOW_NO_COMPLETIONS=1` leaves them out.
It prints the installed version, and says how to put that folder on `PATH` when it is not there yet.
`RSHOW_VERSION=0.0.5` installs a named release, `RSHOW_INSTALL_DIR` writes somewhere else, and `RSHOW_DOWNLOAD_BASE` downloads from a mirror.

With npm, which needs Node 22 or later:

```sh
npm i -g rshow
```

An npm install writes the same completion scripts itself:

```sh
rshow completion bash > ~/.local/share/bash-completion/completions/rshow
rshow completion zsh > ~/.local/share/zsh/site-functions/_rshow   # that folder must be on $fpath
rshow completion fish > ~/.config/fish/completions/rshow.fish
```

From a clone of this repository, which links the CLI into `~/.local/bin` and needs Node 26:

```sh
./install.sh
```

To try it without installing it:

```sh
npx rshow --help
```

A binary says so: `rshow --version` prints `rshow <version> (binary)`, and `rshow doctor` says the same on its `rshow` line.
It unpacks the built-in theme, the skills and the Worker into `${XDG_CACHE_HOME:-$HOME/.cache}/rshow/<version>/` on first use and reads them from there, so `rshow skills install` copies the skills instead of linking them: the folder changes with the version.

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

`rshow login` reads the token from stdin, with no echo on a terminal, checks it with `GET /api/me` and saves it in the macOS Keychain, in the Linux keyring, or in `${XDG_CONFIG_HOME:-$HOME/.config}/rshow/credentials` with mode 600: the first of the three this machine has.
It prints the email, the scope and where the token went.
In CI, set `RSHOW_TOKEN` instead; rshow reads a token from the environment, never from a flag.

## Check the setup

```sh
rshow doctor
```

`rshow doctor` prints one line per check, `ok|warn|fail  <check>  <detail>`, for node, the config files, the token, the API, the art host, the theme and the skills.
It exits 6 when a check fails, and it never prints the token.

## On a cluster or behind a proxy

A cluster often holds its own certificate authority, and a proxy that inspects HTTPS holds one too.
rshow trusts the system store as well as the roots Node bundles, so a host that `curl` accepts is a host rshow accepts.
A root that lives in a file rather than in the store goes in `RSHOW_EXTRA_CA_FILE`:

```sh
export RSHOW_EXTRA_CA_FILE=/etc/pki/cluster-root.pem
```

`RSHOW_SYSTEM_CA=0` leaves the system store out, and `rshow doctor` names a certificate it cannot verify.

A proxy comes from the environment: the binary carries the Node flag, so `https_proxy`, `http_proxy` and `no_proxy` work as they do for `curl`.
An `npm i -g rshow` install needs the variable that flag stands for, which Node 24 and later read:

```sh
export NODE_USE_ENV_PROXY=1
```

A request that fails says which host and why, such as `network error: artd.example.com: certificate not trusted`, followed by one line on what to try next.

`rshow login` needs no keychain on Linux: it saves the token in the keyring, or in `~/.config/rshow/credentials` with mode 600 when there is none, and prints the path it used.

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
