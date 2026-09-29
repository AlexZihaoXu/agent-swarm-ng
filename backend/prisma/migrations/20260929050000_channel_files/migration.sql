CREATE TABLE "FileBlob" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "size" INTEGER NOT NULL,
  "storage" TEXT NOT NULL DEFAULT 'local',
  "location" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "ChannelFile" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "channelKey" TEXT NOT NULL,
  "messageKind" TEXT,
  "messageId" TEXT,
  "uploaderKind" TEXT NOT NULL,
  "uploaderId" TEXT,
  "uploaderName" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "mime" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "blobId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'available',
  "deletedByKind" TEXT,
  "deletedById" TEXT,
  "deletedByName" TEXT,
  "deletedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("blobId") REFERENCES "FileBlob" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "ChannelFile_channelKey_createdAt_idx" ON "ChannelFile"("channelKey", "createdAt");
CREATE INDEX "ChannelFile_messageKind_messageId_idx" ON "ChannelFile"("messageKind", "messageId");
CREATE INDEX "ChannelFile_blobId_idx" ON "ChannelFile"("blobId");
