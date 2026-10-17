-- Tickets, round 4 (docs/tickets.md#workflow): workflow states per organization, and archiving. Additive only: no
-- table is rebuilt and no column dropped. Ticket.status stays (written as the old status of the ticket's state, for
-- a rollback; read by nothing) and Organization.ticketPushReview stays (copied into In review's notifyOnEnter).

-- CreateTable
CREATE TABLE "TicketState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "position" REAL NOT NULL DEFAULT 0,
    "notifyOnEnter" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TicketState_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "TicketState_organizationId_name_key" ON "TicketState"("organizationId", "name");
CREATE INDEX "TicketState_organizationId_category_position_idx" ON "TicketState"("organizationId", "category", "position");

ALTER TABLE "Organization" ADD COLUMN "ticketArchiveAfterDays" INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "Ticket" ADD COLUMN "stateId" TEXT REFERENCES "TicketState" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Ticket" ADD COLUMN "closedAt" DATETIME;
ALTER TABLE "Ticket" ADD COLUMN "archivedAt" DATETIME;
ALTER TABLE "Ticket" ADD COLUMN "archivedBy" TEXT;

-- Every organization gets the fixed statuses it had as states; In review notifies as its old option did.
INSERT INTO "TicketState" ("id", "organizationId", "name", "color", "category", "position", "notifyOnEnter")
SELECT lower(hex(randomblob(16))), "Organization"."id", "seed"."name", "seed"."color", "seed"."category", "seed"."position",
       CASE WHEN "seed"."name" = 'In review' THEN "Organization"."ticketPushReview" ELSE 0 END
FROM "Organization"
CROSS JOIN (
    SELECT 'Backlog' AS "name", 'gray' AS "color", 'backlog' AS "category", 0 AS "position"
    UNION ALL SELECT 'Todo', 'silver', 'unstarted', 0
    UNION ALL SELECT 'In progress', 'amber', 'started', 0
    UNION ALL SELECT 'In review', 'sky', 'started', 1
    UNION ALL SELECT 'Done', 'emerald', 'completed', 0
    UNION ALL SELECT 'Cancelled', 'slate', 'canceled', 0
) AS "seed";

-- Each ticket moves to the state of its old status (an unknown one to Todo), keeping its place in the column.
UPDATE "Ticket" SET "stateId" = (
    SELECT "TicketState"."id" FROM "TicketState"
    WHERE "TicketState"."organizationId" = "Ticket"."organizationId"
      AND "TicketState"."name" = CASE "Ticket"."status"
          WHEN 'backlog' THEN 'Backlog'
          WHEN 'progress' THEN 'In progress'
          WHEN 'review' THEN 'In review'
          WHEN 'done' THEN 'Done'
          WHEN 'cancelled' THEN 'Cancelled'
          ELSE 'Todo'
      END
);
-- Closed tickets count as closed since their last change (the closest record there is).
UPDATE "Ticket" SET "closedAt" = "updatedAt" WHERE "status" IN ('done', 'cancelled');

-- The board's order now goes by state; the old status index is replaced.
DROP INDEX "Ticket_organizationId_status_position_idx";
CREATE INDEX "Ticket_stateId_position_idx" ON "Ticket"("stateId", "position");
CREATE INDEX "Ticket_organizationId_archivedAt_closedAt_idx" ON "Ticket"("organizationId", "archivedAt", "closedAt");
