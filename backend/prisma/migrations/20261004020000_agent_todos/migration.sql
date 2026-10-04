-- Agent todo lists (todo_write): docs/agent-todos.md.
ALTER TABLE "Agent" ADD COLUMN "todos" TEXT NOT NULL DEFAULT '[]';
