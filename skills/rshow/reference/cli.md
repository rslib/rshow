# CLI

## Contents

- Every command
- check
- preview
- publish
- share and pin
- projects
- tags and list
- theme, show, delete
- skills
- handoff and compare
- Config files
- Exit codes

`rshow` is one binary and one file of flags.
This file is the whole surface, both config files and the exit codes.

## Every command

| Command | What it does |
|---|---|
| `rshow check <file-or-dir>` | apply the page contract to the files a publish would upload |
| `rshow preview <dir>` | serve a folder on `127.0.0.1` for a look, offline |
| `rshow publish <file-or-dir>` | upload a folder, or one file as `index.html`, as a new version |
| `rshow config [dir] [--offline]` | print the merged config as JSON, with `theme` resolved to its current version, such as `default@3` |
| `rshow init --url <admin-url> --art <viewer-url>` | write the global config file, with `--theme` and `--force` |
| `rshow doctor [dir]` | check node, config, token, api, art, theme and skills, one `ok\|warn\|fail` line each |
| `rshow list` | list artifacts you own or that are shared with you, with `--project`, `--tag` and `--q` filters |
| `rshow show <slug>` | print the artifact, its versions, its shares, its project and its tags |
| `rshow share <slug>` | set the mode, or add and remove shares |
| `rshow pin <slug> <n\|live>` | serve version `n`, or `live` for the newest |
| `rshow project <cmd>` | create, list, show, share or delete a project |
| `rshow tag <slug>` | add or remove tags on an artifact |
| `rshow handoff <slug>@v<n>` | write a design handoff folder from a published design |
| `rshow compare --against <dir>` | compare an implementation with that handoff folder |
| `rshow delete <slug> --yes` | delete an artifact |
| `rshow theme new <name>` | write a preset folder that extends a built-in theme |
| `rshow theme check <dir>` | check a theme or preset folder against the token contract |
| `rshow theme preview <dir>` | build the theme, then serve its preview page on `127.0.0.1` |
| `rshow theme publish <dir>` | publish a theme folder as `theme-<name>` and set it public |
| `rshow theme list` | list theme artifacts and the version each one serves |
| `rshow skills install [target ...]` | link or copy the three skills into `~/.claude/skills`, `~/.pi/agent/skills` or `~/.codex/skills` |
| `rshow skills uninstall [target ...]` | remove the skill links and copies rshow made |
| `rshow skills status [target ...]` | print `link`, `copy v<version>`, `missing` or `foreign` per target and skill |
| `rshow login` | read a token from the terminal with no echo, check it and save it in the macOS Keychain. The person runs it, never the agent |
| `rshow logout` | remove the saved token |

`--help` on its own prints the general usage, and `--help` after a command prints that command.
`--json` is global and makes stdout the API reply, which is how a script reads a version number.

Every flag takes `--flag value` or `--flag=value`.
`--add`, `--editor`, `--remove` and `--tag` accept several values in a row after one flag.

## check

```bash
rshow check <file-or-dir> [--offline]
```

It reads the same files a publish would upload, including `<dir>/<out>` when `rshow.json` names a build or an out folder.
Each finding is one line in the form `path:line: error|warning: msg`.
The exit code is 6 when there is at least one error and 0 otherwise.
Warnings do not fail the run, and they are still worth fixing when the fix is one line.

A warning is one of these:

- `index.html` with no viewport meta, or with no `title`.
- An `img` with no `alt`.
- A deck that links `deck.js` and holds no `<section class="slide">`.
- A style warning, such as an eyebrow label, three elements numbered `01`, `02`, `03`, gradient text, one of the trend fonts, a font nothing loads, cream next to terracotta, an emoji in visible text, glass or a heavy shadow and a purple to blue gradient.

The style warnings read every `.html` and `.css` file in the folder and skip anything under `fonts/` and any vendored `*.min.css` or `*.min.js`.
They are never errors, because a person may have a reason.
`--no-style` skips all of them, and `--json` prints the findings as data.

`--offline` skips every request the check would make, so it works on a plane and it never waits on the host.
A published page that links `/_themes/<name>@<n>/` needs the network to confirm that version exists, so a `--offline` run reports those links as unchecked rather than as a pass.

`rshow publish` runs the check first and stops while there is an error, so a page that fails the contract does not go live.
`--no-check` skips that step.
Use it only when you just ran `rshow check` yourself and the tree has not moved since.

## preview

```bash
rshow preview <dir> [--theme <dir>] [--offline] [--no-reload] [--port 4321]
```

It serves `<dir>` on `127.0.0.1`, prints `http://127.0.0.1:<port>` and keeps running until you stop it.
It works offline: `/_themes/<name>@<n>/` comes from `--theme` when that folder is the theme, then from the built-in theme on disk, and only then from the art URL in the config, which `--offline` turns off.
A page that uses `<artifact>/_data/<key>` gets a local store for the session, and the page reloads by itself when a file changes, which `--no-reload` turns off.

