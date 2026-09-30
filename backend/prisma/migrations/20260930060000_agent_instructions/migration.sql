-- The owner's own instructions for each agent (Agents → agent → Instructions).
ALTER TABLE "Agent" ADD COLUMN "instructions" TEXT NOT NULL DEFAULT '';
