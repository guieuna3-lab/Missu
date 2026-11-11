CREATE TABLE "route_recordings" (
  "id" UUID PRIMARY KEY,
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "source" VARCHAR(10) NOT NULL CHECK ("source" IN ('DEVICE','DEMO')),
  "policy_version" VARCHAR(80) NOT NULL,
  "started_at" TIMESTAMPTZ NOT NULL,
  "auto_stops_at" TIMESTAMPTZ NOT NULL,
  "stopped_at" TIMESTAMPTZ,
  "expires_at" TIMESTAMPTZ NOT NULL,
  CHECK ("auto_stops_at" = "started_at" + interval '24 hours'),
  CHECK ("expires_at" <= "auto_stops_at" + interval '48 hours')
);
CREATE INDEX "route_recordings_user_id_started_at_idx" ON "route_recordings"("user_id","started_at");
CREATE INDEX "route_recordings_expires_at_idx" ON "route_recordings"("expires_at");
CREATE UNIQUE INDEX "route_one_active_per_user" ON "route_recordings"("user_id") WHERE "stopped_at" IS NULL;
CREATE TABLE "route_points" (
  "id" UUID PRIMARY KEY,
  "recording_id" UUID NOT NULL REFERENCES "route_recordings"("id") ON DELETE CASCADE,
  "client_point_id" UUID NOT NULL,
  "recorded_at" TIMESTAMPTZ NOT NULL,
  "expires_at" TIMESTAMPTZ NOT NULL,
  "position_ciphertext" TEXT NOT NULL,
  "payload_hash" TEXT NOT NULL,
  CHECK ("expires_at" = "recorded_at" + interval '48 hours')
);
CREATE UNIQUE INDEX "route_points_recording_id_client_point_id_key" ON "route_points"("recording_id","client_point_id");
CREATE INDEX "route_points_recording_id_recorded_at_id_idx" ON "route_points"("recording_id","recorded_at","id");
CREATE INDEX "route_points_expires_at_idx" ON "route_points"("expires_at");
