# How rshow works

This page explains what the pieces are and why they are shaped that way.
It has no steps to follow.
For commands, see [reference/commands/index.md](reference/commands/index.md).
For the wire format, see [api.md](api.md).

## Artifacts

An artifact is a named folder of static files, addressed by its slug.
A slug is `[a-z0-9][a-z0-9-]{0,62}`, so a link reads the same in a chat as in a browser tab.

`rshow publish` walks the folder and hashes every file.
A folder needs an `index.html` at its root, except a theme, whose slug starts with `theme-`.
Paths inside an artifact use `/`, with no leading `/`, no `..` segment and no empty segment, and a version holds at most 2000 files and 100 MiB.

## Versions

Every publish of a changed slug adds a version and never changes an older one.
Publishing a folder that did not change adds nothing and says which version already holds it; `--force` publishes a new version anyway.
A version is a manifest, `{path -> {hash, size, type}}`, numbered 1, 2, 3 and so on.
That is what makes a link safe to send: `/<slug>/v<n>/` is a fixed set of bytes for good.

The live URL, `/<slug>/`, serves the **served version**: the pinned one when the artifact has a pin, the newest one otherwise.
`rshow pin <slug> <n>` moves the pin and `rshow pin <slug> live` clears it, so a rollback is one command and leaves every version in place.

## Blobs

A file's bytes are stored once, as a blob under the lowercase hex SHA-256 of the bytes.
Two versions that both ship `page.css` share one blob, and a small change to one page uploads only the files that changed:

1. The CLI hashes every file.
2. `POST /api/blobs/missing` asks which hashes the host does not have, at most 1000 at a time.
3. The CLI uploads the missing ones with `PUT /api/blobs/:sha256`.
4. `POST /api/artifacts/:slug/versions` sends the manifest.

A blob upload whose bytes do not hash to the path it was sent to is refused with 400, so a blob is what its name says it is.
D1 keeps a blob index, so the missing check and the version check read a table and never read R2.

## Modes and roles

An artifact has one mode:

| Mode | Who reads it |
|---|---|
| `private` | the owner, and the shares with the `editor` role |
| `people` | the owner and every share, viewer or editor |
| `public` | anyone who holds the link, with no sign in |

A share has a role, `viewer` or `editor`. Editors publish and pin; only the owner shares, renames and deletes.
A token carries a scope: `publish` creates artifacts, uploads blobs, adds versions and reads, and `full` also shares, pins, renames and deletes.

## Projects and tags

A project groups artifacts and shares them once, and no artifact URL changes when it joins one.

A project has its own slug namespace, a title, an owner and a description of at most 500 characters, and members with the role `viewer` or `editor`.
An artifact belongs to at most one project.
Your effective role on an artifact is the higher of its own share and your project membership, and the mode still applies per artifact.
The group page, `/_p/<project>/`, lists the artifacts of the project that the reader may see, and it follows the same sign-in rules as a page.

A tag is a free label on an artifact, `[a-z0-9][a-z0-9-]{0,31}`, stored lowercase, at most 10 per artifact.
`rshow list --project p --tag t --q text` filters the list, and the three filters combine.

## The `_data` store

A page can keep one JSON value per key, per artifact, at `/<slug>/_data/<key>`.
The viewer host serves it, not the API: `GET` and `HEAD` read, `PUT` writes.

A key is `[A-Za-z0-9_.-]{1,128}`, and an artifact holds at most 500 of them.
A value at or under 64 KiB sits inline in D1; a bigger one, which only a `sketch-` key may hold, goes to R2 under `data/<slug>/<key>.json` with a limit of 5 MiB.
Every reply carries an `ETag`, the quoted SHA-256 of the stored text, and `PUT` takes an `If-Match` on it, so two editors cannot silently overwrite each other.
Reading follows the mode of the artifact, and writing needs a signed-in person who can read it.

## Caching

A version URL serves the same bytes forever, so its files, its manifest and its theme CSS are cached for a year as `immutable`.
That is why `/_themes/` links are pinned at a version: one copy in the browser cache serves every page on the host.

The live URL is not immutable, because a publish moves it.
The access check behind a private or `people` artifact is cached for 15 seconds, so a change of mode or shares reaches every edge in about that time.
`/_data/` is `no-store`.
The Worker sits behind the Workers Cache, which serves a cached public reply without running the Worker and steps aside for a private reply or a request that carries `Authorization`.

## The two hosts

One Worker answers on two hostnames, and the split is what makes Access simple to configure.

The **viewer host** serves readers:

- `/<slug>/` and `/<slug>/<path>`, the served version.
- `/<slug>/v<n>/` and `/<slug>/v<n>/<path>`, one version.
- `/_themes/<name>@<n>/<path>`, a theme at one version, always public and cached for a year.
- `/_themes/<name>.json`, the served version of a public theme, for `rshow config`.
- `/_p/<project>/`, a group page.
- `/<slug>/_data/<key>`, the data store.
- `/_auth/login`, the one path that Access itself guards, which is where a reader signs in.

The **admin host** serves the person who publishes:

- `/`, `/a/<slug>`, `/p/<slug>`, `/projects/new` and `/tokens`, HTML pages that call the API.
- `/api/...`, the JSON API, with a bearer token or the Access session of the browser.

Access guards the admin host by email, bypasses `api/*` so the CLI can send its token, and allows everyone on `/_auth/*` of the viewer host, which lets a reader sign in through one cookie for the whole host.
[self-host.md](self-host.md) has the three applications.
