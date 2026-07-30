-- CreateEnum
CREATE TYPE "InspectionStage" AS ENUM ('PRE_EVENT', 'IN_EVENT', 'POST_RACE');

-- CreateEnum
CREATE TYPE "InspectionStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'PASSED', 'FAILED', 'REFERRED');

-- CreateEnum
CREATE TYPE "CheckResult" AS ENUM ('PENDING', 'PASS', 'FAIL', 'NOT_APPLICABLE');

-- CreateTable
CREATE TABLE "InspectionTemplate" (
    "id" TEXT NOT NULL,
    "seriesId" TEXT NOT NULL,
    "seriesClassId" TEXT,
    "name" TEXT NOT NULL,
    "stage" "InspectionStage" NOT NULL DEFAULT 'PRE_EVENT',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InspectionTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InspectionTemplateItem" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "regulation" TEXT,
    "measureUnit" TEXT,
    "minValue" DOUBLE PRECISION,
    "maxValue" DOUBLE PRECISION,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "InspectionTemplateItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Inspection" (
    "id" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "templateId" TEXT,
    "stage" "InspectionStage" NOT NULL DEFAULT 'PRE_EVENT',
    "status" "InspectionStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "supersedesId" TEXT,
    "inspectedById" TEXT NOT NULL,
    "notes" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Inspection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InspectionCheck" (
    "id" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "templateItemId" TEXT,
    "label" TEXT NOT NULL,
    "regulation" TEXT,
    "measureUnit" TEXT,
    "minValue" DOUBLE PRECISION,
    "maxValue" DOUBLE PRECISION,
    "result" "CheckResult" NOT NULL DEFAULT 'PENDING',
    "measuredValue" DOUBLE PRECISION,
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "InspectionCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InspectionTemplate_seriesId_active_idx" ON "InspectionTemplate"("seriesId", "active");

-- CreateIndex
CREATE INDEX "InspectionTemplateItem_templateId_sortOrder_idx" ON "InspectionTemplateItem"("templateId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Inspection_supersedesId_key" ON "Inspection"("supersedesId");

-- CreateIndex
CREATE INDEX "Inspection_registrationId_stage_idx" ON "Inspection"("registrationId", "stage");

-- CreateIndex
CREATE INDEX "InspectionCheck_inspectionId_sortOrder_idx" ON "InspectionCheck"("inspectionId", "sortOrder");

-- AddForeignKey
ALTER TABLE "InspectionTemplate" ADD CONSTRAINT "InspectionTemplate_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "Series"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InspectionTemplateItem" ADD CONSTRAINT "InspectionTemplateItem_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "InspectionTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inspection" ADD CONSTRAINT "Inspection_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "EventRegistration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inspection" ADD CONSTRAINT "Inspection_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "InspectionTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inspection" ADD CONSTRAINT "Inspection_inspectedById_fkey" FOREIGN KEY ("inspectedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inspection" ADD CONSTRAINT "Inspection_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "Inspection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InspectionCheck" ADD CONSTRAINT "InspectionCheck_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "Inspection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InspectionCheck" ADD CONSTRAINT "InspectionCheck_templateItemId_fkey" FOREIGN KEY ("templateItemId") REFERENCES "InspectionTemplateItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- A tolerance that reads backwards would fail every car silently.
ALTER TABLE "InspectionTemplateItem"
ADD CONSTRAINT "InspectionTemplateItem_bounds_ordered"
CHECK ("minValue" IS NULL OR "maxValue" IS NULL OR "minValue" <= "maxValue");

ALTER TABLE "InspectionCheck"
ADD CONSTRAINT "InspectionCheck_bounds_ordered"
CHECK ("minValue" IS NULL OR "maxValue" IS NULL OR "minValue" <= "maxValue");
