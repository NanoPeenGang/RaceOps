-- AlterTable
ALTER TABLE "Track" ADD COLUMN     "isReference" BOOLEAN NOT NULL DEFAULT false;


-- Reference tracks are canonical data with no owner. Anything with a creator
-- is a community track and keeps the creator-curates rule.
ALTER TABLE "Track"
ADD CONSTRAINT "Track_reference_has_no_creator"
CHECK (NOT "isReference" OR "createdById" IS NULL);
