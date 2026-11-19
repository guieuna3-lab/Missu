-- 기존 검색·등록을 잠그지 않고 작은 보조 색인을 만듭니다. 트랜잭션으로 감싸지 않습니다.
CREATE INDEX CONCURRENTLY verified_items_exact_name_day_idx ON verified_portal_items
  ((regexp_replace(lower(normalize(coalesce(name, ''), NFKC)), '[[:space:]()·-]', '', 'g') COLLATE "C"), day DESC, id COLLATE "C") WHERE stored;
CREATE INDEX CONCURRENTLY verified_items_storage_day_idx ON verified_portal_items (storage, day DESC, id) WHERE stored;
