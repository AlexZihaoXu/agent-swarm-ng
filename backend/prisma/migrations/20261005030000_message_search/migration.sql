-- Message search (docs/chat-and-groups.md#search): an FTS5 trigram index over each message table's text (substring
-- matches in any language, Chinese included; terms under 3 characters are matched with LIKE instead). The indexes hold
-- no copy of the text (external content: they read it from the message table by its sequence). Triggers record every
-- insert, text change and delete (cascades included) in "MessageSearchQueue", a plain table, and the backend applies
-- the queue to the indexes before each search (search/store.ts). Writing a message never touches an FTS5 table: doing
-- so inside Prisma's deferred transactions would make a writer fail at once (SQLITE_BUSY) instead of waiting for a
-- competing one. The last statements index the messages saved before this migration. Prisma does not manage these
-- tables (prisma.config.ts lists them as external). A later migration that rebuilds one of the message tables
-- (Prisma's "RedefineTables") drops its triggers: it must create them again, delete that table's rows from
-- "MessageSearchQueue" (pending changes would otherwise be applied twice) and rebuild its index, as here.

CREATE TABLE "MessageSearchQueue" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "source" TEXT NOT NULL,
    "op" TEXT NOT NULL,
    "row" INTEGER NOT NULL,
    "text" TEXT NOT NULL
);

CREATE VIRTUAL TABLE "MessageSearch" USING fts5("text", content='Message', content_rowid='sequence', tokenize='trigram');
CREATE TRIGGER "Message_search_insert" AFTER INSERT ON "Message" BEGIN
  INSERT INTO "MessageSearchQueue" ("source", "op", "row", "text") VALUES ('chat', 'insert', new."sequence", new."text");
END;
CREATE TRIGGER "Message_search_delete" AFTER DELETE ON "Message" BEGIN
  INSERT INTO "MessageSearchQueue" ("source", "op", "row", "text") VALUES ('chat', 'delete', old."sequence", old."text");
END;
CREATE TRIGGER "Message_search_update" AFTER UPDATE OF "text" ON "Message" BEGIN
  INSERT INTO "MessageSearchQueue" ("source", "op", "row", "text") VALUES ('chat', 'delete', old."sequence", old."text");
  INSERT INTO "MessageSearchQueue" ("source", "op", "row", "text") VALUES ('chat', 'insert', new."sequence", new."text");
END;
INSERT INTO "MessageSearch"("MessageSearch") VALUES ('rebuild');

CREATE VIRTUAL TABLE "GroupMessageSearch" USING fts5("text", content='GroupMessage', content_rowid='sequence', tokenize='trigram');
CREATE TRIGGER "GroupMessage_search_insert" AFTER INSERT ON "GroupMessage" BEGIN
  INSERT INTO "MessageSearchQueue" ("source", "op", "row", "text") VALUES ('group', 'insert', new."sequence", new."text");
END;
CREATE TRIGGER "GroupMessage_search_delete" AFTER DELETE ON "GroupMessage" BEGIN
  INSERT INTO "MessageSearchQueue" ("source", "op", "row", "text") VALUES ('group', 'delete', old."sequence", old."text");
END;
CREATE TRIGGER "GroupMessage_search_update" AFTER UPDATE OF "text" ON "GroupMessage" BEGIN
  INSERT INTO "MessageSearchQueue" ("source", "op", "row", "text") VALUES ('group', 'delete', old."sequence", old."text");
  INSERT INTO "MessageSearchQueue" ("source", "op", "row", "text") VALUES ('group', 'insert', new."sequence", new."text");
END;
INSERT INTO "GroupMessageSearch"("GroupMessageSearch") VALUES ('rebuild');

CREATE VIRTUAL TABLE "DmMessageSearch" USING fts5("text", content='DmMessage', content_rowid='sequence', tokenize='trigram');
CREATE TRIGGER "DmMessage_search_insert" AFTER INSERT ON "DmMessage" BEGIN
  INSERT INTO "MessageSearchQueue" ("source", "op", "row", "text") VALUES ('dm', 'insert', new."sequence", new."text");
END;
CREATE TRIGGER "DmMessage_search_delete" AFTER DELETE ON "DmMessage" BEGIN
  INSERT INTO "MessageSearchQueue" ("source", "op", "row", "text") VALUES ('dm', 'delete', old."sequence", old."text");
END;
CREATE TRIGGER "DmMessage_search_update" AFTER UPDATE OF "text" ON "DmMessage" BEGIN
  INSERT INTO "MessageSearchQueue" ("source", "op", "row", "text") VALUES ('dm', 'delete', old."sequence", old."text");
  INSERT INTO "MessageSearchQueue" ("source", "op", "row", "text") VALUES ('dm', 'insert', new."sequence", new."text");
END;
INSERT INTO "DmMessageSearch"("DmMessageSearch") VALUES ('rebuild');

-- Searching by day across all chats reads by date.
CREATE INDEX "Message_createdAt_idx" ON "Message"("createdAt");
CREATE INDEX "GroupMessage_createdAt_idx" ON "GroupMessage"("createdAt");
CREATE INDEX "DmMessage_createdAt_idx" ON "DmMessage"("createdAt");
