-- CreateEnum
CREATE TYPE "PartCategory" AS ENUM ('ENGINE', 'DRIVETRAIN', 'SUSPENSION', 'BRAKES', 'TIRES_WHEELS', 'BODYWORK', 'ELECTRICAL', 'FLUIDS', 'SAFETY', 'CONSUMABLES', 'TOOLS', 'OTHER');

-- CreateEnum
CREATE TYPE "StockMoveKind" AS ENUM ('RECEIVED', 'CONSUMED', 'ADJUSTED', 'RETURNED');

-- CreateEnum
CREATE TYPE "GarageFileKind" AS ENUM ('TELEMETRY', 'SETUP', 'DOCUMENT');

-- CreateEnum
CREATE TYPE "ServiceKind" AS ENUM ('SCHEDULED', 'REPAIR', 'REBUILD', 'INSPECTION', 'UPGRADE');

-- CreateEnum
CREATE TYPE "ServiceStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'DONE', 'DEFERRED');

-- CreateEnum
CREATE TYPE "PitStopKind" AS ENUM ('FUEL', 'TIRES', 'DRIVER_CHANGE', 'REPAIR', 'PENALTY_SERVE', 'OTHER');

-- CreateEnum
CREATE TYPE "PitStopStatus" AS ENUM ('PLANNED', 'COMPLETED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ChannelKind" AS ENUM ('OPEN', 'DEPARTMENT');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'DIRECT_MESSAGE';

-- AlterTable
ALTER TABLE "Car" ADD COLUMN     "runningHours" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN     "channelId" TEXT,
ADD COLUMN     "threadId" TEXT;

-- CreateTable
CREATE TABLE "InventoryItem" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "partNumber" TEXT,
    "category" "PartCategory" NOT NULL DEFAULT 'OTHER',
    "location" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "minQuantity" INTEGER,
    "unit" TEXT NOT NULL DEFAULT 'each',
    "unitCostMinor" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "supplier" TEXT,
    "notes" TEXT,
    "carId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryMovement" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "kind" "StockMoveKind" NOT NULL,
    "delta" INTEGER NOT NULL,
    "balance" INTEGER NOT NULL,
    "reason" TEXT,
    "eventId" TEXT,
    "serviceId" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GarageFile" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "kind" "GarageFileKind" NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "fileName" TEXT,
    "contentType" TEXT,
    "sizeBytes" INTEGER,
    "carId" TEXT,
    "eventId" TEXT,
    "sessionId" TEXT,
    "trackLayoutId" TEXT,
    "driverUserId" TEXT,
    "conditions" TEXT,
    "bestLapMs" INTEGER,
    "notes" TEXT,
    "tags" TEXT[],
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GarageFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CarService" (
    "id" TEXT NOT NULL,
    "carId" TEXT NOT NULL,
    "kind" "ServiceKind" NOT NULL DEFAULT 'SCHEDULED',
    "status" "ServiceStatus" NOT NULL DEFAULT 'PLANNED',
    "component" TEXT NOT NULL,
    "description" TEXT,
    "hoursAtService" DOUBLE PRECISION,
    "eventId" TEXT,
    "performedById" TEXT,
    "performedOn" TIMESTAMP(3),
    "costMinor" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "nextDueOn" TIMESTAMP(3),
    "nextDueHours" DOUBLE PRECISION,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CarService_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PitStopPlan" (
    "id" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "sessionId" TEXT,
    "sequence" INTEGER NOT NULL,
    "kind" "PitStopKind" NOT NULL DEFAULT 'FUEL',
    "status" "PitStopStatus" NOT NULL DEFAULT 'PLANNED',
    "targetLap" INTEGER,
    "targetAt" TIMESTAMP(3),
    "driverInId" TEXT,
    "driverOutId" TEXT,
    "fuelLitres" DOUBLE PRECISION,
    "tireSetId" TEXT,
    "plannedSeconds" INTEGER,
    "actualAt" TIMESTAMP(3),
    "actualSeconds" INTEGER,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PitStopPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatChannel" (
    "id" TEXT NOT NULL,
    "teamId" TEXT,
    "eventId" TEXT,
    "seriesId" TEXT,
    "organizationId" TEXT,
    "kind" "ChannelKind" NOT NULL DEFAULT 'DEPARTMENT',
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "teamRoles" "TeamRole"[],
    "seriesRoles" "SeriesRole"[],
    "orgRoles" "OrgRole"[],
    "staffRoleId" TEXT,
    "includesEntrantTeams" BOOLEAN NOT NULL DEFAULT false,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DirectThread" (
    "id" TEXT NOT NULL,
    "pairKey" TEXT,
    "subject" TEXT,
    "lastMessageAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DirectThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DirectParticipant" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "leftAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DirectParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InventoryItem_teamId_active_category_idx" ON "InventoryItem"("teamId", "active", "category");

-- CreateIndex
CREATE INDEX "InventoryItem_carId_idx" ON "InventoryItem"("carId");

-- CreateIndex
CREATE INDEX "InventoryItem_createdById_idx" ON "InventoryItem"("createdById");

-- CreateIndex
CREATE INDEX "InventoryMovement_itemId_createdAt_idx" ON "InventoryMovement"("itemId", "createdAt");

-- CreateIndex
CREATE INDEX "InventoryMovement_eventId_idx" ON "InventoryMovement"("eventId");

-- CreateIndex
CREATE INDEX "InventoryMovement_serviceId_idx" ON "InventoryMovement"("serviceId");

-- CreateIndex
CREATE INDEX "InventoryMovement_userId_idx" ON "InventoryMovement"("userId");

-- CreateIndex
CREATE INDEX "GarageFile_teamId_kind_createdAt_idx" ON "GarageFile"("teamId", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "GarageFile_carId_kind_idx" ON "GarageFile"("carId", "kind");

-- CreateIndex
CREATE INDEX "GarageFile_trackLayoutId_kind_idx" ON "GarageFile"("trackLayoutId", "kind");

-- CreateIndex
CREATE INDEX "GarageFile_eventId_idx" ON "GarageFile"("eventId");

-- CreateIndex
CREATE INDEX "GarageFile_sessionId_idx" ON "GarageFile"("sessionId");

-- CreateIndex
CREATE INDEX "GarageFile_driverUserId_idx" ON "GarageFile"("driverUserId");

-- CreateIndex
CREATE INDEX "GarageFile_uploadedById_idx" ON "GarageFile"("uploadedById");

-- CreateIndex
CREATE INDEX "CarService_carId_status_idx" ON "CarService"("carId", "status");

-- CreateIndex
CREATE INDEX "CarService_eventId_idx" ON "CarService"("eventId");

-- CreateIndex
CREATE INDEX "CarService_performedById_idx" ON "CarService"("performedById");

-- CreateIndex
CREATE INDEX "CarService_createdById_idx" ON "CarService"("createdById");

-- CreateIndex
CREATE INDEX "PitStopPlan_registrationId_status_idx" ON "PitStopPlan"("registrationId", "status");

-- CreateIndex
CREATE INDEX "PitStopPlan_sessionId_idx" ON "PitStopPlan"("sessionId");

-- CreateIndex
CREATE INDEX "PitStopPlan_tireSetId_idx" ON "PitStopPlan"("tireSetId");

-- CreateIndex
CREATE INDEX "PitStopPlan_createdById_idx" ON "PitStopPlan"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "PitStopPlan_registrationId_sequence_key" ON "PitStopPlan"("registrationId", "sequence");

-- CreateIndex
CREATE INDEX "ChatChannel_teamId_archived_idx" ON "ChatChannel"("teamId", "archived");

-- CreateIndex
CREATE INDEX "ChatChannel_eventId_archived_idx" ON "ChatChannel"("eventId", "archived");

-- CreateIndex
CREATE INDEX "ChatChannel_staffRoleId_idx" ON "ChatChannel"("staffRoleId");

-- CreateIndex
CREATE INDEX "ChatChannel_createdById_idx" ON "ChatChannel"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "ChatChannel_teamId_slug_key" ON "ChatChannel"("teamId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "ChatChannel_eventId_slug_key" ON "ChatChannel"("eventId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "ChatChannel_seriesId_slug_key" ON "ChatChannel"("seriesId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "ChatChannel_organizationId_slug_key" ON "ChatChannel"("organizationId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "DirectThread_pairKey_key" ON "DirectThread"("pairKey");

-- CreateIndex
CREATE INDEX "DirectThread_lastMessageAt_idx" ON "DirectThread"("lastMessageAt");

-- CreateIndex
CREATE INDEX "DirectThread_createdById_idx" ON "DirectThread"("createdById");

-- CreateIndex
CREATE INDEX "DirectParticipant_userId_leftAt_idx" ON "DirectParticipant"("userId", "leftAt");

-- CreateIndex
CREATE UNIQUE INDEX "DirectParticipant_threadId_userId_key" ON "DirectParticipant"("threadId", "userId");

-- CreateIndex
CREATE INDEX "ChatMessage_channelId_createdAt_idx" ON "ChatMessage"("channelId", "createdAt");

-- CreateIndex
CREATE INDEX "ChatMessage_threadId_createdAt_idx" ON "ChatMessage"("threadId", "createdAt");

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "ChatChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "DirectThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_carId_fkey" FOREIGN KEY ("carId") REFERENCES "Car"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "RaceEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "CarService"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GarageFile" ADD CONSTRAINT "GarageFile_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GarageFile" ADD CONSTRAINT "GarageFile_carId_fkey" FOREIGN KEY ("carId") REFERENCES "Car"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GarageFile" ADD CONSTRAINT "GarageFile_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "RaceEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GarageFile" ADD CONSTRAINT "GarageFile_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "EventSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GarageFile" ADD CONSTRAINT "GarageFile_trackLayoutId_fkey" FOREIGN KEY ("trackLayoutId") REFERENCES "TrackLayout"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GarageFile" ADD CONSTRAINT "GarageFile_driverUserId_fkey" FOREIGN KEY ("driverUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GarageFile" ADD CONSTRAINT "GarageFile_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarService" ADD CONSTRAINT "CarService_carId_fkey" FOREIGN KEY ("carId") REFERENCES "Car"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarService" ADD CONSTRAINT "CarService_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "RaceEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarService" ADD CONSTRAINT "CarService_performedById_fkey" FOREIGN KEY ("performedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarService" ADD CONSTRAINT "CarService_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PitStopPlan" ADD CONSTRAINT "PitStopPlan_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "EventRegistration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PitStopPlan" ADD CONSTRAINT "PitStopPlan_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "EventSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PitStopPlan" ADD CONSTRAINT "PitStopPlan_driverInId_fkey" FOREIGN KEY ("driverInId") REFERENCES "RegistrationDriver"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PitStopPlan" ADD CONSTRAINT "PitStopPlan_driverOutId_fkey" FOREIGN KEY ("driverOutId") REFERENCES "RegistrationDriver"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PitStopPlan" ADD CONSTRAINT "PitStopPlan_tireSetId_fkey" FOREIGN KEY ("tireSetId") REFERENCES "TireSet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PitStopPlan" ADD CONSTRAINT "PitStopPlan_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatChannel" ADD CONSTRAINT "ChatChannel_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatChannel" ADD CONSTRAINT "ChatChannel_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "RaceEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatChannel" ADD CONSTRAINT "ChatChannel_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "Series"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatChannel" ADD CONSTRAINT "ChatChannel_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatChannel" ADD CONSTRAINT "ChatChannel_staffRoleId_fkey" FOREIGN KEY ("staffRoleId") REFERENCES "StaffRole"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatChannel" ADD CONSTRAINT "ChatChannel_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DirectThread" ADD CONSTRAINT "DirectThread_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DirectParticipant" ADD CONSTRAINT "DirectParticipant_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "DirectThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DirectParticipant" ADD CONSTRAINT "DirectParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Structural rules Prisma cannot express
-- ---------------------------------------------------------------------------

-- A chat message still belongs to exactly one room, but there are now four
-- kinds of room rather than two. Replacing the constraint rather than adding a
-- second one: two overlapping CHECKs on the same columns are a puzzle to read
-- when one of them fails at 3am on a Saturday.
ALTER TABLE "ChatMessage" DROP CONSTRAINT IF EXISTS "ChatMessage_exactly_one_scope";
ALTER TABLE "ChatMessage"
ADD CONSTRAINT "ChatMessage_exactly_one_scope"
CHECK (
  (("eventId"   IS NOT NULL)::int
 + ("teamId"    IS NOT NULL)::int
 + ("channelId" IS NOT NULL)::int
 + ("threadId"  IS NOT NULL)::int) = 1
);

-- A channel hangs off exactly one thing. Without this, a row with both a
-- teamId and an eventId would be readable by two different access rules, and
-- whichever ran first would decide who got in.
ALTER TABLE "ChatChannel"
ADD CONSTRAINT "ChatChannel_exactly_one_scope"
CHECK (
  (("teamId"         IS NOT NULL)::int
 + ("eventId"        IS NOT NULL)::int
 + ("seriesId"       IS NOT NULL)::int
 + ("organizationId" IS NOT NULL)::int) = 1
);

-- An open channel is open to its whole scope, so carrying a role filter would
-- be a contradiction that reads as a permission. A department channel must
-- name at least one role, or it is a private room nobody can enter.
ALTER TABLE "ChatChannel"
ADD CONSTRAINT "ChatChannel_department_has_audience"
CHECK (
  CASE WHEN "kind" = 'OPEN'
    THEN cardinality("teamRoles") = 0
     AND cardinality("seriesRoles") = 0
     AND cardinality("orgRoles") = 0
     AND "staffRoleId" IS NULL
    ELSE cardinality("teamRoles") > 0
      OR cardinality("seriesRoles") > 0
      OR cardinality("orgRoles") > 0
      OR "staffRoleId" IS NOT NULL
  END
);

-- Stock never goes negative. A movement that would take it below zero is a
-- mistake somebody should see at the point of entry, not a balance that has
-- to be reconciled later.
ALTER TABLE "InventoryItem"
ADD CONSTRAINT "InventoryItem_quantity_not_negative"
CHECK ("quantity" >= 0);

ALTER TABLE "InventoryMovement"
ADD CONSTRAINT "InventoryMovement_balance_not_negative"
CHECK ("balance" >= 0);

-- A movement that changes nothing is not a movement.
ALTER TABLE "InventoryMovement"
ADD CONSTRAINT "InventoryMovement_delta_not_zero"
CHECK ("delta" <> 0);

-- Stops are numbered from one, so a plan reads the way a pit board does.
ALTER TABLE "PitStopPlan"
ADD CONSTRAINT "PitStopPlan_sequence_positive"
CHECK ("sequence" >= 1);
