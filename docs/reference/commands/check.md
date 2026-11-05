# rshow check

```sh
usage: rshow check <dir> [--offline] [--json]

Checks a folder against the rshow page contract before publish.
Prints one line per finding, <path>:<line>: error|warning: <message>, then a
summary line. Exit 0 when there is no error, 6 when there is an error, 2 on a
usage error. --offline skips the theme version lookup on the art host.

errors:
  no index.html at the root, unless theme.json makes the folder a theme
  a local href, src, poster, srcset, CSS url() or @import with no file behind it
  a root-relative reference other than /_themes/<name>@<n>/<path>
  a /_themes/<name>@<n>/ path whose version the art host does not have
  a script from a host other than cdnjs.cloudflare.com, cdn.jsdelivr.net,
    unpkg.com, or one of those without an exact version (@1.2.3, /1.2.3/ on cdnjs)
  a stylesheet from a host other than fonts.googleapis.com, cdn.jsdelivr.net,
    cdnjs.cloudflare.com
  a fetch, WebSocket, EventSource or XMLHttpRequest.open to an absolute http
    or https url, because connect-src is 'self' only
  bad LaTeX in an element with the class math, which is what the page shows and
    what a deck or a report would print
  a path with a backslash or a .. segment, a file over 25 MiB, more than 2000
    files, or over 100 MiB in total

warnings:
  index.html without <meta name="viewport">, or without <title>
  an <img> without alt
  a deck that links deck.js and has no <section class="slide">
  math on a page that links no math.js, so the LaTeX shows as plain text
  math on a page that links no math.css, so the equation prints twice
  a math element whose text holds a tag, which is an unescaped < that the
    browser eats: write it as &lt;
  an element with the class equation and no class math inside it

Mockup warnings:
  Warnings for a page whose <main> carries the class mockup, and for any
  element with the class tui. They are warnings, never errors.
  a flow through href="#id" inside an artboard, or data-goto="id", that names
    no artboard id in the same file
  two artboards with the same id
  an artboard without data-title
  a block with data-state="x" whose artboard does not list x in data-states
    (default is always allowed)
  an artboard that lists a state in data-states that no block uses
  a tui with data-cols below 80 or data-rows below 24 and no data-allow-small
  a key hint in .tui-keys, .tui-statusbar or .tui-dialog that binds Ctrl+C,
    Ctrl+Z or Ctrl+ (also ^C, ^Z, c-c), which the terminal owns

Style warnings:
  Warnings for AI-design defaults, never errors. They look at .html and .css
  files in the folder, and skip anything under fonts/ and vendored *.min.css
  or *.min.js. --no-style skips all of them.
  eyebrow labels: text-transform: uppercase with letter-spacing of 0.05em or
    more, or 1px or more
  decorative numbering: three or more elements whose whole text is a
    zero-padded number (01, 02, 03)
  gradient text: background-clip: text or -webkit-background-clip: text
  trendy default fonts in font-family: Inter, Space Grotesk, Geist, Fraunces,
    Instrument Serif, Poppins, Montserrat
  a font-family name that nothing loads: not a generic family, no @font-face in
    the folder, no /_themes/ fonts link, and no fonts.googleapis.com link
  cream plus terracotta: a background over 90% lightness at hue 30-50 next to a
    color or border over 45% saturation at hue 5-30
  emoji in visible text
  glass and heavy shadow: backdrop-filter: blur, or a box-shadow blur of 24px
    or more
  purple-blue gradients: a linear-gradient whose stops hold both a 250-290 hue
    and a 200-240 hue
```

## Commands

| Command | What it does |
| --- | --- |

