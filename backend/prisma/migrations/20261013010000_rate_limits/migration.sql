-- API request limits a minute per signed-in person and per client address (Settings → Swarm).
ALTER TABLE "SwarmSettings" ADD COLUMN "rateLimitPerPerson" INTEGER NOT NULL DEFAULT 3600;
ALTER TABLE "SwarmSettings" ADD COLUMN "rateLimitPerAddress" INTEGER NOT NULL DEFAULT 7200;
