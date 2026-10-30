-- Large page_data values (keys starting with `sketch-`) live in R2 under
-- `data/<slug>/<key>.json`; their row keeps a marker in `blob_key` and leaves
-- `value` NULL. SQLite cannot drop NOT NULL in place, so page_data is rebuilt.
CREATE TABLE page_data_rebuild (
  slug TEXT NOT NULL REFERENCES artifacts (slug) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT,
  blob_key TEXT,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (slug, key)
);

INSERT INTO page_data_rebuild (slug, key, value, blob_key, updated_by, updated_at)
  SELECT slug, key, value, NULL, updated_by, updated_at FROM page_data;

DROP TABLE page_data;

ALTER TABLE page_data_rebuild RENAME TO page_data;
