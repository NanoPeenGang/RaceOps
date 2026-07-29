-- CreateEnum
CREATE TYPE "SeriesDiscipline" AS ENUM ('REAL_WORLD', 'SIM');

-- CreateEnum
CREATE TYPE "SeriesRole" AS ENUM ('OWNER', 'ADMIN', 'RACE_CONTROL', 'VOLUNTEER_COORDINATOR');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'COMPLETED', 'CANCELED');

-- CreateEnum
CREATE TYPE "RegistrationStatus" AS ENUM ('PENDING', 'CONFIRMED', 'WAITLISTED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "VolunteerRoleType" AS ENUM ('MARSHAL', 'FLAG', 'TIMING', 'SCRUTINEER', 'MEDICAL', 'GRID', 'PIT_LANE', 'MEDIA', 'OTHER');

-- CreateEnum
CREATE TYPE "VolunteerSignupStatus" AS ENUM ('SIGNED_UP', 'WAITLISTED', 'CONFIRMED', 'CANCELED');

-- DropIndex
DROP INDEX "RaceEvent_series_date_idx";

-- AlterTable
-- "series" is renamed (not dropped/recreated) so existing rows keep their
-- label and the migration is safe on a non-empty table.
ALTER TABLE "RaceEvent" RENAME COLUMN "series" TO "seriesLabel";
ALTER TABLE "RaceEvent"
ADD COLUMN     "description" TEXT,
ADD COLUMN     "entryCapacity" INTEGER,
ADD COLUMN     "registrationClosesAt" TIMESTAMP(3),
ADD COLUMN     "registrationOpensAt" TIMESTAMP(3),
ADD COLUMN     "seriesId" TEXT,
ADD COLUMN     "status" "EventStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "venue" TEXT;

-- AlterTable
-- StrategyPlan.ownerId is required; any pre-existing plan rows would have no
-- owner, so clear the table first (no plan persistence shipped before now).
DELETE FROM "StrategyPlan";
ALTER TABLE "StrategyPlan" ADD COLUMN     "ownerId" TEXT NOT NULL,
ADD COLUMN     "teamId" TEXT;

-- CreateTable
CREATE TABLE "Series" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "discipline" "SeriesDiscipline" NOT NULL,
    "platform" TEXT NOT NULL,
    "season" TEXT,
    "logoUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Series_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeriesMembership" (
    "id" TEXT NOT NULL,
    "seriesId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "SeriesRole" NOT NULL DEFAULT 'ADMIN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SeriesMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventRegistration" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "teamId" TEXT,
    "entrantUserId" TEXT,
    "submittedById" TEXT NOT NULL,
    "carNumber" TEXT,
    "carClass" TEXT,
    "notes" TEXT,
    "status" "RegistrationStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VolunteerShift" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "role" "VolunteerRoleType" NOT NULL,
    "title" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "capacity" INTEGER NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VolunteerShift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VolunteerSignup" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "VolunteerSignupStatus" NOT NULL DEFAULT 'SIGNED_UP',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VolunteerSignup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Series_name_key" ON "Series"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Series_slug_key" ON "Series"("slug");

-- CreateIndex
CREATE INDEX "SeriesMembership_userId_idx" ON "SeriesMembership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SeriesMembership_seriesId_userId_key" ON "SeriesMembership"("seriesId", "userId");

-- CreateIndex
CREATE INDEX "EventRegistration_eventId_status_idx" ON "EventRegistration"("eventId", "status");

-- CreateIndex
CREATE INDEX "EventRegistration_submittedById_idx" ON "EventRegistration"("submittedById");

-- CreateIndex
CREATE UNIQUE INDEX "EventRegistration_eventId_teamId_key" ON "EventRegistration"("eventId", "teamId");

-- CreateIndex
CREATE UNIQUE INDEX "EventRegistration_eventId_entrantUserId_key" ON "EventRegistration"("eventId", "entrantUserId");

-- CreateIndex
CREATE UNIQUE INDEX "EventRegistration_eventId_carNumber_key" ON "EventRegistration"("eventId", "carNumber");

-- CreateIndex
CREATE INDEX "VolunteerShift_eventId_startsAt_idx" ON "VolunteerShift"("eventId", "startsAt");

-- CreateIndex
CREATE INDEX "VolunteerSignup_userId_idx" ON "VolunteerSignup"("userId");

-- CreateIndex
CREATE INDEX "VolunteerSignup_shiftId_status_idx" ON "VolunteerSignup"("shiftId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "VolunteerSignup_shiftId_userId_key" ON "VolunteerSignup"("shiftId", "userId");

-- CreateIndex
CREATE INDEX "RaceEvent_seriesLabel_date_idx" ON "RaceEvent"("seriesLabel", "date");

-- CreateIndex
CREATE INDEX "RaceEvent_seriesId_date_idx" ON "RaceEvent"("seriesId", "date");

-- CreateIndex
CREATE INDEX "RaceEvent_status_date_idx" ON "RaceEvent"("status", "date");

-- CreateIndex
CREATE INDEX "StrategyPlan_ownerId_idx" ON "StrategyPlan"("ownerId");

-- CreateIndex
CREATE INDEX "StrategyPlan_teamId_idx" ON "StrategyPlan"("teamId");

-- AddForeignKey
ALTER TABLE "SeriesMembership" ADD CONSTRAINT "SeriesMembership_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "Series"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeriesMembership" ADD CONSTRAINT "SeriesMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RaceEvent" ADD CONSTRAINT "RaceEvent_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "Series"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventRegistration" ADD CONSTRAINT "EventRegistration_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "RaceEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventRegistration" ADD CONSTRAINT "EventRegistration_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventRegistration" ADD CONSTRAINT "EventRegistration_entrantUserId_fkey" FOREIGN KEY ("entrantUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventRegistration" ADD CONSTRAINT "EventRegistration_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VolunteerShift" ADD CONSTRAINT "VolunteerShift_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "RaceEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VolunteerSignup" ADD CONSTRAINT "VolunteerSignup_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "VolunteerShift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VolunteerSignup" ADD CONSTRAINT "VolunteerSignup_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategyPlan" ADD CONSTRAINT "StrategyPlan_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategyPlan" ADD CONSTRAINT "StrategyPlan_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

