CREATE TABLE "ComputerAssignment" (
  "agentId" TEXT NOT NULL,
  "computerId" TEXT NOT NULL,
  PRIMARY KEY ("agentId", "computerId"),
  FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("computerId") REFERENCES "Computer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ComputerAssignment_computerId_idx" ON "ComputerAssignment"("computerId");
CREATE TABLE "ComputerClaim" (
  "computerId" TEXT NOT NULL PRIMARY KEY,
  "agentId" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "claimedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("computerId") REFERENCES "Computer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ComputerClaim_agentId_key" ON "ComputerClaim"("agentId");
CREATE UNIQUE INDEX "ComputerClaim_token_key" ON "ComputerClaim"("token");
CREATE TABLE "ComputerNotice" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "agentId" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ComputerNotice_agentId_createdAt_idx" ON "ComputerNotice"("agentId", "createdAt");
