-- Operator power intent, so an explicit stop survives controller reconciliation.
-- 'running' is the historical behaviour: boot-time recovery may start the desktop.
-- 'stopped' means the operator turned it off and reconciliation must leave it off.
ALTER TABLE "Computer" ADD COLUMN "desiredState" TEXT NOT NULL DEFAULT 'running';
