-- The audit log: organizations, computers, agents, sign-in attempts and platform starts/stops.
-- CreateTable
CREATE TABLE "AuditEvent" (
    "sequence" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "actor" TEXT,
    "ip" TEXT,
    "targetId" TEXT,
    "targetName" TEXT,
    "detail" TEXT
);

-- CreateIndex
CREATE INDEX "AuditEvent_at_idx" ON "AuditEvent"("at");
CREATE INDEX "AuditEvent_kind_at_idx" ON "AuditEvent"("kind", "at");
