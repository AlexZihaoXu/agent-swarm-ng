-- Notifications about the Swarm itself (docs/notifications.md): updated, started, stopping.
ALTER TABLE "PushPreferences" ADD COLUMN "swarmUpdates" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "PushPreferences" ADD COLUMN "swarmStarts" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "PushPreferences" ADD COLUMN "swarmStops" BOOLEAN NOT NULL DEFAULT true;
