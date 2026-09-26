-- Existing computer records predate per-computer choices. Leave their values
-- null rather than inventing limits/timezones that may differ from Docker.
ALTER TABLE "Computer" ADD COLUMN "cpuCores" INTEGER;
ALTER TABLE "Computer" ADD COLUMN "memoryGiB" INTEGER;
ALTER TABLE "Computer" ADD COLUMN "timezone" TEXT;
