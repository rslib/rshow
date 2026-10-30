#!/usr/bin/env bash
set -euo pipefail

mkdir -p app/handoff/baseline app/src

cat > app/handoff/tokens.json <<'EOF'
{
  "$description": "rshow handoff tokens, W3C DTCG 2025.10",
  "color": {
    "accent": {
      "$value": "#2b5f9e",
      "$type": "color"
    },
    "ground": {
      "$value": "#f4f4f4",
      "$type": "color"
    },
    "ink": {
      "$value": "#161616",
      "$type": "color"
    },
    "line": {
      "$value": "#c6c6c6",
      "$type": "color"
    }
  },
  "font": {
    "sans": {
      "$value": "IBM Plex Sans",
      "$type": "fontFamily"
    }
  },
  "radius": {
    "control": {
      "$value": "7px",
      "$type": "dimension"
    }
  },
  "space": {
    "row": {
      "$value": "38px",
      "$type": "dimension"
    }
  },
  "dark": {
    "color": {
      "ground": {
        "$value": "#161616",
        "$type": "color"
      },
      "ink": {
        "$value": "#f4f4f4",
        "$type": "color"
      }
    }
  }
}
EOF

cat > app/handoff/spec.json <<'EOF'
{
  "schema": "1.0",
  "generator": "rshow handoff",
  "source": {
    "slug": "run-explorer",
    "version": 4,
    "url": "https://art.example.com/run-explorer/",
    "kind": "mockup",
    "skin": "custom"
  },
  "widths": [1440, 390],
  "modes": ["light", "dark"],
  "primaryWidth": 1440,
  "screens": [
    {
      "id": "runs",
      "title": "Runs",
      "frame": "browser",
      "kind": "mockup",
      "width": 1440,
      "height": 900,
      "states": ["default"],
      "flows": [
        { "from": "runs", "to": "runs" }
      ],
      "annotations": [
        {
          "text": "The table is the page, so it takes the width and the filters sit above it",
          "x": 96,
          "y": 180
        }
      ],
      "focus": ["FilterBar", "RunTable"],
      "variants": [
        {
          "state": "default",
          "mode": "light",
          "components": [
            {
              "name": "FilterBar",
              "role": "form",
              "x": 96,
              "y": 180,
              "w": 1248,
              "h": 56,
              "background": "#f4f4f4",
              "radius": "7px",
              "normative": true,
              "padding": "0px 16px",
              "tokens": { "background": "--color-ground", "radius": "--radius-control" }
            },
            {
              "name": "StatusPill",
              "role": "status",
              "x": 96,
              "y": 252,
              "w": 96,
              "h": 24,
              "color": "#161616",
              "background": "#f4f4f4",
              "fontFamily": "IBM Plex Sans",
              "fontSize": "12px",
              "radius": "7px",
              "normative": true,
              "text": "240 runs",
              "tokens": { "color": "--color-ink", "fontFamily": "--font-sans" }
            },
            {
              "name": "RunTable",
              "role": "table",
              "x": 96,
              "y": 288,
              "w": 1248,
              "h": 480,
              "color": "#161616",
              "background": "#f4f4f4",
              "fontFamily": "IBM Plex Sans",
              "fontSize": "14px",
              "normative": true,
              "tokens": { "color": "--color-ink", "fontFamily": "--font-sans" }
            },
            {
              "name": "PrimaryAction",
              "role": "button",
              "x": 1200,
              "y": 180,
              "w": 144,
              "h": 38,
              "color": "#ffffff",
              "background": "#2b5f9e",
              "fontFamily": "IBM Plex Sans",
              "fontSize": "14px",
              "radius": "7px",
              "normative": true,
              "text": "Export CSV",
              "tokens": { "background": "--color-accent", "radius": "--radius-control" }
            }
          ]
        }
      ]
    }
  ],
  "baselines": [
    {
      "file": "baseline/runs__default__1440__light.png",
      "screen": "runs",
      "state": "default",
      "width": 1440,
      "mode": "light"
    }
  ]
}
EOF

cat > app/rshow.map.json <<'EOF'
{
  "components": {
    "FilterBar": "",
    "PrimaryAction": "",
    "RunTable": "",
    "StatusPill": ""
  },
  "tokens": {
    "--color-accent": "",
    "--color-ground": "",
    "--color-ink": "",
    "--font-sans": "",
    "--radius-control": "",
    "--space-row": ""
  },
  "screens": {
    "runs": ""
  }
}
EOF

cat > app/handoff/HANDOFF.md <<'EOF'
# Handoff, run-explorer version 4

Source https://art.example.com/run-explorer/ at version 4, shot as a mockup in the custom skin.
Widths 1440 and 390, modes light and dark, components recorded at 1440.

## Screens

| id | title | frame | states | size |
|---|---|---|---|---|
| runs | Runs | browser | default | 1440x900 |

## Components

| name | role | box | must match |
|---|---|---|---|
| FilterBar | form | 96,180 1248x56 | yes |
| StatusPill | status | 96,252 96x24 | yes |
| RunTable | table | 96,288 1248x480 | yes |
| PrimaryAction | button | 1200,180 144x38 | yes |

Every component in the table carries `data-normative`, so its text, its box and its computed style are the design.
Anything the mockup does not mark is placeholder, so the run names, the numbers and the dates are yours to fill with real data.

## Tokens

`tokens.json` holds the frozen values, with a `dark` group for the dark ones.
Use a token and never a raw value, because a value that equals a token is right and a raw colour near a token colour is drift.
The accents, the radii and the spacing on this design are all tokens, so a screen built from literals is a screen that drifts.

## Rules

- The table is the page, so it takes the width and the filters sit above it.
- One accent, for the one action that changes the data.
- Sentence case in every label.
- The empty state, the error string and a long run name are yours, because they live in the app.

## Compare

```bash
rshow compare --against app/handoff --map app/rshow.map.json
```

Fill the map before you run it, because a screen or a name with an empty value is skipped.
EOF

printf '%s' 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==' \
  | base64 -d > app/handoff/baseline/runs__default__1440__light.png

cat > app/src/App.tsx <<'EOF'
export function App() {
  return (
    <main className="app">
      <p>Run explorer.</p>
    </main>
  );
}
EOF
