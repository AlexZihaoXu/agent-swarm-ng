-- Imported agents start paused until reviewed; links that did not resolve are kept to fix or remove.
ALTER TABLE "Agent" ADD COLUMN "paused" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Agent" ADD COLUMN "unresolved" TEXT NOT NULL DEFAULT '';
