# Compare

## Contents

- The command
- The three checks
- Pixels
- Structure
- Tokens
- The report
- Thresholds
- TUI screens
- Native screens
- Publishing
- A failing run, in order

## The command

```bash
rshow compare --against app/design/gallery --map rshow.map.json
rshow compare --against app/design/gallery --map rshow.map.json --publish
```

| flag | default | what it does |
|---|---|---|
| `--against` | none, required | the handoff folder that holds `spec.json` and `baseline/` |
| `--map` | `rshow.map.json` in the current folder | the map from handoff names to app paths and urls |
| `--threshold` | `0.1` | how far two pixels must differ before a pixel counts as different |
| `--max-diff-ratio` | `0.02` | the share of differing pixels a screen may have, so 2% |
| `--native-max-diff-ratio` | `0.15` | the same share for a native screen, whose window frame and font stack cannot line up |
| `--tui-colors` | off | keeps ANSI colour when a tmux pane is compared, instead of dropping it |
| `--publish` | off | publishes the report as `<slug>-compare`, private by default |

The run opens every screen that has a url in `map.screens`, at the widths and modes the handoff recorded.
A screen with no url is skipped with a note, and a skipped screen does not fail the run.
That is why an empty value in `screens` is a hole in the check and not a pass.
A `tmux:` entry is captured as text, a `file:` or `window:` entry as a native screenshot, and the rest as a url.

## The three checks

All three run in the same pass and every finding lands in one report.

- Pixels, which catches layout, spacing and colour that moved.
- Structure, which catches a normative component that is missing, the wrong size or the wrong style.
- Tokens, which catches a raw value that should have been a token.

## Pixels

Every screen is screenshotted at the same width, height and mode as the baseline.
The diff is a per pixel colour distance in YIQ, close to pixelmatch, so a pixel under `--threshold` does not count.
Anti-aliasing is ignored, so a text edge does not fail a screen.
The failing line is the share of differing pixels against `--max-diff-ratio`, so 2% of a 1440 wide screen is about 26k pixels.
A size mismatch is reported in the note as one size against the other, and it is nearly always a scrollbar, a zoom or a viewport default.

## Structure

Every component the handoff marks normative must exist in the implementation and match it.

- It is matched by `data-component` first, then by role and text.
  Put `data-component="PrimaryButton"` on the element in the app when the match is otherwise ambiguous.
- The box must land within 4px or 2% of the larger side.
- `color`, `fontSize`, `fontWeight` and `radius` must equal the record, or the value its mapped token resolves to.
- A finding reads `component property expected actual`, for example `PrimaryButton box 96,412 168x40` against `96,414 168x40`.

A component in the app that the handoff does not name is not a finding, so a build may hold more than the design.

## Tokens

A value that equals a token passes.
A raw colour within 0.08 of a token colour is reported as drift, because the eye reads it as the token and the next theme change will miss it.
The finding names the token and the value, so the fix is to use the token.

## The report

```text
app/design/gallery/compare-report/
  index.html   the run, one row per screen and state, with the three images and the mismatch table
  report.json  the same data, for a script
  images/      <screen>__<state>__<width>__<mode>-baseline.png, -actual.png and -diff.png
  rubric-<screen>.md   one native screen, a checklist to tick beside the two images
app/design/gallery/diff/
  <screen>__<state>__<width>__<mode>.png   the same diff image, one folder up
```

Open `index.html` and read the row before the image.
The row says pass or fail with the diff ratio and the note.
The mismatch table names the property, the expected value and the actual value.
The diff image is the third opinion, and it is worth a look when the ratio sits just over the limit.

## Thresholds

The defaults are set for a build that uses the design tokens.
Loosening either flag hides a real difference, and the person reading the report still sees the design.
So never change `--threshold` or `--max-diff-ratio` without asking.
When a person agrees a screen cannot match, say which screen and why in the reply, then pass the flag on that run only.
Never write the looser value into a script or a Makefile target that runs on every build.

## TUI screens

A terminal UI cannot be screenshotted by a browser, so the map uses a tmux target and the compare captures text cells.

```json
{ "screens": { "cli": "tmux:mysession:0.1" } }
```

- `mysession` is the session, `0` the window and `.1` the pane, and the pane must be running the TUI when the run starts.
- The pane is read with `tmux capture-pane -pet`, so every character cell is kept.
- The first run writes `baseline/<screen>.txt` from the live pane and passes, which makes it the reference.
  Read that file before you trust it, because a baseline taken from a broken build locks the break in.
- Later runs compare cell by cell, and a finding is a row number with the expected and the actual text.
- ANSI colour is dropped unless `--tui-colors` is passed, so a style only run uses that flag.
- `new-session -A -s mysession`, then `select-pane -t 0.1`, gets a pane with a stable target for CI.

A tmux baseline is text, so it diffs in a review and it bootstraps nothing from the network.

## Native screens

A native desktop app has no DOM, so a screenshot is the capture.
An Electron, Tauri, egui, Qt, GTK or SwiftUI window compares this way.

```json
{ "screens": { "desktop": "file:shots/desktop.png", "settings": "window:My App" } }
```

- `file:` is a screenshot you or the agent took, and the path is relative to `rshow.map.json`.
  Take it at the baseline width or at 2x that width, because the compare scales it.
- `window:` captures the window itself.
  On macOS it asks `CGWindowListCopyWindowInfo` through `osascript -l JavaScript` for the window id of the owner name or the title, then runs `screencapture -x -o -l <windowID>`.
  On Linux it runs `xdotool search --name` and `import -window`.
  Anywhere else, and when no window matches, the run exits 2 and asks for `file:`.
- The capture is scaled to the baseline width with a box filter, so a Retina 2x shot averages 2x2 into one pixel.
  The diff is then written like a browser run.
- The pixel limit is `--native-max-diff-ratio`, 0.15 by default, because an OS window frame, a WebView and another font stack cannot line up.
- The palette check takes the dominant colours of the capture, k of 8 by histogram and k-means, then compares them in Lab.
  A token colour that a normative component uses and that is absent from the capture, at a delta E 76 under 10, is a finding.
  A large area that sits within 10 of a token but not on it is reported as drift.
- `compare-report/rubric-<screen>.md` is a checklist built from `spec.json`.
  It holds every state, every normative component with its text, its colour, its size and its place against the sibling before it, every annotation note and the palette findings.
  The compare cannot answer those lines, so you do, with the baseline and the capture open side by side.
- Such a screen reports `review` and the run exits 0, with the report saying the rubric needs a pass.
  Exit 7 only when the pixels or a missing token colour fail hard.

## Publishing

`--publish` publishes `compare-report` as `<slug>-compare`, private by default, then prints the version url plus the live url.
Send it to the person with the screens that still differ named in the same message.
Ask before making it public, because the report holds a screenshot of every screen and state.

## A failing run, in order

1. Read the failing rows and write down the screen, the state and the note.
2. Read the mismatch table, and fix a missing component or a wrong token first, because that finding often clears several pixel rows.
3. Look at the diff image, and check whether the whole canvas moved, such as a scrollbar, a zoom or a font that did not load.
4. Fill in the rubric of every `review` screen, and write the reason on each line you could not tick.
5. Fix, then run the same command again.
6. Report the run that exits 0, and never report a run that only passed after a flag moved.
