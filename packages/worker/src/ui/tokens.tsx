import { formatDate } from "../html";
import type { Env } from "../types";
import { islandProps, ISLAND, NavLayout, plural, titleCase } from "./layout";
import type { NavProject, UiToken } from "./types";

export function tokensPage(env: Env, email: string, tokens: UiToken[], projects: NavProject[]) {
  return (
    <NavLayout env={env} email={email} title="Tokens" search="" projects={projects} active="tokens">
      <nav class="breadcrumbs" aria-label="Breadcrumb">
        <a href="/">All artifacts</a>
        <span class="crumb-sep">/</span>
        <span aria-current="page">Tokens</span>
      </nav>
      <div class="page-head">
        <div>
          <h1>Tokens</h1>
          <p class="page-sub">Create tokens for the CLI. Publish tokens can publish and tag, full tokens can do everything.</p>
        </div>
      </div>

      <div data-island={ISLAND.tokens} data-props={islandProps({})}>
        <section class="panel" aria-label="New token">
          <div class="panel-head">
            <h2>New token</h2>
            <span class="muted">The secret is shown once</span>
          </div>
          <div class="panel-body">
            <form class="field-row" data-form="token">
              <label class="sr-only" for="token-name">
                Token name
              </label>
              <input id="token-name" name="name" placeholder="Token name" required maxlength={64} autocomplete="off" />
              <label class="sr-only" for="token-scope">
                Scope
              </label>
              <select id="token-scope" name="scope">
                <option value="publish">Publish</option>
                <option value="full">Full</option>
              </select>
              <button type="submit" class="btn btn-primary">
                Create token
              </button>
            </form>
            <div class="token-box" id="token-box" hidden>
              <p class="muted">Copy this token now. It will not be shown again.</p>
              <code id="token-value"></code>
            </div>
            <p class="token-error" id="token-error" hidden></p>
          </div>
        </section>

        <section class="panel" aria-label="Your tokens">
          <div class="panel-head">
            <h2>Your tokens</h2>
            <span class="muted">{plural(tokens.length, "token", "tokens")}</span>
          </div>
          {tokens.length === 0 ? (
            <p class="empty">No tokens yet. Create one above to publish from the CLI.</p>
          ) : (
            <div class="table-box">
              <table class="data-table token-table">
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Scope</th>
                    <th scope="col">Created</th>
                    <th scope="col">Last used</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody id="token-rows">
                  {tokens.map((token) => (
                    <tr data-token-id={token.id}>
                      <td>{token.name}</td>
                      <td class="muted">{titleCase(token.scope)}</td>
                      <td class="muted">
                        <time datetime={token.created_at}>{formatDate(token.created_at)}</time>
                      </td>
                      <td class="muted">
                        {token.last_used_at === null ? "Never" : <time datetime={token.last_used_at}>{formatDate(token.last_used_at)}</time>}
                      </td>
                      <td>
                        <button type="button" class="btn-link" data-action="revoke" data-id={token.id}>
                          Revoke
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </NavLayout>
  );
}
