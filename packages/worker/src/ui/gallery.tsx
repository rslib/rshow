import { THEME_PREFIX } from "../constants";
import type { Env } from "../types";
import { islandProps, ISLAND, MODE_LABEL, MODE_ORDER, NavLayout, Pill, shortDate } from "./layout";
import type { UiArtifact, GalleryFilters, GalleryTag, NavProject } from "./types";

function galleryHref(filters: GalleryFilters, patch: Partial<GalleryFilters>): string {
  const next = { ...filters, ...patch };
  const params = new URLSearchParams();
  if (next.project) params.set("project", next.project);
  if (next.tag) params.set("tag", next.tag);
  if (next.mode) params.set("mode", next.mode);
  if (next.q) params.set("q", next.q);
  if (next.share) params.set("share", "shared");
  const query = params.toString();
  return query === "" ? "/" : `/?${query}`;
}

function ArtifactRow(props: { env: Env; artifact: UiArtifact; projectTitle: string | null }) {
  const artifact = props.artifact;
  const slugPath = `${artifact.slug}/`;
  return (
    <tr>
      <td class="cell-name">
        <a class="row-title" href={`/a/${artifact.slug}`}>
          {artifact.title}
        </a>
        <a
          class="slug-link mono"
          href={`https://${props.env.ART_HOST}/${artifact.slug}/`}
          target="_blank"
          rel="noreferrer"
          aria-label={`Open ${slugPath} live`}
        >
          {slugPath}
        </a>
      </td>
      <td class="muted">
        {artifact.project ? (
          <a href={`/p/${artifact.project}`}>{props.projectTitle ?? artifact.project}</a>
        ) : (
          <span class="muted">No project</span>
        )}
      </td>
      <td class="muted">{artifact.tags.length === 0 ? "No tags" : artifact.tags.join(", ")}</td>
      <td>
        <Pill mode={artifact.mode} />
      </td>
      <td class="mono">{artifact.served === null ? "No version" : `v${artifact.served}`}</td>
      <td class="muted">
        <time datetime={artifact.updated_at}>{shortDate(artifact.updated_at)}</time>
      </td>
    </tr>
  );
}

export function galleryPage(
  env: Env,
  email: string,
  items: UiArtifact[],
  projects: NavProject[],
  tags: GalleryTag[],
  filters: GalleryFilters
) {
  const projectTitle = filters.project === null ? null : (projects.find((row) => row.slug === filters.project)?.title ?? filters.project);
  const hasFilters = filters.project !== null || filters.tag !== null || filters.mode !== null || filters.q !== "" || filters.share;
  const heading = filters.project !== null ? (projectTitle ?? "Project") : filters.share ? "Shared with me" : "All artifacts";
  const subheading =
    filters.project !== null
      ? "Every artifact in this project that you can open."
      : filters.share
        ? "Artifacts owned by someone else that you can open."
        : "Everything you can open, publish and share.";
  const themes = items.filter((item) => item.slug.startsWith(THEME_PREFIX) && item.served !== null);
  const active = filters.project !== null ? "artifacts" : filters.share ? "shared" : "artifacts";

  return (
    <NavLayout
      env={env}
      email={email}
      title={heading}
      search={filters.q}
      projects={projects}
      active={active}
      activeProject={filters.project}
    >
      <div class="page-head">
        <div>
          <h1>{heading}</h1>
          <p class="page-sub">{subheading}</p>
        </div>
        <div class="button-row">
          <button
            type="button"
            class="btn btn-tertiary"
            data-island={ISLAND.copy}
            data-props={islandProps({ text: "rshow publish ." })}
          >
            Copy publish command
          </button>
          <a class="btn btn-primary" href="/tokens">
            New token
          </a>
        </div>
      </div>

      <div class="tagbar">
        <span class="tagbar-label">Tags</span>
        {tags.length === 0 ? (
          <span class="muted">No tags yet</span>
        ) : (
          tags.map((tag) => (
            <a
              class={filters.tag === tag.tag ? "tag-chip is-on" : "tag-chip"}
              href={galleryHref(filters, { tag: filters.tag === tag.tag ? null : tag.tag })}
              aria-pressed={filters.tag === tag.tag}
            >
              {tag.tag}
              <span class="tag-count">{tag.count}</span>
            </a>
          ))
        )}
        <span class="tagbar-spacer"></span>
        <form class="sharing-filter" method="get" action="/">
          {filters.project ? <input type="hidden" name="project" value={filters.project} /> : null}
          {filters.tag ? <input type="hidden" name="tag" value={filters.tag} /> : null}
          {filters.q ? <input type="hidden" name="q" value={filters.q} /> : null}
          {filters.share ? <input type="hidden" name="share" value="shared" /> : null}
          <label class="inline-label" for="sharing-filter">
            Sharing
            <select id="sharing-filter" name="mode" data-submit-on-change>
              <option value="">Any sharing</option>
              {MODE_ORDER.map((mode) => (
                <option value={mode} selected={filters.mode === mode}>
                  {MODE_LABEL[mode]}
                </option>
              ))}
            </select>
          </label>
          <noscript>
            <button type="submit" class="btn btn-sm">
              Apply
            </button>
          </noscript>
        </form>
      </div>

      <div class="table-box">
        <table class="data-table gallery-table">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Project</th>
              <th scope="col">Tags</th>
              <th scope="col">Sharing</th>
              <th scope="col">Live version</th>
              <th scope="col">Updated</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr class="empty-row">
                <td colSpan={6}>
                  {hasFilters
                    ? "No artifacts match these filters."
                    : "No artifacts yet. Publish one with the CLI, then it will appear here."}
                </td>
              </tr>
            ) : (
              items.map((artifact) => (
                <ArtifactRow
                  env={env}
                  artifact={artifact}
                  projectTitle={
                    artifact.project === null
                      ? null
                      : (projects.find((row) => row.slug === artifact.project)?.title ?? artifact.project)
                  }
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {themes.length > 0 ? (
        <section class="panel" aria-label="Themes">
          <div class="panel-head">
            <h2>Themes</h2>
            <span class="muted">Use a theme from your artifacts</span>
          </div>
          <ul class="theme-list">
            {themes.map((theme) => {
              const name = theme.slug.slice(THEME_PREFIX.length);
              return (
                <li class="theme-row">
                  <span>{name}</span>
                  <a class="mono" href={`https://${env.ART_HOST}/_themes/${name}@${theme.served}/`}>
                    {`/_themes/${name}@${theme.served}/`}
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </NavLayout>
  );
}
