ALTER TABLE verified_portal_items ADD COLUMN phone text;
-- 학교 시연은 실제 공고나 회원 물품과 별도의 상태를 가집니다.
CREATE TABLE hansung_demo_requests (
  id uuid PRIMARY KEY, requester_id uuid NOT NULL REFERENCES users(id),
  status text NOT NULL CHECK (status IN ('PENDING','APPROVED','HANDED_OVER','RETURNED','REJECTED')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX hansung_demo_one_active ON hansung_demo_requests(requester_id) WHERE status IN ('PENDING','APPROVED','HANDED_OVER');
CREATE INDEX hansung_demo_inbox ON hansung_demo_requests(updated_at DESC,id);
INSERT INTO users(id,email,nickname,password_hash,email_verified_at,updated_at) VALUES
('81bf8eb6-7551-4f18-bfb3-259f50ed8533','hs-demo-keeper-c15f54f4@example.invalid','시연 보관담당','$argon2id$v=19$m=19456,t=2,p=1$NUSm20QbhSaAQJWiTwoDKw$/dkKKm/EF3c44a0+B7NTaWoDm4S8S26CtNXooP5nUMs',now(),now()),
('0a03faa3-630d-4c59-8e1f-024d450abb3e','hs-demo-requester-e0538a57@example.invalid','시연 요청자','$argon2id$v=19$m=19456,t=2,p=1$+nc5rRiAq6XEu4xs7442Lg$UAqz8+uMeWYuJQO/jipEXRtUuXxpXJuDE4Xw1UOfsfc',now(),now());
