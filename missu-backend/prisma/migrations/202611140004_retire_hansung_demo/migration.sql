-- 시연 전용 계정 두 개의 로그인을 종료합니다. 기존 세션도 탈퇴 상태를 검사합니다.
UPDATE users SET withdrawn_at = now(), updated_at = now()
WHERE withdrawn_at IS NULL AND id IN (
  '81bf8eb6-7551-4f18-bfb3-259f50ed8533'::uuid,
  '0a03faa3-630d-4c59-8e1f-024d450abb3e'::uuid
);
