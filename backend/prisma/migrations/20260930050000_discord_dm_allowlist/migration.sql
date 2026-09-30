-- CreateTable
CREATE TABLE "DiscordDmAllow" (
    "agentId" TEXT NOT NULL,
    "discordUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("agentId", "discordUserId"),
    CONSTRAINT "DiscordDmAllow_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_DiscordBot" (
    "agentId" TEXT NOT NULL PRIMARY KEY,
    "botUserId" TEXT,
    "botName" TEXT,
    "admission" TEXT NOT NULL DEFAULT 'check',
    "catchUp" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DiscordBot_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_DiscordBot" ("admission", "agentId", "botName", "botUserId", "catchUp", "createdAt", "updatedAt") SELECT "admission", "agentId", "botName", "botUserId", "catchUp", "createdAt", "updatedAt" FROM "DiscordBot";
DROP TABLE "DiscordBot";
ALTER TABLE "new_DiscordBot" RENAME TO "DiscordBot";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

