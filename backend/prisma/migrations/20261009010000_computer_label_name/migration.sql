-- Computers can be renamed; the name their containers were labelled with stays for the controller.
ALTER TABLE "Computer" ADD COLUMN "labelName" TEXT NOT NULL DEFAULT '';
UPDATE "Computer" SET "labelName" = "name";
