-- Per-agent background compaction policy (Agents → agent → Model).
ALTER TABLE "Agent" ADD COLUMN "compactAtPercent" INTEGER NOT NULL DEFAULT 65;
ALTER TABLE "Agent" ADD COLUMN "idleCompactMinutes" INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "Agent" ADD COLUMN "idleCompactPercent" INTEGER NOT NULL DEFAULT 50;
