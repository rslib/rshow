CREATE TABLE IF NOT EXISTS projects (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  owner TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS projects_owner ON projects (owner);

CREATE TABLE IF NOT EXISTS project_members (
  project TEXT NOT NULL REFERENCES projects (slug) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('viewer', 'editor')),
  PRIMARY KEY (project, email)
);

CREATE INDEX IF NOT EXISTS project_members_email ON project_members (email);

ALTER TABLE artifacts ADD COLUMN project TEXT;

CREATE INDEX IF NOT EXISTS artifacts_project ON artifacts (project);

CREATE TABLE IF NOT EXISTS artifact_tags (
  slug TEXT NOT NULL REFERENCES artifacts (slug) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  PRIMARY KEY (slug, tag)
);

CREATE INDEX IF NOT EXISTS artifact_tags_tag ON artifact_tags (tag);
