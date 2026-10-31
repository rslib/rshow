---
type: llm
focus: {source: file, path: poster/index.html}
weight: 3
arm: both
---
Grade the poster against the rshow poster contract.

PASS only if all of these hold.
- It uses the poster layout classes, such as `poster`, `poster-head`, `poster-cols` and `poster-foot`, and it links the theme at one pinned version.
- It picks one sheet size and leaves the columns to the sheet, so no own layout and no `@media` rule reflows the poster, though a block may carry a class of its own.
- The head holds the title as a claim, the two authors, the one affiliation and the venue.
- Every block is a `section` with a heading in `poster-cols`, and the argument reads top left to bottom right.
- It uses the 120 MB and 6 MB numbers and no other number, and it says where they come from.
- It marks the things it was not given as placeholders, such as a QR address, a reference list, a logo and an acknowledgement.
- It carries no copy of a theme file, no font file and no third party CSS.
- Every remote script URL is pinned to an exact version.
- Nothing secret in the file, and no token, key or password in the source.

FAIL if any of these is false, or if the file was not written.
