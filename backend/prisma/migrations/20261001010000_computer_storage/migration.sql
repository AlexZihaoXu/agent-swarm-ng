-- Keep/Cache storage: each computer's host folders (null = its own Docker volumes) and kept paths; the folders
-- chosen in Settings for new computers.
ALTER TABLE "Computer" ADD COLUMN "keepFolder" TEXT;
ALTER TABLE "Computer" ADD COLUMN "cacheFolder" TEXT;
ALTER TABLE "Computer" ADD COLUMN "keptPaths" TEXT NOT NULL DEFAULT '["/home/agent","/usr/local"]';
ALTER TABLE "SwarmSettings" ADD COLUMN "computerKeepFolder" TEXT;
ALTER TABLE "SwarmSettings" ADD COLUMN "computerCacheFolder" TEXT;
