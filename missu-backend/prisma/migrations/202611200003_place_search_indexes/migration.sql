-- 최초 적용이 시간 제한으로 실패한 색인 변경입니다. 적용 완료된 이력은 변경하지 않습니다.
-- 한글을 ASCII 바이트 문자열로 바꾸면 C 로캘에서도 pg_trgm이 검색 조각을 만듭니다.
-- 위치 일치 여부는 원문으로 다시 검사하므로 잘못 포함되는 결과는 없습니다.
SET lock_timeout = '5s';
SET statement_timeout = '5min';
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE OR REPLACE FUNCTION missu_place_hex(first_place text, second_place text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT encode(convert_to(lower(coalesce(first_place, '') || '|' || coalesce(second_place, '')), 'UTF8'), 'hex')
$$;
CREATE INDEX CONCURRENTLY verified_items_place_hex_idx
ON verified_portal_items USING gin (missu_place_hex(place_key, found_place) gin_trgm_ops) WHERE stored;
