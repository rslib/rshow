CREATE TABLE retired_slugs (
  slug TEXT PRIMARY KEY,
  last_n INTEGER NOT NULL,
  version_gen INTEGER NOT NULL
);
