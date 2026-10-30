# rshow theme preview

```sh
usage: rshow theme preview <dir> [--offline] [--no-reload] [--port 4321]

Builds the theme folder into a temporary folder, serves that on 127.0.0.1 and
prints the URL of index.html, the preview page that shows every layout. The
built folder answers /_themes/<name>@<n>/ and is rebuilt, and the page reloaded,
when the folder changes; --no-reload turns the reload off. A /_themes/ path for
another theme comes from the built-in themes on disk, then from the art URL
from config, which --offline turns off. The temporary folder goes when the
server stops.
```

