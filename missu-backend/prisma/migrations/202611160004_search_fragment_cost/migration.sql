-- 조각 길이는 세 가지로 고정해 PostgreSQL이 실제 행 수에 맞게 메모리를 잡도록 한다.
-- 결과가 같은 함수만 교체하므로 이미 만든 검색 색인과 물품 행을 다시 쓰지 않는다.
CREATE OR REPLACE FUNCTION missu_search_fragments(item_name text, kind text)
RETURNS text[] LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT ARRAY(
    SELECT DISTINCT substr(label, pos, width)
    FROM unnest(ARRAY[lower(item_name), lower(kind)]) AS labels(label)
    CROSS JOIN LATERAL generate_series(1, char_length(label)) AS positions(pos)
    CROSS JOIN (VALUES (1), (2), (3)) AS sizes(width)
    WHERE pos + width - 1 <= char_length(label)
  )
$$;
