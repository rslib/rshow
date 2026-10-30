# Themes

A theme is a published artifact of its own.
Pages, decks and reports link it and never copy it, so one new version restyles every page that points at it.

## The built-in theme

One theme ships, `default`: IBM Carbon on IBM Plex, in two modes, light and dark.
The light values sit on `:root` in `tokens.css`, the dark values sit under the system preference and under `<html data-mode="dark">`, and `mode.js` follows the system until a reader picks a mode.
Print is always light.

Every custom property of that theme, with both values and its role, is in [reference/theme-tokens.md](reference/theme-tokens.md).

A page links the theme with root-relative URLs at one version:

```html
<link rel="stylesheet" href="/_themes/default@3/page.css">
<script src="/_themes/default@3/mode.js"></script>
```

A deck links `deck.css` where a page links `page.css`, and a report links `report.css`.
Every URL carries the same `<name>@<n>`, and `/_themes/<name>@<n>/` serves that version for one year as `immutable`, so every page on the host shares one browser cache entry.
An override goes in one `:root` block in the page, five declarations at most.

`rshow theme list` prints the themes you can see and the version each one serves.

## Presets

A preset is a small folder: a `theme.json` that extends a built-in theme, and a `fonts/` folder only when the brand brings its own type.
It changes token values and fonts, and it never renames a class.

```sh
rshow theme new acme --dir ./themes
rshow theme check ./themes/acme
rshow theme preview ./themes/acme
rshow theme publish ./themes/acme
```

1. `theme new` writes `./themes/acme/theme.json` with `extends`, an empty `tokens` object and both modes filled with the base values of `--bg`, `--fg`, `--muted`, `--accent` and `--layer-01`.
2. Edit that file and nothing else. Change values, not names.
   `tokens` holds a value both modes share, such as `--font-sans`; `modeTokens.light` and `modeTokens.dark` hold the colours.
3. `theme check` is a hard gate. It names an unknown token, a bad colour value, and every text pair under 4.5:1 in light, in dark and in print.
4. `theme preview` builds the preset over its base and serves it on `127.0.0.1`, with no host needed.
5. `theme publish` checks again, lays the preset over its base and publishes the built folder as `theme-acme`, then sets it public.
   A re-publish of an already public theme needs only the `publish` scope; making it public the first time needs `full`.
   A re-publish whose built folder did not change adds no version and says which one is already live; `--force` publishes anyway.

It prints the immutable URL it published to:

```text
https://art.example.com/_themes/acme@2/
```

## Full themes

A full theme is the whole folder: `tokens.css`, `fonts.css`, `fonts/`, one `css` and one `js` per layout, `skins/`, `example/`, `theme.json` and the preview `index.html`.

1. Copy `themes/default` from the rshow repository.
2. Change `name` in `theme.json` and leave every other file name alone.
3. Edit `tokens.css` first, from a documented system rather than from a feeling, and keep the role names, because a role is the interface.
4. Keep the class names. `slide`, `title`, `bullets`, `figure`, `table`, `code` and `big-number` are the interface a deck writes against.
5. Run `rshow preview <dir>` to look at it with no network, then `rshow theme check` and `rshow theme publish`.

## Choosing the theme of a page

A page takes the theme from two config files, and the later one wins:

- `~/.config/rshow/config.json`, which `rshow init --theme acme` writes.
- `rshow.json` in the page folder: `{"slug", "title", "theme", "tokens", "project", "tags", "build", "out"}`.

`rshow config [dir]` prints the merged config and resolves the version.
No theme means `default@latest`, and `<name>` or `<name>@latest` becomes `<name>@<n>` from `/_themes/<name>.json`.
A fixed `<name>@<n>` is printed as it is, with no request.
When the lookup fails it prints a warning and leaves the name alone, and `--offline` skips it.

Pin the version you tested in a page you publish, and let `rshow config` do the lookup when you are starting one.
