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
- Every slide is a `section` with `slide` plus one layout class, such as `title`, `section`, `bullets`, `two-col`, `quote`, `figure`, `code`, `big-number` or a layout the deck adds for itself.
- Any layout CSS of its own sits in one inline `<style>` block, takes its colour, type and space from the theme tokens, and is scoped to its own class, such as `.slide.<name>`.
- No run of more than three text slides (`two-col` or `bullets`) in a row.
- The theme is linked at one version and the folder holds no copy of a theme file.

FAIL if any of these is false, or if no index.html was written.
