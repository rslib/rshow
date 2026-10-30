---
type: regex
weight: 2
arm: both
pattern: '<script[^>]+src="https?://(?![^"]*@[0-9])(?![^"]*[0-9]+\.[0-9])'
match: not_contains
target: {source: file, path: index.html}
---
