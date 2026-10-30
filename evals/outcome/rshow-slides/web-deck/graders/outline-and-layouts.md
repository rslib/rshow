---
type: llm
focus: trace
weight: 2
arm: both
---
Look at the reply and at the index.html the run wrote.

PASS only if all of these hold.
- The run gave an outline before it wrote any HTML.
  The outline was one line per slide and said what each slide claims.
- The deck has 5 to 14 slides for a ten minute talk and each slide carries one idea.
- Every slide is a `section` with `slide` plus one layout class the theme already has, such as `title`, `section`, `bullets`, `two-col`, `three-col`, `quote`, `figure`, `code` or `big-number`.
- The run did not invent a layout class, a wrapper class or a block of layout CSS of its own.
- The theme is linked at one version and the folder holds no copy of a theme file.

FAIL if any of these is false, or if no index.html was written.
