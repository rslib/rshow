# Sketch

## Contents

- When a sketch
- Markup
- View and edit
- Save to the store
- Download and publish
- Ink and modes
- Checks

A sketch is a hand drawn figure from Excalidraw, read in the page and edited in place.
It is a guided kit rather than a documented template: `sketch.css` is the bar around the canvas and `sketch.js` is the canvas.
Use it for an architecture drawing, a flow of systems or an idea that should look unfinished.

## When a sketch

Use a sketch when the drawing is the thought: boxes and arrows between services, a state machine, a rough plan of a page.
Use a mockup when the drawing is a screen a builder will reproduce, because a sketch has no frames, no states and no annotations to hand off.
A sketch is also the honest shape for a workshop, where a tidy drawing would end the conversation early.

## Markup

```html
<link rel="stylesheet" href="/_themes/default@latest/fonts.css">
<link rel="stylesheet" href="/_themes/default@latest/tokens.css">
<link rel="stylesheet" href="/_themes/default@latest/sketch.css">
<script src="/_themes/default@latest/mode.js"></script>
<script defer src="/_themes/default@latest/sketch.js"></script>
...
<div class="sketch" data-src="drawing.excalidraw" data-store="sketch-main"></div>
```

`data-src` is the `.excalidraw` file to read, relative to the page.
`data-store` is the store key that holds a saved copy.
Leave `data-store` off a sketch nobody edits.

`sketch.js` loads React, ReactDOM and Excalidraw from jsDelivr at exact versions.
0.17.6 is the last release with a UMD bundle, which is why the pinned version is old on purpose.
Never upgrade that pin by hand, because a newer Excalidraw needs a bundler and the page has none.

## View and edit

View mode is the default: read only, fitted to the drawing, with pan and zoom.
The bar over the canvas carries `Edit`, which opens the editor, `Save`, which writes the scene to the store and `Download`, which writes a `.excalidraw` file.
The canvas takes Excalidraw's own chrome from the theme tokens, so the selection handle and the active tool are the theme's accent and not Excalidraw's blue.

## Save to the store

`Save` writes the scene to `/_data/<key>`, which is the one network call a page may make.
A saved scene wins over the file when its `savedAt` is later than the file's `Last-Modified`, and the bar says which of the two the reader is looking at.
A public viewer cannot write, so the messages are literal: `Sign in to save` on 401 and 403, `Saving works once published` on 404 and a pointer at `Download` on 413.
The store holds 64 KiB per key, and a drawing over that limit is a drawing to download and commit.

The store is not a file in the version, so an edit made in the browser lives outside the artifact.
Say that to the person when they save, because it is the one thing about a sketch that surprises people.

## Download and publish

`Download` writes a `.excalidraw` file, and that file is the one that becomes the artifact.
Commit it next to the page, then `rshow publish <dir> --slug <slug> --label "sketch: <what changed>"` so the drawing travels in an immutable version.
That publish is also what makes `Save` work for a viewer, because the page now has a published origin.

## Ink and modes

The drawing is authored on paper, in Carbon white values.
In dark mode the ink inverts for the screen and inverts back on save or download, so a committed file keeps one palette and the store holds what the reader drew.
Never edit the ink by hand in the JSON, because the next save rewrites it.

With JavaScript off, or with the CDN blocked, the page keeps the file link and the text fallback, so a reader still learns what the figure is.

## Checks

- `rshow check <dir>` exits 0, and every CDN URL carries an exact version.
- `rshow preview <dir>`, then open the figure in both modes and read the ink at 100 percent.
- Edit, save, reload: the saved scene comes back and the bar names the store as its source.
- Download, diff the file against the committed one and publish only when the difference is the change you meant.
