CREATE TABLE last_search_counts (
  query_key TEXT PRIMARY KEY,
  total INTEGER NOT NULL,
  police_included BOOLEAN NOT NULL,
  checked_at TIMESTAMPTZ NOT NULL
);
