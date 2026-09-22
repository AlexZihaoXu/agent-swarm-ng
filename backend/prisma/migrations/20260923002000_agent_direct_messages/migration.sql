CREATE TABLE "DmGrant" (
  "senderId" TEXT NOT NULL,
  "recipientId" TEXT NOT NULL,
  PRIMARY KEY ("senderId", "recipientId"),
  CONSTRAINT "DmGrant_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "Agent" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "DmGrant_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "Agent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "DmGrant_recipientId_idx" ON "DmGrant"("recipientId");

CREATE TABLE "DmChain" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "rootAgentId" TEXT,
  "remaining" INTEGER NOT NULL DEFAULT 8,
  "cancelled" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DmChain_rootAgentId_fkey" FOREIGN KEY ("rootAgentId") REFERENCES "Agent" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "DmChain_rootAgentId_idx" ON "DmChain"("rootAgentId");

CREATE TABLE "DmMessage" (
  "sequence" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "senderId" TEXT NOT NULL,
  "recipientId" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "chainId" TEXT NOT NULL,
  "deliveryKey" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DmMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "Agent" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "DmMessage_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "Agent" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "DmMessage_chainId_fkey" FOREIGN KEY ("chainId") REFERENCES "DmChain" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "DmMessage_id_key" ON "DmMessage"("id");
CREATE UNIQUE INDEX "DmMessage_deliveryKey_key" ON "DmMessage"("deliveryKey");
CREATE INDEX "DmMessage_conversationId_sequence_idx" ON "DmMessage"("conversationId", "sequence");
CREATE INDEX "DmMessage_recipientId_status_sequence_idx" ON "DmMessage"("recipientId", "status", "sequence");
CREATE INDEX "DmMessage_status_sequence_idx" ON "DmMessage"("status", "sequence");
CREATE INDEX "DmMessage_senderId_idx" ON "DmMessage"("senderId");
CREATE INDEX "DmMessage_chainId_idx" ON "DmMessage"("chainId");
