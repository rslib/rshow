# Map

## Contents

- The file
- components
- tokens
- screens
- The starter map
- One example per stack
- Empty values

## The file

`rshow.map.json` sits next to the app and holds three objects, all of them name to string maps.

```json
{
  "components": {
    "wf-button": "src/ui/Button.tsx",
    "PrimaryButton": "src/ui/Button.tsx#primary"
  },
  "tokens": {
    "--accent": "theme.colors.accent",
    "--line": "--border-muted"
  },
  "screens": {
    "gallery": "http://localhost:5173/",
    "share": "http://localhost:5173/a/demo#share",
    "cli": "tmux:mysession:0.1",
    "desktop": "file:shots/desktop.png"
  }
}
```

`rshow compare` reads it from `--map`, or from `./rshow.map.json` when the flag is absent.
Keys are sorted on write, and a hand edit keeps working because the file is only read.
`screens` is the only object the compare reads, so a screen missing from it is skipped.
`components` and `tokens` are the record of the translation, and they are what a reviewer reads to see that each design name landed somewhere in the app.

## components

The key is the component name exactly as the handoff table writes it, such as `PrimaryButton` or `wf-card-header`.
The value is a path from the repo root, with `#anchor` when one file holds several components.

- Find the app component that already does the job before you write a new one.
  A handoff name often lands on a shared primitive, and two names may point at one file.
- Map every name in the component table that is not the role or the tag, because a name that is a bare tag such as `button` is not a component.
- Put `data-component` on the element when the app markup cannot be told apart by role and text.
  That is the first thing the structural check matches on.
- A new component gets a line here in the same commit, and the reply says the app had nothing that fit.

## tokens

The key is the token name with its leading `--`, exactly as `tokens.json` groups it.
The value is the path to the app's own token, in whatever form the app reads it.

- A CSS app maps to a variable or a Tailwind key, such as `"--accent": "--color-accent"` or `"--accent": "theme.colors.accent"`.
- A Swift app maps to a colour asset or a struct field, such as `"Color.accent"`.
- A Kotlin or Compose app maps to a theme field, such as `"MaterialTheme.colorScheme.primary"`.
- A ratatui app maps to a style field, such as `"Style::new().fg(ACCENT)"`.
- A dark value lives in the `dark` group of `tokens.json` and in the app's own dark scope, so it needs no second map line when the app swaps the token.

A token the design uses and the app does not have is a change to the app token system, and it is worth one sentence in the reply.

## screens

The key is the screen id from `spec.json`, such as an artboard id, a slide number or `page`.
The value is a url that renders that screen and that state, with the hash or the query the app needs.
It may also be a tmux target or a native capture, and the compare picks the path from the prefix.

- Use the dev server url and the route that renders the screen, such as `http://localhost:5173/a/demo#share`.
- A url may hold a hash, so a router that reads it lands on the right screen.
- A terminal UI uses a tmux target, which is `tmux:<session>:<window>.<pane>`.
  The pane must already run the TUI, and the first compare writes `baseline/<screen>.txt` from it.
- A native desktop app uses `file:<path.png>` for a screenshot of the window, relative to `rshow.map.json`.
  It uses `window:<app or title>` to capture the window itself, which works on macOS and on Linux with `xdotool` and ImageMagick.
  The capture is scaled to the baseline width with a box filter, so a Retina 2x screenshot is fine.
  The report then marks the screen `review` and writes `compare-report/rubric-<screen>.md` to tick beside the two images.
- Several screens may share one url when the app switches on a hash, and the compare opens the url once for all of them.
- A screen with no url is skipped, and the run still exits 0, so check that every id in `spec.json` has a value here.

## The starter map

`rshow handoff` writes a starter `./rshow.map.json` when the current folder has none.
It lists every component name, every token name and every screen id from the handoff, all with an empty value.
Fill the values in and delete nothing, because a key that the handoff writes and the map drops is a name the next handoff adds back.
Run the handoff from the app repo root so the starter lands where the compare looks for it.

## One example per stack

```json
{
  "components": { "wf-nav-item": "src/components/NavItem.tsx", "wf-avatar": "src/components/Avatar.tsx" },
  "tokens": { "--accent": "--accent", "--bg": "--surface", "--line": "--border" },
  "screens": { "gallery": "http://localhost:5173/gallery", "share": "http://localhost:5173/share" }
}
```

A React app with a Tailwind theme reads `tokens.json` into `theme.extend` once, and the map points at the theme keys.

```json
{
  "components": { "wf-button": "ios/UI/Button.swift", "wf-row": "ios/UI/Row.swift" },
  "tokens": { "--accent": "Color.accent", "--line": "Color.separator" },
  "screens": { "gallery": "http://localhost:8080/#gallery" }
}
```

A Swift app cannot match pixels through a browser, so the screens entry is a screenshot of the running app or the structural compare by hand.
Say which one you did.

A Compose app maps to the theme, and a screen url needs an emulator bridge, a screenshot of the running app or the structural compare instead.

```json
{
  "components": { "wf-button": "app/src/main/kotlin/ui/Button.kt" },
  "tokens": { "--accent": "MaterialTheme.colorScheme.primary" },
  "screens": { "gallery": "http://localhost:8080/#gallery" }
}
```

A ratatui app or any other terminal app maps `screens` to tmux, and the components and tokens the same way.

```json
{
  "components": { "wf-log-row": "src/ui/log_row.rs" },
  "tokens": { "--accent": "styles::ACCENT", "--line": "styles::BORDER" },
  "screens": { "cli": "tmux:rshow:0.1" }
}
```

A native desktop app, whether it is Electron, Tauri, egui, Qt, GTK or SwiftUI, maps `screens` to a screenshot or to the window itself.

```json
{
  "components": { "wf-sidebar": "src/Sidebar.tsx", "PrimaryButton": "src/Button.tsx#primary" },
  "tokens": { "--accent": "--color-accent", "--line": "--color-border" },
  "screens": { "desktop": "file:shots/desktop.png", "settings": "window:My App" }
}
```

Take `shots/desktop.png` at the baseline width or at twice it and keep it next to the map.
Re-take it after each fix.
`window:My App` matches the owner name first, then the window title, so the app name is usually enough.

## Empty values

An empty value is not a neutral default, it is a name nobody translated.
Write the value, or write the reason it stays empty in the reply, such as a component the design names and the app renders inline.
The next handoff adds every new name with an empty value, so a diff of this file is the list of what still needs a home.
