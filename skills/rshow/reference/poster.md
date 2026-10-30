# Poster

## Contents

- The sheet
- Skeleton
- Blocks
- Figures
- QR code
- Print
- Checks

A poster is one sheet that prints from the browser, in the same theme as a page, a report and a project page.
It is a fixed template, so the sheet, the columns and the print are set and the blocks are the work.
`poster.css` sets the look and `poster.js` sets the scale, the QR code and the one page print.

## The sheet

A sheet is an attribute on the poster and never a second stylesheet.

| `data-size` | Size | Columns |
|---|---|---|
| `a0` | 841 x 1189 mm, the default | three |
| `a1` | 594 x 841 mm | three |
| `36x48` | 3 x 4 ft, shown landscape | four |
| `48x36` | the same sheet in portrait | three |

`?size=a1` in the address picks a sheet without a click, which is what a print check and an automated print use.
The status line beside the buttons always names the width and the height, so the sheet a print will use is never a guess.

## Skeleton

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Immutable artifacts for reproducible figures</title>
<link rel="stylesheet" href="/_themes/default@3/fonts.css">
<link rel="stylesheet" href="/_themes/default@3/tokens.css">
<link rel="stylesheet" href="/_themes/default@3/poster.css">
<script src="/_themes/default@3/mode.js"></script>
<script defer src="https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js"></script>
<script defer src="/_themes/default@3/poster.js"></script>
</head>
<body>

<div class="poster-toolbar">
  <div class="poster-sizes" role="group" aria-label="Poster size">
    <button type="button" data-poster-size="a0" aria-pressed="true">A0</button>
    <button type="button" data-poster-size="a1" aria-pressed="false">A1</button>
  </div>
  <button type="button" data-poster-print>Print</button>
  <span class="poster-status" data-poster-status>A0, 841 mm wide x 1189 mm tall, three columns</span>
</div>

<div class="poster-stage">
  <div class="poster" data-size="a0">
    <header class="poster-head">
      <h1 class="poster-title">[One line of the claim]</h1>
      <div class="poster-byline">
        <div class="poster-who">
          <p class="poster-authors">[Author]<sup>1</sup>, [Author]<sup>2</sup></p>
          <p class="poster-affil"><sup>1</sup> [Affiliation]</p>
          <p class="poster-venue">[Venue] 2025, poster [n]</p>
        </div>
        <p class="poster-logos">[Logo] [Logo]</p>
        <div class="poster-qr" data-qr="https://art.example.com/my-poster/">
          <p class="poster-qr-url"><a href="https://art.example.com/my-poster/">art.example.com/my-poster</a></p>
        </div>
      </div>
    </header>

    <main class="poster-cols">
      <section>
        <h2>The problem</h2>
        <p>[PLACEHOLDER] one paragraph.</p>
      </section>
      <section>
        <h2>What we did</h2>
        <p>[PLACEHOLDER] one paragraph and a short list.</p>
      </section>
      <section>
        <h2>What we found</h2>
        <figure>
          <img src="figure.svg" width="720" height="640" alt="[What the figure shows]">
          <figcaption>[One line, with the unit and the source]</figcaption>
        </figure>
      </section>
    </main>

    <footer class="poster-foot">
      <p>[1] [Reference]. [2] [Reference].</p>
    </footer>
  </div>
</div>

</body>
</html>
```

## Blocks

- One `<section>` per block of the argument, in reading order from top left.
- The title is the claim, and it is short enough to read at 3 metres.
- Three to five sections is the range, and each one has a heading a reader can say back.
- Type is in `pt`, because 110pt here is 110pt on paper.
  `--poster-type` carries one multiplier per sheet.
- A block that only holds a paragraph is a block that wants a figure.

## Figures

A figure is the argument on a poster, so it takes the width of its column and it is labelled at the end of the line.
No legend box, no gridline that carries nothing and no chart with two y axes.
Every value in an example figure is example data, and the caption says so.
Never invent a number.

## QR code

`data-qr` holds the address the code points at, and `poster.js` draws the code as an inline SVG.
Keep the plain address in `poster-qr-url` as the fallback, because a reader with a dead phone still needs to type it.
Point the code at the artifact's own link, so a reader who scans it lands on the page with the paper and the data.

## Print

`poster.js` copies the two dimensions of the current sheet into one `@page` rule, so a print is exactly one page of that size with no margin.
On screen the poster keeps its real width in mm and the script scales the whole sheet down to the window, so a preview is a preview and never a second responsive layout.
Print is always light, and the tokens do that.

## Checks

- `rshow check <dir>` exits 0, then print to PDF at the chosen size and count the pages.
- The sheet prints as one page with no scale set to fit.
- The title reads from 3 metres and the body from 1 metre, so check the type at 100 percent and at print size.
- No text sits closer than the sheet margin to the edge.
- `rshow publish <dir> --slug <slug> --label "<what changed>"` and report the printed `live-url`.
