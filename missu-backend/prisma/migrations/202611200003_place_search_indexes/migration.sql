-- 한국어 장소명도 로캘에 의존하지 않고 후보를 좁힙니다.
-- CONCURRENTLY로 기존 검색·등록을 막는 테이블 잠금을 피합니다.
SET lock_timeout = '5s';
SET statement_timeout = '5min';
CREATE INDEX CONCURRENTLY verified_items_place_fragments_idx
ON verified_portal_items USING gin (missu_search_fragments(place_key, found_place)) WHERE stored;
