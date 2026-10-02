-- Organizations: folders of agents, computers and group chats kept apart. Everything existing joins "Personal".
-- CreateTable
CREATE TABLE "Organization" (
    "sequence" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "Organization_id_key" ON "Organization"("id");
INSERT INTO "Organization" ("id", "name") VALUES ('personal', 'Personal');

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Computer" (
    "sequence" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'creating',
    "desiredState" TEXT NOT NULL DEFAULT 'running',
    "cpuCores" INTEGER,
    "memoryGiB" INTEGER,
    "timezone" TEXT,
    "keepFolder" TEXT,
    "cacheFolder" TEXT,
    "keptPaths" TEXT NOT NULL DEFAULT '["/home/agent","/usr/local"]',
    "organizationId" TEXT NOT NULL DEFAULT 'personal',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Computer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Computer" ("cacheFolder", "cpuCores", "createdAt", "desiredState", "id", "keepFolder", "keptPaths", "memoryGiB", "name", "requestKey", "sequence", "state", "timezone", "updatedAt") SELECT "cacheFolder", "cpuCores", "createdAt", "desiredState", "id", "keepFolder", "keptPaths", "memoryGiB", "name", "requestKey", "sequence", "state", "timezone", "updatedAt" FROM "Computer";
DROP TABLE "Computer";
ALTER TABLE "new_Computer" RENAME TO "Computer";
CREATE UNIQUE INDEX "Computer_id_key" ON "Computer"("id");
CREATE UNIQUE INDEX "Computer_requestKey_key" ON "Computer"("requestKey");
CREATE TABLE "new_Agent" (
    "sequence" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "avatar" TEXT,
    "endpointId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "thinkingLevel" TEXT NOT NULL,
    "compactAtPercent" INTEGER NOT NULL DEFAULT 65,
    "idleCompactMinutes" INTEGER NOT NULL DEFAULT 30,
    "idleCompactPercent" INTEGER NOT NULL DEFAULT 50,
    "instructions" TEXT NOT NULL DEFAULT '',
    "heartbeatEnabled" BOOLEAN NOT NULL DEFAULT false,
    "heartbeatMinutes" INTEGER NOT NULL DEFAULT 30,
    "heartbeatFrom" TEXT NOT NULL DEFAULT '',
    "heartbeatTo" TEXT NOT NULL DEFAULT '',
    "heartbeatChecklist" TEXT NOT NULL DEFAULT '',
    "organizationId" TEXT NOT NULL DEFAULT 'personal',
    "memoryIndex" TEXT NOT NULL DEFAULT '',
    "sleepFrom" TEXT NOT NULL DEFAULT '03:00',
    "sleepTo" TEXT NOT NULL DEFAULT '05:00',
    "sleptAt" DATETIME,
    "sleptPosition" INTEGER NOT NULL DEFAULT 0,
    "sleepNote" TEXT NOT NULL DEFAULT '',
    "sleepNoteTold" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Agent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Agent" ("avatar", "compactAtPercent", "createdAt", "endpointId", "heartbeatChecklist", "heartbeatEnabled", "heartbeatFrom", "heartbeatMinutes", "heartbeatTo", "id", "idleCompactMinutes", "idleCompactPercent", "instructions", "memoryIndex", "model", "name", "sequence", "sleepFrom", "sleepNote", "sleepNoteTold", "sleepTo", "sleptAt", "sleptPosition", "thinkingLevel") SELECT "avatar", "compactAtPercent", "createdAt", "endpointId", "heartbeatChecklist", "heartbeatEnabled", "heartbeatFrom", "heartbeatMinutes", "heartbeatTo", "id", "idleCompactMinutes", "idleCompactPercent", "instructions", "memoryIndex", "model", "name", "sequence", "sleepFrom", "sleepNote", "sleepNoteTold", "sleepTo", "sleptAt", "sleptPosition", "thinkingLevel" FROM "Agent";
DROP TABLE "Agent";
ALTER TABLE "new_Agent" RENAME TO "Agent";
CREATE UNIQUE INDEX "Agent_id_key" ON "Agent"("id");
CREATE TABLE "new_GroupChat" (
    "sequence" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL DEFAULT 'personal',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GroupChat_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_GroupChat" ("createdAt", "id", "name", "sequence") SELECT "createdAt", "id", "name", "sequence" FROM "GroupChat";
DROP TABLE "GroupChat";
ALTER TABLE "new_GroupChat" RENAME TO "GroupChat";
CREATE UNIQUE INDEX "GroupChat_id_key" ON "GroupChat"("id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
