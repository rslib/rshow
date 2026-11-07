# rshow config

```sh
usage: rshow config [dir] [--offline]

Prints the merged config as JSON: ~/.config/rshow/config.json first, then
<dir>/rshow.json (default: the current folder). RSHOW_URL overrides url and
RSHOW_ART overrides art. <dir>/rshow.json also takes project and tags; later
files win. Run rshow init to write url and art.
A theme with no version, or @latest, prints as <name>@latest, and with the
network its lookup adds theme_resolved as <name>@<n>; when the lookup fails a
warning goes to stderr and the key is left out. --offline prints the loaded
config as it is, and so does a config with no art host.
The token is RSHOW_TOKEN, else the token rshow login saved in the macOS
Keychain, the Linux keyring or a file with mode 600.
```

