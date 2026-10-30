# rshow config

```sh
usage: rshow config [dir] [--offline]

Prints the merged config as JSON: ~/.config/rshow/config.json first, then
<dir>/rshow.json (default: the current folder). RSHOW_URL overrides url and
RSHOW_ART overrides art. <dir>/rshow.json also takes project and tags; later
files win. Run rshow init to write url and art.
A theme with no version, or @latest, is looked up on the art host and printed
as <name>@<n>; when that fails a warning goes to stderr. --offline skips it, and
so does a config with no art host.
The token is RSHOW_TOKEN, else the token saved by rshow login in the macOS
Keychain; never read from a file.
```

