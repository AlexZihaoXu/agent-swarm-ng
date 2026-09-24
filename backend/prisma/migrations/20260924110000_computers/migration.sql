-- Platform computer identities and create-idempotency keys are independent of agents.
CREATE TABLE "Computer" (
    "sequence" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'creating',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "Computer_id_key" ON "Computer"("id");
CREATE UNIQUE INDEX "Computer_requestKey_key" ON "Computer"("requestKey");
