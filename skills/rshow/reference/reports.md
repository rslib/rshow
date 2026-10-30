# Reports

## Contents

- The shape
- Skeleton
- Sections
- Figures and tables
- Cross-references
- Notes
- References
- Print
- Checks

A report is the reading shape: a long technical report or a paper preprint, on the same theme as a page and a deck.
`report.css` sets the look and `report.js` sets the numbering.
Both work with JavaScript off, so the document stays a readable paper that loses only the generated labels.

## The shape

```text
report/index.html
report/figure.svg     # optional, when a figure is not inline
```

Link `fonts.css`, `tokens.css` and `report.css`, then `mode.js` in the head and `report.js` with `defer`.
`report.css` is self contained, so it needs no `page.css` beside it.

## Skeleton

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Publishing a folder as an immutable artifact</title>
<link rel="stylesheet" href="/_themes/default@3/fonts.css">
<link rel="stylesheet" href="/_themes/default@3/tokens.css">
<link rel="stylesheet" href="/_themes/default@3/report.css">
<script src="/_themes/default@3/mode.js"></script>
<script defer src="/_themes/default@3/report.js"></script>
</head>
<body>
<div class="report">

  <nav class="toc" aria-label="Contents"></nav>

  <main>
    <header class="report-head">
      <h1>Publishing a folder as an immutable artifact</h1>
      <p class="subtitle">One line that says what the report argues.</p>
      <p class="authors">Dana Ruiz<sup>1</sup> and Tomas Oliveira<sup>2</sup></p>
      <p class="affiliations"><sup>1</sup> rshow project, Berlin<br>
        <sup>2</sup> University of Lisbon</p>
      <p class="date">[PLACEHOLDER] date</p>
      <p class="version">Preprint, version [PLACEHOLDER].</p>
    </header>

    <section class="abstract" id="abstract">
      <h2 data-nonum data-notoc>Abstract</h2>
      <p>Four to six sentences: the problem, the claim, the method and what a reader should do with it.</p>
    </section>

    <section id="sec-design">
      <h2>Design</h2>
      <p>Body text is 18px Plex Sans on a 1.6 line at about seventy characters.</p>
    </section>
  </main>

</div>
</body>
</html>
```

The `nav.toc` sits first so the grid can put it in the left column, and `report.js` fills it.
Above 1056px the page is three columns: contents, text and notes.
Below it the contents collapses at the top and the notes collect at the end of the document.

## Sections

Numbering is generated, so never type a number into a heading.

- `<h2>` takes 1, 2, 3 and `<h3>` takes 1.1, 1.2.
- `data-nonum` keeps a heading out of the numbering, which an abstract and a references list use.
- `data-notoc` keeps a heading out of the contents.
- `data-break` on an `<h2>` starts a new page in print, and nothing else does.
- Headings are sentence case with no eyebrow above them, because the heading is the label.

## Figures and tables

```html
<figure id="fig-pipeline">
  <svg viewBox="0 0 600 186" role="img" aria-label="What the diagram shows in one sentence.">
    <text x="12" y="36" style="font-size: 16px; fill: var(--fg)">Folder</text>
  </svg>
  <figcaption>What to look at, and what it means.</figcaption>
</figure>

<figure class="table" id="tab-headers">
  <table>
    <caption>What the rows are.</caption>
    <thead><tr><th scope="col">Response</th><th scope="col" class="num-cell">Share</th></tr></thead>
    <tbody><tr><td>a versioned path</td><td class="num-cell">[PLACEHOLDER]</td></tr></tbody>
  </table>
  <figcaption>Where the numbers come from.</figcaption>
</figure>
```

`report.js` puts `Figure 1.` or `Table 1.` in front of the caption and counts in document order, so give every one an `id`.
Draw the figure as inline `<svg>` with the colours from tokens, and give it a `viewBox` so it scales.
An equation is `<div class="equation" id="eq-bytes">` with the formula inside, and `report.js` adds `(1)` at the end of the line.
Mark example data as example data in the caption, and never present a number you did not measure.

## Cross-references

```html
<p>The pipeline in <a class="ref" href="#fig-pipeline"></a> writes the record last.</p>
<p>The rule in <a class="ref" href="#sec-pins">the pin section</a> is one line.</p>
```

A `.ref` link resolves to `Figure 1`, `Table 2`, `Equation 1`, `Section 2.1` or `Note 3` from the `id` it points at.
Text inside the link is a fallback for a reader without JavaScript, so write it when the sentence would otherwise lose its object.

## Notes

```html
<p>A republish sends only what changed.<span class="fn">A hash is the SHA-256 of the file bytes, so identical bytes are stored once.</span></p>
```

`report.js` turns the span into a raised number in the text and a note in the right margin.
On a narrow screen and in print the notes move to the end of the document.
Without JavaScript the note text stays in the sentence, which still reads.

## References

```html
<ol class="refs">
  <li id="ref-tufte">Tufte, E. R. <em>The Visual Display of Quantitative Information</em>. Graphics Press, 1983.</li>
</ol>
```

Cite with `<a class="cite" href="#ref-tufte"></a>`, which becomes `[1]` and adds a back-link from the entry to every place it is cited.
List only references that exist and that you read, and print the full URL for a source that lives online.

## Print

Print is always light, one column, black on white, with 18mm margins on A4 and on Letter.
Figures and tables stay whole, `h2[data-break]` starts a page and the contents is dropped, because the page numbers navigate for it.
A URL after a link in the running text is printed in full, and the page number runs in the bottom margin where the browser supports page margin boxes.
Read the print preview before you publish, because a heading landing alone at the foot of a page is the one thing the CSS cannot see.

## Checks

- `rshow check <dir>` until it exits 0, then `rshow preview <dir>`.
- Read the report at 390px wide and at desktop width, in both modes.
- Print it once and read every page, then fix an orphan heading and a figure that split.
- Nothing on a report page is a slide: no 28px bullet list, no big number and no eyebrow.
