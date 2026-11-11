-- 기존 좌표 기반 요청과 팀 앱의 자유 입력을 모두 보존합니다.
ALTER TABLE claims
  ADD COLUMN lost_info VARCHAR(500),
  ADD COLUMN appointment JSONB,
  ALTER COLUMN lost_start DROP NOT NULL,
  ALTER COLUMN lost_end DROP NOT NULL,
  ALTER COLUMN time_precision DROP NOT NULL,
  ALTER COLUMN lost_label DROP NOT NULL,
  ALTER COLUMN lat DROP NOT NULL,
  ALTER COLUMN lng DROP NOT NULL,
  ADD CONSTRAINT claims_loss_description CHECK (
    (lost_info IS NOT NULL AND length(btrim(lost_info)) > 0 AND
     num_nonnulls(lost_start, lost_end, time_precision, lost_label, lat, lng) = 0) OR
    (lost_info IS NULL AND num_nonnulls(lost_start, lost_end, time_precision, lost_label, lat, lng) = 6)
  );
