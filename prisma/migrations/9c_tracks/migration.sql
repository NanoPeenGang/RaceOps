-- CreateEnum
CREATE TYPE "TrackKind" AS ENUM ('CIRCUIT', 'STREET', 'RALLY_STAGE', 'OVAL', 'KART', 'AUTOCROSS', 'OTHER');

-- CreateEnum
CREATE TYPE "TrackDirection" AS ENUM ('CLOCKWISE', 'ANTICLOCKWISE');

-- AlterTable
ALTER TABLE "Incident" ADD COLUMN     "turnId" TEXT;

-- AlterTable
ALTER TABLE "RaceEvent" ADD COLUMN     "trackLayoutId" TEXT;

-- CreateTable
CREATE TABLE "Track" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "kind" "TrackKind" NOT NULL DEFAULT 'CIRCUIT',
    "country" TEXT,
    "region" TEXT,
    "city" TEXT,
    "timezone" TEXT,
    "websiteUrl" TEXT,
    "licenceGrade" TEXT,
    "pitBoxCount" INTEGER,
    "garageCount" INTEGER,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Track_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackLayout" (
    "id" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "platform" TEXT,
    "lengthMeters" INTEGER,
    "direction" "TrackDirection" NOT NULL DEFAULT 'CLOCKWISE',
    "elevationMeters" INTEGER,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrackLayout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackTurn" (
    "id" TEXT NOT NULL,
    "layoutId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "name" TEXT,
    "sector" INTEGER,
    "marshalPost" TEXT,
    "notes" TEXT,

    CONSTRAINT "TrackTurn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackSector" (
    "id" TEXT NOT NULL,
    "layoutId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "name" TEXT,
    "lengthMeters" INTEGER,

    CONSTRAINT "TrackSector_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Track_slug_key" ON "Track"("slug");

-- CreateIndex
CREATE INDEX "Track_country_name_idx" ON "Track"("country", "name");

-- CreateIndex
CREATE INDEX "Track_kind_idx" ON "Track"("kind");

-- CreateIndex
CREATE INDEX "TrackLayout_trackId_isPrimary_idx" ON "TrackLayout"("trackId", "isPrimary");

-- CreateIndex
CREATE UNIQUE INDEX "TrackLayout_trackId_name_key" ON "TrackLayout"("trackId", "name");

-- CreateIndex
CREATE INDEX "TrackTurn_layoutId_sector_idx" ON "TrackTurn"("layoutId", "sector");

-- CreateIndex
CREATE UNIQUE INDEX "TrackTurn_layoutId_number_key" ON "TrackTurn"("layoutId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "TrackSector_layoutId_number_key" ON "TrackSector"("layoutId", "number");

-- CreateIndex
CREATE INDEX "Incident_turnId_idx" ON "Incident"("turnId");

-- CreateIndex
CREATE INDEX "RaceEvent_trackLayoutId_date_idx" ON "RaceEvent"("trackLayoutId", "date");

-- AddForeignKey
ALTER TABLE "RaceEvent" ADD CONSTRAINT "RaceEvent_trackLayoutId_fkey" FOREIGN KEY ("trackLayoutId") REFERENCES "TrackLayout"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "TrackTurn"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Track" ADD CONSTRAINT "Track_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackLayout" ADD CONSTRAINT "TrackLayout_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackTurn" ADD CONSTRAINT "TrackTurn_layoutId_fkey" FOREIGN KEY ("layoutId") REFERENCES "TrackLayout"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackSector" ADD CONSTRAINT "TrackSector_layoutId_fkey" FOREIGN KEY ("layoutId") REFERENCES "TrackLayout"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Invariants Prisma cannot express.

-- Turns and sectors are numbered from 1; a zero or negative number would sort
-- ahead of turn 1 and read as a data-entry slip on every incident report.
ALTER TABLE "TrackTurn"
ADD CONSTRAINT "TrackTurn_number_positive" CHECK ("number" >= 1);

ALTER TABLE "TrackSector"
ADD CONSTRAINT "TrackSector_number_positive" CHECK ("number" >= 1);

-- Lengths are positive when given.
ALTER TABLE "TrackLayout"
ADD CONSTRAINT "TrackLayout_length_positive"
CHECK ("lengthMeters" IS NULL OR "lengthMeters" > 0);

-- At most one primary layout per track: the default an event falls back to
-- has to be unambiguous.
CREATE UNIQUE INDEX "TrackLayout_one_primary_per_track"
ON "TrackLayout"("trackId") WHERE "isPrimary";
