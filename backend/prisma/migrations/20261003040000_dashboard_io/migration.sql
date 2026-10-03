-- Dashboard: network throughput per host sample, and each physical disk's throughput.
-- AlterTable
ALTER TABLE "SystemSample" ADD COLUMN "netRx" REAL;
ALTER TABLE "SystemSample" ADD COLUMN "netTx" REAL;

-- CreateTable
CREATE TABLE "DiskIoSample" (
    "sequence" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "device" TEXT NOT NULL,
    "read" REAL NOT NULL,
    "write" REAL NOT NULL
);

-- CreateIndex
CREATE INDEX "DiskIoSample_at_idx" ON "DiskIoSample"("at");

-- CreateIndex
CREATE INDEX "DiskIoSample_device_at_idx" ON "DiskIoSample"("device", "at");

