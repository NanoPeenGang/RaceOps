-- CreateEnum
CREATE TYPE "IncidentSource" AS ENUM ('COMPETITOR', 'MARSHAL', 'RACE_CONTROL', 'PROTEST');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('REPORTED', 'NOTED', 'UNDER_INVESTIGATION', 'NO_FURTHER_ACTION', 'PENALTY_ISSUED', 'WITHDRAWN');

-- AlterTable
ALTER TABLE "Media" ADD COLUMN     "incidentId" TEXT;

-- CreateTable
CREATE TABLE "Incident" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "sessionId" TEXT,
    "source" "IncidentSource" NOT NULL DEFAULT 'COMPETITOR',
    "status" "IncidentStatus" NOT NULL DEFAULT 'REPORTED',
    "subjectRegistrationId" TEXT,
    "reportedByRegistrationId" TEXT,
    "reportedById" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "description" TEXT,
    "lapNumber" INTEGER,
    "location" TEXT,
    "occurredAt" TIMESTAMP(3),
    "decisionNotes" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "penaltyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentResponse" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "visibleToCompetitors" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentResponse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Incident_penaltyId_key" ON "Incident"("penaltyId");

-- CreateIndex
CREATE INDEX "Incident_eventId_status_idx" ON "Incident"("eventId", "status");

-- CreateIndex
CREATE INDEX "Incident_subjectRegistrationId_idx" ON "Incident"("subjectRegistrationId");

-- CreateIndex
CREATE INDEX "IncidentResponse_incidentId_createdAt_idx" ON "IncidentResponse"("incidentId", "createdAt");

-- CreateIndex
CREATE INDEX "Media_incidentId_idx" ON "Media"("incidentId");

-- AddForeignKey
ALTER TABLE "Media" ADD CONSTRAINT "Media_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "RaceEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "EventSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_subjectRegistrationId_fkey" FOREIGN KEY ("subjectRegistrationId") REFERENCES "EventRegistration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_reportedByRegistrationId_fkey" FOREIGN KEY ("reportedByRegistrationId") REFERENCES "EventRegistration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_penaltyId_fkey" FOREIGN KEY ("penaltyId") REFERENCES "Penalty"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentResponse" ADD CONSTRAINT "IncidentResponse_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentResponse" ADD CONSTRAINT "IncidentResponse_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

