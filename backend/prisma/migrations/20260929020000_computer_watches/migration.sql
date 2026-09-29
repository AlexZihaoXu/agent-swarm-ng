CREATE TABLE "ComputerWatch" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "agentId" TEXT NOT NULL,
  "computerId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "until" TEXT NOT NULL,
  "human" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ComputerWatch_agentId_idx" ON "ComputerWatch"("agentId");
