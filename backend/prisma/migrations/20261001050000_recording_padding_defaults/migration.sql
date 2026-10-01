-- Recording clips: 0.5 s before and after each event by default (was 2.5 s).
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
    "computerKeepFolder" TEXT,
    "computerCacheFolder" TEXT,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_SwarmSettings" ("computerCacheFolder", "computerKeepFolder", "discordHistoryDays", "id", "maxComputers", "recordingDesktopFps", "recordingDesktopKbps", "recordingLeaseSeconds", "recordingMaxMinutes", "recordingPadAfterMs", "recordingPadBeforeMs", "recordingReminderSeconds", "recordingTerminalFps", "scratchFileMaxKb", "scratchMaxFiles", "scratchTotalMb", "storageBudgetGb", "updatedAt", "uploadMaxMb") SELECT "computerCacheFolder", "computerKeepFolder", "discordHistoryDays", "id", "maxComputers", "recordingDesktopFps", "recordingDesktopKbps", "recordingLeaseSeconds", "recordingMaxMinutes", "recordingPadAfterMs", "recordingPadBeforeMs", "recordingReminderSeconds", "recordingTerminalFps", "scratchFileMaxKb", "scratchMaxFiles", "scratchTotalMb", "storageBudgetGb", "updatedAt", "uploadMaxMb" FROM "SwarmSettings";
DROP TABLE "SwarmSettings";
ALTER TABLE "new_SwarmSettings" RENAME TO "SwarmSettings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- A row still at the old defaults moves to the new ones.
UPDATE "SwarmSettings" SET "recordingPadBeforeMs" = 500 WHERE "recordingPadBeforeMs" = 2500;
UPDATE "SwarmSettings" SET "recordingPadAfterMs" = 500 WHERE "recordingPadAfterMs" = 2500;
