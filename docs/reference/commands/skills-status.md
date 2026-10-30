# rshow skills status

```sh
usage: rshow skills status [target ...] [--json]

Prints one line per target and skill, <target>  <skill>  <state>, where the
state is link -> <path>, copy v<version>, missing or foreign. It prints nothing
for a target whose parent folder does not exist, and --json prints {targets,
actions: [{target, skill, action, path}]}.
A copy of another version also warns on stderr, because rshow skills install
replaces it.
```

