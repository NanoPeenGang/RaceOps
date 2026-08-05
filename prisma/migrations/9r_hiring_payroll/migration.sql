-- CreateEnum
CREATE TYPE "InterviewKind" AS ENUM ('VIDEO_CALL', 'PHONE', 'IN_PERSON', 'TRACK_TEST', 'WORK_TRIAL');

-- CreateEnum
CREATE TYPE "InterviewStatus" AS ENUM ('PROPOSED', 'CONFIRMED', 'DECLINED', 'COMPLETED', 'CANCELED');

-- CreateEnum
CREATE TYPE "PayBasis" AS ENUM ('HOURLY', 'DAILY', 'PER_EVENT', 'MONTHLY', 'SEASON', 'UNPAID');

-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'DECLINED', 'WITHDRAWN', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PayRunStatus" AS ENUM ('DRAFT', 'APPROVED', 'PAID', 'CANCELED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ApplicationStatus" ADD VALUE 'INTERVIEWING';
ALTER TYPE "ApplicationStatus" ADD VALUE 'OFFERED';
ALTER TYPE "ApplicationStatus" ADD VALUE 'OFFER_DECLINED';

-- CreateTable
CREATE TABLE "Interview" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "kind" "InterviewKind" NOT NULL DEFAULT 'VIDEO_CALL',
    "status" "InterviewStatus" NOT NULL DEFAULT 'PROPOSED',
    "scheduledAt" TIMESTAMP(3),
    "durationMinutes" INTEGER NOT NULL DEFAULT 30,
    "location" TEXT,
    "agenda" TEXT,
    "privateNotes" TEXT,
    "outcome" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Interview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterviewSlot" (
    "id" TEXT NOT NULL,
    "interviewId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "chosen" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InterviewSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Offer" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "status" "OfferStatus" NOT NULL DEFAULT 'DRAFT',
    "role" "TeamRole" NOT NULL DEFAULT 'MEMBER',
    "title" TEXT,
    "basis" "PayBasis" NOT NULL DEFAULT 'UNPAID',
    "amountMinor" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "extras" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "scope" TEXT,
    "terms" TEXT,
    "expiresAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "responseNote" TEXT,
    "withdrawnAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayRate" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "basis" "PayBasis" NOT NULL DEFAULT 'PER_EVENT',
    "amountMinor" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "label" TEXT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayRun" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "status" "PayRunStatus" NOT NULL DEFAULT 'DRAFT',
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "eventId" TEXT,
    "notes" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollLine" (
    "id" TEXT NOT NULL,
    "payRunId" TEXT NOT NULL,
    "userId" TEXT,
    "payeeName" TEXT,
    "description" TEXT NOT NULL,
    "basis" "PayBasis" NOT NULL DEFAULT 'PER_EVENT',
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "rateMinor" INTEGER NOT NULL DEFAULT 0,
    "amountMinor" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "adjustmentMinor" INTEGER NOT NULL DEFAULT 0,
    "adjustmentNote" TEXT,
    "payRateId" TEXT,
    "eventId" TEXT,
    "paidAt" TIMESTAMP(3),
    "paymentReference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Interview_applicationId_status_idx" ON "Interview"("applicationId", "status");

-- CreateIndex
CREATE INDEX "Interview_scheduledAt_idx" ON "Interview"("scheduledAt");

-- CreateIndex
CREATE INDEX "Interview_createdById_idx" ON "Interview"("createdById");

