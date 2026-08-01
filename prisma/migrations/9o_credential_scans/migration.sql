-- CreateEnum
CREATE TYPE "ScanResult" AS ENUM ('ADMITTED', 'WRONG_ZONE', 'NOT_VALID', 'UNKNOWN');

-- CreateTable
CREATE TABLE "CredentialScan" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "credentialId" TEXT,
    "result" "ScanResult" NOT NULL,
    "zone" "AccessZone",
    "gate" TEXT,
    "token" TEXT,
    "scannedById" TEXT NOT NULL,
    "scannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CredentialScan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CredentialScan_eventId_scannedAt_idx" ON "CredentialScan"("eventId", "scannedAt");

-- CreateIndex
CREATE INDEX "CredentialScan_credentialId_idx" ON "CredentialScan"("credentialId");

-- CreateIndex
CREATE INDEX "CredentialScan_eventId_result_idx" ON "CredentialScan"("eventId", "result");

-- AddForeignKey
ALTER TABLE "CredentialScan" ADD CONSTRAINT "CredentialScan_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "RaceEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CredentialScan" ADD CONSTRAINT "CredentialScan_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "Credential"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CredentialScan" ADD CONSTRAINT "CredentialScan_scannedById_fkey" FOREIGN KEY ("scannedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

