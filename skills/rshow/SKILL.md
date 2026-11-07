---
name: rshow
description: Load before you write, fix, share or publish a page, report, printed or web poster, paper landing page or status dashboard behind an rshow link, such as an art.<domain>/<name> URL. Load it even for a quick question about one or for one accent or theme shared by many pages, one link that gathers a paper's page, deck and figures for co-authors, a CSV you can filter and sort, wireframes or mockups of a web, desktop, mobile or terminal app, TUI layouts and ratatui panes, a rough hand sketch of boxes and arrows, an asciinema capture on a page, grouping artifacts into a project, sending a link not an attachment, a rollback or a publish error. Slide decks belong to rshow-slides, code from a design belongs to rshow-implement, an editable .pptx belongs to slides, a claude.ai Artifact belongs to the Artifact tool, visual design direction belongs to frontend-design.
---

# rshow

rshow serves a folder of static files at a stable link on `https://art.example.com/<slug>/`.
Every publish of the same slug adds an immutable version, and the link keeps working.
A theme is a published artifact of its own, and a page links one at a version.
One theme ships, `default`: IBM Carbon on IBM Plex, in two modes, white and g100, following the system by default.
A report, a poster, a project page, a dashboard, a mockup, a sketch and a terminal page are the other shapes this skill writes.
Every one of them uses the same theme.
A talk deck is the one shape this skill hands off, and building the app is the other.
Read `rshow-slides` and `rshow-implement` for those two and come back here to publish.

## Workflow

Copy this checklist into the reply and tick it as you go.

```text
- [ ] shape picked and outline or headings agreed
- [ ] page written, theme linked at `@latest`
- [ ] rshow check <dir> exits 0
- [ ] rshow preview <dir> looked at 360px wide and at desktop width
- [ ] audience confirmed with the person
- [ ] project and tags passed as --project and --tag
- [ ] rshow publish <dir> printed a live-url
- [ ] live-url and audience reported
```

1. Pick the shape and say it back in one sentence, such as a page, a report, a poster, a project page, a dashboard, a mockup, a sketch, a terminal page or a prerendered Astro or Vite site.
2. Write `index.html` in its own folder, link the theme at `@latest` and keep every other path relative.
3. Run `rshow check <dir>`.
4. Fix every error, then run `rshow check` again until it exits 0.
5. Run `rshow preview <dir>` and open the printed `http://127.0.0.1:4321` link.
   Look at it at 360px and at desktop width.
6. Confirm the audience with the person before any `people` or `public` change.
7. Run `rshow publish <dir> --slug <slug> --label "<what changed>"`.
   Add `--project <slug> --tag <tag>` when the artifact belongs to a project or carries a tag.
8. Report the printed `live-url` and say who can see it, and say which project holds it.

## Page rules

- One `index.html` at the root of what you publish.
- Every path inside the artifact is relative, with no leading slash.
  The only exceptions are `/_themes/...` and `/_data/...`.
- Link the theme, never copy it.
  The stylesheet links and `mode.js` in the head all carry the same `<name>@latest`.
- Link `@latest`, so a theme fix reaches the page with no republish.
  Write a number only when the person asks to freeze a page, such as a talk on the day it is given.
  A page frozen on a number needs 8 or newer for math.
- The theme is the base, not a cage.
  A page may carry one inline `<style>` block with its own classes and its own layouts when the content needs them.
  Own CSS takes colour, type and space from the theme tokens with `var(--...)`, so light, dark, print and a theme swap keep working.
  A hard-coded colour sits inside a figure only.
- Own CSS adds a class and never restyles a theme class globally.
  Scope a new deck layout as `.slide.<name>` and scope a page part under its own class name, and use no `!important`.
- A token override still goes in one `:root` block, with no limit on the declarations.
- Keep the script and the styles inline.
  Add a framework only when the page needs one.
- `connect-src` is `'self'`.
  Bake data in as a literal and fetch nothing from a third party.
- Pin an exact version in every CDN URL, such as `chart.js@4.4.1`.
  Never write `latest`.
- A report links `report.css` and `report.js` in place of `page.css`, and `mode.js` still goes in the head.
  Read [reports](reference/reports.md) before you write one.
- Math is LaTeX in the text of an element with the class `math`, and the page links `math.css` and `math.js` for it.
  A `div.math` is display math and any other element is inline.
  A `$` in the prose is a price and is never read as math, so `$5` stays text.
  Read [reports](reference/reports.md) for the markup an equation takes.
- The page reads at 360px wide.
  Tables go inside `<div class="table">`.
- Nothing secret in a page, because anyone who holds the link can read the HTML source.
- Never invent a number.
  Print `[PLACEHOLDER]` and say so in the footer.
- The look is IBM Carbon on IBM Plex, and every colour has one job.
  `themes/DESIGN.md` in the rshow repo holds the system, the type scale and the layout set.
