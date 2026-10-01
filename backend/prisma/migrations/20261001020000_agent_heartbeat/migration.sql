-- Heartbeat: periodic wake-ups per agent (off by default).
ALTER TABLE "Agent" ADD COLUMN "heartbeatEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Agent" ADD COLUMN "heartbeatMinutes" INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "Agent" ADD COLUMN "heartbeatFrom" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Agent" ADD COLUMN "heartbeatTo" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Agent" ADD COLUMN "heartbeatChecklist" TEXT NOT NULL DEFAULT '';
