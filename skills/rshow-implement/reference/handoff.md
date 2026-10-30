# Handoff

## Contents

- The command
- What it writes
- HANDOFF.md
- spec.json
- A component record
- Normative and placeholder
- Screens and states
- Remote version or local folder
- Commit the folder

## The command

```bash
rshow handoff <slug>@v<n> --out app/design/gallery
rshow handoff ./mockups/gallery --out app/design/gallery
rshow handoff gallery@v3 --widths 1440,768,390 --modes light,dark
```

`--out` defaults to `./handoff-<slug>-v<n>`, or `./handoff-<slug>` for a local folder.
`--widths` defaults to `1440,390` and `--modes` defaults to `light,dark`.
The first width is the primary width, and the component records are taken there.
Chrome or Chromium runs headless, and `CHROME` picks the binary when the default one is wrong.

## What it writes

```text
app/design/gallery/
  HANDOFF.md     the source, the screens, the component table, the rules, the compare command
  spec.json      per screen, state and mode, every component with its box and computed style
  tokens.json    every custom property on :root, in W3C DTCG 2025.10 form
  baseline/      <screen>__<state>__<width>__<mode>.png, one screenshot per variant
```

The folder is a snapshot, so it is safe to commit and safe to diff.
A second handoff into the same `--out` overwrites it, which is how a design change arrives.

## HANDOFF.md

Read it first, because it is short and it holds the four things you need at the start.

- The immutable source url, the width and mode list and the shape it shot, such as a mockup, a deck, a report or a page.
- A screen table with the id, the title, the frame, the states and the size.
- The flows from one screen to another and the annotation notes with their x and y.
- A component table with the name, the role, the box, the token each value matches and whether it must match.
- The exact `rshow compare` line for this folder.

## spec.json

`spec.json` is the machine form of the same thing, and it is what the compare reads.

| field | holds |
|---|---|
| `schema` and `generator` | the handoff schema number and `rshow handoff` |
| `source` | `slug`, `version`, `url`, the `kind` and the `skin` of the mockup |
| `widths`, `modes`, `primaryWidth` | what was shot, plus the width the components were recorded at |
| `screens` | one record per screen, with `id`, `title`, `frame`, `kind`, `width`, `height`, `states` |
| `screens.flows` | `from` and `to` pairs, and the flow is part of the design |
| `screens.annotations` | the note text with its `x` and `y`, and this is the design intent in words |
| `screens.focus` | the focus order, in the order the mockup records it |
| `screens.variants` | one record per `state` and `mode`, holding the `components` |
| `baselines` | the `file` for each screen, state, width and mode |

A screen id is the artboard id for a mockup or the slide number for a deck.
The id `page` covers a page or a report.
The map uses the same id, so a screen the map does not name is a screen nobody compares.

## A component record

```json
{
  "name": "PrimaryButton",
  "role": "button",
  "x": 96, "y": 412, "w": 168, "h": 40,
  "color": "#ffffff",
  "background": "#0f62fe",
  "fontFamily": "IBM Plex Sans",
  "fontSize": "14px",
  "fontWeight": "400",
  "radius": "0px",
  "normative": true,
  "text": "Invite",
  "padding": "0px 16px",
  "tokens": { "background": "--accent", "fontSize": "--type-body" }
}
```

`name` comes from `data-component` first, then from the `wf-*` class, then from the role or the tag.
`gap` and `padding` appear on a container, and `tokens` names the token each value matched.
A box must land within 4px or 2% of the larger side, and `color`, `fontSize`, `fontWeight` and `radius` must match the record or the token it names.

## Normative and placeholder

- `data-normative` means the text, the box and the computed style are the design and they must match.
- `data-placeholder`, and anything the mockup does not mark, is free.
  Text, data, names, prices and images are placeholder by default, so put real content in them.
- A real product needs a real empty state, a real error string and a real long name, because those live in the app.
  Only the shape of the block is fixed.

When a placeholder value and a normative value disagree, the normative one is a finding and the other is not.

## Screens and states

A mockup is shot artboard by artboard, through focus mode when `mockup.js` exposes one.
A deck, a report and a page are one screen each, while a deck is one screen per `section.slide`.
Every artboard state list starts with `default`, so a screen with `data-states="empty,loading"` gives three baselines.
Build and compare each one, because the empty state is where the design is thin and where a build drifts first.

## Remote version or local folder

- A remote target needs a public version, such as `gallery@v3`.
  A private version cannot be read headless, so make it public for the run or shoot the local folder.
- A local folder needs an `index.html` at its root, and rshow serves it for the run.
  `rshow handoff ./mockups/gallery` is the right call while the mockup is still being argued about.
- Both write the same four files, so the compare line is the same.

## Commit the folder

Commit `HANDOFF.md`, `spec.json`, `tokens.json` and `baseline/` next to the code that implements them.
A frozen folder answers a review question six months later, and a live link does not.
Publish the mockup again to a new version when the design changes, and freeze the new version over the old one in one commit.
That commit is the design change, and the diff is the conversation.
