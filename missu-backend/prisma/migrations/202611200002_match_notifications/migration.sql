-- 알림은 명시적으로 켠 신고만 대상으로 하며, 동일 신고·물품 쌍은 한 번만 저장합니다.
CREATE TABLE match_alert_preferences (
  report_id uuid PRIMARY KEY REFERENCES lost_reports(id) ON DELETE CASCADE,
  enabled_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE match_item_events (
  item_id text PRIMARY KEY,
  item jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE match_notifications (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  report_id uuid NOT NULL REFERENCES lost_reports(id) ON DELETE CASCADE,
  item_id text NOT NULL,
  item_name text NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  read_at timestamptz,
  UNIQUE(report_id,item_id)
);
CREATE INDEX match_notifications_owner_idx ON match_notifications(user_id,created_at DESC,id);
CREATE TABLE push_devices (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_ciphertext text NOT NULL,
  binding uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX push_devices_owner_idx ON push_devices(user_id);
CREATE TABLE push_deliveries (
  notification_id uuid NOT NULL REFERENCES match_notifications(id) ON DELETE CASCADE,
  token_hash text NOT NULL REFERENCES push_devices(token_hash) ON DELETE CASCADE,
  binding uuid NOT NULL,
  attempts int NOT NULL DEFAULT 0,
  retry_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(notification_id,token_hash)
);
CREATE INDEX push_deliveries_retry_idx ON push_deliveries(retry_at);

CREATE FUNCTION enqueue_match_item() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE data jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM match_alert_preferences LIMIT 1) THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME='found_items' THEN
    IF NEW.archived OR NEW.status<>'AVAILABLE' THEN RETURN NEW; END IF;
    IF TG_OP='UPDATE' AND NOT OLD.archived AND OLD.status='AVAILABLE' THEN RETURN NEW; END IF;
    data := jsonb_build_object('id',NEW.id::text,'name',NEW.name,'category',coalesce(NEW.app_category,NEW.category::text),'day',to_char(NEW.found_at AT TIME ZONE 'Asia/Seoul','YYYY-MM-DD'),'owner',NEW.keeper_id::text,'lat',NEW.lat,'lng',NEW.lng,'place',NEW.found_label,'storage',NEW.storage_place);
  ELSE
    IF NOT NEW.stored THEN RETURN NEW; END IF;
    IF TG_OP='UPDATE' AND OLD.stored THEN RETURN NEW; END IF;
    data := jsonb_build_object('id',NEW.id,'name',NEW.name,'category',NEW.category,'day',NEW.day,'place',NEW.found_place,'storage',NEW.storage);
  END IF;
  INSERT INTO match_item_events(item_id,item) VALUES(data->>'id',data) ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER match_member_created AFTER INSERT OR UPDATE OF status,archived ON found_items FOR EACH ROW EXECUTE FUNCTION enqueue_match_item();
CREATE TRIGGER match_portal_created AFTER INSERT OR UPDATE OF stored ON verified_portal_items FOR EACH ROW EXECUTE FUNCTION enqueue_match_item();

CREATE FUNCTION enqueue_school_match_items() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM match_alert_preferences LIMIT 1) THEN RETURN NEW; END IF;
  INSERT INTO match_item_events(item_id,item)
  SELECT i->>'id',jsonb_build_object('id',i->>'id','name',i->>'name','category',i->>'category','day',i->>'date','place',i->>'foundPlace','storage',i->>'storage','lat',37.5824,'lng',127.0102)
  FROM jsonb_array_elements(NEW.items) i
  WHERE TG_OP='INSERT' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(OLD.items) p WHERE p->>'id'=i->>'id')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER match_school_created AFTER INSERT OR UPDATE OF items ON institution_school_snapshot FOR EACH ROW EXECUTE FUNCTION enqueue_school_match_items();