- Documented templates carry decks, reports, posters, project pages and dashboards, so the markup is documented and the content is the work.
  The markup is the starting point, and a page adds its own parts with its own classes when it needs them.
- Guided kits carry mockups, sketches and TUIs, so the kit gives you a frame, a floor and a checklist and the drawing is the work.
  Starting a kit at its highest fidelity is the same mistake as decorating a documented template.

## Audience

- `private` is the owner plus the editors.
  Keep it while the page is still being built.
- `people` is the owner plus every share, viewer or editor.
- `public` is anyone who holds the link, with no sign in.

Always confirm the audience with the person before you set `people` or `public`.
Name the artifact and say who will be able to read it.
Then say that a public link means anyone who receives it can read the page.
Also confirm before `--remove` and before `delete`.
Never widen access to make a demo easier.

Editors can publish and pin.
Only the owner can share, rename or delete.

## Exit codes

| code | meaning | what to do |
|---|---|---|
| 0 | success | read the printed lines and report the `live-url` |
| 2 | usage | a flag, an argument, a slug or the token is wrong, or no token is set. Read `rshow --help` and fix the command |
| 4 | auth | the token is expired, revoked or under-scoped. Ask the person to set a token that fits |
| 5 | api | the host refused the request. Read the message, fix the input, retry once |
| 6 | check | `rshow check` or `rshow doctor` found an error. Read each finding and fix the page or the config |

On 2, fix the command and do not retry the same line.
On a config error (`no server configured`, no token, or a config file that will not load), run `rshow doctor` and show its output to the person.
On 4, or on exit 2 with `no token`, never ask for a token in chat. Tell the person to run `rshow login` in their own terminal, which saves the token where only their account can read it.
On 5, retry once and then report the message verbatim.
On 6, fix the page, never `--no-check` past it.

## Reference files

- [page contract](reference/page-contract.md) holds the CSP, the allowed CDNs, the data store and the phone width rule.
  Read it before you write or review any HTML that goes to the host.
- [pages](reference/pages.md) holds the page skeleton, the token override block, diagrams and prerendered Astro or Vite sites.
  Read it when the page is more than a few paragraphs.
- [themes](reference/themes.md) holds the shipped theme, its two modes, token files, the preview page, contrast and version bumps.
  Read it when a token override is not enough and the look has to change.
- [reports](reference/reports.md) holds the report layout: sections, figures, tables, cross-references, notes, citations and print.
  Read it when the artifact is a report or a paper rather than a page or a deck.
- [project page](reference/project-page.md) is the landing page of a paper, with its title block, teaser, key results and BibTeX entry.
- [poster](reference/poster.md) is the conference poster, with one sheet size, columns, a QR code and a print that is one page.
- [dashboard](reference/dashboard.md) is the results explorer, with a CSV in the folder, a filter bar, a summary, small multiples and a table.
- [mockups](reference/mockups.md) is the guided kit for UI drawings, with frames, skins, flows, states, annotations and comments.
- [sketch](reference/sketch.md) is an Excalidraw drawing read in the page and edited in place, saved to the store or downloaded.
- [terminal](reference/terminal.md) is the terminal viewer, the TUI kit and a real ratatui app built with Ratzilla.
- [cli](reference/cli.md) holds every command, every flag, the projects and tags that group artifacts and both config files.
  Read it when a flag is not obvious, a publish failed or an artifact has to join a project.

## Never in the look

- Never write an eyebrow, a kicker or a small caps label with wide tracking above a heading.
- Never set a label in mono or in capitals and never write a meta string such as `A / B / C` above a title.
- Never number a slide or a card 01, 02, 03 and never ship three equal cards with a coloured top rule.
- Never build an identity from cream and terracotta, from beige and brass or from near black plus one bright accent.
- Never put a coloured bar on an edge or a rule down the side of a quote, and never use a hairline rule as decoration.
- Never use Inter, Space Grotesk, Geist, Fraunces or Instrument Serif as the gesture.
- Never use gradient text, glass, a large shadow or an emoji.
- Never decorate what carries no information.
  A chart is labelled at the end of the line, a table keeps its rules and nothing else does.

The short list above is a hard rule.
`themes/DESIGN.md` holds the rest: the palette roles, the type scale and the twelve layouts.

## Never

- Never publish a folder that holds `.env`, a key, a credential or customer data.
- Never publish a source tree, `node_modules` or a `dist` folder that still holds a draft.
- Never write the token into a page, a script, a log line, a commit or a chat message.
- Never fake math with Unicode subscripts, Greek letters in mono or an HTML `<sub>`.
  Write the LaTeX in an element with the class `math` and link `math.css` and `math.js`.
- Never create a second artifact with a `-v2` slug.
  Publish the same slug again.
- Never delete a version, a theme or an artifact, and never drop a share, unless the person asks for it.
