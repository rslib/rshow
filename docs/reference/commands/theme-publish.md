# rshow theme publish

```sh
usage: rshow theme publish <dir> [--label l] [--build cmd] [--no-check] [--force]

<dir> needs theme.json with a name. The folder is published as theme-<name>,
then set to mode public, which needs a full-scope token.
The folder is checked first (see rshow check --help) and an error stops the
publish with exit 6. --no-check skips the check.
A theme.json with "extends" is a preset: it is checked with rshow theme check,
built on top of its base theme, and the built folder is what gets published.
When the newest version already holds the built folder's paths and hashes, it
prints unchanged: theme-<name> is already v<n> and publishes nothing.
--force publishes a new version anyway.
Prints /_themes/<name>@<n>/. Pages link /_themes/<name>@latest/ by default, so
they follow every version you publish here.
```

