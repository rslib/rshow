# rshow

Publish static artifacts (folders of HTML, CSS, images, PDFs) to
[rshow](https://rslib.github.io/rshow) and share them with a short link.

```sh
npx rshow --help
```

## Install

```sh
npm install -g rshow
```

`rshow` needs Node >= 26.

## Commands

```sh
rshow publish <file-or-dir>   publish a folder, or a single file as index.html
rshow check <dir>             check a folder against the page contract
rshow list                    list versions
rshow show <slug>             print a version URL
rshow pin <slug> <n>          pin a slug to a version
rshow share <slug>            create a share link
rshow preview <dir>           serve a local folder
rshow config                  read and write rshow config
rshow theme <name>            list and resolve themes
```

Run `rshow <command> --help` for the flags of each command.

## What is in the package

| Path      | Contents                                                    |
| --------- | ----------------------------------------------------------- |
| `dist/`   | the CLI, compiled from TypeScript                            |
| `worker/` | the rshow Worker bundle (`index.js`) and its D1 migrations   |
| `skills/` | agent skills that drive the CLI                              |
| `themes/` | the default theme, published by `rshow theme`                |

## Source

The repo is an npm workspace: `packages/cli` is this package and
`packages/worker` is the Cloudflare Worker behind it. See
<https://github.com/rslib/rshow>.

## License

MIT
