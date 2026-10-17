-- Tickets keep a manual order within their status (docs/tickets.md#order): smallest position first.
ALTER TABLE "Ticket" ADD COLUMN "position" REAL NOT NULL DEFAULT 0;

-- Existing boards keep the order they showed: most recently updated first, per organization.
UPDATE "Ticket" SET "position" = (
    SELECT COUNT(*) FROM "Ticket" AS "other"
    WHERE "other"."organizationId" = "Ticket"."organizationId"
      AND ("other"."updatedAt" > "Ticket"."updatedAt"
        OR ("other"."updatedAt" = "Ticket"."updatedAt" AND "other"."sequence" > "Ticket"."sequence"))
);

-- CreateIndex
CREATE INDEX "Ticket_organizationId_status_position_idx" ON "Ticket"("organizationId", "status", "position");
