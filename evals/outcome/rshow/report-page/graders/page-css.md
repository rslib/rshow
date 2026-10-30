---
type: regex
weight: 2
arm: both
pattern: '/_themes/[a-z0-9-]+@[0-9]+/page\.css'
match: contains
target: {source: file, path: reports/q3/index.html}
---
