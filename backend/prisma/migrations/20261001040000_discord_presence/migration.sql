-- Discord status chosen by the agent, and its custom status text.
ALTER TABLE "DiscordBot" ADD COLUMN "presenceMode" TEXT NOT NULL DEFAULT 'auto';
ALTER TABLE "DiscordBot" ADD COLUMN "statusText" TEXT NOT NULL DEFAULT '';
