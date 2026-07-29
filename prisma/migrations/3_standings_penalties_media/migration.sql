-- CreateEnum
CREATE TYPE "MediaVisibility" AS ENUM ('PUBLIC', 'ORGANIZERS_ONLY');

-- CreateEnum
CREATE TYPE "ResultStatus" AS ENUM ('FINISHED', 'DNF', 'DNS', 'DSQ');

-- CreateEnum
CREATE TYPE "PenaltyType" AS ENUM ('TIME_PENALTY', 'DRIVE_THROUGH', 'STOP_GO', 'GRID_DROP', 'POINTS_DEDUCTION', 'DISQUALIFICATION', 'WARNING', 'FINE');

-- CreateEnum
CREATE TYPE "PenaltyStatus" AS ENUM ('ISSUED', 'UNDER_APPEAL', 'UPHELD', 'REDUCED', 'OVERTURNED');

-- CreateEnum
CREATE TYPE "AppealStatus" AS ENUM ('SUBMITTED', 'UNDER_REVIEW', 'UPHELD', 'REJECTED');

-- AlterEnum
ALTER TYPE "SeriesRole" ADD VALUE 'STEWARD';

-- AlterTable
ALTER TABLE "Media" ADD COLUMN     "appealId" TEXT,
ADD COLUMN     "eventId" TEXT,
ADD COLUMN     "penaltyId" TEXT,
ADD COLUMN     "seriesId" TEXT,
ADD COLUMN     "teamId" TEXT,
ADD COLUMN     "visibility" "MediaVisibility" NOT NULL DEFAULT 'PUBLIC';

-- AlterTable
ALTER TABLE "Series" ADD COLUMN     "fastestLapPoints" INTEGER,
ADD COLUMN     "pointsScheme" JSONB;

-- CreateTable
CREATE TABLE "EventResult" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "finishPosition" INTEGER,
    "status" "ResultStatus" NOT NULL DEFAULT 'FINISHED',
    "lapsCompleted" INTEGER,
    "fastestLap" BOOLEAN NOT NULL DEFAULT false,
    "pointsOverride" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Penalty" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "issuedById" TEXT NOT NULL,
    "type" "PenaltyType" NOT NULL,
    "status" "PenaltyStatus" NOT NULL DEFAULT 'ISSUED',
    "summary" TEXT NOT NULL,
    "details" TEXT,
    "regulation" TEXT,
    "lapNumber" INTEGER,
    "timeSeconds" INTEGER,
    "gridPlaces" INTEGER,
    "pointsDeducted" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Penalty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PenaltyAppeal" (
    "id" TEXT NOT NULL,
    "penaltyId" TEXT NOT NULL,
    "filedById" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "status" "AppealStatus" NOT NULL DEFAULT 'SUBMITTED',
    "decision" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PenaltyAppeal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EventResult_registrationId_key" ON "EventResult"("registrationId");

-- CreateIndex
CREATE INDEX "EventResult_eventId_idx" ON "EventResult"("eventId");

-- CreateIndex
CREATE INDEX "Penalty_eventId_idx" ON "Penalty"("eventId");

-- CreateIndex
CREATE INDEX "Penalty_registrationId_idx" ON "Penalty"("registrationId");

-- CreateIndex
CREATE INDEX "Penalty_status_idx" ON "Penalty"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PenaltyAppeal_penaltyId_key" ON "PenaltyAppeal"("penaltyId");

-- CreateIndex
CREATE INDEX "PenaltyAppeal_filedById_idx" ON "PenaltyAppeal"("filedById");

-- CreateIndex
CREATE INDEX "PenaltyAppeal_status_idx" ON "PenaltyAppeal"("status");

-- CreateIndex
CREATE INDEX "Media_seriesId_idx" ON "Media"("seriesId");

-- CreateIndex
CREATE INDEX "Media_eventId_idx" ON "Media"("eventId");

-- CreateIndex
CREATE INDEX "Media_teamId_idx" ON "Media"("teamId");

-- CreateIndex
CREATE INDEX "Media_penaltyId_idx" ON "Media"("penaltyId");

-- CreateIndex
CREATE INDEX "Media_appealId_idx" ON "Media"("appealId");

-- AddForeignKey
ALTER TABLE "Media" ADD CONSTRAINT "Media_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "Series"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Media" ADD CONSTRAINT "Media_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "RaceEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Media" ADD CONSTRAINT "Media_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Media" ADD CONSTRAINT "Media_penaltyId_fkey" FOREIGN KEY ("penaltyId") REFERENCES "Penalty"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Media" ADD CONSTRAINT "Media_appealId_fkey" FOREIGN KEY ("appealId") REFERENCES "PenaltyAppeal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventResult" ADD CONSTRAINT "EventResult_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "RaceEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventResult" ADD CONSTRAINT "EventResult_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "EventRegistration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Penalty" ADD CONSTRAINT "Penalty_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "RaceEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Penalty" ADD CONSTRAINT "Penalty_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "EventRegistration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Penalty" ADD CONSTRAINT "Penalty_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PenaltyAppeal" ADD CONSTRAINT "PenaltyAppeal_penaltyId_fkey" FOREIGN KEY ("penaltyId") REFERENCES "Penalty"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PenaltyAppeal" ADD CONSTRAINT "PenaltyAppeal_filedById_fkey" FOREIGN KEY ("filedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PenaltyAppeal" ADD CONSTRAINT "PenaltyAppeal_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

