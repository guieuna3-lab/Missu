-- 복원 자격에서 발급한 앱 토큰을 묶어 로그아웃 때 모두 만료시킵니다.
SET lock_timeout = '5s';
ALTER TABLE sessions ADD COLUMN remember_id uuid;
CREATE INDEX sessions_remember_id_idx ON sessions(remember_id);
