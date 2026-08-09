-- CreateEnum
CREATE TYPE "InventoryUnitStatus" AS ENUM ('IN_STOCK', 'OUT', 'RETIRED');

-- AlterTable
ALTER TABLE "InventoryItem" ADD COLUMN     "qrToken" TEXT,
ADD COLUMN     "trackUnits" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "InventoryMovement" ADD COLUMN     "reversedById" TEXT,
ADD COLUMN     "scannedAt" TIMESTAMP(3),
ADD COLUMN     "unitId" TEXT;

-- CreateTable
CREATE TABLE "InventoryUnit" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "status" "InventoryUnitStatus" NOT NULL DEFAULT 'IN_STOCK',
    "qrToken" TEXT NOT NULL,
    "serial" TEXT,
    "expiresOn" TIMESTAMP(3),
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryUnit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InventoryUnit_qrToken_key" ON "InventoryUnit"("qrToken");

-- CreateIndex
CREATE INDEX "InventoryUnit_itemId_status_idx" ON "InventoryUnit"("itemId", "status");

-- CreateIndex
CREATE INDEX "InventoryUnit_createdById_idx" ON "InventoryUnit"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItem_qrToken_key" ON "InventoryItem"("qrToken");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryMovement_reversedById_key" ON "InventoryMovement"("reversedById");

-- CreateIndex
CREATE INDEX "InventoryMovement_unitId_idx" ON "InventoryMovement"("unitId");

-- AddForeignKey
ALTER TABLE "InventoryUnit" ADD CONSTRAINT "InventoryUnit_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryUnit" ADD CONSTRAINT "InventoryUnit_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "InventoryUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_reversedById_fkey" FOREIGN KEY ("reversedById") REFERENCES "InventoryMovement"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- A unit scan moves exactly one thing.
--
-- The whole point of a per-part label is that scanning it *is* the quantity:
-- there is no keypad, so there is no way to mean "three". A movement carrying
-- a unit and a delta of 4 would be a bug in the scan path that nothing else
-- would catch, and it would silently put the line's count out of step with the
-- units behind it.
ALTER TABLE "InventoryMovement"
  ADD CONSTRAINT "InventoryMovement_unit_moves_one"
  CHECK ("unitId" IS NULL OR "delta" IN (-1, 1));

-- Nothing reverses itself.
--
-- Cheap to write and impossible to reason about afterwards: a row pointing at
-- its own id reads as "already undone" everywhere, which would quietly make a
-- movement permanently un-undoable rather than raising anything.
ALTER TABLE "InventoryMovement"
  ADD CONSTRAINT "InventoryMovement_reversal_is_another_row"
  CHECK ("reversedById" IS NULL OR "reversedById" <> "id");

-- A serial is either something or absent, never blank.
--
-- An empty string reads as "this part has a serial" everywhere it is shown and
-- then prints nothing on the label, which is worse than the honest null: it
-- sends somebody to the shelf looking for a marking that was never there.
ALTER TABLE "InventoryUnit"
  ADD CONSTRAINT "InventoryUnit_serial_not_blank"
  CHECK ("serial" IS NULL OR length(btrim("serial")) > 0);

-- No backfill of "InventoryItem"."qrToken" on purpose.
--
-- Every existing stock line needs a token before it can carry a label, but
-- minting them here would mean generating them in SQL, and Postgres' random()
-- is not a CSPRNG — a token somebody could predict from a neighbouring one
-- would let anybody who saw one label walk the team's whole parts list. The
-- application mints them from crypto randomness the first time a line is
-- labelled instead, which costs one update on a path that is already writing.
