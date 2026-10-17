-- Tickets, round 3 (docs/tickets.md): sub-issues, relations, due dates, edited and deleted comments. Additive only.
ALTER TABLE "Ticket" ADD COLUMN "parentId" TEXT REFERENCES "Ticket" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Ticket" ADD COLUMN "dueDate" TEXT;
ALTER TABLE "Ticket" ADD COLUMN "dueAt" DATETIME;
ALTER TABLE "Ticket" ADD COLUMN "dueReminded" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TicketEvent" ADD COLUMN "editedAt" DATETIME;
ALTER TABLE "TicketEvent" ADD COLUMN "deletedAt" DATETIME;
ALTER TABLE "TicketEvent" ADD COLUMN "deletedBy" TEXT;

-- CreateTable
CREATE TABLE "TicketRelation" (
    "sequence" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "fromId" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TicketRelation_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "Ticket" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TicketRelation_toId_fkey" FOREIGN KEY ("toId") REFERENCES "Ticket" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Ticket_parentId_idx" ON "Ticket"("parentId");
CREATE INDEX "Ticket_dueReminded_dueAt_idx" ON "Ticket"("dueReminded", "dueAt");
CREATE INDEX "TicketRelation_toId_idx" ON "TicketRelation"("toId");
CREATE UNIQUE INDEX "TicketRelation_fromId_toId_kind_key" ON "TicketRelation"("fromId", "toId", "kind");
