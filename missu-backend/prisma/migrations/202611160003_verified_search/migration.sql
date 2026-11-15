-- 한글 한두 글자와 영문 약칭도 부분 일치로 찾는다. 이름과 분류의 경계를 넘는 조각은 만들지 않는다.
CREATE FUNCTION missu_search_fragments(item_name text, kind text)
RETURNS text[] LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT ARRAY(
    SELECT DISTINCT substr(label, pos, width)
    FROM unnest(ARRAY[lower(item_name), lower(kind)]) AS labels(label)
    CROSS JOIN LATERAL generate_series(1, char_length(label)) AS positions(pos)
    CROSS JOIN LATERAL generate_series(1, least(3, char_length(label) - pos + 1)) AS sizes(width)
  )
$$;

ALTER TABLE verified_portal_items ADD COLUMN search_fragments text[]
  GENERATED ALWAYS AS (CASE WHEN stored THEN missu_search_fragments(name, kind_name)
                            ELSE ARRAY[]::text[] END) STORED NOT NULL;
CREATE INDEX verified_items_fragments_gin ON verified_portal_items USING gin (search_fragments);
ANALYZE verified_portal_items;
