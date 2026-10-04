-- Each person's time zone (docs/users.md#time-zone).
ALTER TABLE "User" ADD COLUMN "timeZone" TEXT NOT NULL DEFAULT '';
