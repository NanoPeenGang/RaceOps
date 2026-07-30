-- CreateEnum
CREATE TYPE "TireSetStatus" AS ENUM ('ALLOCATED', 'FITTED', 'RETURNED', 'VOID');

-- AlterTable
ALTER TABLE "EventRegistration" ADD COLUMN     "carId" TEXT;

-- AlterTable
ALTER TABLE "RaceEvent" ADD COLUMN     "tireSetAllowance" INTEGER;

-- CreateTable
CREATE TABLE "Car" (
    "id" TEXT NOT NULL,
    "teamId" TEXT,
    "ownerUserId" TEXT,
    "name" TEXT NOT NULL,
    "make" TEXT,
    "model" TEXT,
    "year" INTEGER,
    "chassisNumber" TEXT,
    "engine" TEXT,
    "homologation" TEXT,
    "classLabel" TEXT,
    "liveryUrl" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Car_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transponder" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "make" TEXT,
    "teamId" TEXT,
    "ownerUserId" TEXT,
    "seriesId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transponder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransponderAssignment" (
    "id" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "transponderId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT true,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,

    CONSTRAINT "TransponderAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TireSet" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "compound" TEXT,
    "dimension" TEXT,
    "status" "TireSetStatus" NOT NULL DEFAULT 'ALLOCATED',
    "allocatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "allocatedById" TEXT,
    "notes" TEXT,

    CONSTRAINT "TireSet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Car_teamId_active_idx" ON "Car"("teamId", "active");

-- CreateIndex
CREATE INDEX "Car_ownerUserId_active_idx" ON "Car"("ownerUserId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "Transponder_number_key" ON "Transponder"("number");

-- CreateIndex
CREATE INDEX "Transponder_teamId_idx" ON "Transponder"("teamId");

-- CreateIndex
CREATE INDEX "Transponder_seriesId_idx" ON "Transponder"("seriesId");

-- CreateIndex
CREATE INDEX "TransponderAssignment_transponderId_idx" ON "TransponderAssignment"("transponderId");

-- CreateIndex
CREATE UNIQUE INDEX "TransponderAssignment_registrationId_transponderId_key" ON "TransponderAssignment"("registrationId", "transponderId");

-- CreateIndex
CREATE INDEX "TireSet_registrationId_status_idx" ON "TireSet"("registrationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TireSet_eventId_identifier_key" ON "TireSet"("eventId", "identifier");

-- AddForeignKey
ALTER TABLE "EventRegistration" ADD CONSTRAINT "EventRegistration_carId_fkey" FOREIGN KEY ("carId") REFERENCES "Car"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Car" ADD CONSTRAINT "Car_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Car" ADD CONSTRAINT "Car_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Car" ADD CONSTRAINT "Car_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transponder" ADD CONSTRAINT "Transponder_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transponder" ADD CONSTRAINT "Transponder_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transponder" ADD CONSTRAINT "Transponder_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "Series"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransponderAssignment" ADD CONSTRAINT "TransponderAssignment_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "EventRegistration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransponderAssignment" ADD CONSTRAINT "TransponderAssignment_transponderId_fkey" FOREIGN KEY ("transponderId") REFERENCES "Transponder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TireSet" ADD CONSTRAINT "TireSet_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "RaceEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TireSet" ADD CONSTRAINT "TireSet_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "EventRegistration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TireSet" ADD CONSTRAINT "TireSet_allocatedById_fkey" FOREIGN KEY ("allocatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Invariants Prisma cannot express.

-- A car belongs to a team or to a person, never both and never neither.
-- Without this an orphan car is invisible to every owner-scoped query.
ALTER TABLE "Car"
ADD CONSTRAINT "Car_exactly_one_owner"
CHECK (num_nonnulls("teamId", "ownerUserId") = 1);

-- At most one primary transponder per entry: the timing feed has to know
-- which unit it is expected to see.
CREATE UNIQUE INDEX "TransponderAssignment_one_primary_per_entry"
ON "TransponderAssignment"("registrationId") WHERE "isPrimary";

-- An allowance of zero would mean an entry may not run at all; null is the
-- way to say "unlimited".
ALTER TABLE "RaceEvent"
ADD CONSTRAINT "RaceEvent_tire_allowance_positive"
CHECK ("tireSetAllowance" IS NULL OR "tireSetAllowance" > 0);
