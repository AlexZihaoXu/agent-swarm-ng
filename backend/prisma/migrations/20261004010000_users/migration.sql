-- Users (docs/users.md): roles, disabling and a RAM cap; organizations get an owner (everything existing is admin's);
-- human messages record their writer; Discord owner accounts belong to a person.
-- AlterTable
ALTER TABLE "Message" ADD COLUMN "authorName" TEXT;
ALTER TABLE "Message" ADD COLUMN "authorUserId" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_DiscordAccount" (
    "discordUserId" TEXT NOT NULL PRIMARY KEY,
    "role" TEXT NOT NULL,
    "userId" TEXT NOT NULL DEFAULT 'admin',
    "agentId" TEXT,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_DiscordAccount" ("agentId", "createdAt", "discordUserId", "name", "role") SELECT "agentId", "createdAt", "discordUserId", "name", "role" FROM "DiscordAccount";
DROP TABLE "DiscordAccount";
ALTER TABLE "new_DiscordAccount" RENAME TO "DiscordAccount";
CREATE TABLE "new_Organization" (
    "sequence" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL DEFAULT 'admin',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Organization_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Organization" ("createdAt", "id", "name", "sequence") SELECT "createdAt", "id", "name", "sequence" FROM "Organization";
DROP TABLE "Organization";
ALTER TABLE "new_Organization" RENAME TO "Organization";
CREATE UNIQUE INDEX "Organization_id_key" ON "Organization"("id");
CREATE TABLE "new_User" (
    "sequence" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'user',
    "disabledAt" DATETIME,
    "memoryLimitGiB" INTEGER,
    "passwordHash" TEXT,
    "passwordChangedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_User" ("createdAt", "id", "name", "passwordChangedAt", "passwordHash", "sequence") SELECT "createdAt", "id", "name", "passwordChangedAt", "passwordHash", "sequence" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_id_key" ON "User"("id");
CREATE UNIQUE INDEX "User_name_key" ON "User"("name");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;


-- The account the first migration created is the admin.
UPDATE "User" SET "role" = 'admin' WHERE "id" = 'admin';
