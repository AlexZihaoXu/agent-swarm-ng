CREATE TABLE "AgentTimer" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "agentId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "note" TEXT NOT NULL DEFAULT '',
  "nextAt" DATETIME NOT NULL,
  "intervalMs" INTEGER,
  "total" INTEGER,
  "fired" INTEGER NOT NULL DEFAULT 0,
  "lastFiredAt" DATETIME,
  "human" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "AgentTimer_nextAt_idx" ON "AgentTimer"("nextAt");
CREATE INDEX "AgentTimer_agentId_idx" ON "AgentTimer"("agentId");
