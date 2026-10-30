---
type: regex
weight: 1
arm: both
pattern: '<meta[^>]+name="viewport"[^>]+width=device-width'
match: contains
target: {source: file, path: index.html}
---
