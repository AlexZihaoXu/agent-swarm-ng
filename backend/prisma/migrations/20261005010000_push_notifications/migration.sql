-- Web Push notifications (docs/notifications.md): each person's devices, what they are notified about, and agent
-- avatars drawn as PNGs for notification icons.
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSuccessAt" DATETIME,
    "failures" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PushSubscription_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "UserSession" ("tokenHash") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");
CREATE INDEX "PushSubscription_sessionId_idx" ON "PushSubscription"("sessionId");

CREATE TABLE "PushPreferences" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "agentMessages" BOOLEAN NOT NULL DEFAULT true,
    "groupChats" BOOLEAN NOT NULL DEFAULT true,
    "agentProblems" BOOLEAN NOT NULL DEFAULT true,
    "critical" BOOLEAN NOT NULL DEFAULT true,
    "preview" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "PushPreferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "AgentAvatarImage" (
    "agentId" TEXT NOT NULL PRIMARY KEY,
    "png" BLOB NOT NULL,
    "source" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AgentAvatarImage_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
