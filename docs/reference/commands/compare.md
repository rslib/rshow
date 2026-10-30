# rshow compare

```sh
usage: rshow compare --against <handoff-dir> [--map rshow.map.json] [--threshold 0.1] [--max-diff-ratio 0.02] [--native-max-diff-ratio 0.15] [--tui-colors] [--publish]

Opens every screen in the handoff that has a url in map.screens, at the same
widths and modes, and compares the result with baseline/:
  pixels      per pixel YIQ colour distance like pixelmatch, anti-aliasing
              ignored; writes diff/<screen>__<state>__<width>__<mode>.png and
              fails above --max-diff-ratio of differing pixels
  structure   every data-normative component must exist in the implementation,
              matched by data-component then by role and text, with its box
              within 4px or 2% and the same colour, font-size, font-weight and
              radius, or the value of its mapped token
  tokens      a value that equals a token is fine; a raw colour within a small
              distance of a token colour is reported as drift
Writes compare-report/index.html, compare-report/report.json and the three
images per screen. Exit 0 when everything matches, 7 when it does not, 2 on a
usage error.
A map.screens entry that starts with tmux: (tmux:mysession:0.1) is captured
with tmux capture-pane -pet and compared cell by cell with
baseline/<screen>.txt, written on the first run; ANSI colour is ignored unless
--tui-colors.
A native desktop app has no DOM, so a screen entry is a screenshot of it:
  file:shots/gallery.png      a screenshot, relative to rshow.map.json
  window:MyApp                the window whose owner name or title matches, on
                              macOS with screencapture -x -o -l and on Linux
                              with xdotool search --name plus import -window;
                              anywhere else the run exits 2, so use file:
The capture is scaled to the baseline width with a box filter, so a Retina 2x
shot lines up, then diffed with the looser --native-max-diff-ratio, checked
against the token colours of every normative component (delta E 76 in Lab) and
turned into compare-report/rubric-<screen>.md, a checklist to tick beside the
baseline and the capture. Such a screen reports review, and exits 7 only when
the pixels or a token colour fail hard.
--publish publishes compare-report as <slug>-compare, private by default.
```

