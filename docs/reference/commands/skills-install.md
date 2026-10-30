# rshow skills install

```sh
usage: rshow skills install [target ...] [--link|--copy] [--dry-run]

Puts the three skills rshow ships, rshow, rshow-slides and rshow-implement, in
the skills folder of every target, so that claude, pi and codex read them:
$HOME/.claude/skills, $HOME/.pi/agent/skills and $HOME/.codex/skills. With no
target, every target whose parent folder exists is used; naming one of claude,
pi and codex picks it, and a usage error names them when none is detected.
Each skill is a symlink to the folder rshow reads it from, so an upgrade of
rshow is nothing to do. --copy copies the folder and writes a .rshow-skill
marker in it, {"version": <rshow version>, "source": "rshow"}, which is how a
newer rshow knows the copy is its own. The default is a link, and a copy when
that folder sits in an npx cache, which npm may delete under a link, or when
rshow runs as a single executable, whose files live in a per-version cache.
A skill that is ours and current prints ok, and one of ours from another path or
another version is replaced and prints updated. Anything else, a folder, a file
or a link that rshow did not make, is left alone: skip goes to stderr, the rest
is still installed, and the run exits 6.
--dry-run prints what would happen, with would, and changes nothing.
Prints one line per skill, then installed <n> skills for <targets>; --json
prints {targets, actions: [{target, skill, action, path}]}.
RSHOW_SKILLS_DIR reads the skills from another folder.
```

