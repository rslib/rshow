# Themes

A theme is a published artifact at `theme-<name>`, served at `/_themes/<name>@<n>/`, and it is always public.
Pages and decks link it and never copy it, so one token change can restyle every artifact that points at the new version.
Read this file when a five line override cannot carry the change.

## What ships

One theme ships in the rshow repo, `themes/default`, and it is IBM Carbon v11 on IBM Plex in two modes.

| Mode | Ground | Use |
|---|---|---|
| light, Carbon white `#ffffff` | `:root` in `tokens.css` | the default on a machine in light appearance |
| dark, Carbon g100 `#161616` | `prefers-color-scheme` and `[data-mode="dark"]` | the same deck, page and report on a dark ground |

One theme, two modes, system by default.
The light values sit on `:root`, the dark values appear twice, once for the system preference and once for `<html data-mode="dark">`.
`--chart-1` to `--chart-8` carry both palettes too.
`mode.js` reads the storage key `rshow-mode` (`light`, `dark` or `system`), sets `data-mode` on the document element and removes it for system.
It also mounts the toggle.
A deck shares the key: `t` cycles system, light and dark.
Print is always light.
The `paper` theme is no longer in the repo.
Its published versions stay online and immutable, so a page that pins `paper@<n>` keeps working.

`themes/DESIGN.md` holds the system itself: the palette roles, the type scale, the twelve layouts and the list of things this design never does.
Read it before you write a theme or a token override that is more than a colour swap.

## Files

| File | Holds |
|---|---|
| `tokens.css` | every custom property, on `:root`, with no rules |
| `fonts.css` | the `@font-face` rules, pointing at `fonts/` |
| `fonts/` | the font files and their licence |
| `page.css` | the prose layout, the tables, the figures and the code block |
| `deck.css` | the 1280x720 canvas and the twelve slide layouts |
| `report.css` | the report layout: title block, contents column, side notes, print rules |
| `mode.js` | the mode from one storage key, plus the toggle button |
| `deck.js` | arrow keys, steps, notes, presenter view, the `t` key, print |
| `report.js` | section, figure and table numbering, cross-references, contents, notes, references |
| `theme.json` | the name and, for humans, the description and both mode token sets |
| `index.html` | the preview page, which shows a deck, a page and a report |

`theme.json` needs one field for the CLI, and the rest is for the person reading the repo.

```json
{
  "name": "default",
  "description": "IBM Carbon on IBM Plex, two modes, one accent, no decoration.",
  "defaultMode": "system",
  "modes": ["system", "light", "dark"],
  "tokens": {"--space-05": "16px"},
  "modeTokens": {
    "light": {"--bg": "#ffffff", "--fg": "#161616", "--accent": "#0f62fe"},
    "dark": {"--bg": "#161616", "--fg": "#f4f4f4", "--accent": "#78a9ff"}
  }
}
```

`modeTokens` lists both sets so the file says what the theme does in each mode, and the CLI reads the name only.

The name is lowercase.
It starts with a letter or a digit and may hold hyphens.
It must not start with `theme-`, because the slug adds that.

## Make a preset

A preset is a small folder: a `theme.json` that extends a built-in theme, and a `fonts/` folder only when the brand brings its own type.
It changes token values and fonts.
It never renames a class or moves a layout.

Start with the brand inputs: the accent colour, the ground for light and for dark, and the font.
A logo is out of scope, because a logo belongs in the page and not in the theme.

1. Run `rshow theme new acme --dir ./themes`.
   It writes `./themes/acme/theme.json` with `extends`, an empty `tokens` object and both modes filled with the base values of `--bg`, `--fg`, `--muted`, `--accent` and `--layer-01`.
2. Edit that `theme.json` and nothing else.
   Change values, not names, and add a token only when the base theme already has it.
   `tokens` holds values both modes share, such as `--font-sans`; `modeTokens.light` and `modeTokens.dark` hold the colours.
3. Add `fonts` when the brand brings a font, and put the files and their licence in `fonts/`.
   One entry looks like `{"family": "Inter", "weight": 400, "style": "normal", "file": "fonts/Inter-Regular.woff2"}`.
   Ship `OFL.txt`, `LICENSE`, `LICENSE.txt` or `LICENSE.md` beside the files, because a font without its licence warns.
4. Run `rshow theme check ./themes/acme` until it passes.
   This is a hard gate and you never skip it: it names an unknown token, a bad colour value, and every text pair under 4.5:1 in light, in dark and in print.
5. Run `rshow theme preview ./themes/acme` and open the printed link.
   Look at both modes, and at the deck, the page and the report.
6. Run `rshow theme publish ./themes/acme`.
   It checks again, lays the preset over its base and publishes the built folder as `theme-acme`.
   Read the `/_themes/acme@<n>/` line it prints.
7. Set `"theme": "acme@<n>"` in `~/.config/rshow/config.json`, or in the `rshow.json` of one folder to move that page alone.

## A full theme

1. Copy `themes/default` from the rshow repo into your own folder.
2. Change `name` in `theme.json` and leave every other file name alone.
3. Edit `tokens.css` first, from a documented system rather than from a feeling.
   Copy the values in by hand and keep the role names, because a role is the interface.
4. Keep the class names.
   `slide`, `title`, `section`, `statement`, `bullets`, `figure`, `figure-two`, `chart`, `table`, `code`, `two-col`, `quote` and `big-number` are the interface a deck writes against.
   A theme that renames one breaks every deck that uses it.
5. Put the measured contrast ratios in a comment at the top of `tokens.css`.
6. Update `index.html` so it shows the new look at desktop width and at 360px, in both modes.
7. Run `rshow preview <theme dir>` and open the printed link, because the preview page links its own files by relative path and needs no host.

The preview page in the repo links `../deck.css` so a checkout previews with no network.
Keep those relative links in the repo and swap them for `/_themes/<name>@<n>/` links only in a page that lives on the host.

## Contrast

Text has to hold 4.5:1 against the ground it sits on, and that includes `--muted` and `--accent` as text.
Check every text pair in both modes, because one theme carries two grounds.
Check the print palette too, which is always light.
A ratio under 4.5:1 is a real defect, not a taste question, so darken the text or lighten the ground before publishing.
A support colour is a data mark and never text, because green on white is 3.4:1 and a mark is not a label.

## Publishing

```bash
rshow theme publish ./my-theme --label "carbon g100 on plex"
rshow theme list
```

`theme publish` uploads the folder, sets the artifact public and prints `/_themes/<name>@<n>/`.
It needs a full-scope token, because the artifact goes public.
Without one it publishes the version and reports that it stayed private, and the link will 404 for everyone else until a person with a full-scope token runs it again.
`theme list` prints each theme artifact and the version it currently serves.

## Bumping a version

Every publish adds a version, and `@<n>` in a page pins one.
So publish the theme and read the new `<n>` from the printed line.
Then change the three or four links in each artifact that should follow.
Change the whole set of links in one page to the same `<n>` and never mix two versions in one page.
Leave a page on the old version when it is being presented this week, and move it after the talk.
A version is immutable, so an old `@<n>` keeps working and no page breaks while the theme is in progress.

A full theme is published the same way.
A preset is checked with `rshow theme check` before it is published, and the built folder is what goes up.
