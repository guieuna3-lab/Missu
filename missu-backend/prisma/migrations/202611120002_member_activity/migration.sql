ALTER TABLE lost_reports ADD COLUMN category varchar(16) NOT NULL DEFAULT 'OTHER'
  CHECK (category IN ('ELECTRONICS','BAG','WALLET','KEY','ID','OTHER')), ADD COLUMN place_name varchar(200);
ALTER TABLE found_items ADD COLUMN app_category varchar(16) CHECK (app_category IN ('ELECTRONICS','BAG','WALLET','KEY','ID','OTHER')),
  ADD COLUMN archived boolean NOT NULL DEFAULT false;
ALTER TABLE abuse_reports ADD COLUMN description varchar(1000);
ALTER TABLE item_photos ADD COLUMN report_id uuid REFERENCES abuse_reports(id) ON DELETE RESTRICT;
ALTER TABLE item_photos DROP CONSTRAINT item_photos_state;
ALTER TABLE item_photos ADD CONSTRAINT item_photos_state CHECK (
  (state='READY' AND item_id IS NULL AND report_id IS NULL AND sort_order IS NULL) OR
  (state='ATTACHED' AND item_id IS NOT NULL AND report_id IS NULL AND sort_order IS NOT NULL AND sort_order BETWEEN 0 AND 4) OR
  (state='EVIDENCE' AND item_id IS NULL AND report_id IS NOT NULL AND sort_order IS NULL));
CREATE INDEX item_photos_report_idx ON item_photos(report_id);

ALTER TABLE users ADD COLUMN withdrawn_at timestamptz;
