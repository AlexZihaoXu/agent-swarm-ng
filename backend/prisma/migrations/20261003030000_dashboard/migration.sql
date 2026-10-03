-- Dashboard: host, disk and computer samples, model usage and agent run spans.
-- CreateTable
CREATE TABLE "SystemSample" (
    "sequence" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cpuPercent" REAL NOT NULL,
    "memUsed" BIGINT NOT NULL,
    "memTotal" BIGINT NOT NULL
);

-- CreateTable
CREATE TABLE "DiskSample" (
    "sequence" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disk" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "uses" TEXT NOT NULL,
    "used" BIGINT NOT NULL,
    "total" BIGINT NOT NULL
);

-- CreateTable
CREATE TABLE "ComputerSample" (
    "sequence" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "computerId" TEXT NOT NULL,
    "cpuPercent" REAL NOT NULL,
    "memUsed" BIGINT NOT NULL,
    "memLimit" BIGINT
);

-- CreateTable
CREATE TABLE "UsageEvent" (
    "sequence" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "agentId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "endpointId" TEXT,
    "model" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "input" INTEGER NOT NULL,
    "output" INTEGER NOT NULL,
    "cacheRead" INTEGER NOT NULL,
    "cacheWrite" INTEGER NOT NULL,
    "reasoning" INTEGER NOT NULL,
    "cost" REAL NOT NULL,
    "sourceKey" TEXT
);

-- CreateTable
CREATE TABLE "AgentRunSpan" (
    "sequence" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "agentId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL,
    "endedAt" DATETIME
);

-- CreateIndex
CREATE INDEX "SystemSample_at_idx" ON "SystemSample"("at");

-- CreateIndex
CREATE INDEX "DiskSample_at_idx" ON "DiskSample"("at");

-- CreateIndex
CREATE INDEX "DiskSample_disk_at_idx" ON "DiskSample"("disk", "at");

-- CreateIndex
CREATE INDEX "ComputerSample_at_idx" ON "ComputerSample"("at");

-- CreateIndex
CREATE INDEX "ComputerSample_computerId_at_idx" ON "ComputerSample"("computerId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "UsageEvent_sourceKey_key" ON "UsageEvent"("sourceKey");

-- CreateIndex
CREATE INDEX "UsageEvent_at_idx" ON "UsageEvent"("at");

-- CreateIndex
CREATE INDEX "UsageEvent_agentId_at_idx" ON "UsageEvent"("agentId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "AgentRunSpan_runId_key" ON "AgentRunSpan"("runId");

-- CreateIndex
CREATE INDEX "AgentRunSpan_agentId_startedAt_idx" ON "AgentRunSpan"("agentId", "startedAt");

-- CreateIndex
CREATE INDEX "AgentRunSpan_startedAt_idx" ON "AgentRunSpan"("startedAt");

