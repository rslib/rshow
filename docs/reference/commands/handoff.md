# rshow handoff

```sh
usage: rshow handoff <slug>@v<n> | <dir> [--out dir] [--widths 1440,390] [--modes light,dark]

Writes a handoff folder, default ./handoff-<slug>-v<n>, so that a coding agent
can build the design without drifting from it:
  tokens.json     every CSS custom property on :root from the linked
                  tokens.css and skin css, the dark values as a dark group,
                  in W3C DTCG 2025.10 form ($value, $type color, dimension,
                  fontFamily, fontWeight, number), grouped by name prefix
  spec.json       per screen, state and mode: components (name, box x y w h
                  in CSS px, computed colour, background, font-family,
                  font-size, font-weight, border-radius, gap and padding for a
                  container, and the token each value matches), flows from one
                  screen to another, annotation pins with their position,
                  focus order and a normative or placeholder flag
  HANDOFF.md      the source URL, the screens and states, the component
                  table, the token summary, the rules and the exact
                  rshow compare command
  baseline/       <screen>__<state>__<width>__<mode>.png screenshots

A component is named by data-component, then by its wf-* class, then by its
role or tag. data-normative means the text, box and style must match;
data-placeholder, and anything without data-normative, is free: text, data and
images are placeholder by default. A mockup is shot artboard by artboard and
state by state, in focus mode through mockup.js when it exposes one, else by
its URL hash and the artboard clip. A deck, a report and a page are one screen
each (a deck one screen per section.slide).

Chrome or Chromium is driven headless over the DevTools protocol; set CHROME
to pick a binary. Only a public version can be read headless: if <slug>@v<n>
is not public, make it public or run rshow handoff on a local folder.
A starter rshow.map.json is written in the current folder when there is none.

rshow.map.json, kept next to the app:
  {"components": {"wf-button": "src/ui/Button.tsx",
                  "PrimaryButton": "src/ui/Button.tsx#primary"},
   "tokens": {"--accent": "theme.colors.accent"},
   "screens": {"gallery": "http://localhost:5173/",
               "share": "http://localhost:5173/a/demo#share",
               "cli": "tmux:mysession:0.1",
               "desktop": "file:shots/desktop.png",
               "settings": "window:My App"}}
```

