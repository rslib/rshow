# rshow skills

```sh
usage: rshow skills <install|uninstall|status> [target ...] [options]

  skills install [target ...]    link or copy the three skills into an agent
  skills uninstall [target ...]  remove the links and copies rshow made
  skills status [target ...]     say what each target holds, per skill

A target is where an agent reads its skills from:
  claude   $HOME/.claude/skills
  pi       $HOME/.pi/agent/skills
  codex    $HOME/.codex/skills
With no target, every target whose parent folder exists is used.
```

## Commands

| Command | What it does |
| --- | --- |
| [`rshow skills install`](skills-install.md) | link or copy the three skills into an agent |
| [`rshow skills uninstall`](skills-uninstall.md) | remove the links and copies rshow made |
| [`rshow skills status`](skills-status.md) | say what each target holds, per skill |

