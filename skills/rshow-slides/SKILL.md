---
name: rshow-slides
description: Load before you build or revise a talk, deck or presentation. Load it even for a quick question about one or for a deck already published at an art.<domain>/<name> link. Use it for any new talk or deck unless an editable .pptx, a Keynote file or a company master is asked for, which belongs to slides. That covers a lab meeting, a reading group, a paper turned into slides, a link you share in Slack instead of a pptx, speaker notes and slides you click through in a browser with arrow keys in our group template. Publishing and non-slide pages belong to rshow, implementing a design in code belongs to rshow-implement, a claude.ai Artifact belongs to the Artifact tool, while visual design direction belongs to frontend-design.
---

# rshow slides

A deck is a folder with one `index.html` in it, published to `https://art.example.com/<slug>/`.
It links the deck half of a published theme, so the folder holds no CSS, no font and no script of its own.
The theme does the layout, and the deck only picks a layout per slide.
The look is IBM Carbon on IBM Plex, and `themes/DESIGN.md` in the rshow repo holds the whole system.

## 1. Outline first

Write the outline before any HTML and put it in the reply.
One line per slide, and each line is a claim that states the takeaway.
A topic on its own is not a slide.

- Size the deck from the talk.
  Ten minutes is 10 to 12 slides, and five minutes is 5 to 6.
- One idea per slide, readable in about 3 seconds.
  When a slide needs two ideas, it is two slides.
- Open with a `title` slide and close with a `title` slide or a `big-number` that says what to do next.
- Put one `section` slide before each move in the argument.
- Give the evidence slides the layout that carries the claim: `figure`, `chart`, `table` or `figure-two` for a research or systems talk.
- In a research talk the figure, the plot and the table are the hero.
  The title says what the evidence shows and the type stays out of the way.
- Say which slide carries the headline number, and put the number in it once.
- A number you cannot measure now is `[PLACEHOLDER]`, and it stays out of the talk until it is real.
- Agree the outline with the person, then write the file.

## 2. Skeleton

Replace `<name>@<n>` with the `theme` value that `rshow config <dir>` prints, which the server resolves to the current version. Use `default@3` only when `rshow config` warns that it cannot resolve the theme.

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Talk title</title>
<link rel="stylesheet" href="/_themes/default@3/fonts.css">
<link rel="stylesheet" href="/_themes/default@3/tokens.css">
<link rel="stylesheet" href="/_themes/default@3/deck.css">
</head>
<body>
<main class="deck">

  <section class="slide title">
    <h1>Talk title</h1>
    <p class="subtitle">One line that says what the room gets.</p>
    <p class="byline">[PLACEHOLDER] name, [PLACEHOLDER] group, [PLACEHOLDER] venue, [PLACEHOLDER] date</p>
    <aside class="notes"><p>Who you are and what the room gets out of this.</p></aside>
  </section>

  <section class="slide figure">
    <h2>The title of the slide is the takeaway</h2>
    <figure>
      <img src="figure.svg" alt="What to look at in the figure.">
      <figcaption>One line of source or caption.</figcaption>
    </figure>
    <aside class="notes"><p>Point at the line that carries the argument.</p></aside>
  </section>

</main>
<script src="/_themes/default@3/deck.js"></script>
</body>
</html>
```

The three stylesheet links and the script carry the same `<n>` on purpose, because a mixed version renders somewhere between two designs.
The deck needs no `mode.js`, because `deck.js` reads the same key and `t` does the same work.
Override a token in one `:root` block after the theme links when the deck needs its own accent, and keep it to a few declarations.

## 3. Layouts

Every slide is a `<section class="slide ...">`, and the second class is one of twelve.

- `title` for the opener, `section` for a divider and `statement` for one claim set large.
- `bullets` for a takeaway title and at most five short points.
- `figure` for one diagram or image, `figure-two` for two side by side and `chart` for an inline SVG plot.
  One series is drawn in the accent blue and two or more take `--chart-1`, `--chart-2` and so on in order.
- `table` for a clean data table and `code` for one command.
- `two-col` for two blocks of text, `quote` for one sentence and `big-number` for one number.

A sparse slide is centred a little above the middle of the canvas, so the air sits under the block.
A bullets slide puts its points under the title at 28px with a 1.4 line, five at most.
A figure slide starts at the top and lets the figure take the rest.
A figure is `<figure>` with a `figcaption`, and two figures are `<div class="pair">` with two `<figure>` inside.
A big number is `<p class="value">` plus `<p class="caption">`, and the value is a short statement with the figure inside it, never a bare digit.
Do not invent a thirteenth layout and do not write the layout CSS yourself, because the theme owns it and a copy drifts.
[layouts](reference/layouts.md) holds one markup example per layout. Read it before you write a slide that is not `title`, `bullets` or `section`.

## 4. Notes and steps

- Every slide gets one `<aside class="notes">`, including the title slide, because a slide without one shows nothing in the notes window.
- Keep a note under 60 words.
  It is what you say, not what the room reads.
- Press `n` for the notes window, which also names the next slide.
- Press `p` for the presenter view: the current slide, the next slide, the notes and an elapsed timer, kept in step with the deck.
- Put `class="step"` on an `<li>` to reveal it one press later.
- Every step is a reveal, so a slide with four steps needs four presses.
  Five is the ceiling before the slide drags.
- Press `f` for fullscreen and arrows or space to advance.
  Press `Ctrl` and `P` for a print sheet when someone wants a pdf.
- Press `t` to cycle the mode: system, light, dark, with the mode shown in the counter for a moment.
  The choice is remembered for every rshow document and print is always light.

## 5. Check, preview, publish

1. Run `rshow check <dir>` and fix every error until it exits 0.
2. Run `rshow preview <dir>` and open the printed `http://127.0.0.1:4321` link.
   Click through the whole deck.
3. Read one slide at 360px wide, because the room may open the link on a phone.
4. Press `n` and read the notes once, out loud, so a note that is too long shows up before the talk.
5. Run `rshow publish <dir> --slug <slug> --label "<what changed>"`.
6. Report the printed `live-url` and say who can see it.

A talk lives at `art.example.com/<slug>/`, and `art.example.com/<slug>/#7` opens slide 7 directly.
Publish again after a fix instead of making a second slug, because the link in the calendar invite keeps working.

## Never

- Never write an eyebrow, a kicker or a small caps label with wide tracking above a title.
- Never set a label in mono or in capitals.
- Never write a meta string such as `A / B / C` above a title.
- Never number a slide or a card 01, 02, 03.
- Never ship three equal cards with a coloured top rule.
- Never build an identity from cream and terracotta, from beige and brass or from near black plus one bright accent.
- Never put a coloured bar on a slide edge or a rule down the side of a quote.
- Never use a hairline rule as decoration.
- Never use Inter, Space Grotesk, Geist, Fraunces or Instrument Serif as the gesture.
- Never use gradient text, glass, a large shadow or an emoji.
- Never animate a slide in, because a reveal is the only motion a deck needs.
- Never invent a number and never present example data without saying so in the caption.
