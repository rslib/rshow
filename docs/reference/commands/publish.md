# rshow publish

```sh
usage: rshow publish <file-or-dir> [--slug s] [--title t] [--label l] [--project p] [--tag t ...] [--build cmd] [--no-check] [--force]

A folder must contain index.html. A single file is published as index.html.
Slug and title fall back to <dir>/rshow.json, then to the file or folder name.
--build (or build in rshow.json) runs the command in <dir> with your shell,
then <dir>/<out> (out defaults to dist) is published.
--project (or project in rshow.json) moves the artifact into a project.
--tag (or tags in rshow.json) sets its tags; repeat the flag, or list several
tags after it.
The folder is checked first (see rshow check --help) and an error stops the
publish with exit 6. --no-check skips the check.
When the newest version already holds the same paths and hashes, nothing is
uploaded: it prints unchanged: <slug> is already v<n>. --force publishes a
new version anyway.
```

