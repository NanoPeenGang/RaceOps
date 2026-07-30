-- CreateEnum
CREATE TYPE "CredentialStatus" AS ENUM ('REQUESTED', 'ISSUED', 'COLLECTED', 'VOID');

-- CreateTable
CREATE TABLE "PaddockAllocation" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "garage" TEXT,
    "pitBox" TEXT,
    "paddockSpace" TEXT,
    "transporterBay" TEXT,
    "powerHookup" TEXT,
    "notes" TEXT,
    "assignedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaddockAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CredentialType" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "allowancePerEntry" INTEGER NOT NULL DEFAULT 0,
    "totalAvailable" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CredentialType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Credential" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "credentialTypeId" TEXT NOT NULL,
    "registrationId" TEXT,
    "holderName" TEXT NOT NULL,
    "holderUserId" TEXT,
    "holderRole" TEXT,
    "serial" TEXT,
    "status" "CredentialStatus" NOT NULL DEFAULT 'REQUESTED',
    "issuedAt" TIMESTAMP(3),
    "collectedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Credential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaddockAllocation_registrationId_key" ON "PaddockAllocation"("registrationId");

-- CreateIndex
CREATE INDEX "PaddockAllocation_eventId_idx" ON "PaddockAllocation"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "CredentialType_eventId_name_key" ON "CredentialType"("eventId", "name");

-- CreateIndex
CREATE INDEX "Credential_eventId_status_idx" ON "Credential"("eventId", "status");

-- CreateIndex
CREATE INDEX "Credential_registrationId_idx" ON "Credential"("registrationId");

-- CreateIndex
CREATE INDEX "Credential_holderUserId_idx" ON "Credential"("holderUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Credential_eventId_serial_key" ON "Credential"("eventId", "serial");

-- AddForeignKey
ALTER TABLE "PaddockAllocation" ADD CONSTRAINT "PaddockAllocation_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "RaceEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaddockAllocation" ADD CONSTRAINT "PaddockAllocation_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "EventRegistration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaddockAllocation" ADD CONSTRAINT "PaddockAllocation_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CredentialType" ADD CONSTRAINT "CredentialType_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "RaceEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Credential" ADD CONSTRAINT "Credential_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "RaceEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Credential" ADD CONSTRAINT "Credential_credentialTypeId_fkey" FOREIGN KEY ("credentialTypeId") REFERENCES "CredentialType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Credential" ADD CONSTRAINT "Credential_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "EventRegistration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Credential" ADD CONSTRAINT "Credential_holderUserId_fkey" FOREIGN KEY ("holderUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Invariants Prisma cannot express.

-- Allowances and caps are counts. A negative allowance would read as a
-- credit against the event rather than an error.
ALTER TABLE "CredentialType"
ADD CONSTRAINT "CredentialType_allowance_non_negative"
CHECK ("allowancePerEntry" >= 0);

ALTER TABLE "CredentialType"
ADD CONSTRAINT "CredentialType_total_non_negative"
CHECK ("totalAvailable" IS NULL OR "totalAvailable" >= 0);
