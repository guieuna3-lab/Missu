CREATE TABLE agency_count_snapshots (
  query text PRIMARY KEY,
  generation integer NOT NULL DEFAULT 1,
  page integer NOT NULL DEFAULT 1,
  list_total integer,
  listed boolean NOT NULL DEFAULT false,
  total integer,
  completed_at timestamptz,
  retry_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE agency_count_candidates (
  query text NOT NULL REFERENCES agency_count_snapshots(query) ON DELETE CASCADE,
  generation integer NOT NULL,
  atc_id text NOT NULL,
  fd_sn text NOT NULL,
  stored boolean,
  PRIMARY KEY (query, generation, atc_id, fd_sn)
);
CREATE INDEX agency_count_candidates_query_generation_stored_idx
  ON agency_count_candidates (query, generation, stored);

CREATE TABLE agency_count_budgets (day text PRIMARY KEY, calls integer NOT NULL);
