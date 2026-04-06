-- CreateIndex
CREATE INDEX IF NOT EXISTS "match_events_workstation_id_created_at_idx" ON "match_events"("workstation_id", "created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "match_events_created_at_idx" ON "match_events"("created_at");
