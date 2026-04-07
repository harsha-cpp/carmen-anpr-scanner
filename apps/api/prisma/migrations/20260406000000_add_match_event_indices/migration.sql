-- CreateIndex
CREATE INDEX IF NOT EXISTS "match_events_workstationId_createdAt_idx" ON "match_events"("workstationId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "match_events_createdAt_idx" ON "match_events"("createdAt");
