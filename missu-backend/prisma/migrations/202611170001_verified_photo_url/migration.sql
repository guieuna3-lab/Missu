-- 기관 목록(저장본)에서도 공개 사진을 보여주기 위해 첫 사진 주소를 함께 저장한다.
-- 기존 물품은 다음 확인 때 채워지며, 다시 확인한 응답에 사진이 없으면 이전 값을 유지한다.
ALTER TABLE verified_portal_items
  ADD COLUMN photo_url TEXT;
