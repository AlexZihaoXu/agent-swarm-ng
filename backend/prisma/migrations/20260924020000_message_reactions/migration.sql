CREATE TABLE "MessageReaction" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "messageId" TEXT,
  "groupMessageId" TEXT,
  "actorKey" TEXT NOT NULL,
  "agentId" TEXT,
  "emoji" TEXT NOT NULL,
  CHECK (("messageId" IS NOT NULL) + ("groupMessageId" IS NOT NULL) = 1),
  FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("groupMessageId") REFERENCES "GroupMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "MessageReaction_messageId_actorKey_emoji_key" ON "MessageReaction"("messageId", "actorKey", "emoji");
CREATE UNIQUE INDEX "MessageReaction_groupMessageId_actorKey_emoji_key" ON "MessageReaction"("groupMessageId", "actorKey", "emoji");
CREATE INDEX "MessageReaction_agentId_idx" ON "MessageReaction"("agentId");
