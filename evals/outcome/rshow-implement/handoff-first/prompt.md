---
tags: [outcome, rshow-implement]
max_turns: 24
timeout_seconds: 400
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit]
---

A design handoff for our run explorer landed in app/handoff and I need it implemented.
Write the screen to app/src/Screen.tsx as a React component.
Take the colours, the radii and the spacing from app/handoff/tokens.json, because those are the frozen values.
Use the component names from app/handoff/spec.json in the code you write, so a reviewer can see that each design name landed somewhere.
Read app/handoff/HANDOFF.md first and follow the compare command it names.
There is no rshow command in this sandbox and no network, so say what you would run instead of running it.
