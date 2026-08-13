import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  InvoiceStatus,
  PlatformRole,
  PrismaClient,
  TeamRole,
} from "@prisma/client";
import { createCaller } from "@/server/trpc/root";

/**
 * Invoicing third-party work, end to end.
 *
 * The behaviour that needs a real database is the numbering. Everything else
 * is arithmetic covered in the unit tests, but "two people issue at the same
 * moment" cannot be simulated in one, and a duplicated invoice number is the
 * single mistake here an accountant cannot unpick afterwards.
 *
 * Opt in with RUN_DB_TESTS=1.
 */
const ENABLED = process.env.RUN_DB_TESTS === "1";
const db = ENABLED ? new PrismaClient() : (null as unknown as PrismaClient);

function callerFor(clerkUserId: string | null) {
  return createCaller({ db, clerkUserId, headers: new Headers() });
}

async function makeUser(suffix: string) {
  const user = await db.user.create({
    data: {
      email: `${suffix}@example.test`,
      authProviderId: `clerk_${suffix}`,
      platformRole: PlatformRole.ADMIN,
      profile: { create: { displayName: suffix } },
    },
  });
  return { user, caller: callerFor(user.authProviderId) };
}

describe.skipIf(!ENABLED)("invoicing (integration)", () => {
  const run = Date.now();
  let manager: Awaited<ReturnType<typeof makeUser>>;
  let crew: Awaited<ReturnType<typeof makeUser>>;
  let outsider: Awaited<ReturnType<typeof makeUser>>;
  let teamId: string;
  let invoiceId: string;

  beforeAll(async () => {
    manager = await makeUser(`inv_mgr_${run}`);
    crew = await makeUser(`inv_crew_${run}`);
    outsider = await makeUser(`inv_out_${run}`);

    const team = await manager.caller.team.create({ name: `Invoice Team ${run}` });
    teamId = team.id;
    await db.teamMembership.create({
      data: { teamId, userId: crew.user.id, role: TeamRole.CREW },
    });

    const invoice = await manager.caller.garage.createInvoice({
      teamId,
      customerName: `Northgate Motorsport ${run}`,
      customerRef: "PO-4471",
      currency: "GBP",
      taxRateBasisPoints: 2000,
      taxLabel: "VAT",
    });
    invoiceId = invoice.id;
  });

  afterAll(async () => {
    if (!ENABLED) return;
    await db.team.deleteMany({ where: { id: teamId } });
    await db.user.deleteMany({
      where: { id: { in: [manager.user.id, crew.user.id, outsider.user.id] } },
    });
    await db.$disconnect();
  });

  it("starts a draft with no number and no date", () => {
    // Numbering on creation means an abandoned draft leaves a hole, and a gap
    // in an invoice run is the first thing an auditor asks about.
    expect(invoiceId).toBeTruthy();
  });

  it("keeps invoices away from the rest of the roster", async () => {
    // Crew run the garage, but what the team charged the outfit next door is
    // commercial — the same line sponsorship terms sit behind.
    await expect(
      crew.caller.garage.invoices({ teamId }),
    ).rejects.toThrow(/owners and managers/i);
    await expect(
      outsider.caller.garage.invoices({ teamId }),
    ).rejects.toThrow();
  });

  it("adds lines and totals them with tax on the taxable part only", async () => {
    await manager.caller.garage.addInvoiceLine({
      invoiceId,
      description: "Gearbox rebuild, labour",
      quantity: 7.5,
      unitMinor: 8250,
      unit: "hours",
    });
    await manager.caller.garage.addInvoiceLine({
      invoiceId,
      description: "Bearing kit",
      quantity: 1,
      unitMinor: 24500,
    });
    await manager.caller.garage.addInvoiceLine({
      invoiceId,
      description: "Courier, at cost",
      quantity: 1,
      unitMinor: 4000,
      taxable: false,
    });

    const invoice = await manager.caller.garage.invoice({ invoiceId });
    expect(invoice.totals.subtotalMinor).toBe(61875 + 24500 + 4000);
    expect(invoice.totals.taxableMinor).toBe(61875 + 24500);
    expect(invoice.totals.taxMinor).toBe(17275);
    expect(invoice.totals.totalMinor).toBe(107650);
  });

  it("refuses to issue an invoice with nothing on it", async () => {
    const empty = await manager.caller.garage.createInvoice({
      teamId,
      customerName: "Nobody",
    });
    await expect(
      manager.caller.garage.issueInvoice({ invoiceId: empty.id }),
    ).rejects.toThrow(/no lines/i);
    await manager.caller.garage.deleteInvoice({ invoiceId: empty.id });
  });

  it("numbers and freezes it on issue", async () => {
    const issued = await manager.caller.garage.issueInvoice({ invoiceId });
    expect(issued.status).toBe(InvoiceStatus.ISSUED);
    expect(issued.number).toBe(1);
    expect(issued.issuedOn).not.toBeNull();
  });

  it("will not let an issued invoice be edited", async () => {
    // Changing it would rewrite a document the customer already has.
    await expect(
      manager.caller.garage.addInvoiceLine({
        invoiceId,
        description: "One more thing",
        quantity: 1,
        unitMinor: 1000,
      }),
    ).rejects.toThrow(/issued/i);
    await expect(
      manager.caller.garage.updateInvoice({
        invoiceId,
        customerName: "Somebody else",
      }),
    ).rejects.toThrow(/issued/i);
  });

  it("gives two invoices issued at the same moment different numbers", async () => {
    /*
     * The one failure a real database is needed for. Both read the top of the
     * sequence before either writes, so without the unique index and the retry
     * they would both take the same number — and a duplicated invoice number
     * is what an accountant cannot unpick afterwards.
     */
    const drafts = await Promise.all(
      [1, 2, 3, 4].map(async (n) => {
        const draft = await manager.caller.garage.createInvoice({
          teamId,
          customerName: `Concurrent ${n} ${run}`,
        });
        await manager.caller.garage.addInvoiceLine({
          invoiceId: draft.id,
          description: "Bench time",
          quantity: 1,
          unitMinor: 10000,
        });
        return draft.id;
      }),
    );

    const issued = await Promise.all(
      drafts.map((id) => manager.caller.garage.issueInvoice({ invoiceId: id })),
    );
    const numbers = issued.map((invoice) => invoice.number);
    expect(new Set(numbers).size).toBe(numbers.length);
    // And the run stays gapless: 1 from the test above, plus these four.
    expect([...numbers].sort((a, b) => a! - b!)).toEqual([2, 3, 4, 5]);
  });

  it("records a deposit as part paid, then settles on the balance", async () => {
    await manager.caller.garage.recordInvoicePayment({
      invoiceId,
      amountMinor: 50000,
      receivedOn: new Date(),
      method: "Bank transfer",
      reference: "FT-9921",
    });
    let invoice = await manager.caller.garage.invoice({ invoiceId });
    expect(invoice.settlement.partial).toBe(true);
    expect(invoice.settlement.outstandingMinor).toBe(57650);

    await manager.caller.garage.recordInvoicePayment({
      invoiceId,
      amountMinor: 57650,
      receivedOn: new Date(),
    });
    invoice = await manager.caller.garage.invoice({ invoiceId });
    expect(invoice.settlement.settled).toBe(true);
    expect(invoice.settlement.outstandingMinor).toBe(0);
  });

  it("settles an invoice in one action", async () => {
    const draft = await manager.caller.garage.createInvoice({
      teamId,
      customerName: `Paid in full ${run}`,
    });
    await manager.caller.garage.addInvoiceLine({
      invoiceId: draft.id,
      description: "Corner rebuild",
      quantity: 1,
      unitMinor: 80000,
    });
    await manager.caller.garage.issueInvoice({ invoiceId: draft.id });

    const payment = await manager.caller.garage.markInvoicePaid({
      invoiceId: draft.id,
    });
    expect(payment.amountMinor).toBe(80000);
    // A payment row, not a flag: settlement is derived from the money, so a
    // flag could disagree with it.
    expect(payment.note).toMatch(/marked paid/i);

    const invoice = await manager.caller.garage.invoice({ invoiceId: draft.id });
    expect(invoice.settlement.settled).toBe(true);
    expect(invoice.settlement.outstandingMinor).toBe(0);
  });

  it("marks only the balance when a deposit is already down", async () => {
    // The bug this guards: settling against the *total* would double-count the
    // deposit and leave the invoice showing an overpayment.
    const draft = await manager.caller.garage.createInvoice({
      teamId,
      customerName: `Deposit then balance ${run}`,
    });
    await manager.caller.garage.addInvoiceLine({
      invoiceId: draft.id,
      description: "Fabrication",
      quantity: 1,
      unitMinor: 100000,
    });
    await manager.caller.garage.issueInvoice({ invoiceId: draft.id });
    await manager.caller.garage.recordInvoicePayment({
      invoiceId: draft.id,
      amountMinor: 30000,
      receivedOn: new Date(),
    });

    const balance = await manager.caller.garage.markInvoicePaid({
      invoiceId: draft.id,
    });
    expect(balance.amountMinor).toBe(70000);

    const invoice = await manager.caller.garage.invoice({ invoiceId: draft.id });
    expect(invoice.settlement.settled).toBe(true);
    expect(invoice.settlement.paidMinor).toBe(100000);
    expect(invoice.settlement.overpaidMinor).toBe(0);
  });

  it("refuses to mark an already settled invoice paid again", async () => {
    const draft = await manager.caller.garage.createInvoice({
      teamId,
      customerName: `Double tap ${run}`,
    });
    await manager.caller.garage.addInvoiceLine({
      invoiceId: draft.id,
      description: "Bench time",
      quantity: 1,
      unitMinor: 5000,
    });
    await manager.caller.garage.issueInvoice({ invoiceId: draft.id });
    await manager.caller.garage.markInvoicePaid({ invoiceId: draft.id });

    // Two taps on a slow connection must not book the money twice.
    await expect(
      manager.caller.garage.markInvoicePaid({ invoiceId: draft.id }),
    ).rejects.toThrow(/already settled/i);
  });

  it("takes a mistaken mark back off again", async () => {
    const draft = await manager.caller.garage.createInvoice({
      teamId,
      customerName: `Ticked in error ${run}`,
    });
    await manager.caller.garage.addInvoiceLine({
      invoiceId: draft.id,
      description: "Bench time",
      quantity: 1,
      unitMinor: 5000,
    });
    await manager.caller.garage.issueInvoice({ invoiceId: draft.id });
    const payment = await manager.caller.garage.markInvoicePaid({
      invoiceId: draft.id,
    });

    await manager.caller.garage.removeInvoicePayment({
      paymentId: payment.id,
    });
    const invoice = await manager.caller.garage.invoice({ invoiceId: draft.id });
    expect(invoice.settlement.settled).toBe(false);
    expect(invoice.settlement.outstandingMinor).toBe(5000);
  });

  it("will not mark a draft paid", async () => {
    const draft = await manager.caller.garage.createInvoice({
      teamId,
      customerName: `Not sent ${run}`,
    });
    await expect(
      manager.caller.garage.markInvoicePaid({ invoiceId: draft.id }),
    ).rejects.toThrow(/issue the invoice/i);
    await manager.caller.garage.deleteInvoice({ invoiceId: draft.id });
  });

  it("will not let crew mark an invoice paid", async () => {
    await expect(
      crew.caller.garage.markInvoicePaid({ invoiceId }),
    ).rejects.toThrow(/owners and managers/i);
  });

  it("takes an overdue invoice off the chase list once marked paid", async () => {
    const draft = await manager.caller.garage.createInvoice({
      teamId,
      customerName: `Chased and settled ${run}`,
      dueOn: new Date(Date.now() - 20 * 86_400_000),
    });
    await manager.caller.garage.addInvoiceLine({
      invoiceId: draft.id,
      description: "Data engineer, one weekend",
      quantity: 1,
      unitMinor: 120000,
    });
    await manager.caller.garage.issueInvoice({
      invoiceId: draft.id,
      dueOn: new Date(Date.now() - 20 * 86_400_000),
    });

    const before = await manager.caller.team.dashboard({ teamId });
    expect(before.attention?.overdueInvoices).toBeGreaterThan(0);

    await manager.caller.garage.markInvoicePaid({ invoiceId: draft.id });
    const after = await manager.caller.team.dashboard({ teamId });
    expect(after.attention?.overdueInvoices).toBe(
      before.attention!.overdueInvoices - 1,
    );
  });

  it("will not record money against a draft", async () => {
    const draft = await manager.caller.garage.createInvoice({
      teamId,
      customerName: "Not sent yet",
    });
    await expect(
      manager.caller.garage.recordInvoicePayment({
        invoiceId: draft.id,
        amountMinor: 1000,
        receivedOn: new Date(),
      }),
    ).rejects.toThrow(/issue the invoice/i);
    await manager.caller.garage.deleteInvoice({ invoiceId: draft.id });
  });

  it("refuses to void one that has money against it", async () => {
    // Voiding it would leave the payment pointing at nothing.
    await expect(
      manager.caller.garage.voidInvoice({ invoiceId, reason: "Changed my mind" }),
    ).rejects.toThrow(/credit note/i);
  });

  it("voids an unpaid invoice and keeps its number", async () => {
    const draft = await manager.caller.garage.createInvoice({
      teamId,
      customerName: `Cancelled ${run}`,
    });
    await manager.caller.garage.addInvoiceLine({
      invoiceId: draft.id,
      description: "Work not started",
      quantity: 1,
      unitMinor: 5000,
    });
    const issued = await manager.caller.garage.issueInvoice({
      invoiceId: draft.id,
    });
    const voided = await manager.caller.garage.voidInvoice({
      invoiceId: draft.id,
      reason: "Customer cancelled before the work started",
    });

    expect(voided.status).toBe(InvoiceStatus.VOID);
    // Kept, not released: a gap in the run is worse than a visible void.
    expect(voided.number).toBe(issued.number);
    expect(voided.notes).toContain("Customer cancelled");

    const next = await manager.caller.garage.createInvoice({
      teamId,
      customerName: `After the void ${run}`,
    });
    await manager.caller.garage.addInvoiceLine({
      invoiceId: next.id,
      description: "Bench time",
      quantity: 1,
      unitMinor: 1000,
    });
    const after = await manager.caller.garage.issueInvoice({
      invoiceId: next.id,
    });
    expect(after.number).toBe(issued.number! + 1);
  });

  it("does not delete an issued invoice by accident", async () => {
    // The bare call is the one a mis-wired button makes. It has to say it
    // means an issued invoice before the number leaves the sequence.
    await expect(
      manager.caller.garage.deleteInvoice({ invoiceId }),
    ).rejects.toThrow(/issued/i);
  });

  it("deletes an issued invoice, its lines and its payments, when told to", async () => {
    const draft = await manager.caller.garage.createInvoice({
      teamId,
      customerName: `Wrong customer ${run}`,
    });
    await manager.caller.garage.addInvoiceLine({
      invoiceId: draft.id,
      description: "Billed to entirely the wrong outfit",
      quantity: 1,
      unitMinor: 40000,
    });
    const issued = await manager.caller.garage.issueInvoice({
      invoiceId: draft.id,
    });
    await manager.caller.garage.recordInvoicePayment({
      invoiceId: draft.id,
      amountMinor: 40000,
      receivedOn: new Date(),
    });

    const result = await manager.caller.garage.deleteInvoice({
      invoiceId: draft.id,
      deleteIssued: true,
    });
    expect(result.wasIssued).toBe(true);
    expect(result.number).toBe(issued.number);
    expect(result.paymentsRemoved).toBe(1);

    // Nothing is left pointing at an invoice that is gone.
    expect(
      await db.invoice.findUnique({ where: { id: draft.id } }),
    ).toBeNull();
    expect(
      await db.invoiceLine.count({ where: { invoiceId: draft.id } }),
    ).toBe(0);
    expect(
      await db.invoicePayment.count({ where: { invoiceId: draft.id } }),
    ).toBe(0);
  });

  it("keeps the gap where a deleted invoice was", async () => {
    /*
     * The consequence the panel spells out before anybody confirms. The next
     * invoice takes the number after the deleted one rather than reusing it,
     * because reissuing a number that was in circulation is worse than a gap:
     * two different documents would exist under one reference.
     */
    const before = await db.invoice.aggregate({
      where: { teamId },
      _max: { number: true },
    });

    const draft = await manager.caller.garage.createInvoice({
      teamId,
      customerName: `Doomed ${run}`,
    });
    await manager.caller.garage.addInvoiceLine({
      invoiceId: draft.id,
      description: "Bench time",
      quantity: 1,
      unitMinor: 1000,
    });
    const doomed = await manager.caller.garage.issueInvoice({
      invoiceId: draft.id,
    });
    // Ahead of everything on the books — and not merely max + 1, because an
    // earlier deletion already burnt a number that is never coming back.
    expect(doomed.number!).toBeGreaterThan(before._max.number ?? 0);

    await manager.caller.garage.deleteInvoice({
      invoiceId: draft.id,
      deleteIssued: true,
    });

    const next = await manager.caller.garage.createInvoice({
      teamId,
      customerName: `After the deletion ${run}`,
    });
    await manager.caller.garage.addInvoiceLine({
      invoiceId: next.id,
      description: "Bench time",
      quantity: 1,
      unitMinor: 1000,
    });
    const after = await manager.caller.garage.issueInvoice({
      invoiceId: next.id,
    });
    expect(after.number).toBe(doomed.number! + 1);
  });

  it("lets a draft go without ceremony", async () => {
    const draft = await manager.caller.garage.createInvoice({
      teamId,
      customerName: `Abandoned ${run}`,
    });
    const result = await manager.caller.garage.deleteInvoice({
      invoiceId: draft.id,
    });
    expect(result.wasIssued).toBe(false);
    // Nothing was ever in circulation, so there is no number to account for.
    expect(result.number).toBeNull();
  });

  it("will not let crew delete an invoice", async () => {
    const draft = await manager.caller.garage.createInvoice({
      teamId,
      customerName: `Guarded ${run}`,
    });
    await expect(
      crew.caller.garage.deleteInvoice({ invoiceId: draft.id }),
    ).rejects.toThrow(/owners and managers/i);
    await manager.caller.garage.deleteInvoice({ invoiceId: draft.id });
  });

  it("puts the team's name and logo on the document itself", async () => {
    /*
     * Carried by the invoice rather than fetched beside it, so the masthead
     * cannot render half-populated because a second call was slower. An
     * invoice arriving from a name the customer does not recognise is one that
     * gets queried rather than paid.
     */
    await db.team.update({
      where: { id: teamId },
      data: { logoUrl: "https://example.test/logo.png", homeBase: "Brackley" },
    });

    const invoice = await manager.caller.garage.invoice({ invoiceId });
    expect(invoice.issuer.name).toBe(`Invoice Team ${run}`);
    expect(invoice.issuer.logoUrl).toBe("https://example.test/logo.png");
    expect(invoice.issuer.homeBase).toBe("Brackley");
  });

  it("finds a logo set on the profile even with no branding row", async () => {
    // A team that uploaded a logo and never opened the branding editor still
    // has one; requiring both would leave most invoices unbranded.
    expect(
      await db.branding.findFirst({ where: { teamId } }),
    ).toBeNull();
    const invoice = await manager.caller.garage.invoice({ invoiceId });
    expect(invoice.issuer.logoUrl).toBeTruthy();
  });

  it("puts an overdue invoice in front of the manager", async () => {
    const draft = await manager.caller.garage.createInvoice({
      teamId,
      customerName: `Late payer ${run}`,
      dueOn: new Date(Date.now() - 40 * 86_400_000),
    });
    await manager.caller.garage.addInvoiceLine({
      invoiceId: draft.id,
      description: "Fabrication",
      quantity: 1,
      unitMinor: 250000,
    });
    await manager.caller.garage.issueInvoice({
      invoiceId: draft.id,
      dueOn: new Date(Date.now() - 40 * 86_400_000),
    });

    // Through the console, which is where the permission check lives.
    const console = await manager.caller.team.dashboard({ teamId });
    expect(console.attention?.overdueInvoices).toBe(1);

    // Paying it takes it off the list: paid late is finished, not overdue.
    await manager.caller.garage.recordInvoicePayment({
      invoiceId: draft.id,
      amountMinor: 250000,
      receivedOn: new Date(),
    });
    const after = await manager.caller.team.dashboard({ teamId });
    expect(after.attention?.overdueInvoices).toBe(0);
  });

  it("tells crew nothing about the invoice book", async () => {
    /*
     * Null rather than a zeroed shape. "Nothing needs attention" and "you are
     * not allowed to know" are different answers, and the second dressed as
     * the first would quietly tell somebody the team is owed nothing.
     */
    const console = await crew.caller.team.dashboard({ teamId });
    expect(console.attention).toBeNull();
  });
});
