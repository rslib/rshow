# Mockups

## Contents

- A guided kit
- Markup
- Frames
- Skins
- One flow per file
- States
- Annotations and comments
- Placeholders
- Look at it

A mockup is a drawing of a product that does not exist yet, so it follows that product and not rshow.
Decks, reports, posters, project pages and dashboards are documented templates, while a mockup is a guided kit: the kit gives you a frame, a floor and a checklist, and the drawing is the work.
`themes/MOCKUPS.md` in the rshow repo holds the kit itself, and this file is what to do with it.

## A guided kit

- Pick the skin from the question.
- Use `wire` when the flow or the order of the layout is the question, because a tidy drawing invites a room to argue about the colour of a button instead of the order of the steps.
- Use `sketch` for an early rough idea, or when the room is too polite about a finished looking picture.
- Use a platform skin, or `tui` and `terminal` for a terminal, when the look is the decision or the person asks for the look.
- Keep the inventing to layout, spacing, hierarchy and the order of steps.
  Own CSS inside a screen is allowed for the part the kit lacks, and it takes colour from the `--mk-*` and theme tokens so a skin swap and dark mode still read.
  Data, copy, names and prices are placeholders and say so.

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
The skin link carries `id="mk-skin"` and `data-mk-skin`, so the toolbar can swap it.
`data-flush` drops the default padding of a screen for an app shell that runs to the edges.
`mockup.js` builds the toolbar, the frame chrome, the tabs, the notes panel and the comments panel.
With JavaScript off the artboards are a plain column of screens and the skin still draws them.

One file is one flow, so a second flow is a second file and a second artifact.

## Frames

| `data-frame` | Use |
|---|---|
| `browser` | a web app, with `data-url` for the address bar |
| `phone` | a mobile client |
| `tablet` | a tablet client |
| `desktop` | a desktop app, with `data-os` set to `mac`, `windows` or `linux` |
| `custom` | an app that paints its own title bar, with the drag area marked `drag-region` |
| `bare` | egui, a game, a kiosk or anything that draws every pixel itself |

Electron, Tauri and egui ignore the native conventions of the platform they ship on, so match the product and use `custom` or `bare` rather than forcing a title bar it does not have.

## Skins

One skin loads at a time and it styles what is inside a screen, never the tool.

| Skin | For |
|---|---|
| `wire` | structure, hierarchy and flow, for anything still being argued about |
| `sketch` | a first idea, a whiteboard or a workshop, where the drawing should look unfinished |
| `custom` | a product with a look of its own, driven by `--mk-*` tokens |
| `fluent` | a Windows app, with Fluent's corner radii and its bottom edge focus bar |
| `mac` | a macOS app, with a hairline separator and a segmented control for tabs |
| `adwaita` | a GTK 4 or GNOME app, with a header bar and rows that are boxes |
| `egui` | an immediate mode tool, flat and dark by default with one selection blue |
| `material` | an Android or Material 3 app, where elevation is a tone and then a shadow |

Every skin draws the same `wf-*` kit: `wf-row`, `wf-col`, `wf-card`, `wf-button`, `wf-input`, `wf-tabs`, `wf-table`, `wf-chart` and the rest.
Learn the kit once and a skin swap restyles every screen.
The sketch skin fetches rough.js at one pinned version and falls back to wire when it cannot, so a reader never gets a half drawn screen.

## One flow per file

Name an artboard by what the person is doing there, such as Gallery, Share dialog or Invite accepted.
Never name one by the widget that happens to be on it.
Link the flow with `<a href="#other-id">` or with `data-goto="other-id"`, and play it in Play mode.
A screen nobody can reach from the entry artboard is a screen to delete or to link.

## States

`data-states="empty,loading,error"` puts a tab under the title, and a block marked `data-state="empty"` draws only in that state.
A block may name more than one state, so `data-state="default,error"` is the list that stays when the error message appears.
Always cover empty, loading, error, long content and narrow width, for every screen where they can happen.
A state is where the argument about a mockup usually happens, because the happy path is the picture everybody already agreed on.

## Annotations and comments

Annotate a decision, never something a reader can already see.
A `<span class="note-pin" data-note="Copy link is the one action, the rest supports it">` sits on the screen and the notes panel in focus view collects the pins by number.
Comments are separate and they are the review: they live in the artifact JSON store named by `data-store`, which defaults to `../_data/mockup-comments`, and the server records who wrote each one.
A public viewer cannot write, so a comment needs a signed in viewer.
The store holds 64 KiB, so a comment thread is a thread and not a document.

## Placeholders

Layout, spacing, hierarchy and the order of steps are free to invent, because that is the design.
Data, copy, names, numbers and prices are not, so mark them as placeholders in a note or in an HTML comment.
Never present invented data as if somebody measured it.

## Look at it

- `rshow check <dir>` exits 0, then `rshow preview <dir>`.
- Look at the canvas, the focus view and Play mode, in both modes, at desktop width and at 360px.
- Press `?` on the page for the keys: `w` `a` `s` `d` or the arrows pan, `[` `]` step between screens, `Enter` opens one, `1` to `9` pick a state, so tell the person about that list.
- Switch the skin in the toolbar and check the drawing still reads.
- Print puts one artboard on a page with no tool chrome, which is what a review meeting wants on paper.
- `rshow publish <dir> --slug <slug> --label "<what changed>"`, then read `rshow-implement` before anybody writes code from it.
