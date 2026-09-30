-- Scratch files may be images: their bytes and type (text files keep both NULL).
ALTER TABLE "ScratchFile" ADD COLUMN "data" BLOB;
ALTER TABLE "ScratchFile" ADD COLUMN "mime" TEXT;
