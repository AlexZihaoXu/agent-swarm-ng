-- Tickets (docs/tickets.md#waking): moving an agent's ticket out of a backlog state wakes it. On for every organization. Additive only.
ALTER TABLE "Organization" ADD COLUMN "ticketWakeOnLeaveBacklog" BOOLEAN NOT NULL DEFAULT true;
