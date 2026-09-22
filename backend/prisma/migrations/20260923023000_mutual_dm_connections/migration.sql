-- Existing enabled pairs become mutual; preserve all existing permissions/history.
INSERT OR IGNORE INTO "DmGrant" ("senderId", "recipientId")
SELECT "recipientId", "senderId" FROM "DmGrant";
CREATE INDEX "DmMessage_recipientId_sequence_idx" ON "DmMessage"("recipientId", "sequence");
