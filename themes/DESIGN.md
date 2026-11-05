# rshow theme design

One theme ships, `default`: IBM Carbon v11 with IBM Plex, in two modes, light (Carbon white) and dark (Carbon g100), following the system by default.
This file is the reference the skills point at, and it holds the rules that keep an artifact out of the generated look.

The theme is `tokens.css`, `fonts.css`, `page.css`, `deck.css`, `report.css`, `project.css`, `poster.css`, `dashboard.css`, `mockup.css`, `tui.css`, `terminal.css`, `sketch.css`, `mode.js`, `deck.js`, `report.js`, `project.js`, `poster.js`, `dashboard.js`, `mockup.js`, `tui.js`, `terminal.js`, `sketch.js`, the skins in `skins/`, the Plex files in `fonts/` and one example per layout in `example/`.
`theme.json` names the files and the example of every layout in its `layouts` map, so a tool reads that map rather than this list.

## The system

The look comes from a documented design system, not from an invented mix.
Every colour, space and size is a Carbon v11 value copied into `tokens.css` by hand.
Nothing loads from Carbon at runtime: no stylesheet, no class name, no CDN.
The type is IBM Plex Sans in three weights and IBM Plex Mono in one, self hosted from `fonts/` with the OFL licence beside it.
Corners are square because Carbon is square, and no element casts a shadow.
`themes/default` is Carbon white in light mode and Carbon g100 in dark mode, for a deck, a page and a report.
A mode is a token swap and not a second theme: same spacing, same type, same one blue.

## Modes

One theme, two modes, system by default.
The light values sit on `:root` in `tokens.css`.
The dark values appear twice, under `@media (prefers-color-scheme: dark) { :root:not([data-mode="light"]) { ... } }` and again under `:root[data-mode="dark"] { ... }`, so a reader can go against the system on purpose.
`--chart-1` to `--chart-8` carry a light and a dark palette in the same way.

`mode.js` runs in the head, before the body paints, so no page flashes white on its way to dark.
It reads the storage key `rshow-mode`, whose values are `light`, `dark` and `system` (an absent key means system).
Every storage call sits in a try/catch, because a private window refuses storage and the page still has to work.
It sets `data-mode` on the document element and removes the attribute for system, and it exposes `window.rshowMode = { get, set, cycle }`.
It also mounts one toggle: an element marked `data-rshow-mode-toggle` if the page has one, otherwise a small fixed button in the bottom right corner.
The button is a real `<button>` with an aria-label, a 44px target and the Carbon ghost look.
It names the current mode in words, and it has no place in print.

A deck shares the same key: `t` cycles system, light and dark and the counter shows the mode for a moment.
Print is always light, so paper and PDF keep one ground.

## Palette roles

Every colour has one job.

- `--bg` is the ground of a deck.
- `--bg-shell` is the area around the 1280x720 canvas.
- `--layer-01` is a filled block on the ground such as a code block or a diagram box.
- `--layer-02` is a second level and it is rare.
- `--border-subtle` rules a table row.
- `--border-strong` draws an axis line or a diagram outline.
- `--fg` is every heading and every paragraph.
- `--muted` is a caption, a source line or a label beside a number.
- `--placeholder` is decorative and never text.
- `--accent` is a link, a focus ring or the one connective line in a figure.
- `--support-error`, `--support-success` and `--support-warning` are data marks and never text.
- `--chart-1` to `--chart-8` are a categorical series in Carbon order.

A chart with one series draws that series in `--accent`, the same blue as a link, because one series is not a category.
A chart with two or more series takes `--chart-1`, `--chart-2` and so on, in order, one per series.
That order holds across every figure in the document.

Every text pair clears 4.5:1 on the ground it sits on.
The measured ratios sit in a comment at the top of each `tokens.css`, next to the values.

## Presets

A preset is a small folder that extends a built-in theme, and it may change only token values and fonts.
It never renames a class, adds a layout or changes the markup a page writes against, because those are the interface the theme promises and every artifact points at it.
A page may still add a class of its own in its own `<style>` block, which a preset never sees.
So a preset gets a new accent, a new ground and a new type family, and the deck, the page and the report keep their shape.
`rshow theme new`, `rshow theme check` and `rshow theme preview` are the edit loop, and `rshow theme publish` ships the built folder.

## Type scale

The scale is Carbon expressive for the display sizes and Carbon body sizes for running text.
The jump from body to slide title is deliberate and it is the widest step in the system.

- 14px and 16px for the slide counter, the mode button and a second level caption.
- 18px for prose on a page, and the smallest size a caption on a slide may take.
- 20px for a line under a bullet, 24px for slide prose and for a table body.
- 28px for a bullet, for a two column body line and for a report heading.
- 32px, 42px, 54px, 60px and 76px for the display sizes on a slide.

Weight 300 for a display line and weight 400 for a slide title, because 600 belongs to a small heading and to emphasis.
Line height is 1.25 on a heading, 1.4 on a bullet list, 1.45 on slide prose and 1.6 on a page.
Letter spacing is zero for body and for headings up to 54px, and it tightens to minus 0.02em only above 54px.
Mono is for code and for data and it never sets a label.

