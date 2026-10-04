-- Time notes while an agent works (docs/agent-time.md#time-notes).
ALTER TABLE "Agent" ADD COLUMN "timeNoteMinutes" INTEGER NOT NULL DEFAULT 15;
