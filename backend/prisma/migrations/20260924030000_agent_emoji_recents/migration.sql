CREATE TABLE "AgentEmojiRecent" (
  "agentId" TEXT NOT NULL,
  "emoji" TEXT NOT NULL,
  "usedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("agentId", "emoji"),
  FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "AgentEmojiRecent_agentId_usedAt_idx" ON "AgentEmojiRecent"("agentId", "usedAt");
