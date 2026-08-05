import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  GarageFileKind,
  PartCategory,
  PrismaClient,
  ServiceStatus,
  StockMoveKind,
  TeamRole,
} from "@prisma/client";
import { createCaller } from "@/server/trpc/root";

/**
 * The garage, end to end.
 *
 * What matters here is not that a row can be written — it is who may write it
 * and what the ledger says afterwards. A stock count that can be typed over,
 * or a driver who can mark parts consumed from the paddock, is how a count
 * stops matching the shelf. Opt in with RUN_DB_TESTS=1.
 */
const ENABLED = process.env.RUN_DB_TESTS === "1";
const db = ENABLED ? new PrismaClient() : (null as unknown as PrismaClient);

function callerFor(clerkUserId: string) {
  return createCaller({ db, clerkUserId, headers: new Headers() });
}

describe.skipIf(!ENABLED)("garage (integration)", () => {
  const run = Date.now();
  let teamId: string;
  let carId: string;
  let manager: ReturnType<typeof callerFor>;
  let engineer: ReturnType<typeof callerFor>;
  let driver: ReturnType<typeof callerFor>;
  let outsider: ReturnType<typeof callerFor>;
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
    return callerFor(user.authProviderId);
  }

  beforeAll(async () => {
    if (!ENABLED) return;
    const team = await db.team.create({
      data: { name: `Garage Test ${run}`, slug: `garage-test-${run}` },
    });
    teamId = team.id;

    manager = await makeUser("gmanager", TeamRole.MANAGER);
    engineer = await makeUser("gengineer", TeamRole.ENGINEER);
    driver = await makeUser("gdriver", TeamRole.DRIVER);
    outsider = await makeUser("goutsider", null);

    const car = await db.car.create({
      data: { teamId, name: `Car ${run}`, runningHours: 30 },
    });
    carId = car.id;
  });

  afterAll(async () => {
    if (!ENABLED) return;
    await db.team.deleteMany({ where: { id: teamId } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.$disconnect();
  });

  // -- Access --------------------------------------------------------------

  it("keeps the garage inside the current roster", async () => {
    await expect(outsider.garage.inventory({ teamId })).rejects.toThrow(
      /current members/i,
    );
  });

  it("lets a driver read but not write", async () => {
    // Not a slight: a driver marking a part consumed from the paddock is how
    // a count stops matching the shelf.
    const stock = await driver.garage.inventory({ teamId });
    expect(stock.canWrite).toBe(false);

    await expect(
      driver.garage.addItem({ teamId, name: "Pads" }),
    ).rejects.toThrow(/engineers and crew/i);
  });

  it("lets an engineer write", async () => {
    const stock = await engineer.garage.inventory({ teamId });
    expect(stock.canWrite).toBe(true);
  });

  // -- Stock ---------------------------------------------------------------

  it("records an opening count as a movement, not just a number", async () => {
    const item = await manager.garage.addItem({
      teamId,
      name: `Brake pads ${run}`,
      category: PartCategory.BRAKES,
      quantity: 4,
      minQuantity: 2,
    });

    const ledger = await manager.garage.movements({ itemId: item.id });
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.kind).toBe(StockMoveKind.RECEIVED);
    expect(ledger[0]!.balance).toBe(4);
  });

  it("moves stock and writes the balance in one go", async () => {
    const item = await manager.garage.addItem({
      teamId,
      name: `Belts ${run}`,
      quantity: 6,
    });

    await engineer.garage.recordMovement({
      itemId: item.id,
      kind: StockMoveKind.CONSUMED,
      amount: 2,
      reason: "Fitted to car 7",
    });

    const after = await db.inventoryItem.findUniqueOrThrow({
      where: { id: item.id },
    });
    expect(after.quantity).toBe(4);

    const ledger = await manager.garage.movements({ itemId: item.id });
    expect(ledger[0]!.delta).toBe(-2);
    expect(ledger[0]!.balance).toBe(4);
    expect(ledger[0]!.reason).toBe("Fitted to car 7");
  });

  it("treats a stock check as a target rather than a change", async () => {
    const item = await manager.garage.addItem({
      teamId,
      name: `Bolts ${run}`,
      quantity: 10,
    });
    await manager.garage.recordMovement({
      itemId: item.id,
      kind: StockMoveKind.ADJUSTED,
      amount: 7,
      reason: "Stocktake",
    });

    const after = await db.inventoryItem.findUniqueOrThrow({
      where: { id: item.id },
    });
    expect(after.quantity).toBe(7);
  });

  it("refuses to take stock below zero, with the numbers", async () => {
    const item = await manager.garage.addItem({
      teamId,
      name: `Filters ${run}`,
      quantity: 1,
    });
    await expect(
      manager.garage.recordMovement({
        itemId: item.id,
        kind: StockMoveKind.CONSUMED,
        amount: 5,
      }),
    ).rejects.toThrow(/Only 1 in stock/);
  });

  it("has no path that changes a count without a ledger line", async () => {
    // `updateItem` deliberately has no `quantity`. If that ever changes, a
    // balance can move with nothing explaining it.
    const item = await manager.garage.addItem({
      teamId,
      name: `Oil ${run}`,
      quantity: 3,
    });
    await manager.garage.updateItem({ itemId: item.id, location: "Shelf 2" });

    const after = await db.inventoryItem.findUniqueOrThrow({
      where: { id: item.id },
    });
    expect(after.quantity).toBe(3);
    expect(after.location).toBe("Shelf 2");
  });

  // -- Files ---------------------------------------------------------------

  it("files a setup with the context that makes it findable", async () => {
    await engineer.garage.addFile({
      teamId,
      kind: GarageFileKind.SETUP,
      name: `Sebring race setup ${run}`,
      url: "https://example.test/setup.sto",
      carId,
      conditions: "damp, 12°C",
      bestLapMs: 103_271,
      tags: [],
    });

    const library = await driver.garage.files({ teamId });
    const found = library.files.find((file) => file.carId === carId);
    expect(found?.bestLapMs).toBe(103_271);
    expect(found?.conditions).toBe("damp, 12°C");
  });

  it("lets an uploader remove their own file and stops others", async () => {
    const file = await engineer.garage.addFile({
      teamId,
      kind: GarageFileKind.TELEMETRY,
      name: `Run ${run}`,
      url: "https://example.test/run.ld",
      tags: [],
    });

    // Crew and engineers write, but removing somebody else's data is a
    // manager's call — a setup nobody can find is lost.
    await expect(
      driver.garage.removeFile({ fileId: file.id }),
    ).rejects.toThrow(/engineers and crew/i);

    await expect(
      engineer.garage.removeFile({ fileId: file.id }),
    ).resolves.toEqual({ deleted: true });
  });

  // -- Servicing -----------------------------------------------------------

  it("reports an overdue job against the car's running hours", async () => {
    await manager.garage.logService({
      carId,
      component: `Gearbox ${run}`,
      status: ServiceStatus.PLANNED,
      nextDueHours: 25,
    });

    const services = await driver.garage.services({ teamId });
    const car = services.cars.find((row) => row.id === carId)!;
    const due = car.due.find((row) =>
      row.service.component.startsWith("Gearbox"),
    );
    // The car is at 30 hours against a 25-hour interval.
    expect(due?.assessment.urgency).toBe("overdue");
  });

  it("cannot say whether an hours-based job is due on a car with no hours", async () => {
    await manager.garage.setRunningHours({ carId, runningHours: null });
    const services = await manager.garage.services({ teamId });
    const car = services.cars.find((row) => row.id === carId)!;
    // Reporting it as fine is how a rebuild gets missed.
    expect(
      car.due.some((row) => row.service.component.startsWith("Gearbox")),
    ).toBe(false);

    await manager.garage.setRunningHours({ carId, runningHours: 30 });
  });

  // -- Seat time -----------------------------------------------------------

  it("rolls seat time up across events and names who has not been out", async () => {
    const event = await db.raceEvent.create({
      data: {
        name: `Seat Time Round ${run}`,
        seriesLabel: "Fixture",
        platform: "Circuit",
        date: new Date("2026-03-01T00:00:00Z"),
      },
    });
    const submitter = await db.user.findFirstOrThrow({
      where: { authProviderId: `clerk_gmanager_${run}` },
    });
    const driverUser = await db.user.findFirstOrThrow({
      where: { authProviderId: `clerk_gdriver_${run}` },
    });

    const registration = await db.eventRegistration.create({
      data: {
        eventId: event.id,
        teamId,
        submittedById: submitter.id,
      },
    });
    const lineupDriver = await db.registrationDriver.create({
      data: { registrationId: registration.id, userId: driverUser.id },
    });
    await db.stint.create({
      data: {
        registrationId: registration.id,
        lineupDriverId: lineupDriver.id,
        startedAt: new Date("2026-03-01T10:00:00Z"),
        endedAt: new Date("2026-03-01T11:30:00Z"),
        laps: 40,
      },
    });

    const seatTime = await manager.garage.seatTime({ teamId });
    const row = seatTime.drivers.find((d) => d.userId === driverUser.id);
    expect(row?.totalMinutes).toBe(90);
    expect(row?.laps).toBe(40);
    expect(row?.eventCount).toBe(1);

    // The roster comes back too, so the console can name the drivers who have
    // no stints at all — they are invisible in the table above.
    expect(seatTime.roster.map((member) => member.userId)).toContain(
      driverUser.id,
    );

    await db.raceEvent.delete({ where: { id: event.id } });
  });
});
