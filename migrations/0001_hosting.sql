CREATE TABLE IF NOT EXISTS aig_items (
  id TEXT PRIMARY KEY,
  publisher_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  status TEXT NOT NULL CHECK (status IN ('published', 'withdrawn')),
  updated_at TEXT NOT NULL,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS aig_items_feed ON aig_items(status, updated_at DESC, id);
CREATE TABLE IF NOT EXISTS aig_revisions (
  id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  payload TEXT NOT NULL,
  PRIMARY KEY (id, revision)
);
