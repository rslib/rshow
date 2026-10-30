# rshow init

```sh
usage: rshow init --url <admin-url> --art <viewer-url> [--theme <name>] [--force]

Writes the global config file that rshow reads first:
$XDG_CONFIG_HOME/rshow/config.json, or ~/.config/rshow/config.json.
Both urls are required and must be https://; http://127.0.0.1 and
http://localhost are allowed for local development. A trailing slash is
removed. Other fields in an existing file are kept, and so is its theme unless
--theme is given.
When the file already sets a different url or art, init refuses instead of
overwriting; --force replaces them.
Prints the path it wrote and the next step: rshow login. --json prints
{path, url, art}.
```

