# Agents

rshow ships three skills, so a coding agent can write a page, a deck or a report and publish it without guessing at the flags.

## Install them

From a clone of the rshow repository:

```sh
./install.sh
```

`./install.sh` links the three skills into `~/.claude/skills`, `~/.pi/agent/skills` and `~/.codex/skills`, and links the CLI into `~/.local/bin`.
It uses every target whose parent folder exists, and it takes one on the command line: `./install.sh claude`.
`--dry-run` prints what it would do, `--list` shows each target, and `--uninstall` removes the links it made.
It refuses to replace a link it did not make.

From the npm package, copy the folder instead:

```sh
cp -R "$(npm root -g)/rshow/skills/." ~/.claude/skills/
```

The package ships the same three skill folders under `skills/`, so an upgrade of rshow is one copy again.

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
