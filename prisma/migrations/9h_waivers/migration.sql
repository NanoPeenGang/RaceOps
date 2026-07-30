-- CreateEnum
CREATE TYPE "WaiverAudience" AS ENUM ('ALL_PARTICIPANTS', 'DRIVERS', 'CREW', 'VOLUNTEERS', 'CREDENTIAL_HOLDERS');

-- CreateTable
CREATE TABLE "Waiver" (
    "id" TEXT NOT NULL,
    "seriesId" TEXT,
    "eventId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "audience" "WaiverAudience" NOT NULL DEFAULT 'ALL_PARTICIPANTS',
    "required" BOOLEAN NOT NULL DEFAULT true,
    "minSigningAge" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "supersededAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Waiver_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaiverSignature" (
    "id" TEXT NOT NULL,
    "waiverId" TEXT NOT NULL,
    "waiverVersion" INTEGER NOT NULL,
    "signerUserId" TEXT,
    "signedName" TEXT NOT NULL,
    "signedEmail" TEXT,
    "registrationId" TEXT,
    "guardianName" TEXT,
    "guardianRelation" TEXT,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaiverSignature_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Waiver_seriesId_active_idx" ON "Waiver"("seriesId", "active");

-- CreateIndex
CREATE INDEX "Waiver_eventId_active_idx" ON "Waiver"("eventId", "active");

-- CreateIndex
CREATE INDEX "WaiverSignature_waiverId_signedAt_idx" ON "WaiverSignature"("waiverId", "signedAt");

-- CreateIndex
CREATE INDEX "WaiverSignature_signerUserId_idx" ON "WaiverSignature"("signerUserId");

-- CreateIndex
CREATE INDEX "WaiverSignature_registrationId_idx" ON "WaiverSignature"("registrationId");

-- AddForeignKey
ALTER TABLE "Waiver" ADD CONSTRAINT "Waiver_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "Series"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Waiver" ADD CONSTRAINT "Waiver_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "RaceEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Waiver" ADD CONSTRAINT "Waiver_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverSignature" ADD CONSTRAINT "WaiverSignature_waiverId_fkey" FOREIGN KEY ("waiverId") REFERENCES "Waiver"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverSignature" ADD CONSTRAINT "WaiverSignature_signerUserId_fkey" FOREIGN KEY ("signerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverSignature" ADD CONSTRAINT "WaiverSignature_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "EventRegistration"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Invariants Prisma cannot express.

-- A waiver belongs to a series or a single event, never both and never
-- neither. Without this an orphan waiver is invisible to every scope query
-- and nobody would ever be asked to sign it.
ALTER TABLE "Waiver"
ADD CONSTRAINT "Waiver_exactly_one_scope"
CHECK (num_nonnulls("seriesId", "eventId") = 1);

-- Versions start at 1 and only go up.
ALTER TABLE "Waiver"
ADD CONSTRAINT "Waiver_version_positive" CHECK ("version" >= 1);

-- A signature records the version it was given, so it cannot predate v1.
ALTER TABLE "WaiverSignature"
ADD CONSTRAINT "WaiverSignature_version_positive"
CHECK ("waiverVersion" >= 1);

-- One signature per person per waiver version. A second click on a slow
-- form must not produce two records of the same consent.
CREATE UNIQUE INDEX "WaiverSignature_one_per_signer_version"
ON "WaiverSignature"("waiverId", "waiverVersion", "signerUserId")
WHERE "signerUserId" IS NOT NULL;