-- CreateIndex
CREATE INDEX "InterviewSlot_interviewId_startsAt_idx" ON "InterviewSlot"("interviewId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "InterviewSlot_interviewId_startsAt_key" ON "InterviewSlot"("interviewId", "startsAt");

-- CreateIndex
CREATE INDEX "Offer_applicationId_status_idx" ON "Offer"("applicationId", "status");

-- CreateIndex
CREATE INDEX "Offer_teamId_status_idx" ON "Offer"("teamId", "status");

-- CreateIndex
CREATE INDEX "Offer_createdById_idx" ON "Offer"("createdById");

-- CreateIndex
CREATE INDEX "PayRate_teamId_userId_effectiveTo_idx" ON "PayRate"("teamId", "userId", "effectiveTo");

-- CreateIndex
CREATE INDEX "PayRate_userId_idx" ON "PayRate"("userId");

-- CreateIndex
CREATE INDEX "PayRate_createdById_idx" ON "PayRate"("createdById");

-- CreateIndex
CREATE INDEX "PayRun_teamId_status_periodStart_idx" ON "PayRun"("teamId", "status", "periodStart");

-- CreateIndex
CREATE INDEX "PayRun_eventId_idx" ON "PayRun"("eventId");

-- CreateIndex
CREATE INDEX "PayRun_approvedById_idx" ON "PayRun"("approvedById");

-- CreateIndex
CREATE INDEX "PayRun_createdById_idx" ON "PayRun"("createdById");

-- CreateIndex
CREATE INDEX "PayrollLine_payRunId_idx" ON "PayrollLine"("payRunId");

-- CreateIndex
CREATE INDEX "PayrollLine_userId_paidAt_idx" ON "PayrollLine"("userId", "paidAt");

-- CreateIndex
CREATE INDEX "PayrollLine_payRateId_idx" ON "PayrollLine"("payRateId");

-- CreateIndex
CREATE INDEX "PayrollLine_eventId_idx" ON "PayrollLine"("eventId");

-- CreateIndex
CREATE INDEX "Application_status_idx" ON "Application"("status");

-- AddForeignKey
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewSlot" ADD CONSTRAINT "InterviewSlot_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayRate" ADD CONSTRAINT "PayRate_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayRate" ADD CONSTRAINT "PayRate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayRate" ADD CONSTRAINT "PayRate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayRun" ADD CONSTRAINT "PayRun_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayRun" ADD CONSTRAINT "PayRun_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "RaceEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayRun" ADD CONSTRAINT "PayRun_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayRun" ADD CONSTRAINT "PayRun_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollLine" ADD CONSTRAINT "PayrollLine_payRunId_fkey" FOREIGN KEY ("payRunId") REFERENCES "PayRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollLine" ADD CONSTRAINT "PayrollLine_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollLine" ADD CONSTRAINT "PayrollLine_payRateId_fkey" FOREIGN KEY ("payRateId") REFERENCES "PayRate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollLine" ADD CONSTRAINT "PayrollLine_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "RaceEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Structural rules Prisma cannot express
-- ---------------------------------------------------------------------------

-- One chosen slot per interview. Two would make `scheduledAt` ambiguous, and
-- the ambiguity would only show up as two people on two different calls.
CREATE UNIQUE INDEX "InterviewSlot_one_chosen_per_interview"
ON "InterviewSlot"("interviewId") WHERE "chosen";

-- A confirmed interview has a time. Without this, "confirmed" can mean
-- nothing at all, and the applicant is told to turn up on no date.
ALTER TABLE "Interview"
ADD CONSTRAINT "Interview_confirmed_has_time"
CHECK ("status" <> 'CONFIRMED' OR "scheduledAt" IS NOT NULL);

ALTER TABLE "Interview"
ADD CONSTRAINT "Interview_duration_positive"
CHECK ("durationMinutes" > 0);

-- An unpaid offer carries no figure. Nullable rather than zero because the two
-- mean different things — "there is no money" versus "the money is nil" —
-- and a payroll built on a zero-that-means-unpaid pays people nothing while
-- looking correct.
ALTER TABLE "Offer"
ADD CONSTRAINT "Offer_unpaid_has_no_amount"
CHECK ("basis" <> 'UNPAID' OR "amountMinor" IS NULL);

ALTER TABLE "Offer"
ADD CONSTRAINT "Offer_amount_not_negative"
CHECK ("amountMinor" IS NULL OR "amountMinor" >= 0);

-- An offer the applicant has seen was sent. A response with no send is a
-- record of a conversation that did not happen.
ALTER TABLE "Offer"
ADD CONSTRAINT "Offer_answered_was_sent"
CHECK ("status" IN ('DRAFT', 'WITHDRAWN') OR "sentAt" IS NOT NULL);

ALTER TABLE "PayRate"
ADD CONSTRAINT "PayRate_unpaid_has_no_amount"
CHECK ("basis" <> 'UNPAID' OR "amountMinor" IS NULL);

ALTER TABLE "PayRate"
ADD CONSTRAINT "PayRate_amount_not_negative"
CHECK ("amountMinor" IS NULL OR "amountMinor" >= 0);

-- A rate cannot stop before it starts.
ALTER TABLE "PayRate"
ADD CONSTRAINT "PayRate_period_ordered"
CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom");

ALTER TABLE "PayRun"
ADD CONSTRAINT "PayRun_period_ordered"
CHECK ("periodEnd" >= "periodStart");

-- Every line is owed to somebody: an account, or a name for the mechanic who
-- does two weekends a year and has none. Never both — two identities on one
-- line is two people's money in one row.
ALTER TABLE "PayrollLine"
ADD CONSTRAINT "PayrollLine_has_exactly_one_payee"
CHECK (("userId" IS NOT NULL) <> ("payeeName" IS NOT NULL));

ALTER TABLE "PayrollLine"
ADD CONSTRAINT "PayrollLine_quantity_not_negative"
CHECK ("quantity" >= 0);

ALTER TABLE "PayrollLine"
ADD CONSTRAINT "PayrollLine_rate_not_negative"
CHECK ("rateMinor" >= 0);
