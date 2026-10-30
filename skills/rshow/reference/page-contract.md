# Page contract

Every artifact on rshow follows this contract, whether a person wrote the HTML or a build did.
`rshow check <dir>` enforces it and exits 6 on any error, and it prints findings as `path:line: error|warning: msg`.
It reads the files a publish would upload, so for a prerendered site it reads the built output and not the source tree.

## Files

- One `index.html` at the root of the folder you publish.
- Every other path inside the artifact is relative and has no leading slash, such as `chart.svg`.
- The two root-relative prefixes are `/_themes/<name>@<n>/` and `/_data/`, and both point at the host on purpose.
- At most 2000 files and 100 MiB per version, and at most 25 MiB per file.
- No theme file in the artifact.
  No `deck.css`, no `page.css`, no font file, no `assets/` copy of a theme.

## Content Security Policy

The host sends these directives, and a request outside them fails in the browser console.

| Directive | Allowed sources |
|---|---|
| `script-src` | `'self'`, inline, `cdnjs.cloudflare.com`, `cdn.jsdelivr.net`, `unpkg.com` |
| `style-src` | `'self'`, inline, `fonts.googleapis.com` |
| `font-src` | `'self'`, `fonts.gstatic.com` |
| `img-src` | `'self'`, `data:`, `blob:` |
| `connect-src` | `'self'` |

`connect-src` is `'self'` only, so `fetch`, `XMLHttpRequest` and a websocket to any other host are blocked.
Bake the data into the page as a literal.
The artifact data store is the other place a value can live.

The theme files under `/_themes/` count as `'self'`, so a linked theme needs no policy exception.

## CDN builds, pinned

Pin the exact version in the URL and never write `@latest` or a moving tag, which `rshow check` counts as an error.

| Library | Pinned URL |
|---|---|
| Chart.js 4.4.1 | `https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.js` |
| D3 7.9.0 | `https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js` |
| Mermaid 10.9.1 | `https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js` |
| Marked 12.0.2 | `https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js` |
| Lodash 4.17.21 | `https://unpkg.com/lodash@4.17.21/lodash.min.js` |

The same file is fine from `cdnjs.cloudflare.com` or `unpkg.com`, as long as the version is in the path.
A page that needs no library is the better page, so reach for one only when the chart or the diagram is the point.

## The data store

`/_data/<key>` is a per artifact JSON store, and it is the only network call a page may make.
`GET ./_data/<key>` returns `{value}` or a 404, and `PUT` with a body of `{value}` needs a signed-in viewer and takes at most 64 KiB.

```js
const r1 = await fetch('./_data/settings');
const value = r1.ok ? (await r1.json()).value : null;

await fetch('./_data/settings', {
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ value: { title: 'A talk' } }),
});
```

Handle a 401 or a 403 by drawing the page without the stored value, because a public viewer cannot write.

## Phone width

The page is read on a phone more often than on a projector.

- `page.css` goes single column below 640px, so do not fight it with a fixed width.
- Wrap every table in `<div class="table">`, which scrolls sideways instead of squeezing.
- Body text stays at 16px or more, and an input stays at 16px or more so Safari does not zoom.
- A tap target is at least 40px tall.
- Look at the page at 360x640 before you publish.

## Nothing secret

Anyone who holds the link can read the HTML source, the inline script and every file in the folder.
So no token, no key, no password, no private URL, no customer name and no internal data.
Search the folder for `token`, `secret`, `key=`, `password` and `rsh_` before a publish.

`rshow check` catches some of these patterns and a `.env` file, and the rest of the search is yours to finish.