## publish

```bash
rshow publish <file-or-dir> [--slug s] [--title t] [--label l] [--project p] [--tag t ...] [--build cmd] [--no-check] [--force]
```

| Flag | Effect |
|---|---|
| `--slug` | the artifact name, `[a-z0-9][a-z0-9-]{0,62}`, default is the folder name made lowercase |
| `--title` | the human title, default keeps the current one |
| `--label` | a note on this version, such as "first draft" |
| `--build` | run this command in `<dir>` first, then publish `<dir>/<out>` |
| `--project` | move the artifact into a project |
| `--tag` | set its tags, and the flag repeats or takes several values |
| `--no-check` | skip the check and upload whatever is in the folder |
| `--force` | publish a new version even when the folder did not change |

A folder needs an `index.html` at its root.
A single file is published as `index.html`.
Publishing the same slug again adds a version and changes the live page, so a fix is a second publish and never a new slug.
A folder that did not change adds no version and prints `unchanged: <slug> is already v<n>`, and `theme publish` does the same for an unchanged theme.
It prints `slug`, `version`, `files`, `uploaded`, `skipped`, `label`, `version-url` and `live-url`.
Report `live-url` to the person, because that is the link that follows the newest version.

## share and pin

```bash
rshow share <slug> [--mode private|people|public] [--add a@b] [--editor a@b] [--remove a@b]
rshow pin <slug> <n|live>
```

`--add` shares as viewer and `--editor` shares as editor.
`--remove` drops the share.
`pin <slug> <n>` serves an old version at the live link while the newest one stays latest, and `pin <slug> live` follows the newest again.
Pin before a talk, so a half finished publish cannot reach the room.

## projects

```bash
rshow project create <slug> [--title t] [--description d]
rshow project list
rshow project show <slug>
rshow project share <slug> [--add a@b] [--editor a@b] [--remove a@b]
rshow project delete <slug> --yes
```

A project groups artifacts and shares them at once, and the URLs of the artifacts do not change.
A project has a slug in its own namespace, a title and a description of at most 500 characters.
`--add` adds a member as viewer and `--editor` adds one as editor, so a project share is the cheapest way to let a co-author see five artifacts.

The group page is at `https://art.example.com/_p/<project>/`, and the host renders it in the theme's look.
It lists the artifacts of the project that the viewer may see, with the title, the mode and the date.
It 404s when the viewer may see none of them and is not a member.
Copy that link from `rshow project show <slug>`, which prints it as `url`.
Send it when the person asks for everything at once.

An artifact belongs to at most one project, and moving one in needs its owner plus the owner or an editor of the project.
The effective role on an artifact is the higher of its own share role and the project member role.
The mode rules stay per artifact: `private` is the owner plus the editors, `people` adds every project member and `public` is everyone.
Deleting a project keeps its artifacts and clears their project.

## tags and list

```bash
rshow tag <slug> [--add t ...] [--remove t ...]
rshow list [--project p] [--tag t] [--q text]
```

A tag is `[a-z0-9][a-z0-9-]{0,31}`, stored lowercase, at most ten per artifact.
A tag is a filter and never an audience, so it grants nothing and it hides nothing.
`rshow tag` prints the tags after the change, and an empty list prints `-`.
`rshow list` prints `slug mode served title` per artifact.
The three filters combine with AND.
`--q` matches the slug and the title.
Set the tags and the project in `rshow.json` when they are a fact about the folder rather than a one off, and the flag still wins.

## theme, show, delete

`rshow theme publish <dir> [--label l] [--build cmd]` needs a `theme.json` with a `name`, publishes the folder as `theme-<name>`, sets it public and prints `/_themes/<name>@<n>/`.
`rshow theme list` prints the theme artifacts and the version each one serves.
`rshow show <slug>` prints the artifact, its versions, its shares, its pin and its URLs.
`rshow delete <slug> --yes` deletes the artifact and every version.
It needs `--yes`, and it needs a yes from the person.

A preset is a small folder whose `theme.json` carries `"extends": "default"` and only token and font overrides.
`rshow theme new <name> [--dir <parent>] [--from default]` writes it with both modes pre-filled with the base values of `--bg`, `--fg`, `--muted`, `--accent` and `--layer-01`, and prints the path plus `next: rshow theme check <dir>`.

```bash
rshow theme new acme --dir ./themes
rshow theme check ./themes/acme
rshow theme preview ./themes/acme --port 4321
rshow theme publish ./themes/acme
```

