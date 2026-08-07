-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('MEMBER', 'MODERATOR', 'ADMIN');

-- CreateEnum
CREATE TYPE "AccessRequestKind" AS ENUM ('TEAM', 'ORGANIZATION', 'SERIES', 'SPONSOR');

-- CreateEnum
CREATE TYPE "AccessRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "platformRole" "PlatformRole" NOT NULL DEFAULT 'MEMBER';

-- CreateTable
CREATE TABLE "AccessRequest" (
    "id" TEXT NOT NULL,
    "kind" "AccessRequestKind" NOT NULL,
    "status" "AccessRequestStatus" NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT NOT NULL,
    "proposedName" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "websiteUrl" TEXT,
    "experience" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "fulfilledEntityId" TEXT,
    "fulfilledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccessRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccessRequest_status_kind_createdAt_idx" ON "AccessRequest"("status", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "AccessRequest_requestedById_status_idx" ON "AccessRequest"("requestedById", "status");

-- CreateIndex
CREATE INDEX "AccessRequest_reviewedById_idx" ON "AccessRequest"("reviewedById");

-- AddForeignKey
ALTER TABLE "AccessRequest" ADD CONSTRAINT "AccessRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessRequest" ADD CONSTRAINT "AccessRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Structural rules Prisma cannot express
-- ---------------------------------------------------------------------------

-- A decided request records who decided it and when. Without this, "approved"
-- can exist with nobody's name on it, and the review queue stops being an
-- audit trail the moment somebody asks who let a spam team through.
ALTER TABLE "AccessRequest"
ADD CONSTRAINT "AccessRequest_decision_has_a_reviewer"
CHECK (
  "status" IN ('PENDING', 'WITHDRAWN')
  OR ("reviewedById" IS NOT NULL AND "reviewedAt" IS NOT NULL)
);

-- Only an approval can be spent. A rejected or pending request pointing at a
-- created entity would mean something got made without a yes.
ALTER TABLE "AccessRequest"
ADD CONSTRAINT "AccessRequest_only_approved_is_fulfilled"
CHECK ("fulfilledEntityId" IS NULL OR "status" = 'APPROVED');

-- Spending a request stamps both columns or neither.
ALTER TABLE "AccessRequest"
ADD CONSTRAINT "AccessRequest_fulfilment_is_complete"
CHECK (("fulfilledEntityId" IS NULL) = ("fulfilledAt" IS NULL));

-- A sponsor grant creates nothing, so it can never be "spent" on an entity.
-- Its approval is the grant itself.
ALTER TABLE "AccessRequest"
ADD CONSTRAINT "AccessRequest_sponsor_creates_nothing"
CHECK ("kind" <> 'SPONSOR' OR "fulfilledEntityId" IS NULL);
