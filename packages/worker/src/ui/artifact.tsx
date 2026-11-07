import { THEME_PREFIX } from "../constants";
import { formatBytes } from "../html";
import type { Env, ShareRow, VersionRow } from "../types";
import {
  Breadcrumbs,
  DetailLayout,
  islandProps,
  ISLAND,
  MODE_LABEL,
  MODE_ORDER,
  Pill,
  plural,
  RemoveButton,
  shortDate
} from "./layout";
import type { UiArtifact, UiProjectAccess } from "./types";

const MODE_HINT: Record<string, string> = {
  private: "Only you and editors can open it.",
  people: "Everyone must sign in. You choose who can open it.",
  public: "Anyone with the link can open it."
};

function sharingSummary(artifact: UiArtifact, project: UiProjectAccess | null, shares: readonly ShareRow[]): string {
  if (artifact.mode === "public") return "Anyone with the link. No sign-in.";
  if (artifact.mode === "people") {
    const base = "You, the people below and every member of the project. Everyone signs in first.";
    if (project) return `${base} ${plural(project.members.length + 1, "member", "members")} through ${project.title}.`;
    if (shares.length > 0) return `${base} ${plural(shares.length, "person", "people")} listed directly.`;
    return base;
  }
  const base = "Only you, editors and project editors.";
  if (project) return `${base} ${plural(project.members.length + 1, "member", "members")} through ${project.title}.`;
  return base;
}

function VersionRowView(props: { artifact: UiArtifact; version: VersionRow; owner: boolean; count: number }) {
  const version = props.version;
  const served = props.artifact.served === version.n;
  const pinned = props.artifact.pinned === version.n;
  const deletable =
    props.owner && !props.artifact.slug.startsWith(THEME_PREFIX) && !pinned && props.count > 1;
  return (
    <li class={served ? "version-row is-served" : "version-row"}>
      <span class="version-n mono">v{version.n}</span>
      <div class="version-main">
        <div class="version-label">{version.label === "" ? "Untitled version" : version.label}</div>
        <div class="version-meta">
          {version.created_by} &middot; {shortDate(version.created_at)} &middot; {plural(version.files, "file", "files")} &middot;{" "}
          {formatBytes(version.bytes)}
        </div>
      </div>
      {served ? <span class="pill pill-live">{pinned ? "Pinned, live" : "Live"}</span> : null}
      <a class="btn-link" href={`/a/${props.artifact.slug}?preview=${version.n}`}>
        Preview
      </a>
      {props.owner && !served ? (
        <button type="button" class="btn-link" data-action="pin" data-n={version.n}>
          Pin here
        </button>
      ) : null}
      {deletable ? (
        <button type="button" class="btn-link" data-action="delete-version" data-n={version.n}>
          Delete
        </button>
      ) : null}
    </li>
  );
}

