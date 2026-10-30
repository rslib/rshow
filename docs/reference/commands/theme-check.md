# rshow theme check

```sh
usage: rshow theme check <dir>

Checks a preset or a full theme folder. Prints one line per finding,
theme.json:<line>: error|warning: <message>, then a summary line. Exit 0 when
there is no error, 6 when there is an error, 2 on a usage error.

errors:
  a token in tokens or modeTokens that the base tokens.css does not define
  a colour token whose value is not #hex, rgb() or var(--known-token)
  --fg, --muted or --accent under 4.5:1 on --bg or --layer-01, in light,
    in dark and in print
  a fonts[].file that does not exist
  a name that is not [a-z0-9-]{1,40}, or that starts with theme-

warnings:
  fonts listed without a licence file in fonts/ (OFL.txt, LICENSE,
    LICENSE.txt or LICENSE.md)
```

## Commands

| Command | What it does |
| --- | --- |

