# Layouts

## Contents

- title
- section
- statement
- bullets
- figure
- figure-two
- chart
- table
- code
- two-col
- quote
- big-number
- math (an equation on a bullets slide)
- your own layout

One markup example per layout, all inside `<main class="deck">`.
Every slide carries `slide` plus one layout class, and the layout class goes second.
The twelve are a starting set: a deck may add a layout of its own when none of them carries the claim.
Nothing sits above a title: no kicker, no label, no number.

A sparse slide (`title`, `section`, `statement`, `quote`, `big-number`, `bullets`) is centred a little above the middle of the 1280x720 canvas, so the air sits under the block instead of closing it in.
A slide with a figure starts at the top and lets the figure take the rest.

## title

The opener and the closer.
A display title, one line of subtitle and one plain line of who, where and when.

```html
<section class="slide title">
  <h1>A cache that survives a restart</h1>
  <p class="subtitle">What we changed and what it cost us.</p>
  <p class="byline">Dana Ruiz, cache group, lab meeting, 14 March</p>
  <aside class="notes"><p>Who I am and what you get out of this.</p></aside>
</section>
```

## section

A divider.
One title and at most one line under it.

```html
<section class="slide section">
  <h2>The write path</h2>
  <p>Where the last quarter went.</p>
  <aside class="notes"><p>Transition. Do not read the heading out.</p></aside>
</section>
```

## statement

The claim of the slide as one sentence.
Use it when the sentence is the argument and there is nothing to show yet.

```html
<section class="slide statement">
  <p>A restart is not an outage if the log is already on disk.</p>
  <aside class="notes"><p>Give it a moment before you move on.</p></aside>
</section>
```

## bullets

A list of points, one press each.
No nesting and no more than five items, because the theme sets a point at 28px with a 1.4 line, which is the size a room reads from the back.

```html
<section class="slide bullets">
  <h2>Three things broke</h2>
  <ul>
    <li class="step">The log doubled on a retry.</li>
    <li class="step">A stale entry survived the flush.</li>
    <li class="step">The counter drifted under load.</li>
  </ul>
  <aside class="notes"><p>Pause after the second one. That is the real bug.</p></aside>
</section>
```

## figure

One diagram or image, as large as the canvas allows, with a caption that says what to look at.
The title states the takeaway, so the room knows what the figure is evidence for.

```html
<section class="slide figure">
  <h2>The log is appended before the map is updated</h2>
  <figure>
    <img src="write-path.svg" alt="The log is appended before the map is updated, so a crash replays the tail.">
    <figcaption>A crash after step 2 replays the tail and loses nothing.</figcaption>
  </figure>
  <aside class="notes"><p>Trace the arrows left to right. Do not read the text out.</p></aside>
</section>
```

An inline `<svg>` works in the same slot.
Take its colours from tokens so both modes read the same file.

## figure-two

Two diagrams side by side, each with a short label under it in the body font.
Use it for a before and after, or for two versions of one mechanism.

```html
<section class="slide figure-two">
  <h2>The same log, one flush later</h2>
  <div class="pair">
    <figure>
      <svg viewBox="0 0 460 270" role="img" aria-label="One writer and one lock.">
        <!-- rect and text in tokens: style="fill: var(--layer-01)" -->
      </svg>
      <figcaption>One writer, one lock.</figcaption>
    </figure>
    <figure>
      <svg viewBox="0 0 460 270" role="img" aria-label="Two writers and an append log.">
        <!-- rect and text in tokens: style="stroke: var(--accent)" -->
      </svg>
      <figcaption>Two writers, one append log.</figcaption>
    </figure>
  </div>
  <aside class="notes"><p>Point at the second diagram last.</p></aside>
</section>
```

## chart

An inline SVG chart.
Label each series at the end of its line or above its bar, so there is no legend box and no looking back and forth.
One series is drawn in `--accent`, the same blue as a link, because one series is not a category.
Two or more series take `--chart-1`, `--chart-2` and so on, in order.
That order holds in every figure in the deck.
The numbers are `--fg`, the axis is `--border-strong` and the caption is `--muted`.

```html
<section class="slide chart">
  <h2>A republish uploads a fraction of the first one</h2>
  <figure>
    <svg viewBox="0 0 1088 430" role="img" aria-label="Bar chart of megabytes uploaded per publish: 120, 40, 18, 9, 6 and 6.">
      <g style="fill: var(--accent)">
        <rect x="40" y="80" width="88" height="300"></rect>
      </g>
      <text x="84" y="62" style="font-size: 22px; fill: var(--fg); text-anchor: middle">120</text>
      <line x1="40" y1="380" x2="1048" y2="380" style="stroke: var(--border-strong)"></line>
    </svg>
    <figcaption>Example data, not a measurement.</figcaption>
  </figure>
  <aside class="notes"><p>The shape is the point. The numbers are illustrative.</p></aside>
</section>
```

Keep gridlines light or leave them out, and never put a box around the plot.
A chart built with a library is fine when it draws the same labels and no legend.

## table

A clean data table.
Numbers go right aligned in a `num-cell` and they stay in Plex Sans with tabular figures.

