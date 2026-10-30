# Agents

rshow ships three skills, so a coding agent can write a page, a deck or a report and publish it without guessing at the flags.

## Install them

With the npm package or the single executable:

```sh
rshow skills install
```

`rshow skills install` links the three skills into `~/.claude/skills`, `~/.pi/agent/skills` and `~/.codex/skills`, and uses every target whose parent folder exists.
Name a target to pick one: `rshow skills install claude`.
The default is a symlink to the skills folder that ships with rshow, so an upgrade of rshow is nothing to do.
It copies instead when that folder sits in an npx cache, which npm may delete under a link; `--link` and `--copy` force either one.
A single executable copies too: it unpacks its skills into `${XDG_CACHE_HOME:-$HOME/.cache}/rshow/<version>/`, a folder the next version does not read, so a link from there would dangle.
A copy carries a `.rshow-skill` marker with the version, so a newer rshow replaces its own copy and never a folder that is not from rshow.

```sh
rshow skills status
rshow skills uninstall
```

`rshow skills status` prints one line per target and skill: `link -> <path>`, `copy v<version>`, `missing` or `foreign`.
`rshow skills uninstall` removes the links and copies rshow made, and leaves everything else.
`--dry-run` prints what would happen and changes nothing, and `--json` prints the same as data.
A skill folder or link that is not from rshow is never touched: `rshow skills install` prints `skip <path>: exists and is not from rshow` and exits 6.

From a clone of the rshow repository, `./install.sh` does the same for the checkout and links the CLI into `~/.local/bin`:

```sh
./install.sh
```

`./install.sh` links the three skills into the same three folders, and links the CLI into `~/.local/bin`.
It uses every target whose parent folder exists, and it takes one on the command line: `./install.sh claude`.
`--dry-run` prints what it would do, `--list` shows each target, and `--uninstall` removes the links it made.
It refuses to replace a link it did not make.

`rshow doctor` says whether the installed skills match the rshow you are running, one `skills` line: `ok` when every detected target holds the three skills, `warn` with the reason when one does not.

## What each one does

| Skill | Use it for |
|---|---|
| `rshow` | writing and publishing a page, a report, a poster, a project page, a dashboard, a mockup, a sketch or a terminal page; the audience, the projects and the tags, and the publish itself |
| `rshow-slides` | a talk deck: the outline, the layouts, the speaker notes, the arrow keys and the presenter view |
| `rshow-implement` | building an app from a published design: `rshow handoff` freezes the design, `rshow compare` holds the build to it |

`rshow` is the one to load before any publish, and it hands off to the other two: a deck belongs to `rshow-slides`, and code from a design belongs to `rshow-implement`.
Both come back to `rshow` to publish.

Each skill carries reference files, such as the page contract, the layouts and the report rules, and the skill says when to read which.
The agent reads them on demand instead of holding all of it in context.

## The token rule

An agent never asks for a token in chat, and it never pastes one into a reply.

The token lives in the macOS Keychain, where `rshow login` put it, and every agent command reads it from there.
When a command exits 2 with no token, or exits 4 with an auth error, the agent tells the person to run `rshow login` in their own terminal and says nothing about the value.
In CI the token is `RSHOW_TOKEN` in the environment, which an agent also never prints.

## What the agent runs

The same commands you run:

```sh
rshow check <dir>
rshow preview <dir>
rshow publish <dir> --slug <slug> --label "<what changed>"
```

The skill lists the exit codes with what to do for each one, so a failure ends in a fixed page or a fixed config rather than a retry of the same line.
