-- CreateEnum
CREATE TYPE "SponsorshipStatus" AS ENUM ('OFFERED', 'NEGOTIATING', 'ACTIVE', 'DECLINED', 'EXPIRED');

-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN     "teamId" TEXT,
ALTER COLUMN "eventId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Team" ADD COLUMN     "homeBase" TEXT,
ADD COLUMN     "websiteUrl" TEXT;

-- CreateTable
CREATE TABLE "Sponsorship" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "sponsorUserId" TEXT,
    "sponsorName" TEXT NOT NULL,
    "contactEmail" TEXT,
    "websiteUrl" TEXT,
    "logoUrl" TEXT,
    "tier" TEXT,
    "valueMinor" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" "SponsorshipStatus" NOT NULL DEFAULT 'OFFERED',
    "season" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sponsorship_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Sponsorship_teamId_status_idx" ON "Sponsorship"("teamId", "status");

-- CreateIndex
CREATE INDEX "Sponsorship_sponsorUserId_idx" ON "Sponsorship"("sponsorUserId");

-- CreateIndex
CREATE INDEX "Sponsorship_createdById_idx" ON "Sponsorship"("createdById");

-- CreateIndex
CREATE INDEX "ChatMessage_teamId_createdAt_idx" ON "ChatMessage"("teamId", "createdAt");

-- AddForeignKey
ALTER TABLE "Sponsorship" ADD CONSTRAINT "Sponsorship_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sponsorship" ADD CONSTRAINT "Sponsorship_sponsorUserId_fkey" FOREIGN KEY ("sponsorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sponsorship" ADD CONSTRAINT "Sponsorship_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- A chat message belongs to exactly one room. The router enforces this on the
-- way in; the constraint makes it structural so no future code path can create
-- a message that belongs to neither an event nor a team.
ALTER TABLE "ChatMessage"
ADD CONSTRAINT "ChatMessage_exactly_one_scope"
CHECK (("eventId" IS NOT NULL) <> ("teamId" IS NOT NULL));
