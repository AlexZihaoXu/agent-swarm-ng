-- Agent recordings: Settings → Swarm values and the recordings in progress.
ALTER TABLE "SwarmSettings" ADD COLUMN "recordingLeaseSeconds" INTEGER NOT NULL DEFAULT 300;
ALTER TABLE "SwarmSettings" ADD COLUMN "recordingReminderSeconds" INTEGER NOT NULL DEFAULT 150;
ALTER TABLE "SwarmSettings" ADD COLUMN "recordingMaxMinutes" INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "SwarmSettings" ADD COLUMN "recordingDesktopKbps" INTEGER NOT NULL DEFAULT 1000;
ALTER TABLE "SwarmSettings" ADD COLUMN "recordingDesktopFps" INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "SwarmSettings" ADD COLUMN "recordingTerminalFps" INTEGER NOT NULL DEFAULT 15;
ALTER TABLE "SwarmSettings" ADD COLUMN "recordingPadBeforeMs" INTEGER NOT NULL DEFAULT 2500;
ALTER TABLE "SwarmSettings" ADD COLUMN "recordingPadAfterMs" INTEGER NOT NULL DEFAULT 2500;

CREATE TABLE "AgentRecording" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentId" TEXT NOT NULL,
    "computerId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "folder" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentRecording_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "AgentRecording_agentId_idx" ON "AgentRecording"("agentId");
