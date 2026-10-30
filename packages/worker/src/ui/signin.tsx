import type { Env } from "../types";
import { DetailLayout } from "./layout";

export function signInPage(env: Env) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Sign in - rshow</title>
        <script src="/static/mode.js"></script>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400&family=IBM+Plex+Sans:wght@300;400;600&display=swap"
        />
        <link rel="stylesheet" href="/static/app.css" />
      </head>
      <body>
        <div class="app">
          <header class="topbar">
            <span class="brand">
              rshow<span class="brand-sub">admin</span>
            </span>
            <span class="top-spacer"></span>
            <span class="topbar-user">{env.ARTD_HOST}</span>
          </header>
          <main class="page signin">
            <section class="panel signin-card">
              <div class="panel-body">
                <h1>Sign in to rshow</h1>
                <p class="page-sub">
                  The admin UI is protected by Cloudflare Access. Sign in with the account your team manages.
                </p>
                <a class="btn btn-primary" href="/">
                  Continue
                </a>
              </div>
            </section>
          </main>
        </div>
        <script src="/static/app.js"></script>
      </body>
    </html>
  );
}

export function uiNotFoundPage(env: Env, email: string) {
  return (
    <DetailLayout env={env} email={email} title="Not found">
      <nav class="breadcrumbs" aria-label="Breadcrumb">
        <a href="/">All artifacts</a>
        <span class="crumb-sep">/</span>
        <span aria-current="page">Not found</span>
      </nav>
      <div class="page-head">
        <div>
          <h1>Not found</h1>
          <p class="page-sub">That artifact or project does not exist, or you do not have access to it.</p>
        </div>
        <div class="button-row">
          <a class="btn btn-secondary" href="/">
            All artifacts
          </a>
          <a class="btn btn-primary" href="/projects/new">
            New project
          </a>
        </div>
      </div>
    </DetailLayout>
  );
}
