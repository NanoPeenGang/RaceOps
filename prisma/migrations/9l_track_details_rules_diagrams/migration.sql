-- CreateEnum
CREATE TYPE "TrackRuleKind" AS ENUM ('SOUND', 'CURFEW', 'LICENCE', 'SAFETY', 'PADDOCK', 'ENVIRONMENTAL', 'ACCESS', 'OTHER');

-- CreateEnum
CREATE TYPE "LayoutShape" AS ENUM ('OVAL', 'TRI_OVAL', 'QUAD_OVAL', 'PAPERCLIP', 'D_SHAPE', 'TRIANGLE', 'RECTANGLE');

-- AlterTable
ALTER TABLE "Track" ADD COLUMN     "addressLine" TEXT,
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION,
ADD COLUMN     "postalCode" TEXT;

-- AlterTable
ALTER TABLE "TrackLayout" ADD COLUMN     "bankingDegrees" INTEGER,
ADD COLUMN     "diagramCredit" TEXT,
ADD COLUMN     "diagramUrl" TEXT,
ADD COLUMN     "shape" "LayoutShape",
ADD COLUMN     "turnCount" INTEGER;

-- CreateTable
CREATE TABLE "TrackRule" (
    "id" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "kind" "TrackRuleKind" NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "source" TEXT,
    "sourceUrl" TEXT,
    "verifiedOn" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrackRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrackRule_trackId_kind_idx" ON "TrackRule"("trackId", "kind");

-- AddForeignKey
ALTER TABLE "TrackRule" ADD CONSTRAINT "TrackRule_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;

