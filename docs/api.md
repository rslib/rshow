# rshow API

Two hostnames, one Worker.

- `art.example.com` serves artifacts to viewers.
- `artd.example.com` serves the admin UI and the JSON API under `/api`.

This page is the wire format. [how-it-works.md](how-it-works.md) explains why the pieces are shaped that way, and [self-host.md](self-host.md) deploys the Worker.

## Concepts

- **Artifact**: a named page, addressed by `slug` (`[a-z0-9][a-z0-9-]{0,62}`).
- **Version**: an immutable manifest `{path -> {hash, size, type}}`. Numbered 1, 2, 3 ...
- **Blob**: one file's bytes, stored once under its lowercase hex SHA-256.
- **Served version**: `pinned` if set, else the newest version.
- **Mode**: `private` (owner + shares with role editor), `people` (owner + every share), `public` (anyone, no sign-in).
- **Role** of a share: `viewer` or `editor`. Editors can publish and pin. Only the owner shares, renames or deletes.

## Viewer URLs (art.example.com)

- `/<slug>/` and `/<slug>/<path>`: the served version.
- `/<slug>/v<n>/` and `/<slug>/v<n>/<path>`: version n.
- A path that ends in `/` (or is empty) means `index.html` under it.
- `/<slug>/_data/<key>`: per-artifact JSON store. See [Data store](#data-store-_data).

## Data store (`_data`)

One JSON value per key, per artifact. Keys are `[A-Za-z0-9_.-]{1,128}`, at most 500 keys per artifact (a new key past that is a 409; existing keys still update). An invalid key is a 404.

| Key | Limit |
|---|---|
| `sketch-...` | 5 MiB |
| any other key | 64 KiB |

Where a value lives depends on its size. A value at or under 64 KiB is stored inline in D1 (`page_data.value`). A larger value, which only a `sketch-` key can hold, goes to R2 under `data/<slug>/<key>.json`, and the `page_data` row keeps `blob_key` with `value` NULL. Deleting the artifact drops both the rows and the objects under `data/<slug>/`. The API has no data endpoints; the store is served by the viewer host only.

Who: reading follows the mode rules of the artifact, so a public artifact's values are readable by anyone. Writing needs a signed-in person who can view the artifact; the `viewer` role is enough, and so is a project member.

| Method | Path | Notes |
|---|---|---|
| GET, HEAD | `/<slug>/_data/<key>` | `{value, updated_at, updated_by}` plus an `etag` header, `cache-control: no-store`. |
| PUT | `/<slug>/_data/<key>` | Body `{value}`, `content-type: application/json`, optional `If-Match`. Reply `{ok, key, updated_at}` with the new `etag`. |

The `ETag` is the quoted SHA-256 of the stored JSON text, whether that text sits in D1 or in R2, so a client sees one value per stored version. `If-Match` keeps two editors from silently overwriting each other.

| Case | Status |
|---|---|
| GET key that was never written | 404 |
| GET without sign-in when the artifact is not public | 302 to the login, then back |
| GET or PUT without the right to view | 403 |
| GET a row whose R2 object is gone | 500 |
| PUT a body that is not `application/json` | 415 |
| PUT a body that is not `{value}` | 400 |
| PUT a value over its key limit | 413 |
| PUT with `If-Match` that does not match, or with no value stored yet | 409 `etag mismatch` |
| PUT a 501st key | 409 `too many keys for this artifact` |
| any other method | 405 |

## API auth (artd.example.com/api)

Either:

- `Authorization: Bearer rsh_...` (a token made on the Tokens page), or
- the Cloudflare Access session of the browser (UI only).

Token scopes: `publish` (create artifacts, upload blobs, add versions, read) and `full` (also share, pin, rename, delete). Tokens never manage tokens.

Errors are `{"error": "<message>"}` with a 4xx or 5xx status.

## Endpoints

| Method | Path | Body | Reply |
|---|---|---|---|
| GET | `/api/me` | | `{email, scope}` |
| GET | `/api/artifacts` | | `{artifacts: [Artifact]}` (owned or shared with you) |
| POST | `/api/artifacts` | `{slug, title?}` | `Artifact` (201). 409 if slug is taken. |
| GET | `/api/artifacts/:slug` | | `Artifact & {versions: [Version], shares: [Share]}` |
| GET | `/api/artifacts/:slug/versions/:n` | | `Version & {files: {path: {hash, size, type}}}` (the manifest). 404 when the version does not exist. |
| PATCH | `/api/artifacts/:slug` | `{title?, mode?, pinned?}` (`pinned`: number or null) | `Artifact` |
| DELETE | `/api/artifacts/:slug` | `?force=1` for a `theme-` slug | 204, or 409 `pages link to this theme; pass force to delete it` |
| DELETE | `/api/artifacts/:slug/versions/:n` | `?force=1` for a `theme-` slug | `Artifact` (200). 404 when the version does not exist. 409 when it is pinned, is the only version, is a `theme-` version without `force`, or another change came first. |
| PUT | `/api/artifacts/:slug/shares/:email` | `{role}` | `Share` |
| DELETE | `/api/artifacts/:slug/shares/:email` | | 204 |
| POST | `/api/blobs/missing` | `{hashes: [sha256]}` (at most 1000) | `{missing: [sha256]}` |
| PUT | `/api/blobs/:sha256` | raw bytes (at most 25 MiB) | 204. 400 if the bytes do not hash to `:sha256`. |
| POST | `/api/artifacts/:slug/versions` | `{label?, files: {path: {hash, size, type}}}` | `Version` (201). 400 if a blob is missing, or if there is no `index.html` (artifacts whose slug starts with `theme-` are exempt). |

Types:

```ts
type Artifact = { slug: string; title: string; owner: string; mode: "private" | "people" | "public";
  pinned: number | null; latest: number | null; served: number | null; updated_at: string;
  role: "owner" | "editor" | "viewer"; url: string };
type Version = { n: number; label: string; created_by: string; created_at: string; files: number; bytes: number; url: string };
type Share = { email: string; role: "viewer" | "editor" };
```

`url` is the viewer URL on `art.example.com`.
On `GET /api/artifacts/:slug/versions/:n`, `files` is the manifest itself, not the count that a `Version` carries elsewhere.
Paths in `files` use `/`, have no leading `/`, no `..` segment and no empty segment.
At most 2000 files and 100 MiB per version.

`DELETE /api/artifacts/:slug/versions/:n` needs the owner, with a signed-in session or a `full` token, and drops one version: its row and its file list. An editor or a `publish` token gets 403. It answers 409 `version <n> is pinned; pin another version first` when the artifact pins that version and 409 `this is the only version; delete the artifact instead` when it is the last one. The bytes stay in storage, because another version or another page can share them. A version number is never used again: the next publish takes the highest number ever used plus one, so a browser that holds `/<slug>/v5/` never reads a different page at that URL.

A `theme-` slug, either the whole artifact or one of its versions, needs `?force=1`, because pages link the theme and a delete would break them.

## Publish flow (CLI)

1. Walk the folder (or take the one file as `index.html`) and hash each file.
2. `POST /api/artifacts` if the slug does not exist yet (ignore 409 when you own it).
3. When the artifact has a latest version, `GET /api/artifacts/:slug/versions/:n` and stop here if every path and hash matches: the folder is unchanged and gets no new version. `--force` skips this step.
4. `POST /api/blobs/missing`, then `PUT /api/blobs/:sha256` for each missing hash.
5. `POST /api/artifacts/:slug/versions` with the manifest.

## Themes

A theme is a public artifact whose slug is `theme-<name>`. Its versions are served at a fixed, immutable URL:

- `art.example.com/_themes/<name>@<n>/<path>` serves version n of artifact `theme-<name>`.
- `art.example.com/_themes/<name>@latest/<path>` answers a 302 to the version that theme serves now, so a page links the name once and a theme fix reaches it with no republish. It redirects to the version that `/_themes/<name>.json` reports, so a pin wins over the newest one. The redirect answers `cache-control: public, max-age=60`. A theme that is missing, private or has no version is a 404.
- These URLs are always public and cached for one year (`immutable`), so every deck shares one browser cache entry.
- `art.example.com/_themes/<name>.json` returns `{name, version, url}` for the served version of a public theme, cached for 60 s and open to any origin (`access-control-allow-origin: *`). Anything else is a 404 `{"error": "not found"}`, so a private theme stays hidden.
- `theme.json` names the theme and its files: `{name, description, defaultMode, modes, layouts, tokens, modeTokens}`. `layouts` maps a layout name to `{css: [...], js: [...], example: "example/<page>.html"}`, so a tool reads that map instead of a list of files.
- `tokens.css` holds CSS custom properties on `:root` (the light values) plus the dark values, and `fonts.css` declares the self-hosted fonts in `fonts/` (`*.woff2` plus the licence).
- `mode.js` owns the reader's choice of `system`, `light` or `dark`: `localStorage["rshow-mode"]`, `<html data-mode="light">` or `<html data-mode="dark">`, system otherwise, and the toggle button.
- One `css` and one `js` per layout, named after it: `deck`, `page`, `report`, `project`, `poster`, `dashboard`, `mockup`, `sketch`, `terminal`, `tui` (`deck.css` and `deck.js`, and so on).
- `skins/` holds the mockup skins as `css` and `js`: `wire`, `mac`, `material`, `fluent`, `adwaita`, `egui`, `sketch`, `custom`.
- `example/` holds one example page per layout, the one `layouts` points at.
- `rshow theme publish` publishes the folder as `theme-<name>` and sets the artifact public. Setting it public needs a full-scope token, but only when it is not public yet: a re-publish of an already public theme needs only `publish`. If the token is not full, the version is still published and stays private.
- Pages link the theme at `@latest`, for example `/_themes/default@latest/deck.css`, then override tokens in their own `<style>:root{...}</style>`.
- Every custom property of the built-in theme, with both values and its role, is in [theme-tokens.md](reference/theme-tokens.md).

## Config

Merged in this order, later wins:

1. `~/.config/rshow/config.json`: `{"url": "https://artd.example.com", "art": "https://art.example.com", "theme": "default@latest", "tokens": {"--accent": "#6EA8FF"}}`.
2. `rshow.json` in the artifact folder: `{"slug", "title", "theme", "tokens", "build": "<shell command>", "out": "dist"}`.

`rshow config [dir]` prints the merged config as JSON. It keeps `theme` as `<name>@latest`: no theme means `default@latest`, and a bare `<name>` or `<name>@latest` stays that way. A fixed `<name>@<n>` is left as it is. With the network it also prints `theme_resolved` as the `<name>@<n>` from `/_themes/<name>.json`. If the lookup fails, it prints a warning and leaves `theme_resolved` out. `--offline` skips the lookup.

The token comes from `RSHOW_TOKEN`, else from the macOS Keychain (service `rshow`, account = the API URL), the Linux keyring (same service and account), or `${XDG_CONFIG_HOME:-$HOME/.config}/rshow/credentials`, a JSON file `{"version": 1, "tokens": {"<url>": "<token>"}}` with mode 600. `rshow login` picks the first store the machine has and saves there, and `RSHOW_TOKEN_STORE` forces `keychain`, `keyring` or `file`.

## Blob index

D1 keeps `blobs(hash PK, size, created_at)`, written on every successful blob PUT. `POST /api/blobs/missing` and version checks query this table, never R2, and take the real `size` from it (the client's `size` is ignored).

## Projects

A project groups artifacts and shares them at once. URLs of artifacts do not change.

- A project has `slug` (same pattern as artifacts, separate namespace), `title`, `owner`, `description` (at most 500 chars).
- Members have role `viewer` or `editor`. The owner is implicit.
- An artifact belongs to at most one project (`project` is a slug or null). Only someone who can manage the artifact (its owner) and who is owner or editor of the project may move it into a project.
- Effective role on an artifact = the higher of its own share role and the project member role (owner > editor > viewer). The project owner counts as editor on its artifacts, never as artifact owner.
- Mode rules stay per artifact: `private` = owner + editors (direct or through the project); `people` = owner + every direct share + every project member; `public` = everyone.
- Group page `art.example.com/_p/<project>/`: lists the artifacts of the project that the viewer may see (title, link, mode, updated), rendered by the Worker in the default theme look, with the same sign-in redirect rules as artifacts. 404 when the viewer can see none of them and is not a member.

| Method | Path | Body | Reply |
|---|---|---|---|
| GET | `/api/projects` | | `{projects: [Project]}` (owned or member) |
| POST | `/api/projects` | `{slug, title?, description?}` | `Project` (201). 409 if taken. |
| GET | `/api/projects/:slug` | | `Project & {members: [Share], artifacts: [Artifact]}` (artifacts the caller can see) |
| PATCH | `/api/projects/:slug` | `{title?, description?}` | `Project` (owner) |
| DELETE | `/api/projects/:slug` | | 204 (owner; artifacts stay, their `project` becomes null) |
| PUT | `/api/projects/:slug/members/:email` | `{role}` | `Share` (owner) |
| DELETE | `/api/projects/:slug/members/:email` | | 204 (owner) |

`PATCH /api/artifacts/:slug` also takes `project` (slug or null) and `tags`. `POST /api/artifacts` also takes `project` and `tags`.

```ts
type Project = { slug: string; title: string; description: string; owner: string;
  role: "owner" | "editor" | "viewer"; artifacts: number; updated_at: string; url: string };
```

`Artifact` gains `project: string | null` and `tags: string[]`.

## Tags

- Free labels on an artifact, many per artifact: `[a-z0-9][a-z0-9-]{0,31}`, at most 10 per artifact, stored lowercase.
- Owner and editors may set tags (Bearer scope publish is enough).
- `GET /api/artifacts?tag=x&project=y&q=text` filters the list (all optional, combined with AND; `q` matches slug and title).
- `GET /api/tags` returns `{tags: [{tag, count}]}` over the artifacts the caller can see.

## Admin UI (artd.example.com)

Pages: `/` (artifacts, projects and a themes panel), `/a/<slug>` (artifact, versions, shares), `/p/<slug>` (project, members, artifacts), `/projects/new`, `/tokens`. A browser needs the Cloudflare Access session; the pages are HTML and call the same JSON API.

Admin pages link the viewer URLs on the art host, not on artd, so every link opens the real thing in a new tab: an artifact row links `https://art.example.com/<slug>/`, the detail page shows the live URL and frames a version from `https://art.example.com/<slug>/v<n>/`, a theme links `https://art.example.com/_themes/<name>@<n>/`, and a project links its group page `https://art.example.com/_p/<project>/`.

## The CLI against the API

The CLI is one client of this API. [commands/index.md](reference/commands/index.md) has every command with its flags, and [exit-codes.md](reference/exit-codes.md) has every exit code.

Every command takes `--json` (print the API reply JSON), `--help` and `--version` (`rshow <version>`). The token is read from `RSHOW_TOKEN`, else from the macOS Keychain, the Linux keyring or the 0600 credentials file, in that order, which is where `rshow login` put it. `rshow login [--url u]` reads the token from stdin (no echo on a terminal), checks it with `GET /api/me`, saves it in the first store the machine has, then reads it back to confirm, and prints where it went. `rshow logout [--url u]` removes it from every store that holds it.

`rshow publish` follows the publish flow above and prints `version-url` and `live-url`. A folder whose paths and hashes already match the latest version adds no version: it prints `unchanged: <slug> is already v<n>`, and `--force` publishes anyway. `rshow check` reads a folder against the page contract and exits 6 on an error, and `rshow publish` runs it first unless `--no-check` is given.
`rshow theme publish` publishes a folder as `theme-<name>`, and `rshow config` prints the merged config and resolves the theme version.
