CREATE TABLE "GroupChat" (
  "sequence" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "GroupChat_id_key" ON "GroupChat"("id");

ALTER TABLE "DmChain" ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'agent';
ALTER TABLE "DmChain" ADD COLUMN "rootGroupId" TEXT REFERENCES "GroupChat"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "DmChain_rootGroupId_idx" ON "DmChain"("rootGroupId");

CREATE TABLE "GroupMember" (
  "groupId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  PRIMARY KEY ("groupId", "agentId"),
  FOREIGN KEY ("groupId") REFERENCES "GroupChat"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "GroupMember_agentId_groupId_idx" ON "GroupMember"("agentId", "groupId");

CREATE TABLE "GroupMessage" (
  "sequence" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "id" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "authorId" TEXT,
  "authorName" TEXT NOT NULL,
  "authorAvatar" TEXT,
  "text" TEXT NOT NULL,
  "chainId" TEXT NOT NULL,
  "submissionKey" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("groupId") REFERENCES "GroupChat"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("chainId") REFERENCES "DmChain"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "GroupMessage_id_key" ON "GroupMessage"("id");
CREATE UNIQUE INDEX "GroupMessage_id_groupId_key" ON "GroupMessage"("id", "groupId");
CREATE UNIQUE INDEX "GroupMessage_submissionKey_key" ON "GroupMessage"("submissionKey");
CREATE INDEX "GroupMessage_groupId_sequence_idx" ON "GroupMessage"("groupId", "sequence");
CREATE INDEX "GroupMessage_chainId_idx" ON "GroupMessage"("chainId");

CREATE TABLE "GroupDelivery" (
  "messageId" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  PRIMARY KEY ("messageId", "agentId"),
  FOREIGN KEY ("messageId", "groupId") REFERENCES "GroupMessage"("id", "groupId") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("groupId", "agentId") REFERENCES "GroupMember"("groupId", "agentId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "GroupDelivery_agentId_status_idx" ON "GroupDelivery"("agentId", "status");
CREATE INDEX "GroupDelivery_groupId_agentId_idx" ON "GroupDelivery"("groupId", "agentId");
CREATE INDEX "GroupDelivery_status_idx" ON "GroupDelivery"("status");
