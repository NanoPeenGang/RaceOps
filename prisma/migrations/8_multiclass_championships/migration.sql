-- AlterTable
ALTER TABLE "EventRegistration" ADD COLUMN     "seriesClassId" TEXT;

-- AlterTable
ALTER TABLE "RaceEvent" ADD COLUMN     "pointsMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Series" ADD COLUMN     "countBestRounds" INTEGER,
ADD COLUMN     "minStartsForTitle" INTEGER;

-- CreateTable
CREATE TABLE "SeriesClass" (
    "id" TEXT NOT NULL,
    "seriesId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "grouping" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "pointsScheme" JSONB,
    "fastestLapPoints" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeriesClass_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SeriesClass_seriesId_sortOrder_idx" ON "SeriesClass"("seriesId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "SeriesClass_seriesId_name_key" ON "SeriesClass"("seriesId", "name");

-- CreateIndex
CREATE INDEX "EventRegistration_seriesClassId_idx" ON "EventRegistration"("seriesClassId");

-- AddForeignKey
ALTER TABLE "SeriesClass" ADD CONSTRAINT "SeriesClass_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "Series"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventRegistration" ADD CONSTRAINT "EventRegistration_seriesClassId_fkey" FOREIGN KEY ("seriesClassId") REFERENCES "SeriesClass"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Positive weighting only. A zero or negative multiplier would silently void a
-- round's points rather than failing where an organizer could see it.
ALTER TABLE "RaceEvent"
ADD CONSTRAINT "RaceEvent_points_multiplier_positive"
CHECK ("pointsMultiplier" > 0);
