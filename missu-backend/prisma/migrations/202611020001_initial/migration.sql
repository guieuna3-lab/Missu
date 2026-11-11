-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ItemStatus" AS ENUM ('AVAILABLE', 'RESERVED', 'RETURNED');

-- CreateEnum
CREATE TYPE "Category" AS ENUM ('OTHER', 'ELECTRONICS', 'WALLET_BAG');

-- CreateEnum
CREATE TYPE "TimePrecision" AS ENUM ('EXACT', 'APPROX', 'DATE');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "nickname" VARCHAR(20) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "email_verified_at" TIMESTAMPTZ NOT NULL,
    "phone_ciphertext" TEXT,
    "phone_verified_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "token_digest" TEXT NOT NULL,
    "csrf_digest" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "found_items" (
    "id" UUID NOT NULL,
    "keeper_id" UUID NOT NULL,
    "name" VARCHAR(20) NOT NULL,
    "category" "Category" NOT NULL DEFAULT 'OTHER',
    "public_features" VARCHAR(100),
    "found_at" TIMESTAMPTZ NOT NULL,
    "found_label" VARCHAR(200) NOT NULL,
    "lat" DECIMAL(9,6) NOT NULL,
    "lng" DECIMAL(9,6) NOT NULL,
    "storage_place" VARCHAR(200) NOT NULL,
    "pickup_guide" VARCHAR(100),
    "status" "ItemStatus" NOT NULL DEFAULT 'AVAILABLE',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "found_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "found_item_secrets" (
    "item_id" UUID NOT NULL,
    "features_ciphertext" TEXT NOT NULL,

    CONSTRAINT "found_item_secrets_pkey" PRIMARY KEY ("item_id")
);

-- CreateTable
CREATE TABLE "item_photos" (
    "id" UUID NOT NULL,
    "uploader_id" UUID NOT NULL,
    "item_id" UUID,
    "object_key" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'READY',
    "sort_order" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "item_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lost_reports" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" VARCHAR(20) NOT NULL,
    "features" VARCHAR(100),
    "lost_start" TIMESTAMPTZ NOT NULL,
    "lost_end" TIMESTAMPTZ NOT NULL,
    "time_precision" "TimePrecision" NOT NULL,
    "lost_label" VARCHAR(200) NOT NULL,
    "lat" DECIMAL(9,6) NOT NULL,
    "lng" DECIMAL(9,6) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "lost_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "route" TEXT NOT NULL,
    "key" UUID NOT NULL,
    "request_hash" TEXT NOT NULL,
    "response_body" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "request_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_digest_key" ON "sessions"("token_digest");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE INDEX "found_items_status_created_at_id_idx" ON "found_items"("status", "created_at", "id");

-- CreateIndex
CREATE INDEX "found_items_keeper_id_created_at_id_idx" ON "found_items"("keeper_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "found_items_lat_lng_idx" ON "found_items"("lat", "lng");

-- CreateIndex
CREATE UNIQUE INDEX "item_photos_object_key_key" ON "item_photos"("object_key");

-- CreateIndex
CREATE INDEX "item_photos_uploader_id_state_created_at_idx" ON "item_photos"("uploader_id", "state", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "item_photos_item_id_sort_order_key" ON "item_photos"("item_id", "sort_order");

-- CreateIndex
CREATE INDEX "lost_reports_user_id_created_at_id_idx" ON "lost_reports"("user_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "idempotency_records_expires_at_idx" ON "idempotency_records"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_user_id_route_key_key" ON "idempotency_records"("user_id", "route", "key");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "found_items" ADD CONSTRAINT "found_items_keeper_id_fkey" FOREIGN KEY ("keeper_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "found_item_secrets" ADD CONSTRAINT "found_item_secrets_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "found_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_photos" ADD CONSTRAINT "item_photos_uploader_id_fkey" FOREIGN KEY ("uploader_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_photos" ADD CONSTRAINT "item_photos_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "found_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lost_reports" ADD CONSTRAINT "lost_reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- API를 우회한 잘못된 입력도 DB가 거절하도록 최소 제약을 추가합니다.
ALTER TABLE found_items ADD CONSTRAINT found_items_coordinates CHECK (lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180);
ALTER TABLE found_items ADD CONSTRAINT found_items_required_text CHECK (length(btrim(name)) BETWEEN 1 AND 20 AND length(btrim(storage_place)) > 0 AND length(btrim(found_label)) > 0);
ALTER TABLE lost_reports ADD CONSTRAINT lost_reports_coordinates CHECK (lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180);
ALTER TABLE lost_reports ADD CONSTRAINT lost_reports_times CHECK (lost_end >= lost_start AND (time_precision <> 'EXACT' OR lost_end = lost_start));
ALTER TABLE item_photos ADD CONSTRAINT item_photos_state CHECK ((state = 'READY' AND item_id IS NULL AND sort_order IS NULL) OR (state = 'ATTACHED' AND item_id IS NOT NULL AND sort_order BETWEEN 0 AND 4));
ALTER TABLE item_photos ADD CONSTRAINT item_photos_size CHECK (byte_size > 0 AND width > 0 AND height > 0);
