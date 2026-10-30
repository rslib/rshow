CREATE TABLE artifacts (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  owner TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'private' CHECK (mode IN ('private', 'people', 'public')),
  pinned INTEGER,
  latest INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE versions (
  slug TEXT NOT NULL REFERENCES artifacts (slug) ON DELETE CASCADE,
  n INTEGER NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  manifest_key TEXT NOT NULL,
  files INTEGER NOT NULL,
  bytes INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (slug, n)
);

CREATE TABLE shares (
  slug TEXT NOT NULL REFERENCES artifacts (slug) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('viewer', 'editor')),
  PRIMARY KEY (slug, email)
);

CREATE TABLE tokens (
  hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('publish', 'full')),
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT
);

CREATE TABLE page_data (
  slug TEXT NOT NULL REFERENCES artifacts (slug) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (slug, key)
);

CREATE INDEX artifacts_owner ON artifacts (owner);
CREATE INDEX shares_email ON shares (email);
CREATE INDEX tokens_email ON tokens (email);
CREATE INDEX versions_slug ON versions (slug);
