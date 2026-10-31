import { MAX_DESCRIPTION_LENGTH, MAX_TITLE_LENGTH } from "../constants";
import type { Env } from "../types";
import {
  Breadcrumbs,
  DetailLayout,
  islandProps,
  ISLAND,
  NavLayout,
  Pill,
  plural,
  RemoveButton,
  shortDate
} from "./layout";
import type { NavProject, UiArtifact, UiProject, UiProjectMember } from "./types";

const KIND_TAGS: readonly { tag: string; label: string }[] = [
  { tag: "deck", label: "Deck" },
  { tag: "poster", label: "Poster" },
  { tag: "report", label: "Report" },
  { tag: "project", label: "Project" },
  { tag: "dashboard", label: "Dashboard" },
  { tag: "page", label: "Page" }
];

function kindOf(tags: readonly string[]): string {
  for (const kind of KIND_TAGS) if (tags.includes(kind.tag)) return kind.label;
  return "Page";
}

export function projectPage(
  env: Env,
  email: string,
  project: UiProject,
  members: UiProjectMember[],
  artifacts: UiArtifact[],
  ownArtifacts: UiArtifact[]
) {
  const owner = project.role === "owner";
  const canEdit = owner || project.role === "editor";
  const groupUrl = `https://${env.ART_HOST}/_p/${project.slug}/`;
  const projectProps = islandProps({ slug: project.slug });

  return (
    <DetailLayout env={env} email={email} title={project.title}>
      <Breadcrumbs project={null} title={project.title} />
      <div class="page-head detail-head">
        <div class="title-block">
          <h1>{project.title}</h1>
          <p class="meta-line">
            <a class="slug-link mono" href={groupUrl} target="_blank" rel="noreferrer">
              {groupUrl}
            </a>
            <span>{project.role === "owner" ? "You own this project" : "You are a project member"}</span>
          </p>
          {project.description !== "" ? <p class="page-sub project-description">{project.description}</p> : null}
        </div>
        <div class="button-row">
          <button
            type="button"
            class="btn btn-tertiary"
            data-island={ISLAND.copy}
            data-props={islandProps({ text: groupUrl })}
          >
            Copy group link
          </button>
          <a class="btn btn-primary" href={groupUrl} target="_blank" rel="noreferrer">
            Open group page
          </a>
        </div>
      </div>

      {owner ? (
        <form
          class="panel desc-form"
          data-island={ISLAND.project}
          data-props={projectProps}
          data-form="description"
        >
          <div class="panel-head">
            <h2>Description</h2>
            <span class="muted">Shown on the group page</span>
          </div>
          <div class="panel-body">
            <label class="field-label" for="project-description">
              Description
            </label>
            <textarea
              id="project-description"
              name="description"
              maxlength={MAX_DESCRIPTION_LENGTH}
              placeholder="What belongs in this project?"
            >{project.description}</textarea>
            <button type="submit" class="btn btn-primary">
              Save description
            </button>
          </div>
        </form>
      ) : null}

      <div class="detail-layout">
        <div class="detail-main">
          <section class="panel" aria-label="Artifacts">
            <div class="panel-head">
              <h2>Artifacts</h2>
              {canEdit ? (
                <form
                  class="inline-select"
                  data-island={ISLAND.project}
                  data-props={projectProps}
                  data-form="add-artifact"
                >
                  <label class="inline-label" for="add-artifact">
                    Add an artifact
                    <select
                      id="add-artifact"
                      name="artifact"
                      data-submit-on-change
                      disabled={ownArtifacts.length === 0}
                    >
                      <option value="">
                        {ownArtifacts.length === 0 ? "No artifacts to add" : "Choose one of yours"}
                      </option>
                      {ownArtifacts.map((artifact) => (
                        <option value={artifact.slug}>{artifact.title}</option>
                      ))}
                    </select>
                  </label>
                  <noscript>
                    <button type="submit" class="btn btn-sm">
                      Add
                    </button>
                  </noscript>
                </form>
              ) : (
                <span class="muted">{plural(artifacts.length, "artifact", "artifacts")}</span>
              )}
            </div>
            <div class="table-box">
              <table class="data-table project-table">
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Kind</th>
                    <th scope="col">Sharing</th>
                    <th scope="col">Live</th>
                    <th scope="col">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {artifacts.length === 0 ? (
                    <tr class="empty-row">
                      <td colSpan={5}>No artifacts in this project yet.</td>
                    </tr>
                  ) : (
                    artifacts.map((artifact) => (
                      <tr>
                        <td class="cell-name">
                          <a class="row-title" href={`/a/${artifact.slug}`}>
                            {artifact.title}
                          </a>
                          <a
                            class="slug-link mono"
                            href={`https://${env.ART_HOST}/${artifact.slug}/`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {`${artifact.slug}/`}
                          </a>
                        </td>
                        <td class="muted" data-label="Kind">{kindOf(artifact.tags)}</td>
                        <td data-label="Sharing">
                          <Pill mode={artifact.mode} />
                        </td>
                        <td class="mono" data-label="Live">{artifact.served === null ? "No version" : `v${artifact.served}`}</td>
                        <td class="muted" data-label="Updated">
                          <time datetime={artifact.updated_at}>{shortDate(artifact.updated_at)}</time>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <aside class="detail-side" aria-label="Members" data-island={ISLAND.project} data-props={projectProps}>
          <div>
            <h2>Members</h2>
            <p class="side-text">
              Viewers can open every People artifact in this project. Editors can also publish and pin.
            </p>
          </div>
          {owner ? (
            <>
              <span class="field-label">Add a member by email</span>
              <form class="field-row" data-form="member">
                <label class="sr-only" for="member-email">
                  Add a member by email
                </label>
                <input id="member-email" name="email" type="email" placeholder="person@example.com" required />
                <label class="sr-only" for="member-role">
                  Role
                </label>
                <select id="member-role" name="role">
                  <option value="viewer">Viewer</option>
                  <option value="editor">Editor</option>
                </select>
                <button type="submit" class="btn btn-sm">
                  Add member
                </button>
              </form>
            </>
          ) : null}
          <ul class="people-list">
            <li class="person-row">
              <span class="person-email">{project.owner}</span>
              <span class="person-role">Owner</span>
            </li>
            {members.map((member) => (
              <li class="person-row">
                <span class="person-email">{member.email}</span>
                <span class="person-role">{member.role === "editor" ? "Editor" : "Viewer"}</span>
                {owner ? (
                  <RemoveButton action="remove-member" email={member.email} label={`Remove ${member.email}`} />
                ) : null}
              </li>
            ))}
          </ul>
          <div class="info-text">{plural(members.length + 1, "member", "members")} including you.</div>
        </aside>
      </div>
    </DetailLayout>
  );
}

export function newProjectPage(env: Env, email: string, projects: NavProject[]) {
  return (
    <NavLayout env={env} email={email} title="New project" search="" projects={projects} active="new">
      <nav class="breadcrumbs" aria-label="Breadcrumb">
        <a href="/">All artifacts</a>
        <span class="crumb-sep">/</span>
        <span aria-current="page">New project</span>
      </nav>
      <div class="page-head">
        <div>
          <h1>New project</h1>
          <p class="page-sub">Group artifacts, share them together and give them a public group page.</p>
        </div>
      </div>
      <form
        class="panel form-card"
        data-island={ISLAND.project}
        data-props={islandProps({})}
        data-form="project-new"
      >
        <div class="panel-body form-stack">
          <div class="form-field">
            <label class="field-label" for="project-slug">
              Slug
            </label>
            <input
              id="project-slug"
              name="slug"
              required
              pattern="[a-z0-9][a-z0-9-]{0,62}"
              placeholder="team-talks"
              autocomplete="off"
            />
            <span class="field-hint">Lowercase letters, numbers and dashes. This is in the group link.</span>
          </div>
          <div class="form-field">
            <label class="field-label" for="project-title">
              Title
            </label>
            <input id="project-title" name="title" maxlength={MAX_TITLE_LENGTH} placeholder="Team talks" />
          </div>
          <div class="form-field">
            <label class="field-label" for="project-new-description">
              Description
            </label>
            <textarea
              id="project-new-description"
              name="description"
              maxlength={MAX_DESCRIPTION_LENGTH}
              placeholder="What belongs in this project?"
            ></textarea>
          </div>
          <div class="form-actions">
            <button type="submit" class="btn btn-primary">
              Create project
            </button>
            <a class="btn btn-tertiary" href="/">
              Cancel
            </a>
          </div>
          <noscript>
            <p class="muted">Enable JavaScript to create a project from this form.</p>
          </noscript>
        </div>
      </form>
    </NavLayout>
  );
}
