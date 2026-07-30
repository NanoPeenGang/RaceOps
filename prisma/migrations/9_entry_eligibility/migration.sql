-- CreateEnum
CREATE TYPE "RequirementKind" AS ENUM ('CREDENTIAL', 'SIM_RATING', 'MIN_AGE', 'ACKNOWLEDGEMENT');

-- CreateEnum
CREATE TYPE "RequirementEnforcement" AS ENUM ('BLOCKING', 'ADVISORY');

-- AlterTable
ALTER TABLE "Profile" ADD COLUMN     "dateOfBirth" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "EntryRequirement" (
    "id" TEXT NOT NULL,
    "seriesId" TEXT NOT NULL,
    "seriesClassId" TEXT,
    "kind" "RequirementKind" NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "enforcement" "RequirementEnforcement" NOT NULL DEFAULT 'BLOCKING',
    "credentialKind" TEXT,
    "simPlatform" TEXT,
    "minRating" INTEGER,
    "minAge" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EntryRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequirementWaiver" (
    "id" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL DEFAULT true,
    "reason" TEXT,
    "decidedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RequirementWaiver_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EntryRequirement_seriesId_active_idx" ON "EntryRequirement"("seriesId", "active");

-- CreateIndex
CREATE INDEX "EntryRequirement_seriesClassId_idx" ON "EntryRequirement"("seriesClassId");

-- CreateIndex
CREATE INDEX "RequirementWaiver_registrationId_idx" ON "RequirementWaiver"("registrationId");

-- CreateIndex
CREATE UNIQUE INDEX "RequirementWaiver_requirementId_registrationId_userId_key" ON "RequirementWaiver"("requirementId", "registrationId", "userId");

-- AddForeignKey
ALTER TABLE "EntryRequirement" ADD CONSTRAINT "EntryRequirement_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "Series"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementWaiver" ADD CONSTRAINT "RequirementWaiver_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "EntryRequirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementWaiver" ADD CONSTRAINT "RequirementWaiver_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "EventRegistration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementWaiver" ADD CONSTRAINT "RequirementWaiver_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementWaiver" ADD CONSTRAINT "RequirementWaiver_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