## Layouts

A slide is `<section class="slide ...">` with one layout class second.
The canvas is 1280x720 and one slide carries one idea that a reader can take in about 3 seconds.

A sparse slide is centred on the optical centre, which is a little above the geometric one, so the air sits under the block rather than closing it in.
A slide with a figure starts at the top and lets the figure take the rest of the canvas.
A bullets slide sets its title first and then at most five points at 28px, one line each where the claim allows.

- `title` for the opener: a display title, a one line subtitle and one plain line of name, affiliation, venue and date.
- `section` for a divider: one big title, left aligned, with space around it.
- `statement` for the claim of the slide as one sentence, set large.
- `bullets` for a takeaway title and at most five short points.
- `figure` for one diagram or image that fills the rest of the slide, with a one line caption.
- `chart` for an inline SVG chart with a direct label on each series and no legend box.
- `table` for a clean data table with numbers right aligned in tabular figures.
- `code` for one block or one command in Plex Mono on `--layer-01`.
- `two-col` for two blocks of text with a plain heading each.
- `figure-two` for two diagrams side by side with a short label under each.
- `quote` for one sentence and its attribution, with no giant quote mark.
- `big-number` for one number and the sentence that says what it means.

The twelve are a starting set and not a ceiling.
A deck may add a layout of its own as `.slide.<name>` in one inline `<style>` block, when none of the twelve carries the claim.
An annotated figure, a figure with a callout, a diagram built in HTML or SVG, a timeline, a before and after and a comparison grid are the usual ones.
The colours come from the tokens, and the slide still fits the canvas and still reads at 360px wide.

On a phone held upright a slide is a 390x219 strip, so below 700px of width in portrait `deck.js` turns the deck into a reading page: every slide is stacked down the page at the width of the screen and reflowed for it, at 32px for an `h1`, 24px for an `h2` and 17px for running text, with the notes hidden and every step revealed.
Nothing is scaled, because a 1280x720 canvas shrunk to 390px sets the body text near 9px: the figures take the width they are given, a wide table or a block of code scrolls inside itself, every two-column and grid layout stacks, and a rule and an `n / total` label mark where one slide ends.
A layout of a deck's own takes the same stacking and the same width and is otherwise left alone.
The page then scrolls like a document, `#n` opens at slide n, and a small fixed button presents one slide at a time, which `Esc` comes back from.
A landscape phone and a desktop keep one slide at a time.

A page keeps the same rules: prose at about 72 characters, the same table rules and the same figure rules.
A page may add a class of its own in one inline `<style>` block in the same way, scoped to that class.

## Report

A report is a page for reading rather than a slide for a room: `<div class="report">` with a `<nav class="toc">`, one `<main>` and the notes that `report.js` adds.
`report.css` sets the look and `report.js` sets the numbering, and both work with JavaScript off as a plain readable document.

- The title block carries a title, a subtitle, the authors and their affiliations, the date and a version line in `--muted`.
- Body text is 18px Plex Sans on a 1.6 line at about seventy characters, and the measure belongs to the text column, so a table, a figure and a paragraph end on the same line.
- Headings are weights 400 and 600 with clear steps (42, 28, 20 and 18px) in sentence case.
  No eyebrow sits above one.
- Above 1056px the page is three columns: contents, text and side notes, with the side columns sticky.
  Below it the contents collapses at the top and the notes move to the end of the document.
- The contents, the figure and table numbers, the cross-references, the notes and the reference back-links are all generated.
  Every one of them is a plain element a reader can still follow without a script.
- Print is one column of black on white.
  `@page` is size auto with 18mm margins, a URL follows an external link, a figure does not split and a page break happens only where a heading carries `data-break`.
  The page number runs in the bottom margin.

## Math

Math is the one addon of the theme: `math.css` and `math.js`, over KaTeX 0.19.1, which is vendored into `themes/default` under its MIT licence.
An addon is not a layout, so a page that writes no math links neither file and pays nothing for it.
The LaTeX is the text of an element with the class `math`, and `div.math` is display math while any other element is inline.
A `$` in the prose stays a price and is never scanned.
KaTeX sets an equation in its own serif beside Plex on purpose: a formula is not a sentence, and the face with the real fraction bars is the one that reads as mathematics.
The colour is inherited, so dark mode needs no second rule, and a wide equation scrolls inside its own box on a phone rather than widening the page.
A copy of an equation gives the LaTeX behind it.

## Documented templates and guided kits

There are two kinds of layout in the theme and they ask for different work.
A documented template is the deck, the report, the poster, the project page and the dashboard: the markup is documented, the classes are the theme's and the work is the content.
The theme is the base, not a cage, so the markup is the starting point and a page may add its own parts with its own classes and its own CSS when the content needs them.
A guided kit is a mockup, a sketch, a terminal and a tui.
The kit gives a frame and a floor.
The drawing inside is the work.
`MOCKUPS.md` holds the rules for the kits, and inside them an agent may invent layout, spacing, hierarchy and the order of steps.
A terminal capture is a viewer and never an invention: it shows a file that was recorded somewhere else.

### Own CSS

