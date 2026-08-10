-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'VOID');

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "number" INTEGER,
    "customerName" TEXT NOT NULL,
    "customerContact" TEXT,
    "customerEmail" TEXT,
    "customerAddress" TEXT,
    "customerRef" TEXT,
    "issuedOn" TIMESTAMP(3),
    "dueOn" TIMESTAMP(3),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "taxRateBasisPoints" INTEGER NOT NULL DEFAULT 0,
    "taxLabel" TEXT,
    "taxRegistration" TEXT,
    "terms" TEXT,
    "notes" TEXT,
    "carId" TEXT,
    "eventId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLine" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "unitMinor" INTEGER NOT NULL DEFAULT 0,
    "amountMinor" INTEGER NOT NULL DEFAULT 0,
    "taxable" BOOLEAN NOT NULL DEFAULT true,
    "unit" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "serviceId" TEXT,
    "inventoryItemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoicePayment" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "receivedOn" TIMESTAMP(3) NOT NULL,
    "method" TEXT,
    "reference" TEXT,
    "note" TEXT,
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoicePayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Invoice_teamId_status_issuedOn_idx" ON "Invoice"("teamId", "status", "issuedOn");

-- CreateIndex
CREATE INDEX "Invoice_carId_idx" ON "Invoice"("carId");

-- CreateIndex
CREATE INDEX "Invoice_eventId_idx" ON "Invoice"("eventId");

-- CreateIndex
CREATE INDEX "Invoice_createdById_idx" ON "Invoice"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_teamId_number_key" ON "Invoice"("teamId", "number");

-- CreateIndex
CREATE INDEX "InvoiceLine_invoiceId_sortOrder_idx" ON "InvoiceLine"("invoiceId", "sortOrder");

-- CreateIndex
CREATE INDEX "InvoiceLine_serviceId_idx" ON "InvoiceLine"("serviceId");

-- CreateIndex
CREATE INDEX "InvoiceLine_inventoryItemId_idx" ON "InvoiceLine"("inventoryItemId");

-- CreateIndex
CREATE INDEX "InvoicePayment_invoiceId_receivedOn_idx" ON "InvoicePayment"("invoiceId", "receivedOn");

-- CreateIndex
CREATE INDEX "InvoicePayment_recordedById_idx" ON "InvoicePayment"("recordedById");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_carId_fkey" FOREIGN KEY ("carId") REFERENCES "Car"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "RaceEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "CarService"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoicePayment" ADD CONSTRAINT "InvoicePayment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoicePayment" ADD CONSTRAINT "InvoicePayment_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- A draft carries no number; anything past draft carries one and a date.
--
-- The two halves matter for different reasons. A numbered draft would put a
-- number into circulation that might never be issued, leaving a hole in the
-- sequence. An issued invoice with no number or no date is not an invoice —
-- it is a document a customer cannot pay against and an auditor cannot trace.
ALTER TABLE "Invoice"
  ADD CONSTRAINT "Invoice_numbered_when_issued"
  CHECK (
    ("status" = 'DRAFT' AND "number" IS NULL AND "issuedOn" IS NULL)
    OR ("status" <> 'DRAFT' AND "number" IS NOT NULL AND "issuedOn" IS NOT NULL)
  );

-- Invoice numbers start at one and go up.
--
-- Zero and negatives are not numbering mistakes anybody makes by hand, but
-- they are exactly what an off-by-one in the assignment would produce, and the
-- unique index alone would happily accept them.
ALTER TABLE "Invoice"
  ADD CONSTRAINT "Invoice_number_is_positive"
  CHECK ("number" IS NULL OR "number" > 0);

-- Tax is a rate, not an arbitrary integer.
--
-- Capped at 100% rather than left open: a typo of 200 for 2000 basis points
-- undercharges quietly, but 2000000 produces a total nobody would ever send,
-- and the row is the last place to catch it.
ALTER TABLE "Invoice"
  ADD CONSTRAINT "Invoice_tax_rate_in_range"
  CHECK ("taxRateBasisPoints" >= 0 AND "taxRateBasisPoints" <= 10000);

-- A payment moves money. Zero does not, and negative is a credit note.
--
-- A zero-value payment row would read as "they paid" everywhere while
-- settling nothing, which is worse than no row at all. A refund is a credit
-- note against a new invoice, not a negative payment against a paid one —
-- otherwise the invoice's own total stops matching the document that was sent.
ALTER TABLE "InvoicePayment"
  ADD CONSTRAINT "InvoicePayment_amount_is_positive"
  CHECK ("amountMinor" > 0);

-- A line counts something.
--
-- Negative quantities are how a discount gets typed in by accident; a discount
-- is a negative *rate* on a positive quantity, which prints as a line the
-- customer can read rather than as "-1 x labour".
ALTER TABLE "InvoiceLine"
  ADD CONSTRAINT "InvoiceLine_quantity_is_positive"
  CHECK ("quantity" > 0);