```html
<section class="slide table">
  <h2>Every version stays reachable at its own path</h2>
  <div class="table">
    <table>
      <caption>Example data, five publishes of one folder.</caption>
      <thead>
        <tr><th scope="col">Version</th><th scope="col">Label</th><th scope="col" class="num-cell">Uploaded</th></tr>
      </thead>
      <tbody>
        <tr><td>v1</td><td>first draft</td><td class="num-cell">240 KB</td></tr>
        <tr><td>v2</td><td>fix the chart</td><td class="num-cell">18 KB</td></tr>
      </tbody>
    </table>
  </div>
  <aside class="notes"><p>The label is what a reader uses to pick a version.</p></aside>
</section>
```

Six rows is the ceiling, and a table with more belongs on a page rather than a slide.

## code

One command or one short block, in Plex Mono on `--layer-01`.
An optional takeaway title sits above it.

```html
<section class="slide code">
  <h2>Run it</h2>
  <pre><code>rshow publish ./lab-talk \
  --slug lab-talk \
  --label "first draft"</code></pre>
  <p class="source">The label is what changed, and it shows in the version list.</p>
  <aside class="notes"><p>Point at the label last. Never put the token on the line.</p></aside>
</section>
```

## two-col

Two blocks of text with a plain heading each.
Use it for a comparison, a cause and an effect or a claim and its caveat.

```html
<section class="slide two-col">
  <h2>Before and after</h2>
  <div class="col">
    <h3>Before</h3>
    <ul>
      <li>One writer, one lock.</li>
      <li>Full flush on every commit.</li>
    </ul>
  </div>
  <div class="col">
    <h3>After</h3>
    <ul>
      <li>Two writers, a log.</li>
      <li>Flush on the group boundary.</li>
    </ul>
  </div>
  <aside class="notes"><p>Point at the second column last.</p></aside>
</section>
```

## quote

One sentence and who said it.
Use it once in a deck, and never with a giant quote mark.

```html
<section class="slide quote">
  <blockquote>A restart is not an outage if the log is already on disk.</blockquote>
  <cite>our postmortem, item 4</cite>
  <aside class="notes"><p>Stop talking for a moment after this one.</p></aside>
</section>
```

## big-number

One number and the sentence that says what it means.
The value is a short statement with the figure inside it, never a bare digit, because a digit on a slide says nothing on its own.
The unit belongs in the statement and the source goes under it.

```html
<section class="slide big-number">
  <p class="value">5 versions, 1 link</p>
  <p class="caption">Every publish adds a version and the link in the invitation keeps working.</p>
  <p class="source">Example data, not a measurement. Count your own folder before the talk.</p>
  <aside class="notes"><p>Say the number once, then say what it buys the room.</p></aside>
</section>
```

A number you cannot measure is `[PLACEHOLDER]` until it is real, and a number that stands for an example says so in the source line.

## math

An equation takes a `bullets` slide: a takeaway title and one `div.math`.
The LaTeX is the text of the element, and the deck links `math.css` and `math.js` for it.
A note holds words, not math.

```html
<section class="slide bullets">
  <h2>A republish sends only the bytes that changed</h2>
  <div class="math">\mathrm{sent}(n) = \sum_{f \in \mathrm{new}(n)} |f|</div>
  <aside class="notes"><p>The sum drops every file the host already holds.</p></aside>
</section>
```

## your own layout

A layout of your own takes a short class name and sits second on the slide, in the same slot as the twelve.
Pick the shape the claim needs, such as an annotated figure, a figure with a callout, a diagram built in HTML or SVG, a timeline, a before and after or a comparison grid.
Its CSS goes in one inline `<style>` block after the theme links, scoped to `.slide.<name>`, with colour, type and space from the tokens.
Here one figure carries three callouts, and they stack under it below 640px.

```html
<style>
.slide.annotated .annotated-fig { position: relative; margin: 0; }
.slide.annotated .annotated-fig img { display: block; width: 100%; }
.slide.annotated .callout {
  position: absolute;
  max-width: 30%;
  padding: var(--space-03) var(--space-04);
  background: var(--layer-01);
  border: 1px solid var(--border-strong);
  color: var(--fg);
  font-size: 18px;
  line-height: 1.4;
}
.slide.annotated .callout.one { top: 6%; left: 3%; }
.slide.annotated .callout.two { top: 40%; right: 3%; }
.slide.annotated .callout.three { bottom: 6%; left: 30%; }
@media (max-width: 640px) {
  .slide.annotated .callout {
    position: static;
    max-width: none;
    margin: var(--space-03) 0 0;
    padding: 0;
    border: 0;
  }
}
</style>

<section class="slide annotated">
  <h2>The tail of the log is what a restart replays</h2>
  <figure class="annotated-fig">
    <img src="write-path.svg" alt="A log appended before the map is updated, with three stages marked.">
    <p class="callout one">The append lands first.</p>
    <p class="callout two">The map follows it.</p>
    <p class="callout three">A crash replays the tail.</p>
    <figcaption>A restart loses nothing after step 2.</figcaption>
  </figure>
  <aside class="notes"><p>Trace the three callouts in order.</p></aside>
</section>
```
