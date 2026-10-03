-- Known client addresses (labels, trusted), the lockdown flag and threshold, critical-event alerts and the access log.
-- CreateTable
CREATE TABLE "KnownAddress" (
    "sequence" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "trusted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Lockdown" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "since" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "failures" INTEGER NOT NULL
);

-- CreateTable
CREATE TABLE "Alert" (
    "sequence" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL,
    "endedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "dismissedAt" DATETIME
);

-- CreateTable
CREATE TABLE "AccessMinute" (
    "sequence" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "minute" INTEGER NOT NULL,
    "ip" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "user" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "status" INTEGER NOT NULL,
    "count" INTEGER NOT NULL,
    "totalMs" INTEGER NOT NULL,
    "maxMs" INTEGER NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_SwarmSettings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "maxComputers" INTEGER NOT NULL DEFAULT 4,
    "uploadMaxMb" INTEGER NOT NULL DEFAULT 100,
    "scratchFileMaxKb" INTEGER NOT NULL DEFAULT 1024,
    "scratchMaxFiles" INTEGER NOT NULL DEFAULT 500,
    "scratchTotalMb" INTEGER NOT NULL DEFAULT 50,
    "storageBudgetGb" INTEGER NOT NULL DEFAULT 10,
    "discordHistoryDays" INTEGER NOT NULL DEFAULT 30,
    "recordingLeaseSeconds" INTEGER NOT NULL DEFAULT 300,
    "recordingReminderSeconds" INTEGER NOT NULL DEFAULT 150,
    "recordingMaxMinutes" INTEGER NOT NULL DEFAULT 30,
    "recordingDesktopKbps" INTEGER NOT NULL DEFAULT 1000,
    "recordingDesktopFps" INTEGER NOT NULL DEFAULT 30,
    "recordingTerminalFps" INTEGER NOT NULL DEFAULT 15,
    "recordingPadBeforeMs" INTEGER NOT NULL DEFAULT 500,
    "recordingPadAfterMs" INTEGER NOT NULL DEFAULT 500,
    "memoryIndexMaxLines" INTEGER NOT NULL DEFAULT 60,
    "memoryIndexMaxChars" INTEGER NOT NULL DEFAULT 4000,
    "memoryMaxChars" INTEGER NOT NULL DEFAULT 2000,
    "memoryMaxCount" INTEGER NOT NULL DEFAULT 1000,
    "lockdownFailures" INTEGER NOT NULL DEFAULT 20,
    "computerKeepFolder" TEXT,
    "computerCacheFolder" TEXT,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_SwarmSettings" ("computerCacheFolder", "computerKeepFolder", "discordHistoryDays", "id", "maxComputers", "memoryIndexMaxChars", "memoryIndexMaxLines", "memoryMaxChars", "memoryMaxCount", "recordingDesktopFps", "recordingDesktopKbps", "recordingLeaseSeconds", "recordingMaxMinutes", "recordingPadAfterMs", "recordingPadBeforeMs", "recordingReminderSeconds", "recordingTerminalFps", "scratchFileMaxKb", "scratchMaxFiles", "scratchTotalMb", "storageBudgetGb", "updatedAt", "uploadMaxMb") SELECT "computerCacheFolder", "computerKeepFolder", "discordHistoryDays", "id", "maxComputers", "memoryIndexMaxChars", "memoryIndexMaxLines", "memoryMaxChars", "memoryMaxCount", "recordingDesktopFps", "recordingDesktopKbps", "recordingLeaseSeconds", "recordingMaxMinutes", "recordingPadAfterMs", "recordingPadBeforeMs", "recordingReminderSeconds", "recordingTerminalFps", "scratchFileMaxKb", "scratchMaxFiles", "scratchTotalMb", "storageBudgetGb", "updatedAt", "uploadMaxMb" FROM "SwarmSettings";
DROP TABLE "SwarmSettings";
ALTER TABLE "new_SwarmSettings" RENAME TO "SwarmSettings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "KnownAddress_id_key" ON "KnownAddress"("id");

-- CreateIndex
CREATE UNIQUE INDEX "KnownAddress_address_key" ON "KnownAddress"("address");

-- CreateIndex
CREATE UNIQUE INDEX "Alert_id_key" ON "Alert"("id");

-- CreateIndex
CREATE INDEX "Alert_dismissedAt_createdAt_idx" ON "Alert"("dismissedAt", "createdAt");

-- CreateIndex
CREATE INDEX "AccessMinute_minute_idx" ON "AccessMinute"("minute");

-- CreateIndex
CREATE INDEX "AccessMinute_ip_minute_idx" ON "AccessMinute"("ip", "minute");

-- CreateIndex
CREATE UNIQUE INDEX "AccessMinute_minute_ip_user_method_route_status_key" ON "AccessMinute"("minute", "ip", "user", "method", "route", "status");

