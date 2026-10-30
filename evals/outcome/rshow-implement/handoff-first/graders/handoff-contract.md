---
type: llm
focus: {source: file, path: app/src/Screen.tsx}
weight: 3
arm: both
---
Grade the screen against the handoff in app/handoff.

PASS only if all of these hold.
- It is a React component that renders the runs screen from `spec.json`, with a filter bar above the table and one action for the data.
- It reads the token values from `app/handoff/tokens.json` rather than inventing colours, radii or spacing, and it says where each one came from.
- It uses the component names from `spec.json`, such as `FilterBar`, `RunTable`, `StatusPill` and `PrimaryAction`, as the names of the parts it writes.
- The blocks the handoff marks normative keep their text, their order and their shape, and the run names and the numbers are free so they could be real data.
- It covers the empty state and the error string, because those live in the app and not in the drawing.
- It does not paste the baseline, the raw mockup HTML or a screenshot in place of a component.

FAIL if any of these is false, or if the file was not written.
