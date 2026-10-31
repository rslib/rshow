# Mockups

A mockup is a drawing of a product that does not exist yet, so it follows that product and not rshow.
It exists to settle layout and flow before anybody writes code.
The theme's Carbon tokens style the tool: the canvas, the toolbar, the states, the notes.
They never style what is inside a screen.
A screen looks like the thing being designed, which is why a mockup carries its own `--mk-*` tokens.

The kit is `mockup.css`, `mockup.js`, eight skins in `skins/`, the `tui.css` kit and six examples in `example/`.
Nothing is fixed the way a deck or a report is fixed: the kit gives an agent a frame and a floor, and the drawing is the work.

## Three layers

| Layer | File | Holds |
|---|---|---|
| tool | `mockup.css`, `mockup.js` | canvas, zoom, pan, focus, play, states, notes, comments |
| frames | `mockup.css` | generic chrome drawn in CSS, not any vendor's artwork |
| skin | `skins/*.css` | the blocks inside a screen, in the product's own look |

## Start low fidelity

Start in wire, every time.
A tidy drawing invites people to talk about the colour of the button instead of the order of the steps.
Move to sketch when the room is too polite about a finished looking picture.
Move to custom only when the look of the product is the decision.

## Which skin

- `wire` for structure, hierarchy and flow, and for anything still being argued about.
- `sketch` for a first idea, a whiteboard or a workshop where the drawing should look unfinished.
- `custom` for a product with a look of its own: a desktop client, a dense tool, a dark editor.
- `fluent` for a Windows 11 client, a settings panel or an enterprise tool that ships on Windows.
  `skins/fluent.js` upgrades the `wf-*` controls into the real Fluent UI Web Components while the skin is on and puts the kit back when it goes.
- `mac` for a macOS client: the window, the toolbar, the 13px control, the dense table.
- `adwaita` for a GNOME or libadwaita app, which is what a GTK4 tool actually looks like.
- `egui` for a Rust tool, an egui panel, a bevy debug screen.
- `material` for an Android client or a Material 3 web app.

Each platform skin scopes its rules to `[data-skin="<name>"]`, so one artboard can carry one platform and the next artboard another.
`example/mockup-platforms.html` is the pattern to copy: `data-skin="pin"` on the main element, one skin per artboard and one sheet per skin in the head.
The toolbar then reads "per screen" and leaves those artboards alone, and every skin still switches back and forth on a page that names one skin.

Two rules hold for all eight.
A screen keeps its own `--mk-*` tokens, so a skin never leaks into the toolbar.
A skin is a drawing of a platform and not an import of one: no vendor font, no vendor asset, no vendor script except the pinned Fluent module that `fluent.js` asks for.

The sketch skin fetches rough.js at one pinned version and falls back to wire if it cannot.
Switching skins in the toolbar restyles every screen, so a mockup can answer both questions.

## Frames

`browser` for a web app, `phone` and `tablet` for a client, `desktop` with `data-os` for a desktop app.
`custom` when the app paints its own title bar, and mark the drag region with class `drag-region`.
`bare` for egui, a game, a kiosk or anything that draws every pixel itself.
`terminal` for a tui or a shell: one title bar in mono and one body, which is the frame `terminal.css` also draws around a capture.
An artboard framed as a terminal takes `tui.css` content directly, so `data-flush` and a `.tui` grid inside it are enough for a full screen.
A desktop app may ignore the native conventions of the platform it ships on, because Electron, Tauri and egui do.
Match the product, and use `custom` or `bare` rather than forcing a title bar the product does not have.

## One flow per file

One mockup file is one flow from one entry point to one outcome.
Name an artboard by what the person is doing there: Gallery, Share dialog, Invite accepted.
Never name one by the widget that happens to be on it.
Link the flow with `<a href="#other-id">` or with `data-goto="other-id"`, and play it in Play mode.

## States to always cover

Empty, loading, error, long content and narrow width, for every screen where they can happen.
`data-states="empty,loading,error"` puts a tab under the title, and a block marked `data-state="empty"` draws only in that state.
A block may name more than one state, so `data-state="default,error"` is the list that stays when the error message appears.
A state is where the argument about a mockup usually happens: the happy path is the picture everybody already agreed on.

## Annotations

Annotate a decision, never something a reader can already see.
"This is a button" is not a note.
"Copy link is the one action, the rest is support for it" is a note.
Put a `<span class="note-pin" data-note="...">` on the screen and the notes panel in focus view collects them by number.
Review comments are separate: they live in the artifact's JSON store and the server records who wrote each one.

## Invent and mark

Layout, spacing, hierarchy and the order of steps are free to invent, because that is the design.
Data, copy, names, numbers and prices are not: mark them as placeholders in a note or in an HTML comment.
Never present invented data as if somebody measured it.

## Markup

```html
<main class="mockup" data-skin="wire" data-name="rshow admin" data-store="../_data/mockup-comments">
  <section class="artboard" id="gallery" data-frame="browser" data-title="Gallery"
           data-url="art.example.com/admin" data-states="empty,loading,error"
           data-w="1280" data-h="800">
    <div class="wf-col">...</div>
  </section>
</main>
```