- One inline `<style>` block per page, with its own classes and its own layouts.
- Colour, type and space come from the tokens with `var(--...)`, so light, dark, print and a theme swap keep working.
  A hard-coded colour sits inside a figure only.
- A new deck layout is scoped as `.slide.<name>` and a page part under an own class name.
  No theme class is restyled globally and no rule carries `!important`.
- A token override stays in one `:root` block, with no limit on the declarations.
- A deck still fits the 1280x720 canvas and a page still reads at 360px wide, in both modes.

### Project

A project page is `<div class="project">` with one `<header class="project-head">`, one `<figure class="teaser wide">`, one `<main>` and one `<footer>`.
Every child of the project is one column of prose at about 72 characters and a child marked `wide` takes the wider measure, which is what the teaser and a wide table use.
The head carries the title, the authors, the affiliations, the marks, the venue and the links.
`project.js` only adds the copy button.

### Poster

A poster is `<div class="poster" data-size="a0">` inside `<div class="poster-stage">`, with a toolbar of `[data-poster-size]` buttons above it.
`poster.js` scales the sheet to the window, writes the size into one `@page` rule and draws a QR code for any `[data-qr]` element.
The sheet sizes are A0, A1, 36x48 and 48x36.
A `?size=` parameter prints the same sheet a reader saw.

### Dashboard

A dashboard is `<div class="dashboard">` with a `<header class="dash-head">` and one `<section class="dash-section">` per panel.
The data is a CSV or JSON file named in `data-src`, or a `<script type="application/json">` block, and the columns are named in `data-facet`, `data-x`, `data-series`, `data-metric` and `data-unit`.
`dashboard.js` draws the summary, the chart and the table from those attributes with no chart library and keeps the view in the URL hash.

### Mockup

A mockup is `<main class="mockup" data-skin="wire">` with one `<section class="artboard" data-frame="browser" data-title="Gallery">` per screen.
The frames are browser, phone, tablet, desktop, custom, bare and terminal.
The terminal frame is a title bar in mono over a screen that `tui.css` fills with cells.
`mockup.js` owns the toolbar, the canvas, the focus view, the states, the notes and the skin switch.
The skins in `skins/` are wire, sketch, custom, fluent, mac, adwaita, egui and material.
Four screens at 12% are a thumbnail on a phone, so a stage narrower than 700px and a URL that asks for no view opens the first screen in the focus view, fitted to the width, with the Previous and Next buttons and `Esc`; `?view=` and `#screen` still say what they say.

### Sketch

A sketch is `<div class="sketch" data-src="drawing.excalidraw" data-store="sketch-main">` and it is an Excalidraw drawing, not a hand written SVG.
`sketch.js` loads a pinned Excalidraw build, reads the file in view mode and writes a saved scene to the artifact store, so the drawing is edited where it is read.
A freeform diagram that only has to be looked at is an Excalidraw file in this viewer and a diagram that is data is a figure the page draws itself.

### Terminal

A terminal is `<div class="terminal" data-mode="ansi" data-src="capture.ans" data-cols="100" data-rows="24" data-title="procview">` for a capture of a screen, or `data-mode="cast"` with an asciicast for a recording.
`terminal.js` loads xterm or asciinema-player from a pinned CDN only when a figure of that kind exists and falls back to a stripped `<pre>` when it cannot.
A hundred columns do not fit a phone, and fitted to it the text would be five pixels tall, so the frame keeps the width of the page and the grid or the recording scrolls sideways inside it; a recording is fitted to the width only while the fit keeps its text at 9px or more.

### Tui

A tui is `<div class="tui" data-cols="100" data-rows="27" data-palette="default" data-depth="256">` with a `<div class="tui-screen">` inside it.
`tui.js` turns the column and row counts into the grid, draws the pane frames, gates anything under 80x24 and warns when a block does not fit a whole cell.
Its rules are in `MOCKUPS.md`: cells and not pixels, one focused pane, no app binding on Ctrl+C, Ctrl+Z or Ctrl+\ and a palette that still reads at 16 colours.

## What the work does instead

The subject decides the shape.
In a research talk or a systems talk the figure, the plot, the table and the diagram are the hero, so the type steps back and the evidence fills the slide.
A chart is labelled where the line ends, so a reader never looks back and forth to a legend.
Decoration that carries no information is deleted rather than made quieter.

## Never

- Never write an eyebrow, a kicker or a small caps label with wide tracking above a heading.
- Never set a label in mono or in capitals.
- Never write a meta string such as `A / B / C` above a title.
- Never number a slide or a card 01, 02, 03.
- Never ship three equal cards with a coloured top rule.
- Never build an identity from cream and terracotta, from beige and brass or from near black plus one bright accent.
- Never put a coloured bar on a slide edge or a rule down the side of a quote.
- Never use a hairline rule as decoration.
- Never use Inter, Space Grotesk, Geist, Fraunces or Instrument Serif as the gesture.
- Never use gradient text, glass, a large shadow or an emoji.
- Never animate a slide in for decoration.
  Motion is allowed when it explains something, such as a step that builds a diagram or a short transition that shows a change.
- Never invent a number and never present example data without saying so.
