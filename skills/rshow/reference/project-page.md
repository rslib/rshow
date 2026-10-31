# Project page

## Contents

- The shape
- Skeleton
- Title block
- Teaser
- Key results
- BibTeX and the copy button
- Checks

A project page is the landing page of a paper, and it uses the same theme as a page, a report and a poster.
It is a documented template, so the sections are the starting point and the content is the work, and a page may add its own parts with its own classes.
`project.css` sets the look and `project.js` does one thing, the copy button on the BibTeX entry.

A project page is not a project.
A project is the grouping on the host, and it gets a group page at `art.example.com/_p/<project>/` that the host renders.
`reference/cli.md` holds that one.

## The shape

```text
paper/
  index.html
  teaser.svg        # optional, a figure with its own light and dark values
```

Link `fonts.css`, `tokens.css` and `project.css`, then `mode.js` in the head and `project.js` with `defer`.
`project.css` is self contained, so it needs no `page.css` beside it.

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
<link rel="stylesheet" href="/_themes/default@3/project.css">
<script src="/_themes/default@3/mode.js"></script>
<script defer src="/_themes/default@3/project.js"></script>
</head>
<body>
<div class="project">

  <header class="project-head">
    <h1>Immutable artifacts for reproducible figures</h1>
    <p class="authors">[Author One]<sup>1</sup>, [Author Two]<sup>2</sup></p>
    <p class="affiliations"><sup>1</sup> [Affiliation], <sup>2</sup> [Affiliation]</p>
    <p class="marks"><sup>*</sup> Equal contribution.</p>
    <p class="venue">[Venue], 2025</p>
    <nav class="links" aria-label="Paper resources">
      <a class="btn btn--tertiary" href="paper.pdf"><span class="btn-label">Paper PDF</span></a>
      <a class="btn btn--tertiary" href="#cite"><span class="btn-label">BibTeX</span></a>
    </nav>
  </header>

  <figure class="teaser wide">
    <img src="teaser.svg" width="928" height="360" alt="[What the figure shows]">
    <figcaption>[One line that says what the reader is looking at]</figcaption>
  </figure>

  <main>
    <h2>Abstract</h2>
    <p class="tldr">One sentence a reader could repeat after skimming.</p>
    <p>[PLACEHOLDER] body copy at the theme measure.</p>
  </main>

  <footer class="project-foot">
    <p class="ack">Acknowledgements. [PLACEHOLDER]</p>
  </footer>

</div>
</body>
</html>
```

Every child of `.project` is one column of prose at `--prose`, which is about 72 characters at 18px.
A child marked `class="wide"` takes `--wide`, which is 928px, and the teaser is the one that usually wants it.

## Title block

- The title is one line of the claim, not the name of the artifact.
- The authors line is the paper's author list with superscript numbers, and the affiliation line gives each number once.
- `marks` holds the footnote the author list points at, such as equal contribution.
- `venue` holds the venue and the year, in `--muted`.
- `links` holds the paper PDF, the code, the data and the BibTeX jump, each one a `btn`.

## Teaser

The teaser is an `<img>` inside `figure.teaser.wide`, and it carries its own light and dark values.
Use an SVG so the dark block inside it resolves against the page's used color scheme, and give the `img` a width and a height so the page does not move when it loads.
The caption says what the figure shows and nothing about why it is good.

## Key results

A key results block is a small table or one figure with a direct label, and it always says what the numbers are.
Two exhibits is the ceiling, and each one names its source.
Never invent a number, and print `[PLACEHOLDER]` when the result is not in hand.

## BibTeX and the copy button

```html
<h2 id="cite">BibTeX</h2>
<pre id="bibtex-entry"><code>@inproceedings{key2025,
  title = {[Title]},
  author = {[Author One] and [Author Two]},
  booktitle = {[Venue]},
  year = {2025}
}</code></pre>
<div class="copy-row">
  <button class="btn" type="button" data-rshow-copy="bibtex-entry">
    <span class="btn-label">Copy</span>
  </button>
  <p class="copy-status" role="status" aria-live="polite"></p>
</div>
```

`data-rshow-copy` names the id of the element to copy, and `project.js` uses the clipboard API with a select the text fallback.
The entry is ordinary text in the page, so a reader with JavaScript off selects it by hand.
Keep the entry true, because a wrong BibTeX entry is the one bug a reader notices a year later.

## Checks

- `rshow check <dir>` exits 0, then `rshow preview <dir>` and read the page at 360px and at desktop width.
- The copy button announces `Copied` and then goes back to `Copy`, and the status line clears.
- Print preview is one column of black on white with no theme chrome.
- Every link and every figure is in the folder, so the version is self contained.
