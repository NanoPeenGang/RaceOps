-- CreateEnum
CREATE TYPE "LineupRole" AS ENUM ('DRIVER_OF_RECORD', 'DRIVER', 'RESERVE');

-- AlterTable
ALTER TABLE "RaceEvent" ADD COLUMN     "maxDriveMinutesPerDriver" INTEGER,
ADD COLUMN     "maxDriversPerEntry" INTEGER,
ADD COLUMN     "maxStintMinutes" INTEGER,
ADD COLUMN     "minDriveMinutesPerDriver" INTEGER,
ADD COLUMN     "minDriversPerEntry" INTEGER,
ADD COLUMN     "minStintMinutes" INTEGER;

-- CreateTable
CREATE TABLE "RegistrationDriver" (
    "id" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "LineupRole" NOT NULL DEFAULT 'DRIVER',
    "grade" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RegistrationDriver_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Stint" (
    "id" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "lineupDriverId" TEXT,
    "sessionId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "laps" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Stint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RegistrationDriver_userId_idx" ON "RegistrationDriver"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "RegistrationDriver_registrationId_userId_key" ON "RegistrationDriver"("registrationId", "userId");

-- CreateIndex
CREATE INDEX "Stint_registrationId_startedAt_idx" ON "Stint"("registrationId", "startedAt");

-- CreateIndex
CREATE INDEX "Stint_lineupDriverId_idx" ON "Stint"("lineupDriverId");

-- CreateIndex
CREATE INDEX "Stint_sessionId_idx" ON "Stint"("sessionId");

-- AddForeignKey
ALTER TABLE "RegistrationDriver" ADD CONSTRAINT "RegistrationDriver_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "EventRegistration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegistrationDriver" ADD CONSTRAINT "RegistrationDriver_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stint" ADD CONSTRAINT "Stint_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "EventRegistration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stint" ADD CONSTRAINT "Stint_lineupDriverId_fkey" FOREIGN KEY ("lineupDriverId") REFERENCES "RegistrationDriver"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stint" ADD CONSTRAINT "Stint_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "EventSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- A stint cannot end before it began. The router rejects this on the way in;
-- the constraint means no import or backfill can introduce negative drive time,
-- which would silently understate a driver's total.
ALTER TABLE "Stint"
ADD CONSTRAINT "Stint_ends_after_start"
CHECK ("endedAt" IS NULL OR "endedAt" > "startedAt");
