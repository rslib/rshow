---
name: rshow-implement
description: Load before you implement or code a UI from an rshow mockup, design or an rshow link such as art.<domain>/<name>, when signed off wireframes or frozen tokens must become working code in your app and when a built app needs a side by side check against the design or where it drifted. Load it even for a quick question about it. Run rshow handoff to freeze the design and rshow compare to hold the build to it. Making the mockup belongs to rshow, slide decks belong to rshow-slides, visual direction belongs to frontend-design.
---

# rshow implement

A design published on rshow is the contract, and the app repo is where it gets built.
`rshow handoff` freezes that design into a folder that does not move, and `rshow compare` holds the build to it.
The code moves toward the design, never the other way round.

## Workflow

Copy this checklist into the reply and tick it as you go.

```text
- [ ] handoff frozen into the app repo at a path the person agreed on
- [ ] HANDOFF.md read, spec.json read for the screen at hand
- [ ] tokens mapped in rshow.map.json
- [ ] components mapped in rshow.map.json
- [ ] one screen and one state built, url, tmux target or native screenshot in the map
- [ ] rshow compare --against <handoff-dir> --map rshow.map.json exits 0
- [ ] a review screen has its rubric filled in beside both images
- [ ] every state covered, not only the happy path
- [ ] report published and the person asked to review
```

1. Freeze the design.
   Run `rshow handoff <slug>@v<n> --out <dir>`, or `rshow handoff <local-folder>` when the mockup is still local.
   The folder it writes holds `HANDOFF.md`, `spec.json`, `tokens.json` and `baseline/`.
   Put it in the app repo at a path the person agrees on and commit it next to the code.
   Never work from a live link, because the next publish moves it.
2. Read the handoff before you write any code.
   `HANDOFF.md` gives the immutable source, the screens, the states, the component table and the compare command.
   `spec.json` gives the screen at hand its boxes, computed styles, flows, annotations and focus order.
   A component the mockup marks `data-normative` is normative here, and its text, box and style must match.
   Everything else is placeholder, so data, copy, names and images are free to change.
3. Map the tokens.
   `tokens.json` is W3C DTCG 2025.10 with `$value` and `$type` on every token, grouped by name prefix, plus a `dark` group for the dark values.
   Translate each token into the app's own system, such as a CSS variable, a Tailwind theme key, a Swift or Kotlin constant, a ratatui style.
   Fill the `tokens` object in `rshow.map.json`, such as `"--accent": "theme.colors.accent"`.
   Never hardcode a value that has a token, because a raw colour near a token colour comes back as drift.
4. Map the components.
   Find the component the app already has before you write a new one.
   Fill `components` in `rshow.map.json`, such as `"wf-button": "src/ui/Button.tsx"` or `"PrimaryButton": "src/ui/Button.tsx#primary"`.
   Create a new component only when nothing fits, and say so in the reply.
5. Build one screen and one state at a time.
   Fill `screens` with the dev url, a tmux target or a native capture, such as `"gallery": "http://localhost:5173/"`, `"cli": "tmux:mysession:0.1"` or `"desktop": "file:shots/desktop.png"`.
   Compare that screen before you start the next one.
6. Run `rshow compare --against <handoff-dir> --map rshow.map.json` and fix until it exits 0.
   Read the report at `<handoff-dir>/compare-report/index.html` and work through the mismatches before anything else.
   Read a mismatch before you reach for a threshold, because a looser threshold hides a real difference.
   Never loosen `--max-diff-ratio` or `--threshold` without asking the person.
7. A native desktop app has no DOM, so it compares through a screenshot.
   An Electron, Tauri, egui, Qt, GTK or SwiftUI window takes `file:<path.png>` for a screenshot you took or `window:<app or title>` to capture the window itself on macOS.
   The capture is scaled to the baseline width with a box filter so a Retina 2x shot lines up.
   It is then diffed with the looser `--native-max-diff-ratio`, which defaults to 0.15.
   The token colours of the normative components are checked against the dominant colours of the capture, in Lab, so a colour that is near a token but not on it is reported.
   Such a screen reports `review` and the run still exits 0, unless the pixels or a token colour fail hard.
   Open the baseline and the capture side by side, then fill in `compare-report/rubric-<screen>.md`.
   It lists every state and every annotation note, plus each normative component with its text, colour, size and place.
   List each line you could not tick for the person with the reason, because your eye is the check a native window cannot pass on its own.
8. Publish the report.
   Run `rshow compare --against <handoff-dir> --map rshow.map.json --publish` and report the printed link.
   Ask the person to review it, because their comments are the next tasks.

## Hard rules

- The design is the contract.
  A box, a colour or a step that does not fit is a question for the person, not an edit to the design.
- Placeholders are free and normative values are not.
  Keep the text, the box and the computed style of every normative component.
- Do not skip a state.
  Empty, loading, error, long content and narrow width are part of the design.
  A screen missing one of them is not done.
- An empty value in `rshow.map.json` is a component or a token nobody checks.
  Fill it, or say why it stays empty.
- Keep the flows and the focus order that `spec.json` records.
- Every screen needs a url, a tmux target or a native capture in `screens`, because a screen without one is skipped and the report still passes.
- A `review` screen is not done when the rubric is empty.
  Tick it beside both images, or say which lines you could not tick and why.

## Exit codes

| code | meaning | what to do |
|---|---|---|
| 0 | every screen matches, or a native screen is ready for review | publish the report and report the link |
| 2 | usage | the handoff folder, a flag or a url is wrong. Read `rshow compare --help` and fix the command |
| 5 | api | the host refused a `--publish` request. Read the message and retry once |
| 7 | compare failed | read each mismatch and the diff images, fix the build and run it again |

On 7, fix the build.
Never pass it with `--max-diff-ratio 1`, and never edit `baseline/` to make a screen pass.

## Reference files

- [handoff](reference/handoff.md) holds the frozen folder, `spec.json` field by field and the normative and placeholder rules.
  Read it before you freeze a design or argue about a recorded box.
- [compare](reference/compare.md) holds every flag, the three checks, the report, the tmux path and the native path.
  Read it when a compare run fails or a flag is not obvious.
- [map](reference/map.md) holds `rshow.map.json`, one example per stack and the empty value rule.
  Read it before you write the map.

## Never

- Never change the design to match the code.
- Never build from a link that can move.
- Never hand edit `baseline/`, `tokens.json` or `spec.json`, because the next handoff overwrites them and a hand edit hides drift.
- Never loosen `--max-diff-ratio`, `--native-max-diff-ratio` or `--threshold` without a yes from the person.
- Never call a `review` screen done with an empty rubric or a line you did not look at.
- Never call a screen done on the happy path alone.
- Never publish the report as `public` without a yes, because it holds screenshots of unreleased work.
