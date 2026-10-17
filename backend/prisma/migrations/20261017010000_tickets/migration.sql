-- Tickets (docs/tickets.md): per-organization boards, off by default; ticket tools granted per agent.
ALTER TABLE "Organization" ADD COLUMN "ticketsEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Organization" ADD COLUMN "ticketPrefix" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Organization" ADD COLUMN "ticketWakeOnAssign" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Organization" ADD COLUMN "ticketAgentsCreate" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Organization" ADD COLUMN "ticketAgentsPickUp" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Organization" ADD COLUMN "ticketPushReview" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Organization" ADD COLUMN "ticketNext" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Agent" ADD COLUMN "ticketTools" TEXT NOT NULL DEFAULT '[]';

-- CreateTable
CREATE TABLE "Ticket" (
    "sequence" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'todo',
    "priority" TEXT NOT NULL DEFAULT 'none',
    "labels" TEXT NOT NULL DEFAULT '[]',
    "links" TEXT NOT NULL DEFAULT '[]',
    "assigneeOwner" BOOLEAN NOT NULL DEFAULT false,
    "assigneeAgentId" TEXT,
    "writerKind" TEXT NOT NULL,
    "writerId" TEXT NOT NULL,
    "writerName" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Ticket_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Ticket_assigneeAgentId_fkey" FOREIGN KEY ("assigneeAgentId") REFERENCES "Agent" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TicketEvent" (
    "sequence" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "authorKind" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TicketEvent_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_id_key" ON "Ticket"("id");
CREATE INDEX "Ticket_organizationId_updatedAt_idx" ON "Ticket"("organizationId", "updatedAt");
CREATE INDEX "Ticket_assigneeAgentId_idx" ON "Ticket"("assigneeAgentId");
CREATE UNIQUE INDEX "Ticket_organizationId_number_key" ON "Ticket"("organizationId", "number");
CREATE UNIQUE INDEX "TicketEvent_id_key" ON "TicketEvent"("id");
CREATE INDEX "TicketEvent_ticketId_sequence_idx" ON "TicketEvent"("ticketId", "sequence");
