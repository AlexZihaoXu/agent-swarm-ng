CREATE TABLE "Activity" (
    "sequence" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "timestamp" REAL NOT NULL,
    "revision" INTEGER NOT NULL,
    "state" TEXT,
    CONSTRAINT "Activity_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Activity_id_key" ON "Activity"("id");
CREATE INDEX "Activity_agentId_sequence_idx" ON "Activity"("agentId", "sequence");
CREATE INDEX "Activity_agentId_label_sequence_idx" ON "Activity"("agentId", "label", "sequence");
CREATE INDEX "Activity_state_idx" ON "Activity"("state");
