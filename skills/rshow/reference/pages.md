# Pages

## Contents

- Folder shape
- The skeleton
- Modes
- Token overrides
- Figures and charts
- Prerendered sites

A page is a folder with an `index.html` in it and whatever files that page needs.
This file holds the skeleton, the token override, the figures and the prerendered shapes.
Decks are a different skeleton, and `rshow-slides` holds that one.

## Folder shape

```text
reports/q3/
  index.html
  page.html        # optional, a second page of the same artifact
  chart.svg
```

Publish the folder, not a file, so the extra pages and assets travel with it.
A single file published on its own becomes `index.html` and nothing else is uploaded.

## The skeleton

Replace `<name>@<n>` with the `theme` value that `rshow config <dir>` prints, which the server resolves to the current version. Use `default@3` only when `rshow config` warns that it cannot resolve the theme.
Every link carries the same version on purpose, because a mixed version renders somewhere between two designs.

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Q3 latency report</title>
<link rel="stylesheet" href="/_themes/default@3/fonts.css">
<link rel="stylesheet" href="/_themes/default@3/tokens.css">
<link rel="stylesheet" href="/_themes/default@3/page.css">
<script src="/_themes/default@3/mode.js"></script>
<style>:root{--accent: #0f62fe;}</style>
</head>
<body>
<main>

  <h1>Latency after the cache change</h1>
  <p class="lede">One sentence that says what this page answers.</p>

  <h2>What changed</h2>
  <p>Body copy sits at the theme measure. <strong>Bold</strong> is a weight, not a colour.</p>

  <div class="table">
    <table>
      <caption>Example data, results per configuration</caption>
      <thead><tr><th scope="col">Config</th><th scope="col" class="num-cell">P50</th></tr></thead>
      <tbody><tr><td>baseline</td><td class="num-cell">[PLACEHOLDER]</td></tr></tbody>
    </table>
  </div>

  <h2>The write path</h2>
  <pre><code>rshow publish ./report --label "first public version"</code></pre>

  <footer>Source: [PLACEHOLDER]. Written [PLACEHOLDER].</footer>

</main>
</body>
</html>
```

`page.css` gives you `lede`, `table`, `num-cell`, `muted`, `small` and `mono`, plus the heading, list, figure, table and code rules.
Use them and keep your own CSS to the one `:root` block.
There is no card class, no label class and no number tile.
A page that needs one is usually a page with a table it has not written yet.

The theme carries both modes, so the same page reads on white and on g100 with nothing in the page itself.

## Modes

One theme, two modes, system by default.
`mode.js` goes in the head, not at the end of the body, because it sets `data-mode` before the body paints and stops the flash of a white page on the way to dark.
It reads the storage key `rshow-mode` (`light`, `dark` or `system`) inside a try/catch, because a private window refuses storage and the page still has to work, and it exposes `window.rshowMode = { get, set, cycle }`.

The toggle is a real `<button>` with an aria-label, a 44px target and the Carbon ghost look.
A page that has a place for it writes the button itself:

```html
<button type="button" data-rshow-mode-toggle>Mode</button>
```

Without that element `mode.js` mounts a small fixed button in the bottom right corner, which stays out of print either way.
A deck shares the key, and `t` cycles the same three modes with the mode shown in the counter.
Print is always light, whatever the screen was.

## Token overrides

Override a token instead of writing rules.
Five declarations cover most restyling.

```html
<style>:root{
  --accent: #0f62fe;
  --pad-x: 80px;
  --border-subtle: #e0e0e0;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-mode="light"]) { --accent: #78a9ff; }
}
:root[data-mode="dark"] { --accent: #78a9ff; }
</style>
```

A token that carries text needs a value per mode, because a colour that reads on white is not a colour that reads on g100.
A token that only fills a shape can be set once.

The block goes after the theme links so it wins, and it stays in `index.html` so one artifact stays one folder.
Change a role, not a rule: a page that sets `--border-subtle` to near black gets heavy table rows, which is the point of a role.
A new font has to be a linked stylesheet or a system stack, because a `@font-face` in an override needs a font file in the artifact and the contract says no theme files.
If the look has to change past what an override can carry, read `themes.md` and publish a theme.

## Figures and charts

- Draw the figure as inline `<svg>` in the page, with `role="img"` and an `aria-label` that says what it shows.
- Take the colours from tokens with a style attribute, such as `style="stroke: var(--accent)"` and `style="fill: var(--layer-01)"`, so light and dark both work.
  A `var()` inside a presentation attribute is not reliable, so put it in `style`.
- Keep the text in the SVG as text, so it stays selectable and readable on a phone.
- Add a `<figure>` and a `<figcaption>` when the figure carries an argument.
- Label a line at its end or a bar above its head, so the figure needs no legend box.
- Draw one series in `var(--accent)`, the same blue as a link, because one series is not a category.
  Two or more series take `--chart-1`, `--chart-2` and so on in order.
  That order holds in every figure in the artifact.
- Mark example data as example data in the caption, with round numbers and no claim of a measurement.
- Reach for Mermaid only when the graph changes often, and pin it with the exact version.
- Never ship a diagram as a screenshot of a slide, because it stops scaling at phone width.

A screenshot of a real interface is fine, as a `png` or a `webp` next to the page, with an `alt` that says what to look at.

## Prerendered sites

The host serves files.
There is no Node process, no server rendering, no API route and no edge function, so a framework works only when it writes static files.

Astro works when `output` is `'static'` and the interactive part is an island, so everything else ships as HTML.
Vite with vanilla, Svelte or React works the same way, because all three write a folder.

Publish the build output, never the source tree:

```bash
rshow check dist
rshow publish . --build "npm run build" --slug status --label "first public build"
```

`--build` runs the command in `<dir>` through your shell, so the build has to work in that folder with no extra arguments.
When a build runs, the folder that gets published is `<dir>/<out>`.
The `out` field defaults to `dist`.

Put the same thing in `rshow.json` when it should not be retyped:

```json
{
  "slug": "status",
  "title": "Cluster status",
  "theme": "default@3",
  "build": "npm run build",
  "out": "dist"
}
```

With `rshow.json` in place, `rshow publish .` builds and publishes `dist` with no flags at all.
`rshow check .` reads the same `rshow.json` and checks `<dir>/<out>`, so run the build once before a check on a clean tree.

A prerendered site still has to pass the page contract, and the parts that break it are almost always the same three: an absolute asset path from the framework, an API call in the client bundle and a font loaded from a third party host.
