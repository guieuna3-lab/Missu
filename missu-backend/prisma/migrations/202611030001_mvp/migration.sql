BEGIN;
-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('PENDING', 'REJECTED', 'APPROVED', 'HANDED_OVER', 'RETURNED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ChallengePurpose" AS ENUM ('SIGNUP', 'RESET', 'PHONE');

-- AlterTable
ALTER TABLE "audit_events" ADD COLUMN     "from_state" TEXT,
ADD COLUMN     "to_state" TEXT;

-- CreateTable
CREATE TABLE "auth_challenges" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "user_id" UUID,
    "purpose" "ChallengePurpose" NOT NULL,
    "target_ciphertext" TEXT NOT NULL,
    "target_digest" TEXT NOT NULL,
    "code_digest" TEXT NOT NULL,
    "proof_digest" TEXT,
    "delivery_status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "verified_at" TIMESTAMPTZ,
    "consumed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consents" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "policy_version" VARCHAR(80) NOT NULL,
    "agreed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claims" (
    "id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "requester_id" UUID NOT NULL,
    "features" VARCHAR(300) NOT NULL,
    "lost_start" TIMESTAMPTZ NOT NULL,
    "lost_end" TIMESTAMPTZ NOT NULL,
    "time_precision" "TimePrecision" NOT NULL,
    "lost_label" VARCHAR(200) NOT NULL,
    "lat" DECIMAL(9,6) NOT NULL,
    "lng" DECIMAL(9,6) NOT NULL,
    "status" "ClaimStatus" NOT NULL DEFAULT 'PENDING',
    "decision_reason" VARCHAR(300),
    "approved_at" TIMESTAMPTZ,
    "handed_over_at" TIMESTAMPTZ,
    "received_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "claim_id" UUID NOT NULL,
    "sender_id" UUID NOT NULL,
    "body" VARCHAR(200) NOT NULL,
    "client_message_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "abuse_reports" (
    "id" UUID NOT NULL,
    "claim_id" UUID NOT NULL,
    "reporter_id" UUID NOT NULL,
    "reason" VARCHAR(200) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "abuse_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limit_buckets" (
    "id" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "rate_limit_buckets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "auth_challenges_session_id_purpose_created_at_idx" ON "auth_challenges"("session_id", "purpose", "created_at");

-- CreateIndex
CREATE INDEX "auth_challenges_target_digest_created_at_idx" ON "auth_challenges"("target_digest", "created_at");

-- CreateIndex
CREATE INDEX "auth_challenges_expires_at_idx" ON "auth_challenges"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "consents_user_id_kind_policy_version_key" ON "consents"("user_id", "kind", "policy_version");

-- CreateIndex
CREATE INDEX "claims_requester_id_created_at_id_idx" ON "claims"("requester_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "claims_item_id_status_idx" ON "claims"("item_id", "status");

-- CreateIndex
CREATE INDEX "messages_claim_id_created_at_id_idx" ON "messages"("claim_id", "created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "messages_sender_id_client_message_id_key" ON "messages"("sender_id", "client_message_id");

-- CreateIndex
CREATE UNIQUE INDEX "abuse_reports_claim_id_reporter_id_key" ON "abuse_reports"("claim_id", "reporter_id");

-- CreateIndex
CREATE INDEX "rate_limit_buckets_expires_at_idx" ON "rate_limit_buckets"("expires_at");

-- AddForeignKey
ALTER TABLE "auth_challenges" ADD CONSTRAINT "auth_challenges_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_challenges" ADD CONSTRAINT "auth_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consents" ADD CONSTRAINT "consents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "found_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "claims"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "abuse_reports" ADD CONSTRAINT "abuse_reports_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "claims"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "abuse_reports" ADD CONSTRAINT "abuse_reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 서비스 검사에 더해 DB에서도 단일 승인과 중복 활성 요청을 차단합니다.
CREATE UNIQUE INDEX claims_single_approved_item ON claims(item_id) WHERE status IN ('APPROVED','HANDED_OVER','RETURNED');
CREATE UNIQUE INDEX claims_single_active_requester ON claims(item_id,requester_id) WHERE status IN ('PENDING','APPROVED','HANDED_OVER');
ALTER TABLE claims ADD CONSTRAINT claims_valid_input CHECK (
  length(btrim(features)) BETWEEN 1 AND 300 AND length(btrim(lost_label)) BETWEEN 1 AND 200
  AND lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180
  AND lost_end >= lost_start AND (time_precision <> 'EXACT' OR lost_start=lost_end)
  AND (status <> 'REJECTED' OR length(btrim(decision_reason)) BETWEEN 1 AND 300)
  AND (status NOT IN ('APPROVED','HANDED_OVER','RETURNED') OR approved_at IS NOT NULL)
  AND (status NOT IN ('HANDED_OVER','RETURNED') OR handed_over_at IS NOT NULL)
  AND (status <> 'RETURNED' OR received_at IS NOT NULL)
);
ALTER TABLE messages ADD CONSTRAINT messages_body_valid CHECK(length(btrim(body)) BETWEEN 1 AND 200);
ALTER TABLE abuse_reports ADD CONSTRAINT abuse_reports_valid CHECK(length(btrim(reason)) BETWEEN 1 AND 200 AND status='RECEIVED');
ALTER TABLE auth_challenges ADD CONSTRAINT auth_challenges_valid CHECK (
  attempts BETWEEN 0 AND 5 AND delivery_status IN ('PENDING','SENT','FAILED')
  AND (purpose <> 'PHONE' OR user_id IS NOT NULL)
);
ALTER TABLE consents ADD CONSTRAINT consents_kind_valid CHECK(kind IN ('TERMS','PRIVACY','PHONE') AND length(btrim(policy_version)) > 0);
ALTER TABLE rate_limit_buckets ADD CONSTRAINT rate_limit_positive CHECK(count > 0);
COMMIT;
