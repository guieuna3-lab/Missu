-- 날짜별 번호는 검색에 영향을 주는 변경과 같은 트랜잭션에서만 올라간다.
-- 기존 물품을 다시 쓰거나 색인을 재생성할 필요가 없다.
CREATE TABLE verified_search_day_versions (
  day text PRIMARY KEY,
  revision bigint NOT NULL
);
CREATE TABLE verified_search_count_cache (
  slot integer PRIMARY KEY CHECK (slot BETWEEN 0 AND 1023),
  query_key text NOT NULL,
  summary jsonb NOT NULL
);

CREATE FUNCTION mark_verified_search_days() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  old_day text;
  new_day text;
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    new_day := '*';
  ELSE
    IF TG_OP = 'UPDATE' THEN
      IF (OLD.stored, OLD.day, OLD.name, OLD.kind_name, OLD.place_key, OLD.found_place)
         IS NOT DISTINCT FROM
         (NEW.stored, NEW.day, NEW.name, NEW.kind_name, NEW.place_key, NEW.found_place) THEN
        RETURN NULL;
      END IF;
    END IF;
    IF TG_OP <> 'INSERT' THEN
      IF OLD.stored THEN old_day := OLD.day; END IF;
    END IF;
    IF TG_OP <> 'DELETE' THEN
      IF NEW.stored THEN new_day := NEW.day; END IF;
    END IF;
  END IF;
  INSERT INTO verified_search_day_versions AS current (day, revision)
  SELECT DISTINCT d, 1 FROM unnest(ARRAY[old_day, new_day]) AS d
  WHERE d IS NOT NULL ORDER BY d
  ON CONFLICT (day) DO UPDATE SET revision = current.revision + 1;
  RETURN NULL;
END;
$$;
CREATE TRIGGER verified_search_days_after_write
AFTER INSERT OR UPDATE OF stored, day, name, kind_name, place_key, found_place OR DELETE
ON verified_portal_items FOR EACH ROW EXECUTE FUNCTION mark_verified_search_days();
CREATE TRIGGER verified_search_days_after_truncate
AFTER TRUNCATE ON verified_portal_items FOR EACH STATEMENT EXECUTE FUNCTION mark_verified_search_days();
