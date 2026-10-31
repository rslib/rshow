# Self-host

rshow runs on your own Cloudflare account: one Worker, one D1 database and one R2 bucket.
This page sets that up once, then deploys it from a small private repository.

Every example uses `art.example.com` for the host that serves pages to viewers and `artd.example.com` for the host that serves the API and the web UI.
Use your own hosts in their place, and keep both on a zone in your account.

## What you need

- A Cloudflare account with a zone.
- Node 26 or later, and a checkout of the rshow repository.
- Wrangler, logged in to that account: `npx wrangler login`.

## The database and the bucket

```sh
npx wrangler d1 create rshow
npx wrangler r2 bucket create rshow-blobs
```

The first command prints a `database_id`. Keep it for the config below.
D1 holds the artifacts, versions, shares, projects, tags and tokens, and the `_data` rows.
R2 holds every file once per hash, plus the large `_data` values.

## The three Access applications

Zero Trust, then Access, then Applications.
All three use the same team, so they share one `ACCESS_TEAM`.

| App | Host | Path | Action | Rule |
|---|---|---|---|---|
| Admin | `artd.example.com` | every path | Allow | `Emails` includes the address you sign in with |
| Viewer session | `art.example.com` | `_auth/*` | Allow | `Everyone` |
| CLI | `artd.example.com` | `api/*` | Bypass | `Everyone` |

Turn off **Cookie path** on the viewer session app, under its additional settings.
With it off, the Access cookie covers the whole host, and the Worker reads it on every page it serves.
With it on, the cookie is only sent to `_auth/*` and every viewer is asked to sign in again.

> [!IMPORTANT]
> The bypass on `api/*` does not open the API to anyone.
> The Worker checks the bearer token itself on that path and answers 401 without a valid `rshow` token.

Each application has an Application Audience (AUD) tag on its overview page.
The admin app gives `ARTD_AUD`, the viewer session app gives `ART_AUD`.
The CLI app has one too, and nothing reads it.

## The Worker config

```sh
cp packages/worker/wrangler.example.jsonc wrangler.jsonc
```

Then fill it in:

| Field | Holds |
|---|---|
| `routes` | the two custom domains, one per host; Cloudflare makes the DNS records |
| `vars.ART_HOST` | `art.example.com` |
| `vars.ARTD_HOST` | `artd.example.com` |
| `vars.ACCESS_TEAM` | `https://<team>.cloudflareaccess.com` |
| `vars.ART_AUD` | the AUD of the viewer session app |
| `vars.ARTD_AUD` | the AUD of the admin app |
| `d1_databases[0].database_id` | the id that `d1 create` printed |
| `r2_buckets[0].bucket_name` | `rshow-blobs` |

Nothing in that file is a secret. A team name and an AUD tag are public identifiers.

## The deploy repository

Keep the repository private, because it names your hosts and your AUD tags.
Its `package.json` depends on the published rshow package, which ships the Worker bundle, its migrations and the default theme:

```json
{
  "name": "rshow-deploy",
  "private": true,
  "dependencies": {
    "rshow": "^0.0.5"
  }
}
```

`wrangler.jsonc` points `main` and `migrations_dir` into that package, so an upgrade is one version bump:

```jsonc
{
  "name": "rshow",
  "main": "node_modules/rshow/worker/index.js",
  "compatibility_date": "2025-01-01",
  "observability": { "enabled": true },
  "cache": { "enabled": true },
  "routes": [
    { "pattern": "art.example.com", "custom_domain": true },
    { "pattern": "artd.example.com", "custom_domain": true }
  ],
  "vars": {
    "ART_HOST": "art.example.com",
    "ARTD_HOST": "artd.example.com",
    "ACCESS_TEAM": "https://<team>.cloudflareaccess.com",
    "ART_AUD": "<ART_AUD>",
    "ARTD_AUD": "<ARTD_AUD>"
  },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "rshow",
      "database_id": "<database-id>",
      "migrations_dir": "node_modules/rshow/worker/migrations"
    }
  ],
  "r2_buckets": [{ "binding": "BUCKET", "bucket_name": "rshow-blobs" }]
}
```

Commit `package-lock.json` with it, so a deploy uses the version you tested.

## The deploy job

`.github/workflows/deploy.yml` runs on every push to `main`:

```yaml
name: deploy

on:
  push:
    branches: [main]
  workflow_dispatch:

concurrency:
  group: deploy
  cancel-in-progress: false

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v7
        with:
          node-version: 26
          cache: npm
      - run: npm ci
      - run: npx wrangler d1 migrations apply rshow --remote
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
      - run: npx wrangler deploy
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

Two repository secrets: `CLOUDFLARE_API_TOKEN`, with the Workers Scripts and D1 edit permissions, and `CLOUDFLARE_ACCOUNT_ID`.
The migrations run before the deploy, so a new table exists before a Worker asks for it.

## The first run

Open `https://artd.example.com` and sign in through Access.
Make a token on the Tokens page, then point the CLI at the two hosts and save the token, as [getting-started.md](getting-started.md) does.

## Upgrades

`.github/dependabot.yml` opens a pull request when a new rshow is published:

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
```

Merging it runs the same job: the new bundle is uploaded and any new migration is applied.
Published versions keep their URLs, so an upgrade never changes a link you sent.
