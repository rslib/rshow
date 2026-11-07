# rshow preview

```sh
usage: rshow preview <dir> [--theme <dir>] [--offline] [--no-reload] [--port 4321]

Serves <dir> on 127.0.0.1: index.html for a folder, content types for files.
Works offline: /_themes/<name>@<n>/ and /_themes/<name>@latest/ are served
from --theme when it names that theme, then from the built-in themes on disk,
and only then proxied to the art URL from config, which --offline turns off.
The page is reloaded on its own when a file changes; --no-reload turns that off.
Scripts that use <artifact>/_data/<key> get a local store in that same session.
```

