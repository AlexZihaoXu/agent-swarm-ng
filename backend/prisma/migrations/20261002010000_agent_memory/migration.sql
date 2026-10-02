-- Long-term agent memory: memories with versions, the index and sleep per agent, and Settings → Swarm caps.
ALTER TABLE "Agent" ADD COLUMN "memoryIndex" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Agent" ADD COLUMN "sleepFrom" TEXT NOT NULL DEFAULT '03:00';
ALTER TABLE "Agent" ADD COLUMN "sleepTo" TEXT NOT NULL DEFAULT '05:00';
ALTER TABLE "Agent" ADD COLUMN "sleptAt" DATETIME;
ALTER TABLE "Agent" ADD COLUMN "sleptPosition" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Agent" ADD COLUMN "sleepNote" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Agent" ADD COLUMN "sleepNoteTold" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SwarmSettings" ADD COLUMN "memoryIndexMaxLines" INTEGER NOT NULL DEFAULT 60;
ALTER TABLE "SwarmSettings" ADD COLUMN "memoryIndexMaxChars" INTEGER NOT NULL DEFAULT 4000;
ALTER TABLE "SwarmSettings" ADD COLUMN "memoryMaxChars" INTEGER NOT NULL DEFAULT 2000;
ALTER TABLE "SwarmSettings" ADD COLUMN "memoryMaxCount" INTEGER NOT NULL DEFAULT 1000;

CREATE TABLE "AgentMemory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "by" TEXT NOT NULL,
    "trust" TEXT NOT NULL,
    "channelId" TEXT,
    "recalls" INTEGER NOT NULL DEFAULT 0,
    "lastRecalledAt" DATETIME,
    "faded" BOOLEAN NOT NULL DEFAULT false,
    "conflict" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AgentMemory_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AgentMemory_agentId_name_key" ON "AgentMemory"("agentId", "name");
CREATE INDEX "AgentMemory_agentId_updatedAt_idx" ON "AgentMemory"("agentId", "updatedAt");

CREATE TABLE "AgentMemoryVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "memoryId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "changedBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentMemoryVersion_memoryId_fkey" FOREIGN KEY ("memoryId") REFERENCES "AgentMemory" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "AgentMemoryVersion_memoryId_createdAt_idx" ON "AgentMemoryVersion"("memoryId", "createdAt");
