---
type: llm
focus: {source: file, path: reports/q3/index.html}
weight: 2
arm: both
---
Grade the page against the rshow page contract.

PASS only if all of these hold.
- It links the theme at one version and carries no copy of a theme file, no font file and no third party CSS.
- It has a viewport meta tag and one `h1`, plus a lede that says what the page answers.
- It keeps its own CSS to one `:root` block of token overrides and does not restyle the theme classes.
- Every path is relative except `/_themes/...`, and a remote script URL is pinned to an exact version.
- It uses only the numbers it was given and no others, and it says where they come from.
- Nothing secret in the file, and no token, key or password in the source.

FAIL if any of these is false, or if the file was not written.
