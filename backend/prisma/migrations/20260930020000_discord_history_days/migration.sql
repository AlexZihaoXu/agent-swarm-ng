-- Settings → Swarm: how many days saved Discord messages are kept.
ALTER TABLE "SwarmSettings" ADD COLUMN "discordHistoryDays" INTEGER NOT NULL DEFAULT 30;

-- The hourly prune finds old messages by age alone.
CREATE INDEX "DiscordMessage_createdAt_idx" ON "DiscordMessage"("createdAt");
