-- AlterTable
ALTER TABLE "Team" ADD COLUMN     "nextInvoiceNumber" INTEGER NOT NULL DEFAULT 1;


-- Start each team's counter above whatever it has already issued.
--
-- Without this, a team mid-season would restart at 1 and immediately clash
-- with its own invoices — the unique index would catch it, but only by making
-- every issue fail until somebody worked out why.
UPDATE "Team"
SET "nextInvoiceNumber" = COALESCE(
  (SELECT MAX("number") + 1 FROM "Invoice" WHERE "Invoice"."teamId" = "Team"."id"),
  1
);

-- The counter never goes backwards, and never below one.
--
-- The whole point of holding it separately from the invoices is that deleting
-- the highest-numbered invoice must not release its number for reuse. A
-- counter that could be set back would quietly reintroduce exactly that.
ALTER TABLE "Team"
  ADD CONSTRAINT "Team_next_invoice_number_is_positive"
  CHECK ("nextInvoiceNumber" >= 1);
