-- CreateEnum
CREATE TYPE "SessionType" AS ENUM ('PRACTICE', 'QUALIFYING', 'RACE', 'WARMUP', 'SCRUTINEERING', 'DRIVER_BRIEFING', 'MEDIA', 'SUPPORT', 'OTHER');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('SCHEDULED', 'LIVE', 'FINISHED', 'CANCELED');

-- CreateEnum
CREATE TYPE "FlagState" AS ENUM ('NONE', 'GREEN', 'YELLOW', 'SAFETY_CAR', 'VIRTUAL_SAFETY_CAR', 'RED', 'CHECKERED');

-- CreateEnum
CREATE TYPE "TimingStatus" AS ENUM ('RUNNING', 'PIT', 'OUT', 'STOPPED', 'FINISHED', 'DNS');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('RULEBOOK', 'SUPPLEMENTARY_REGS', 'TECH_SHEET', 'BULLETIN', 'ENTRY_LIST', 'SCHEDULE', 'APPROVED_MEDIA', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentVisibility" AS ENUM ('PUBLIC', 'COMPETITORS', 'ORGANIZERS');

-- CreateEnum
CREATE TYPE "AnnouncementUrgency" AS ENUM ('INFO', 'IMPORTANT', 'URGENT');

-- DropForeignKey
ALTER TABLE "_MediaToRaceReport" DROP CONSTRAINT "_MediaToRaceReport_A_fkey";

-- DropForeignKey
ALTER TABLE "_MediaToRaceReport" DROP CONSTRAINT "_MediaToRaceReport_B_fkey";

-- AlterTable
ALTER TABLE "Media" ADD COLUMN     "reportId" TEXT;

-- AlterTable
ALTER TABLE "RaceEvent" ADD COLUMN     "endDate" TIMESTAMP(3),
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "RaceReport" ADD COLUMN     "eventId" TEXT,
ADD COLUMN     "published" BOOLEAN NOT NULL DEFAULT true;

-- Preserve existing report attachments before the implicit many-to-many join
-- table is replaced by Media."reportId". "A" is the Media id, "B" the report id
-- (Prisma orders the columns by model name). A media row attached to more than
-- one report keeps a single attachment, which is the shape the column allows.
UPDATE "Media" AS m
SET "reportId" = j."B"
FROM "_MediaToRaceReport" AS j
WHERE j."A" = m."id" AND m."reportId" IS NULL;

-- DropTable
DROP TABLE "_MediaToRaceReport";

-- CreateTable
CREATE TABLE "EventSession" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "type" "SessionType" NOT NULL,
    "name" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "location" TEXT,
    "notes" TEXT,
    "status" "SessionStatus" NOT NULL DEFAULT 'SCHEDULED',
    "flagState" "FlagState" NOT NULL DEFAULT 'NONE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimingEntry" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "position" INTEGER,
    "lapsCompleted" INTEGER NOT NULL DEFAULT 0,
    "lastLapMs" INTEGER,
    "bestLapMs" INTEGER,
    "gapMs" INTEGER,
    "status" "TimingStatus" NOT NULL DEFAULT 'RUNNING',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimingEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RaceDocument" (
    "id" TEXT NOT NULL,
    "seriesId" TEXT,
    "eventId" TEXT,
    "uploadedById" TEXT NOT NULL,
    "type" "DocumentType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "fileUrl" TEXT NOT NULL,
    "version" TEXT,
    "visibility" "DocumentVisibility" NOT NULL DEFAULT 'PUBLIC',
    "supersededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RaceDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "seriesId" TEXT,
    "eventId" TEXT,
    "authorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "urgency" "AnnouncementUrgency" NOT NULL DEFAULT 'INFO',
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EventSession_eventId_startsAt_idx" ON "EventSession"("eventId", "startsAt");

-- CreateIndex
CREATE INDEX "TimingEntry_sessionId_position_idx" ON "TimingEntry"("sessionId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "TimingEntry_sessionId_registrationId_key" ON "TimingEntry"("sessionId", "registrationId");

-- CreateIndex
CREATE INDEX "RaceDocument_seriesId_type_idx" ON "RaceDocument"("seriesId", "type");

-- CreateIndex
CREATE INDEX "RaceDocument_eventId_type_idx" ON "RaceDocument"("eventId", "type");

-- CreateIndex
CREATE INDEX "Announcement_seriesId_createdAt_idx" ON "Announcement"("seriesId", "createdAt");

-- CreateIndex
CREATE INDEX "Announcement_eventId_createdAt_idx" ON "Announcement"("eventId", "createdAt");

-- CreateIndex
CREATE INDEX "ChatMessage_eventId_createdAt_idx" ON "ChatMessage"("eventId", "createdAt");

-- CreateIndex
CREATE INDEX "Media_reportId_idx" ON "Media"("reportId");

-- CreateIndex
CREATE INDEX "RaceReport_published_createdAt_idx" ON "RaceReport"("published", "createdAt");

-- AddForeignKey
ALTER TABLE "Media" ADD CONSTRAINT "Media_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "RaceReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventSession" ADD CONSTRAINT "EventSession_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "RaceEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimingEntry" ADD CONSTRAINT "TimingEntry_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "EventSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimingEntry" ADD CONSTRAINT "TimingEntry_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "EventRegistration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RaceDocument" ADD CONSTRAINT "RaceDocument_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "Series"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RaceDocument" ADD CONSTRAINT "RaceDocument_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "RaceEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RaceDocument" ADD CONSTRAINT "RaceDocument_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "Series"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "RaceEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "RaceEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RaceReport" ADD CONSTRAINT "RaceReport_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "RaceEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

