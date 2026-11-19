-- 기존 대량 물품 테이블은 다시 쓰지 않습니다. 공개 기관 정보만 작은 별도 캐시에 저장합니다.
CREATE TABLE institution_place_points (
  storage text PRIMARY KEY,
  lat double precision,
  lng double precision,
  located_at timestamptz,
  retry_at timestamptz NOT NULL,
  CHECK ((lat IS NULL AND lng IS NULL) OR (lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180))
);
CREATE TABLE institution_school_snapshot (
  id integer PRIMARY KEY CHECK (id = 1),
  items jsonb NOT NULL,
  checked_at timestamptz NOT NULL
);
