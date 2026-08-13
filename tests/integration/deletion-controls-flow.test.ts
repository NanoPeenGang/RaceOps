import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  OpportunityType,
  PlatformRole,
  PrismaClient,
  StockMoveKind,
  TeamRole,
} from "@prisma/client";
import { createCaller } from "@/server/trpc/root";

/**
 * Getting rid of things, and renaming them.
 *
 * Three separate asks with one thing in common: each destroys something, so
 * each needs to be sure it destroys what it says and nothing it does not. The
 * team delete in particular reaches further than it looks — entries and
 * results live in other organizers' events — and this pins that behaviour down
 * so a change to it has to be deliberate.
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

describe.skipIf(!ENABLED)("renaming and deleting (integration)", () => {
  const run = Date.now();
  let owner: Awaited<ReturnType<typeof makeUser>>;
  let manager: Awaited<ReturnType<typeof makeUser>>;
  let driver: Awaited<ReturnType<typeof makeUser>>;
  let teamId: string;
  const created: string[] = [];

  beforeAll(async () => {
    owner = await makeUser(`del_own_${run}`);
    manager = await makeUser(`del_mgr_${run}`);
    driver = await makeUser(`del_drv_${run}`);
    created.push(owner.user.id, manager.user.id, driver.user.id);

    const team = await owner.caller.team.create({ name: `Delete Team ${run}` });
    teamId = team.id;
    await db.teamMembership.createMany({
      data: [
        { teamId, userId: manager.user.id, role: TeamRole.MANAGER },
        { teamId, userId: driver.user.id, role: TeamRole.DRIVER },
      ],
    });
  });

  afterAll(async () => {
    if (!ENABLED) return;
    await db.team.deleteMany({ where: { id: teamId } });
    await db.user.deleteMany({ where: { id: { in: created } } });
    await db.$disconnect();
  });

  // -- Renaming a team -----------------------------------------------------

  it("renames a team without moving its address", async () => {
    const before = await db.team.findUniqueOrThrow({ where: { id: teamId } });
    const renamed = await owner.caller.team.update({
      teamId,
      name: `Renamed Team ${run}`,
    });
    expect(renamed.name).toBe(`Renamed Team ${run}`);
    /*
     * The slug is in links people have already shared, in QR codes on printed
     * passes, and in somebody's browser history. A rename changes the name on
     * the door, not the address.
     */
    expect(renamed.slug).toBe(before.slug);
  });

  it("refuses a name another team already races under", async () => {
    const other = await manager.caller.team.create({
      name: `Occupied Name ${run}`,
    });
    await expect(
      owner.caller.team.update({ teamId, name: `Occupied Name ${run}` }),
    ).rejects.toThrow(/already races under that name/i);
    await manager.caller.team.delete({
      teamId: other.id,
      confirmName: `Occupied Name ${run}`,
    });
  });

  it("lets a manager rename but not a driver", async () => {
    await expect(
      manager.caller.team.update({ teamId, name: `Manager Renamed ${run}` }),
    ).resolves.toBeTruthy();
    await expect(
      driver.caller.team.update({ teamId, name: `Driver Renamed ${run}` }),
    ).rejects.toThrow();
    await owner.caller.team.update({ teamId, name: `Delete Team ${run}` });
  });

  // -- Deleting a stock line -----------------------------------------------

  it("deletes a stock line nobody has touched, in one go", async () => {
    const item = await owner.caller.garage.addItem({
      teamId,
      name: `Typo line ${run}`,
      quantity: 0,
    });
    // No ledger to lose, so no confirmation to demand.
    const result = await owner.caller.garage.deleteItem({ itemId: item.id });
    expect(result.movementsRemoved).toBe(0);
    expect(await db.inventoryItem.findUnique({ where: { id: item.id } })).toBeNull();
  });

  it("will not silently discard a stock line's history", async () => {
    const item = await owner.caller.garage.addItem({
      teamId,
      name: `Real line ${run}`,
      quantity: 4,
    });
    await owner.caller.garage.recordMovement({
      itemId: item.id,
      kind: StockMoveKind.CONSUMED,
      amount: 1,
    });

    await expect(
      owner.caller.garage.deleteItem({ itemId: item.id }),
    ).rejects.toThrow(/movements? recorded/i);

    const impact = await owner.caller.garage.itemDeletionImpact({
      itemId: item.id,
    });
    // Opening count plus the consumption.
    expect(impact.movements).toBe(2);

    const result = await owner.caller.garage.deleteItem({
      itemId: item.id,
      discardHistory: true,
    });
    expect(result.movementsRemoved).toBe(2);
    expect(
      await db.inventoryMovement.count({ where: { itemId: item.id } }),
    ).toBe(0);
  });

  it("leaves an invoice alone when the stock behind it is deleted", async () => {
    /*
     * A document already sent to a customer must not change because the shelf
     * behind it was tidied up. The link is SET NULL, so the line keeps its
     * wording and its figures.
     */
    const item = await owner.caller.garage.addItem({
      teamId,
      name: `Billed part ${run}`,
      quantity: 1,
    });
    const invoice = await owner.caller.garage.createInvoice({
      teamId,
      customerName: `Somebody ${run}`,
    });
    const line = await owner.caller.garage.addInvoiceLine({
      invoiceId: invoice.id,
      description: "Brake pads supplied",
      quantity: 1,
      unitMinor: 12000,
      inventoryItemId: item.id,
    });

    await owner.caller.garage.deleteItem({
      itemId: item.id,
      discardHistory: true,
    });

    const after = await db.invoiceLine.findUniqueOrThrow({
      where: { id: line.id },
    });
    expect(after.description).toBe("Brake pads supplied");
    expect(after.amountMinor).toBe(12000);
    expect(after.inventoryItemId).toBeNull();

    await owner.caller.garage.deleteInvoice({ invoiceId: invoice.id });
  });

  it("keeps stock deletion to the people who run the garage", async () => {
    const item = await owner.caller.garage.addItem({
      teamId,
      name: `Guarded line ${run}`,
      quantity: 0,
    });
    await expect(
      driver.caller.garage.deleteItem({ itemId: item.id }),
    ).rejects.toThrow(/managers, engineers and crew/i);
    await owner.caller.garage.deleteItem({ itemId: item.id });
  });

  // -- Deleting a team -----------------------------------------------------

  it("shows what deleting a team would cost before it happens", async () => {
    await owner.caller.garage.addItem({
      teamId,
      name: `Counted stock ${run}`,
      quantity: 2,
    });
    const impact = await owner.caller.team.deletionImpact({ teamId });
    expect(impact.name).toBe(`Delete Team ${run}`);
    expect(impact.roster).toBe(3);
    expect(impact.inventory).toBeGreaterThan(0);
  });

  it("lets only the owner see the impact or pull the trigger", async () => {
    // A manager runs the team day to day; ending it is the one act nobody can
    // undo for them.
    await expect(
      manager.caller.team.deletionImpact({ teamId }),
    ).rejects.toThrow(/owner/i);
    await expect(
      manager.caller.team.delete({ teamId, confirmName: `Delete Team ${run}` }),
    ).rejects.toThrow(/owner/i);
  });

  it("refuses a mistyped name and deletes nothing", async () => {
    await expect(
      owner.caller.team.delete({ teamId, confirmName: "not the name" }),
    ).rejects.toThrow(/not the team's name/i);
    expect(await db.team.findUnique({ where: { id: teamId } })).not.toBeNull();
  });

  it("deletes the team and everything hanging off it", async () => {
    const doomed = await owner.caller.team.create({
      name: `Doomed Team ${run}`,
    });
    await owner.caller.garage.addItem({
      teamId: doomed.id,
      name: "Stock",
      quantity: 1,
    });

    await owner.caller.team.delete({
      teamId: doomed.id,
      confirmName: `Doomed Team ${run}`,
    });

    expect(await db.team.findUnique({ where: { id: doomed.id } })).toBeNull();
    expect(
      await db.inventoryItem.count({ where: { teamId: doomed.id } }),
    ).toBe(0);
    expect(
      await db.teamMembership.count({ where: { teamId: doomed.id } }),
    ).toBe(0);
  });

  it("leaves a job posting's applications with the applicant", async () => {
    /*
     * An application is the applicant's own history as much as the team's.
     * `Opportunity.postedByTeamId` is SET NULL, so the posting survives with no
     * team attached rather than disappearing from under somebody who applied
     * to it in good faith.
     */
    const doomed = await owner.caller.team.create({
      name: `Hiring Team ${run}`,
    });
    const posting = await owner.caller.opportunity.create({
      title: "Crew for the season",
      description: "Weekends away, expenses covered, bring your own gloves.",
      type: OpportunityType.CREW_JOB,
      teamId: doomed.id,
    });

    await owner.caller.team.delete({
      teamId: doomed.id,
      confirmName: `Hiring Team ${run}`,
    });

    const after = await db.opportunity.findUnique({
      where: { id: posting.id },
    });
    expect(after).not.toBeNull();
    expect(after!.postedByTeamId).toBeNull();

    await db.opportunity.delete({ where: { id: posting.id } });
  });
});
