# rshow skills uninstall

```sh
usage: rshow skills uninstall [target ...] [--dry-run]

Removes the skills rshow put in every target: a symlink into a skills folder
that holds rshow skills, and a copy that carries the .rshow-skill marker.
It removes nothing else, with no line and no error. With no target, every
target whose parent folder exists is used.
Prints removed <path> per skill, then removed <n> skills for <targets>, and
--dry-run prints what would happen, with would, and changes nothing.
```

