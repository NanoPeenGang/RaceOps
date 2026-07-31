-- Track photographs: a gallery per venue, replacing the single diagram slot.
--
-- The statement order here is deliberate and differs from what `migrate diff`
-- generates. The generated version drops TrackLayout.diagramUrl before the new
-- table exists, which would silently discard any map already uploaded on a
-- deployment running the previous release. The table is created first, the
-- existing diagrams are copied into it, and only then are the old columns
-- dropped.

-- CreateEnum
CREATE TYPE "TrackImageKind" AS ENUM ('MAP', 'AERIAL', 'PADDOCK', 'PHOTO');

-- CreateTable
CREATE TABLE "TrackImage" (
    "id" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "layoutId" TEXT,
    "kind" "TrackImageKind" NOT NULL DEFAULT 'MAP',
    "url" TEXT NOT NULL,
    "caption" TEXT,
    "credit" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrackImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrackImage_trackId_position_idx" ON "TrackImage"("trackId", "position");

-- CreateIndex
CREATE INDEX "TrackImage_layoutId_position_idx" ON "TrackImage"("layoutId", "position");

-- AddForeignKey
ALTER TABLE "TrackImage" ADD CONSTRAINT "TrackImage_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackImage" ADD CONSTRAINT "TrackImage_layoutId_fkey" FOREIGN KEY ("layoutId") REFERENCES "TrackLayout"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackImage" ADD CONSTRAINT "TrackImage_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Carry across any diagram uploaded under the single-slot model. cuid() is not
-- available in SQL, so the id is composed from the layout's — unique by
-- construction, since a layout had at most one diagram.
INSERT INTO "TrackImage" ("id", "trackId", "layoutId", "kind", "url", "credit", "position", "createdAt", "updatedAt")
SELECT
    'img_' || "id",
    "trackId",
    "id",
    'MAP',
    "diagramUrl",
    "diagramCredit",
    0,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "TrackLayout"
WHERE "diagramUrl" IS NOT NULL;

-- AlterTable
ALTER TABLE "TrackLayout" DROP COLUMN "diagramCredit",
DROP COLUMN "diagramUrl";
