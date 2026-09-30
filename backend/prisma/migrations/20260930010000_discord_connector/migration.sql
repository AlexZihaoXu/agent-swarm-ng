CREATE TABLE "DiscordBot" (
  "agentId" TEXT NOT NULL PRIMARY KEY,
  "botUserId" TEXT,
  "botName" TEXT,
  "admission" TEXT NOT NULL DEFAULT 'mention',
  "strangerDms" BOOLEAN NOT NULL DEFAULT false,
  "catchUp" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "DiscordBot_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "DiscordChannel" (
  "agentId" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "guildId" TEXT,
  "guildName" TEXT,
  "parentId" TEXT,
  "recipientId" TEXT,
  "name" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "allowed" BOOLEAN NOT NULL DEFAULT false,
  "admission" TEXT,
  "announcedUpTo" TEXT,
  "botOnlyTurns" INTEGER NOT NULL DEFAULT 0,
  "pausedAt" DATETIME,
  "updatedAt" DATETIME NOT NULL,
  PRIMARY KEY ("agentId", "channelId"),
  CONSTRAINT "DiscordChannel_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "DiscordAccount" (
  "discordUserId" TEXT NOT NULL PRIMARY KEY,
  "role" TEXT NOT NULL,
  "agentId" TEXT,
  "name" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "DiscordMessage" (
  "agentId" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "guildId" TEXT,
  "authorId" TEXT NOT NULL,
  "authorName" TEXT NOT NULL,
  "authorBot" BOOLEAN NOT NULL DEFAULT false,
  "content" TEXT NOT NULL,
  "chainId" TEXT,
  "replyToId" TEXT,
  "mentionsBot" BOOLEAN NOT NULL DEFAULT false,
  "attachments" TEXT,
  "createdAt" DATETIME NOT NULL,
  "editedAt" DATETIME,
  "deletedAt" DATETIME,
  PRIMARY KEY ("agentId", "id"),
  CONSTRAINT "DiscordMessage_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "DiscordMessage_agentId_channelId_createdAt_idx" ON "DiscordMessage"("agentId", "channelId", "createdAt");