`theme check` prints `theme.json:<line>: error|warning: <message>` per finding and a summary line, and exits 6 on any error.
It names an unknown token, a colour value that is not `#hex`, `rgb()` or `var(--known-token)`, text under 4.5:1 in light, in dark or in print, a missing font file and a name that breaks the theme rules.
`theme preview` builds the preset on its base in a temporary folder and serves it on `127.0.0.1`, with the same offline theme lookup, local `_data` store and live reload as `rshow preview`, and prints the URL of `index.html`; the temporary folder goes when the server stops.
`theme publish` runs the check first on a preset, then publishes the built folder, so `--no-check` skips both.

## skills

```bash
rshow skills install [target ...] [--link|--copy] [--dry-run]
rshow skills uninstall [target ...] [--dry-run]
rshow skills status [target ...] [--json]
```

The three skills, `rshow`, `rshow-slides` and `rshow-implement`, teach an agent to publish; `rshow skills install` puts them where claude, pi and codex read them.
A target is `claude` (`~/.claude/skills`), `pi` (`~/.pi/agent/skills`) or `codex` (`~/.codex/skills`), and with no target every one whose parent folder exists is used.
The default is a symlink to the skills folder rshow reads from; `--copy` copies it and writes a `.rshow-skill` marker with the version, which a link does not need.
The default copies in an npx cache, because npm may delete that folder under a live link.
Each skill prints `ok`, `installed`, `updated` or `removed`, then a summary line.
A folder, a file or a link that rshow did not make is left alone, with `skip <dst>: exists and is not from rshow` on stderr and exit 6 on the run.
`rshow skills uninstall` removes only what rshow made: a link into a skills folder that holds rshow skills, or a copy with the marker.
`rshow doctor` reports the skills on one `skills` line, which warns and never fails.

## handoff and compare

```bash
rshow handoff <slug>@v<n> [--out dir] [--widths 1440,390] [--modes light,dark]
rshow compare --against <handoff-dir> [--map rshow.map.json] [--threshold 0.1] [--max-diff-ratio 0.02] [--tui-colors] [--publish]
```

`handoff` freezes a published design into a folder of `tokens.json`, `spec.json`, `HANDOFF.md` and `baseline/`, so a builder works from a copy that cannot move.
`compare` opens that folder's screens next to the app and fails with exit 7 when a screen drifts.
Both belong to `rshow-implement`, which owns the map, the three checks and the whole loop, so read that skill before you run either one.
This skill publishes the mockup and hands the link over, and it never builds the app.

The one exception is a tmux target, such as `tmux:mysession:0.1`, which is how a terminal app is compared cell by cell.

## Config files

Later files win, and the environment beats both.

| File | Fields |
|---|---|
| `~/.config/rshow/config.json` | `url`, `art`, `theme`, `tokens` |
| `<dir>/rshow.json` | `slug`, `title`, `theme`, `tokens`, `project`, `tags`, `build`, `out` |

| Field | Meaning |
|---|---|
| `url` | the API base, set by `rshow init` or `RSHOW_URL`; a command that needs the API fails without it |
| `art` | the art base the preview proxies `/_themes/` to, set by `rshow init` or `RSHOW_ART`; without it a theme lookup is skipped with a warning |
| `slug` | the artifact to publish to, overridden by `--slug` |
| `title` | the human title, overridden by `--title` |
| `theme` | the theme a page should link: `<name>`, `<name>@latest` or a fixed `<name>@<n>`. `rshow config` prints it as `<name>@<n>` and you apply it by hand |
| `tokens` | token overrides recorded and printed by `rshow config`. No command writes them into a page, so apply them by hand |
| `build` | the command `publish` runs in the folder first |
| `out` | the folder under `<dir>` to publish, default `dist` |
| `project` | the project slug the artifact belongs to, overridden by `--project` |
| `tags` | the tags to set, overridden by `--tag` |

`RSHOW_URL` overrides `url` and `RSHOW_ART` overrides `art`.
`rshow init --url <admin-url> --art <viewer-url>` writes the global file with both, keeps its other fields, and prints the next step, `rshow login`.
`rshow doctor [dir]` checks node, both config files, the token, the API, the art host, the theme and the skills, one line each, and exits 6 when a check failed. Run it on a config error and show its output to the person.
The token comes from `RSHOW_TOKEN`, else from the macOS Keychain, where `rshow login` saves it. It is never read from a file or from a flag.
`XDG_CONFIG_HOME` moves the global config file away from `~/.config`.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | it worked |
| 2 | usage, which covers a bad flag, a bad slug, a missing `index.html` and a missing token |
| 4 | auth, which covers an expired token, a revoked token and a token without the scope the command needs |
| 5 | api or a failed build, which covers a taken slug, a refused request and a build command that exited non-zero |
| 6 | `rshow check` found an error in the page, or a skill folder in the way is not from rshow |
| 7 | `rshow compare` found a screen that drifted from the handoff |
