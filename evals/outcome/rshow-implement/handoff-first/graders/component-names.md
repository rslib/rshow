---
type: regex
weight: 2
arm: both
pattern: '(?s)(?=.*\bRunTable\b)(?=.*\bStatusPill\b)(?=.*\bFilterBar\b)(?=.*\bPrimaryAction\b)'
match: contains
target: {source: file, path: app/src/Screen.tsx}
---
