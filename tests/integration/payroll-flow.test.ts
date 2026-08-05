import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PayBasis,
  PayRunStatus,
  PrismaClient,
  TeamRole,
} from "@prisma/client";
import { createCaller } from "@/server/trpc/root";

/**
 * Payroll, end to end.
 *
 * The behaviours worth proving are the ones about money: an approved run's
 * figures cannot move, a paid line cannot be deleted, currencies are never
 * added together, and what everybody is paid is not readable by the whole
 * roster. Opt in with RUN_DB_TESTS=1.
 */
const ENABLED = process.env.RUN_DB_TESTS === "1";
const db = ENABLED ? new PrismaClient() : (null as unknown as PrismaClient);

function callerFor(clerkUserId: string) {
  return createCaller({ db, clerkUserId, headers: new Headers() });
}

describe.skipIf(!ENABLED)("payroll (integration)", () => {
  const run = Date.now();
  let teamId: string;
  let manager: ReturnType<typeof callerFor>;
  let crew: ReturnType<typeof callerFor>;
  let engineerId: string;
  let crewId: string;
  const userIds: string[] = [];

  async function makeUser(suffix: string, role: TeamRole | null) {
    const user = await db.user.create({
      data: {
        email: `${suffix}_${run}@example.test`,
        authProviderId: `clerk_${suffix}_${run}`,
        profile: { create: { displayName: suffix } },
      },
    });
    userIds.push(user.id);
    if (role) {
      await db.teamMembership.create({
        data: { teamId, userId: user.id, role },
      });
    }
    return { caller: callerFor(user.authProviderId), id: user.id };
  }

  beforeAll(async () => {
    if (!ENABLED) return;
    const team = await db.team.create({
      data: { name: `Payroll Test ${run}`, slug: `payroll-test-${run}` },
    });
    teamId = team.id;

    manager = (await makeUser("pmanager", TeamRole.OWNER)).caller;
    const crewMember = await makeUser("pcrewmember", TeamRole.CREW);
    crew = crewMember.caller;
    crewId = crewMember.id;
    engineerId = (await makeUser("pengineer", TeamRole.ENGINEER)).id;
  });

  afterAll(async () => {
    if (!ENABLED) return;
    await db.team.deleteMany({ where: { id: teamId } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.$disconnect();
  });

  it("keeps payroll away from the roster at large", async () => {
    // Unlike the garage, this is not about competence: what everybody is paid
    // is not something every member should be able to read.
    await expect(crew.payroll.runs({ teamId })).rejects.toThrow(
      /owner and managers/i,
    );
  });

  it("refuses a figure on an unpaid rate", async () => {
    await expect(
      manager.payroll.setRate({
        teamId,
        userId: crewId,
        basis: PayBasis.UNPAID,
        amountMinor: 5000,
      }),
    ).rejects.toThrow(/unpaid position carries no figure/i);
  });

  it("closes the old rate rather than editing it", async () => {
    // A pay run built in March has to keep making sense in December, and it
    // cannot if the rate behind it was quietly rewritten.
    await manager.payroll.setRate({
      teamId,
      userId: engineerId,
      basis: PayBasis.PER_EVENT,
      amountMinor: 20_000,
      effectiveFrom: new Date("2026-01-01"),
    });
    await manager.payroll.setRate({
      teamId,
      userId: engineerId,
      basis: PayBasis.PER_EVENT,
      amountMinor: 25_000,
      effectiveFrom: new Date("2026-07-01"),
    });

    const rates = await db.payRate.findMany({
      where: { teamId, userId: engineerId },
      orderBy: { effectiveFrom: "asc" },
    });
    expect(rates).toHaveLength(2);
    expect(rates[0]!.effectiveTo).not.toBeNull();
    expect(rates[1]!.effectiveTo).toBeNull();
  });

  it("shows the rate in force today on the roster view", async () => {
    const view = await manager.payroll.rates({ teamId });
    const engineer = view.members.find(
      (member) => member.userId === engineerId,
    )!;
    expect(engineer.rate?.amountMinor).toBe(25_000);

    // Somebody with no rate is listed with none rather than left out — they
    // are exactly who a manager is looking for.
    const crewRow = view.members.find((member) => member.userId === crewId)!;
    expect(crewRow.rate).toBeNull();
  });

  it("pre-fills a run from the standing rates, leaving volunteers off", async () => {
    const created = await manager.payroll.createRun({
      teamId,
      label: `August ${run}`,
      periodStart: new Date("2026-08-01"),
      periodEnd: new Date("2026-08-31"),
      prefillFromRates: true,
    });

    const detail = await manager.payroll.run({ payRunId: created.id });
    // The engineer has a rate; the crew member does not, so no zero-value row
    // burying the people actually owed money.
    expect(detail.run.lines).toHaveLength(1);
    expect(detail.run.lines[0]!.userId).toBe(engineerId);
    expect(detail.run.lines[0]!.rateMinor).toBe(25_000);
    expect(detail.run.lines[0]!.quantity).toBe(1);
  });

  it("refuses a period that ends before it starts", async () => {
    await expect(
      manager.payroll.createRun({
        teamId,
        label: "Backwards",
        periodStart: new Date("2026-09-30"),
        periodEnd: new Date("2026-09-01"),
      }),
    ).rejects.toThrow(/ends before it starts/i);
  });

  it("recomputes the amount whenever the numbers behind it change", async () => {
    const runs = await manager.payroll.runs({ teamId });
    const payRunId = runs[0]!.id;
    const detail = await manager.payroll.run({ payRunId });
    const line = detail.run.lines[0]!;

    await manager.payroll.updateLine({ lineId: line.id, quantity: 3 });
    const after = await db.payrollLine.findUniqueOrThrow({
      where: { id: line.id },
    });
    expect(after.amountMinor).toBe(75_000);
  });

  it("refuses a deduction bigger than the pay", async () => {
    const runs = await manager.payroll.runs({ teamId });
    const detail = await manager.payroll.run({ payRunId: runs[0]!.id });
    await expect(
      manager.payroll.updateLine({
        lineId: detail.run.lines[0]!.id,
        adjustmentMinor: -1_000_000,
      }),
    ).rejects.toThrow(/larger than the pay/i);
  });

  it("takes a payee with no account", async () => {
    // The mechanic who does two weekends a year. Excluding them pushes a
    // chunk of a real team's costs back onto the spreadsheet.
    const runs = await manager.payroll.runs({ teamId });
    const line = await manager.payroll.addLine({
      payRunId: runs[0]!.id,
      payeeName: "Weekend mechanic",
      description: "Two days at Sebring",
      basis: PayBasis.DAILY,
      quantity: 2,
      rateMinor: 15_000,
      currency: "EUR",
    });
    expect(line.amountMinor).toBe(30_000);
    expect(line.userId).toBeNull();
  });

  it("refuses a line with two payees, or none", async () => {
    const runs = await manager.payroll.runs({ teamId });
    await expect(
      manager.payroll.addLine({
        payRunId: runs[0]!.id,
        userId: crewId,
        payeeName: "Also this person",
        description: "Both",
      }),
    ).rejects.toThrow(/not both/i);

    await expect(
      manager.payroll.addLine({
        payRunId: runs[0]!.id,
        description: "Nobody",
      }),
    ).rejects.toThrow(/not both/i);
  });

  it("keeps currencies apart in the totals", async () => {
    const runs = await manager.payroll.runs({ teamId });
    const detail = await manager.payroll.run({ payRunId: runs[0]!.id });
    const currencies = detail.totals.map((total) => total.currency).sort();
    expect(currencies).toEqual(["EUR", "USD"]);
    // No combined figure anywhere — that would be a made-up amount in a
    // made-up currency on a document somebody pays people from.
    expect(detail.totals.find((t) => t.currency === "USD")!.grossMinor).toBe(
      75_000,
    );
    expect(detail.totals.find((t) => t.currency === "EUR")!.grossMinor).toBe(
      30_000,
    );
  });

  it("will not record a payment before the run is approved", async () => {
    const runs = await manager.payroll.runs({ teamId });
    const detail = await manager.payroll.run({ payRunId: runs[0]!.id });
    await expect(
      manager.payroll.markLinePaid({
        lineId: detail.run.lines[0]!.id,
        paid: true,
      }),
    ).rejects.toThrow(/approve the run first|Approve the run before/i);
  });

  it("freezes the figures on approval", async () => {
    const runs = await manager.payroll.runs({ teamId });
    const payRunId = runs[0]!.id;
    await manager.payroll.approve({ payRunId });

    const detail = await manager.payroll.run({ payRunId });
    expect(detail.run.status).toBe(PayRunStatus.APPROVED);

    // Money should not go out against a number that can still be edited.
    await expect(
      manager.payroll.updateLine({
        lineId: detail.run.lines[0]!.id,
        quantity: 99,
      }),
    ).rejects.toThrow(/frozen/i);
    await expect(
      manager.payroll.addLine({
        payRunId,
        userId: crewId,
        description: "Late addition",
      }),
    ).rejects.toThrow(/frozen/i);
  });

  it("refuses to approve an empty run", async () => {
    const created = await manager.payroll.createRun({
      teamId,
      label: `Empty ${run}`,
      periodStart: new Date("2026-09-01"),
      periodEnd: new Date("2026-09-30"),
      prefillFromRates: false,
    });
    await expect(
      manager.payroll.approve({ payRunId: created.id }),
    ).rejects.toThrow(/nothing on this run/i);
  });

  it("closes the run once every line is paid, and reopens if one is undone", async () => {
    const runs = await manager.payroll.runs({ teamId });
    const approved = runs.find((row) => row.status === PayRunStatus.APPROVED)!;
    const detail = await manager.payroll.run({ payRunId: approved.id });

    for (const line of detail.run.lines) {
      await manager.payroll.markLinePaid({
        lineId: line.id,
        paid: true,
        paymentReference: "BACS 0099",
      });
    }
    let after = await db.payRun.findUniqueOrThrow({
      where: { id: approved.id },
    });
    expect(after.status).toBe(PayRunStatus.PAID);

    await manager.payroll.markLinePaid({
      lineId: detail.run.lines[0]!.id,
      paid: false,
    });
    after = await db.payRun.findUniqueOrThrow({ where: { id: approved.id } });
    expect(after.status).toBe(PayRunStatus.APPROVED);
    expect(after.paidAt).toBeNull();
  });

  it("will not delete a line that has been paid", async () => {
    const runs = await manager.payroll.runs({ teamId });
    const approved = runs.find((row) => row.status === PayRunStatus.APPROVED)!;
    const detail = await manager.payroll.run({ payRunId: approved.id });
    const paid = detail.run.lines.find((line) => line.paidAt)!;

    await expect(
      manager.payroll.removeLine({ lineId: paid.id }),
    ).rejects.toThrow(/frozen|money out of the door/i);
  });

  it("will not cancel a run that has been paid", async () => {
    const runs = await manager.payroll.runs({ teamId });
    const approved = runs.find((row) => row.status === PayRunStatus.APPROVED)!;
    // Mark them all paid again so the run closes.
    const detail = await manager.payroll.run({ payRunId: approved.id });
    for (const line of detail.run.lines) {
      if (!line.paidAt) {
        await manager.payroll.markLinePaid({ lineId: line.id, paid: true });
      }
    }
    await expect(
      manager.payroll.cancelRun({ payRunId: approved.id }),
    ).rejects.toThrow(/hide payments that already went out/i);
  });

  it("exports a CSV with the payees and figures on it", async () => {
    const runs = await manager.payroll.runs({ teamId });
    const paid = runs.find((row) => row.status === PayRunStatus.PAID)!;
    const { csv, filename } = await manager.payroll.exportCsv({
      payRunId: paid.id,
    });

    expect(filename).toMatch(/\.csv$/);
    expect(csv.split("\n")[0]).toContain("Payee");
    expect(csv).toContain("Weekend mechanic");
    // Major units, which is what a bank file and an accountant expect.
    expect(csv).toContain("300.00");
  });
});
