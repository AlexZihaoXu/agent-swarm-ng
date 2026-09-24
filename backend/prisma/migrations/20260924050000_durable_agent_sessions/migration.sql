-- Private, indexed Pi session entries are separate from published conversation history.
CREATE TABLE "AgentSession" (
    "agentId" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "header" TEXT NOT NULL,
    "entryCount" INTEGER NOT NULL DEFAULT 0,
    "activeStart" INTEGER NOT NULL DEFAULT 0,
    "leafId" TEXT,
    "privateCursor" INTEGER NOT NULL DEFAULT 0,
    "dmCursor" INTEGER NOT NULL DEFAULT 0,
    "groupCursor" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AgentSession_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "AgentSessionEntry" (
    "agentId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "entryId" TEXT NOT NULL,
    "parentId" TEXT,
    "payload" TEXT NOT NULL,
    PRIMARY KEY ("agentId", "position"),
    CONSTRAINT "AgentSessionEntry_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AgentSession" ("agentId") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AgentSessionEntry_agentId_entryId_key" ON "AgentSessionEntry"("agentId", "entryId");
CREATE INDEX "GroupMessage_authorId_sequence_idx" ON "GroupMessage"("authorId", "sequence");
