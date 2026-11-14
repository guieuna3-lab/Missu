CREATE TABLE verified_portal_items (
  id text PRIMARY KEY, name text NOT NULL, source text NOT NULL,
  storage text NOT NULL, place_key text NOT NULL, day text NOT NULL,
  category text NOT NULL, stored boolean NOT NULL, checked_at timestamptz NOT NULL
);
CREATE INDEX verified_portal_items_stored_day_id_idx ON verified_portal_items(stored, day, id);
