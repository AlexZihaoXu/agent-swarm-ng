-- Replies reference a message in their own conversation; publication validates scope atomically.
ALTER TABLE "Message" ADD COLUMN "replyToId" TEXT REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GroupMessage" ADD COLUMN "replyToId" TEXT REFERENCES "GroupMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DmMessage" ADD COLUMN "replyToId" TEXT REFERENCES "DmMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Message_replyToId_idx" ON "Message"("replyToId");
CREATE INDEX "GroupMessage_replyToId_idx" ON "GroupMessage"("replyToId");
CREATE INDEX "DmMessage_replyToId_idx" ON "DmMessage"("replyToId");
