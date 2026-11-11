BEGIN;
-- SQL CHECK의 NULL 통과 규칙을 고려해 거절 사유의 존재도 명시적으로 검사합니다.
ALTER TABLE claims ADD CONSTRAINT claims_rejection_reason_required
CHECK(status <> 'REJECTED' OR (decision_reason IS NOT NULL AND length(btrim(decision_reason)) BETWEEN 1 AND 300));
COMMIT;
