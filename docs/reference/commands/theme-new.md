# rshow theme new

```sh
usage: rshow theme new <name> [--dir <parent>] [--from default]

Writes <parent>/<name>/theme.json with "extends", an empty "tokens" object and
modeTokens light and dark filled with the base values of --bg, --fg, --muted,
--accent and --layer-01, so you edit values and not token names.
<parent> is the current folder by default. --from names the built-in theme to
extend, default "default". It refuses to overwrite an existing folder.
Prints the path it wrote and the next step: rshow theme check <dir>.
```

