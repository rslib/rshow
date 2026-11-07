# rshow delete

```sh
usage: rshow delete <slug> [--version n] [--force] --yes

Deletes the artifact, or with --version n only that version, and needs --yes.
A theme or a theme version also needs --force, because pages link to it.
A pinned version and the only version of an artifact cannot be deleted.
A public version can stay visible for up to 5 minutes after the delete, and a
theme file for longer.
```

