-- CreateEnum
CREATE TYPE "SeriesRuleKind" AS ENUM ('ELIGIBILITY', 'SAFETY', 'DRIVERS', 'FORMAT', 'SCORING', 'CONDUCT', 'ENTRY', 'OTHER');

-- AlterTable
ALTER TABLE "Series" ADD COLUMN     "isReference" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sourceUrl" TEXT;

-- CreateTable
CREATE TABLE "SeriesRule" (
    "id" TEXT NOT NULL,
    "seriesId" TEXT NOT NULL,
    "kind" "SeriesRuleKind" NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "citation" TEXT,
    "sourceUrl" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "verifiedOn" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeriesRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SeriesRule_seriesId_kind_sortOrder_idx" ON "SeriesRule"("seriesId", "kind", "sortOrder");

-- AddForeignKey
ALTER TABLE "SeriesRule" ADD CONSTRAINT "SeriesRule_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "Series"("id") ON DELETE CASCADE ON UPDATE CASCADE;