export function artifactPage(
  env: Env,
  email: string,
  artifact: UiArtifact,
  versions: VersionRow[],
  shares: ShareRow[],
  project: UiProjectAccess | null,
  editableProjects: { slug: string; title: string }[],
  preview: number | null
) {
  const owner = artifact.role === "owner";
  const canTag = artifact.role === "owner" || artifact.role === "editor";
  const liveUrl = `https://${env.ART_HOST}/${artifact.slug}/`;
  const previewVersion = preview === null ? null : (versions.find((version) => version.n === preview) ?? null);
  const shareProps = islandProps({ slug: artifact.slug, tags: artifact.tags });
  const versionProps = islandProps({ slug: artifact.slug });

  return (
    <DetailLayout env={env} email={email} title={artifact.title}>
      <Breadcrumbs
        project={project ? { slug: project.slug, title: project.title } : artifact.project ? { slug: artifact.project, title: artifact.project } : null}
        title={artifact.title}
      />
      <div class="page-head detail-head">
        <div class="title-block">
          <h1>{artifact.title}</h1>
          <p class="meta-line">
            <a class="slug-link mono" href={liveUrl} target="_blank" rel="noreferrer">
              {`https://${env.ART_HOST}/${artifact.slug}/`}
            </a>
            {artifact.project ? (
              <span>
                In project <a href={`/p/${artifact.project}`}>{project?.title ?? artifact.project}</a>
              </span>
            ) : (
              <span>No project</span>
            )}
            <span>
              Sharing: <Pill mode={artifact.mode} />
            </span>
          </p>
        </div>
        <div class="button-row">
          <button
            type="button"
            class="btn btn-tertiary"
            data-island={ISLAND.copy}
            data-props={islandProps({ text: liveUrl })}
          >
            Copy link
          </button>
          <a class="btn btn-primary" href={liveUrl} target="_blank" rel="noreferrer">
            Open live
          </a>
        </div>
      </div>

      <div class="detail-layout">
        <div class="detail-main">
          <section class="panel" aria-label="Project and tags">
            <div class="panel-head">
              <h2>Project and tags</h2>
              <span class="muted">{owner ? "Move it or label it" : canTag ? "You can label this artifact" : "Read only"}</span>
            </div>
            <div class="panel-body">
              <div class="detail-block">
                <span class="field-label">Project</span>
                {owner ? (
                  <form class="field-row" data-form="project">
                    <label class="sr-only" for="artifact-project">
                      Move to project
                    </label>
                    <select id="artifact-project" name="project" data-submit-on-change>
                      <option value="" selected={artifact.project === null}>
                        No project
                      </option>
                      {editableProjects.map((row) => (
                        <option value={row.slug} selected={artifact.project === row.slug}>
                          {row.title}
                        </option>
                      ))}
                      {artifact.project !== null && !editableProjects.some((row) => row.slug === artifact.project) ? (
                        <option value={artifact.project} selected>
                          {project?.title ?? artifact.project}
                        </option>
                      ) : null}
                    </select>
                    <noscript>
                      <button type="submit" class="btn btn-sm">
                        Move
                      </button>
                    </noscript>
                  </form>
                ) : (
                  <span class="muted">
                    {artifact.project ? <a href={`/p/${artifact.project}`}>{project?.title ?? artifact.project}</a> : "No project"}
                  </span>
                )}
              </div>
              <div class="detail-block">
                <span class="field-label">Tags</span>
                <div class="tag-row">
                  {artifact.tags.length === 0 ? <span class="muted">No tags</span> : null}
                  {artifact.tags.map((tag) => (
                    <span class="tag-chip tag-chip-static">
                      {tag}
                      {canTag ? (
                        <button
                          type="button"
                          class="tag-remove"
                          data-action="remove-tag"
                          data-tag={tag}
                          aria-label={`Remove tag ${tag}`}
                          title={`Remove tag ${tag}`}
                        >
                          <span aria-hidden="true">&#215;</span>
                        </button>
                      ) : null}
                    </span>
                  ))}
                </div>
                {canTag ? (
                  <form class="field-row tag-form" data-form="tags">
                    <label class="sr-only" for="new-tag">
                      Add a tag
                    </label>
                    <input id="new-tag" name="tag" placeholder="Add a tag" pattern="[a-z0-9][a-z0-9-]{0,31}" />
                    <button type="submit" class="btn btn-sm">
                      Add tag
                    </button>
                  </form>
                ) : null}
              </div>
            </div>
          </section>

          <section class="panel" aria-label="Preview">
            <div class="panel-head">
              <h2>{previewVersion ? `Preview of v${previewVersion.n}` : "Preview"}</h2>
              {versions.length > 0 ? (
                <form class="preview-picker" method="get" action={`/a/${artifact.slug}`}>
                  <label class="inline-label" for="preview-version">
                    Version
                    <select id="preview-version" name="preview" data-submit-on-change>
                      {versions.map((version) => (
                        <option value={version.n} selected={previewVersion?.n === version.n}>
                          v{version.n}
                          {artifact.served === version.n ? " (live)" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <noscript>
                    <button type="submit" class="btn btn-sm">
                      Show
                    </button>
                  </noscript>
                </form>
              ) : (
                <span class="muted">Nothing published yet</span>
              )}
            </div>
            <div class="preview-body">
              {previewVersion ? (
                <iframe
                  class="preview-frame"
                  title={`Live preview of ${artifact.title} v${previewVersion.n}`}
                  src={`https://${env.ART_HOST}/${artifact.slug}/v${previewVersion.n}/`}
                  sandbox="allow-scripts"
                  loading="lazy"
                ></iframe>
              ) : (
                <div class="preview-empty">
                  No version to preview yet. Publish one with the CLI and it will show up here.
                </div>
              )}
            </div>
          </section>

          <section
            class="panel"
            aria-label="Versions"
            data-island={ISLAND.versions}
            data-props={versionProps}
          >
            <div class="panel-head">
              <h2>Versions</h2>
              <span class="muted">
                {artifact.pinned === null
                  ? "The link follows the newest version."
                  : `Pinned to v${artifact.pinned}. New publishes wait behind it.`}
              </span>
            </div>
            {versions.length === 0 ? (
              <p class="empty">No versions yet.</p>
            ) : (
              <ul class="version-list">
                {versions.map((version) => (
                  <VersionRowView artifact={artifact} version={version} owner={owner} count={versions.length} />
                ))}
              </ul>
            )}
            {artifact.pinned !== null ? (
              <div class="version-actions">
                <button type="button" class="btn btn-tertiary" data-action="newest">
                  Follow the newest version again
                </button>
              </div>
            ) : null}
          </section>
        </div>

        <aside class="detail-side" aria-label="Sharing" data-island={ISLAND.share} data-props={shareProps}>
          <div>
            <h2>Who can open this</h2>
            <p class="side-text">{sharingSummary(artifact, project, shares)}</p>
            <p class="side-hint">{MODE_HINT[artifact.mode] ?? ""}</p>
          </div>

          <form class="segmented" role="radiogroup" aria-label="Sharing mode" data-form="mode">
            {MODE_ORDER.map((mode) => (
              <label class={artifact.mode === mode ? "segment is-on" : "segment"}>
                <input
                  class="segment-input"
                  type="radio"
                  name="mode"
                  value={mode}
                  checked={artifact.mode === mode}
                  disabled={!owner}
                  data-submit-on-change
                />
                <span>{MODE_LABEL[mode]}</span>
              </label>
            ))}
            <noscript>
              <button type="submit" class="btn btn-sm">
                Save sharing
              </button>
            </noscript>
          </form>

          {owner ? null : <p class="side-hint">Only the owner can change sharing.</p>}

          {artifact.mode !== "public" ? (
            <section class="side-section" aria-label="People">
              <h2>People</h2>
              {owner ? (
                <>
                  <span class="field-label">Add people by email</span>
                  <form class="field-row" data-form="share">
                    <label class="sr-only" for="share-email">
                      Add a person by email
                    </label>
                    <input id="share-email" name="email" type="email" placeholder="person@example.com" required />
                    <label class="sr-only" for="share-role">
                      Role
                    </label>
                    <select id="share-role" name="role">
                      <option value="viewer">Viewer</option>
                      <option value="editor">Editor</option>
                    </select>
                    <button type="submit" class="btn btn-sm">
                      Add person
                    </button>
                  </form>
                </>
              ) : null}
              {shares.length === 0 ? (
                <p class="muted">No one is added directly yet.</p>
              ) : (
                <ul class="people-list">
                  {shares.map((share) => (
                    <li class="person-row">
                      <span class="person-email">{share.email}</span>
                      <span class="person-role">{share.role === "editor" ? "Editor" : "Viewer"}</span>
                      {owner ? (
                        <RemoveButton
                          action="remove-share"
                          email={share.email}
                          label={`Remove ${share.email}`}
                        />
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}

          {project ? (
            <div class="info-box">
              <div class="info-title">{`Through project ${project.title}`}</div>
              <div class="info-text">
                {`${plural(project.members.length + 1, "member", "members")}, ${plural(
                  1 + project.members.filter((member) => member.role === "editor").length,
                  "editor",
                  "editors"
                )}.`}
              </div>
              <a href={`/p/${project.slug}`}>Manage members</a>
            </div>
          ) : null}

          {owner ? (
            <div class="danger-zone">
              <h2>Danger zone</h2>
              {artifact.slug.startsWith(THEME_PREFIX) ? (
                <p class="side-text">Pages link to this theme. Delete it with rshow delete --force.</p>
              ) : (
                <button
                  type="button"
                  class="btn btn-danger"
                  data-island={ISLAND.delete}
                  data-props={islandProps({ slug: artifact.slug })}
                  data-action="delete-artifact"
                >
                  Delete artifact
                </button>
              )}
            </div>
          ) : null}
        </aside>
      </div>
    </DetailLayout>
  );
}