Link `fonts.css`, `tokens.css`, `mockup.css` and one skin, then `mode.js` in the head and `mockup.js` and `skins/sketch.js` deferred.
The skin link carries `id="mk-skin"` and `data-mk-skin`, and the toolbar swaps it.
`mockup.js` fetches `skins/fluent.js` itself the first time fluent is picked, so a page names that script only when an artboard pins it.
`data-flush` drops the default padding of a screen for an app shell that runs to the edges.

## The tui kit

A tui is a drawing of a terminal and not a screenshot of one: `<div class="tui" data-cols="100" data-rows="27" data-palette="default" data-depth="256">` with a `.tui-screen` inside it.
Every block is a whole number of cells wide and a whole number of lines tall, and the frame around a pane is the box drawing a real program would print.

- 80x24 is the gate.
  Below it `tui.js` replaces the grid with the words a terminal says when it is too small, because a smaller terminal is not a small terminal.
- One pane has focus, marked `data-focus`, and it is drawn with a double frame and a bold title.
  A focus that only exists as a colour disappears in a one colour palette and on paper.
- Never bind Ctrl+C, Ctrl+Z or Ctrl+\ in a tui mockup.
  The terminal owns those three chords, so the hints use plain letters and the drawing shows what the app can keep.
- Degrade to 16 colours.
  `data-depth="16"` has to read on every palette, so the `+` and the `-` of a diff carry the meaning and the green and the red only help.
- A palette is `default`, `dark`, `light`, `high-contrast` or `mono`.
  Every one of them is legible at 16 colours, in both modes and on a printed page.
- The arrow keys belong to the app, so a status bar that lists them is a feature and not decoration.

## Four ways to show a real terminal program

- The kit: `tui.css` and `tui.js` draw the screen in cells, so a second state, a note or a second language costs nothing and the drawing scales with the artboard, which is the way to show a flow with states.
- A capture: `tmux capture-pane -ep` writes an ANSI file and `<div class="terminal" data-mode="ansi" data-src="capture.ans" data-cols="100" data-rows="24">` plays it in the terminal frame, which is the way to show what the program really printed.
- An SVG: `freeze capture.ans -o screen.svg` from charmbracelet/freeze renders the same capture to a vector image that goes in a `<figure>` with a caption, which is the way to put a real screen in a deck or on a poster that has to print.
- A recording: `asciinema rec demo.cast` writes an asciicast and `data-mode="cast"` replays it, paused on its first frame until a reader presses play, which is the way to show timing.

## A ratatui app in the page

A ratatui app compiles to WebAssembly and answers real key presses, which is the one way to show a tui that is not a drawing.
Ratzilla runs the same ratatui draw code on a canvas in the browser and trunk builds it:

```bash
cargo add ratatui ratzilla
rshow publish ./app --build "trunk build --release"
```

`dist` is the default out folder, so rshow publishes the built folder and not the source.
The result is a page that `rshow check ./app/dist` reads like any other, and an artifact that keeps working after the build is gone.
Keep the demo on one screen: a reader in a page cannot install anything, cannot pipe a file and cannot wait.

## Sketches

A freeform drawing is an Excalidraw file and not a hand written SVG: `<div class="sketch" data-src="drawing.excalidraw" data-store="sketch-main">` reads it in place, and a reader can edit it there.
Rough boxes, an arrow drawn by hand and a scribbled label belong here, next to the mockup that needs one diagram of the flow.
The ink is the theme's and the paper is `--bg`, so a sketch sits on the page with no card around it.

## Keys

A reader can work the whole canvas without the mouse.

| Key | What it does |
|---|---|
| `w` `a` `s` `d`, arrows | pan the canvas; in focus view a step moves along the flow |
| `Shift` with a pan key | pan a quarter of the stage |
| `+` `-` | zoom around the middle of the stage |
| `0`, `z` | fit every screen, zoom to 100% |
| `[` `]`, `Shift+Tab` `Tab` | select the previous and next screen |
| `Enter`, `Esc` | open the selected screen, go back to the canvas |
| `1` to `9` | pick a state of the screen the keys are on, `1` being Default |
| `?` | the list of keys, which `Esc` closes first |

The selected screen carries an outline in the canvas, and in focus view the arrows and `a` `d` step to the next screen in `boards` order.
A screen taller than the stage pans with `w` and `s` once it is open.
No key fires with Ctrl, meta or alt held, and a field keeps its own keys, so a comment can be typed without the canvas moving.
There is also a quiet `? keys` button in the bottom left corner of the stage, for a reader who never guesses the key.

## Look at it

`rshow check <dir>` exits 0 before anything is published.
Then look at the canvas, the focus view and Play mode, in both modes, at desktop width and at 360px.
A mockup that was never looked at is a drawing of a guess.
Print puts one artboard on a page with no tool chrome, which is what a review meeting wants on paper.
