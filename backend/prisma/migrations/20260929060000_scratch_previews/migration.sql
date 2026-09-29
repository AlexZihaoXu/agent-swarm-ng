-- A live scratch preview posted in a chat: points at the presenting agent's scratch file instead of stored bytes.
ALTER TABLE "ChannelFile" ADD COLUMN "scratchAgentId" TEXT;
ALTER TABLE "ChannelFile" ADD COLUMN "scratchPath" TEXT;
