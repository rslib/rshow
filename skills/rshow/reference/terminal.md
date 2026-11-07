# Terminal

## Contents

- Three shapes
- The viewer
- ANSI captures
- Recordings
- Palettes
- The TUI kit
- A real ratatui app
- Checks

A terminal in a page is one of three things, and they are not interchangeable.

## Three shapes

| Shape | For | File |
|---|---|---|
| the viewer | a capture of a screen or a recording of a command, as evidence | `terminal.css`, `terminal.js` |
| the TUI kit | a drawing of a terminal user interface that does not exist yet | `tui.css`, `tui.js` |
| a real app | a ratatui tool that already builds and runs | Ratzilla plus `rshow publish --build` |

The viewer and the TUI kit are the theme's, and both are guided kits: the frame and the floor are given and the content is the work.

## The viewer

```html
<link rel="stylesheet" href="/_themes/default@latest/fonts.css">
<link rel="stylesheet" href="/_themes/default@latest/tokens.css">
<link rel="stylesheet" href="/_themes/default@latest/terminal.css">
<script src="/_themes/default@latest/mode.js"></script>
<script defer src="/_themes/default@latest/terminal.js"></script>
...
<figure class="terminal" data-mode="ansi" data-src="capture.ans"
        data-cols="100" data-rows="30" data-title="procview" data-palette="default"></figure>
<figure class="terminal" data-mode="cast" data-src="demo.cast"
        data-title="rshow publish ./deck"></figure>
```

`terminal.js` loads only what a figure needs, from jsDelivr at exact versions: xterm.js for an ANSI capture and asciinema-player for a recording.
Never write either URL by hand, because `terminal.js` owns the pin and a second copy in the page is a version to keep in step.
Put the capture files next to the page, so they travel in the same immutable version.
Link the file below each figure, so a reader can download the evidence and check it.

## ANSI captures

An ANSI capture is one screen of a full screen program, on a fixed grid.

```bash
tmux capture-pane -pet -p > capture.ans
tmux display -p '#{pane_width}x#{pane_height}'
```

Put the size that command prints into `data-cols` and `data-rows`, because a capture read at the wrong grid wraps in the wrong place.
A capture of a run with output is `script -q capture.ans -c "./tool --fast"` on a machine that has `script`.
The capture is read only: no stdin, no blinking cursor and no scrollback, because a terminal in a page is a picture of one and not a shell.
With JavaScript off or a library missing, the escapes are stripped and the screen is set as text, so the evidence still reads.

## Recordings

An asciinema recording is a real session with timing, and the player has a scrub bar.

```bash
asciinema rec demo.cast -c "./tool --fast"
```

Keep it under about 30 seconds and put the interesting line in the first three, because a reader watches a recording twice at most.
`data-title` names what the recording does, so the figure needs no caption to say what it is.
A recording is a file in the folder, never a link to somebody else's player.

## Palettes

`data-palette` picks one of four sets of sixteen colours, and `terminal.css` owns all four.

| Palette | Ground |
|---|---|
| `default` | the page ground, light or dark, with a neutral sixteen that holds on either |
| `dark` | a fixed dark ground, for a capture that is about being dark |
| `light` | a fixed light ground |
| `high-contrast` | black on white in a light page and white on black in a dark one |

The `default` set means one capture reads in both modes, so nothing has to be recorded twice.
At 360px the window frame scrolls inside its own box, so the page itself never scrolls sideways.

## The TUI kit

The kit draws a terminal user interface as cells, for the mockups that are a tool rather than a window, such as a git client, a log tail or a deploy console.

```html
<div class="tui" data-cols="100" data-rows="27" data-palette="default" data-depth="256">
  <div class="tui-screen">
    <div class="tui-body">
      <div class="tui-line tui-dim">ledger, git</div>
      <div class="tui-main">
        <div class="tui-pane" data-title="branches" data-cols="24" data-lines="23">...</div>
        <div class="tui-gap"></div>
        <div class="tui-pane" data-title="commits" data-focus data-cols="38" data-lines="23">...</div>
      </div>
      <div class="tui-statusbar">...</div>
      <div class="tui-keys"><kbd>j</kbd> next <kbd>s</kbd> stage <kbd>q</kbd> quit</div>
    </div>
  </div>
</div>
```

Load it inside a mockup, after `mockup.css` and a skin: `tui.css` and then `tui.js` deferred.
The rules the kit is drawn by, all of them checked by `tui.js`:

- Cells, not pixels.
  Type is one size, the line height is fixed and every block is a whole number of cells wide and lines tall.
  A half cell is a bug.
- Below 80x24 the grid is replaced by a resize message, because a terminal that small asks to be resized.
- Exactly one pane has `data-focus`, and focus is a double frame and a bold title, so it survives a reader who cannot see colour.
- `Ctrl+C`, `Ctrl+Z` and `Ctrl+\` belong to the terminal, so a drawing that binds them teaches a reader something the app cannot keep.
- Every palette is legible at `data-depth="16"`, because a drawing that needs true colour will meet a printer.

Use `tui-gauge`, `tui-sparkline`, `tui-table` and `tui-dialog` instead of a picture of them.
Mark a placeholder branch name or commit hash the same way as any other placeholder.
`tui.js` reports what it cannot fix in the console with an `[rshow tui]` prefix, so read the console before you call the drawing done.

## A real ratatui app

When the tool already exists, publish the tool instead of a drawing of it.
Ratzilla draws a ratatui `Terminal` into a browser page through its DOM backend, so the same code that runs in a terminal runs at the link.

- Build to `dist` with trunk, such as `trunk build --release`.
  Publish that build in one command.
- `rshow publish . --build "trunk build --release" --slug <slug>` runs the build in the folder and then uploads `<dir>/dist`, which is the `out` default.
- The build writes `index.html`, the JavaScript glue and a `.wasm`, and the host serves the wasm as `application/wasm` with no policy exception, because the page loads it from its own origin.
- Keep the wasm under 25 MiB per file, which is why the build is `--release` with debug symbols stripped and `opt-level = "z"` in the release profile when it is close.
- The content policy is `connect-src 'self'`, so the app reads its data from `/_data/<key>` or carries it in the wasm and fetches nothing from a third party.
- Publish the build and not the source tree, so `target/` and `node_modules/` never reach the host.

A real app is not a mockup: there are no states to draw and no annotations to hand off.
It is also the shape to prefer for a tool a person will actually use, because a Ratzilla page is the thing itself and a TUI kit is a drawing of it.

For the compare loop, `rshow compare` captures a terminal app through a `tmux:<session>:<pane>` entry in `map.screens`.
A browser build is captured through its URL.
Read `rshow-implement` for that loop, because it owns both the map and the compare.

## Checks

- `rshow check <dir>` exits 0, and every script URL carries an exact version.
- `rshow preview <dir>`, then read the figure at desktop width and at 360px, in both modes.
- For a real app, run the build locally first, then the published link.
  Click every control that changes state.
- Report the `live-url` and say which of the three shapes the page holds.
