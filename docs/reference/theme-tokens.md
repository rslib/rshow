# Theme tokens

Every CSS custom property of the built-in `default` theme, with its light value, its dark value and the role the theme gives it.
The values come from `themes/default/tokens.css`, in the groups that file uses, and the roles come from the comment at the top of it.
Print uses the light values.

## Colour scheme

"light" or "dark". Tells the browser which way to render scrollbars and form controls. Each mode block below sets it with the rest.

| Token | Light | Dark | Role |
| --- | --- | --- | --- |
| `--color-scheme` | `light` | `dark` | - |

## Ground, Carbon

Carbon white.

| Token | Light | Dark | Role |
| --- | --- | --- | --- |
| `--bg` | `#ffffff` | `#161616` | the ground of a page, a deck slide, a report |
| `--bg-shell` | `#f4f4f4` | `#262626` | the area around the deck canvas |
| `--layer-01` | `#f4f4f4` | `#262626` | a filled block inside the ground: code, inset panels |
| `--layer-02` | `#ffffff` | `#393939` | a second level, used sparingly |
| `--border-subtle` | `#e0e0e0` | `#393939` | a row rule in a table, the lightest line |
| `--border-strong` | `#8d8d8d` | `#6f6f6f` | an axis line, a diagram outline |
| `--fg` | `#161616` | `#f4f4f4` | all body and heading text |
| `--muted` | `#525252` | `#c6c6c6` | a caption, a source line, a label beside a number |
| `--placeholder` | `#a8a8a8` | `#6f6f6f` | decorative only. Never text. |
| `--accent` | `#0f62fe` | `#78a9ff` | a link, a focus ring, a single-series chart, the one line that matters in a figure |
| `--focus` | `#0f62fe` | `#ffffff` | - |
| `--support-error` | `#da1e28` | `#fa4d56` | a data mark. Never text, because they fail 4.5:1 on white. |
| `--support-success` | `#24a148` | `#42be65` | a data mark. Never text, because they fail 4.5:1 on white. |
| `--support-warning` | `#f1c21b` | `#f1c21b` | a data mark. Never text, because they fail 4.5:1 on white. |

## Data, categorical

Carbon's eight series colours, in Carbon order. Data marks only.

| Token | Light | Dark | Role |
| --- | --- | --- | --- |
| `--chart-1` | `#6929c4` | `#8a3ffc` | a categorical series, in Carbon order |
| `--chart-2` | `#1192e8` | `#33b1ff` | a categorical series, in Carbon order |
| `--chart-3` | `#005d5d` | `#007d79` | a categorical series, in Carbon order |
| `--chart-4` | `#9f1853` | `#ff7eb6` | a categorical series, in Carbon order |
| `--chart-5` | `#fa4d56` | `#fa4d56` | a categorical series, in Carbon order |
| `--chart-6` | `#570408` | `#fff1f1` | a categorical series, in Carbon order |
| `--chart-7` | `#198038` | `#6fdc8c` | a categorical series, in Carbon order |
| `--chart-8` | `#002d9c` | `#4589ff` | a categorical series, in Carbon order |

## Fonts

Self hosted, see fonts.css and fonts/OFL.txt. The stacks end in system fonts so the document still reads if the files do not load.

| Token | Light | Dark | Role |
| --- | --- | --- | --- |
| `--font-sans` | `"IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif` | `-` | - |
| `--font-mono` | `"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` | `-` | - |

## Type scale

Two scales in one set. The steps up to --text-lg are for running text and labels. The steps from --text-xl up are Carbon's expressive heading sizes 32, 42, 54, 60, 76, used for one idea per slide on a 1280x720 canvas.

| Token | Light | Dark | Role |
| --- | --- | --- | --- |
| `--text-2xs` | `14px` | `-` | - |
| `--text-xs` | `16px` | `-` | - |
| `--text-sm` | `18px` | `-` | - |
| `--text-base` | `20px` | `-` | - |
| `--text-md` | `24px` | `-` | - |
| `--text-lg` | `28px` | `-` | - |
| `--text-xl` | `32px` | `-` | - |
| `--text-2xl` | `42px` | `-` | - |
| `--text-3xl` | `54px` | `-` | - |
| `--text-4xl` | `60px` | `-` | - |
| `--text-5xl` | `76px` | `-` | - |

## Line heights

| Token | Light | Dark | Role |
| --- | --- | --- | --- |
| `--lh-flat` | `1` | `-` | - |
| `--lh-heading` | `1.25` | `-` | - |
| `--lh-list` | `1.4` | `-` | - |
| `--lh-body` | `1.45` | `-` | - |
| `--lh-read` | `1.6` | `-` | - |
| `--lh-code` | `1.6` | `-` | - |

## Tracking

Zero for body and for headings up to 54px. A display line above 54px tightens, because Plex Sans opens up as it grows.

| Token | Light | Dark | Role |
| --- | --- | --- | --- |
| `--tracking-display` | `-0.02em` | `-` | - |

## Spacing

Carbon's spacing scale, in full.

| Token | Light | Dark | Role |
| --- | --- | --- | --- |
| `--space-01` | `2px` | `-` | - |
| `--space-02` | `4px` | `-` | - |
| `--space-03` | `8px` | `-` | - |
| `--space-04` | `12px` | `-` | - |
| `--space-05` | `16px` | `-` | - |
| `--space-06` | `24px` | `-` | - |
| `--space-07` | `32px` | `-` | - |
| `--space-08` | `40px` | `-` | - |
| `--space-09` | `48px` | `-` | - |
| `--space-10` | `64px` | `-` | - |
| `--space-11` | `80px` | `-` | - |
| `--space-12` | `96px` | `-` | - |
| `--space-13` | `160px` | `-` | - |

## Shape

Carbon is square: no radius, no shadow. The tokens stay so a page can soften a corner on purpose.

| Token | Light | Dark | Role |
| --- | --- | --- | --- |
| `--radius` | `0` | `-` | - |
| `--radius-sm` | `0` | `-` | - |
| `--pad-x` | `var(--space-12)` | `-` | - |
| `--pad-y` | `var(--space-10)` | `-` | - |

