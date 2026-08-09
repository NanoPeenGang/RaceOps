import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  InventoryUnitStatus,
  PartCategory,
  PlatformRole,
  PrismaClient,
  StockMoveKind,
  TeamRole,
} from "@prisma/client";
import { createCaller } from "@/server/trpc/root";
import { partLabelUrl } from "@/server/services/qr";

/**
 * Scanning parts in and out, end to end.
 *
 * The behaviour worth testing against a real database is the arithmetic: a
 * scan has to move the count and the ledger together, and the two must not be
 * able to disagree. The rest — that a QR decodes, that the window suppresses a
 * repeat — is covered where it lives.
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

describe.skipIf(!ENABLED)("part labels and scanning (integration)", () => {
  const run = Date.now();
  let crew: Awaited<ReturnType<typeof makeUser>>;
  let driver: Awaited<ReturnType<typeof makeUser>>;
  let outsider: Awaited<ReturnType<typeof makeUser>>;
  let teamId: string;
  let padsId: string;
  let padsToken: string;
  let boxId: string;

  beforeAll(async () => {
    crew = await makeUser(`scan_crew_${run}`);
    driver = await makeUser(`scan_drv_${run}`);
    outsider = await makeUser(`scan_out_${run}`);

    const team = await crew.caller.team.create({ name: `Scan Team ${run}` });
    teamId = team.id;
    await db.teamMembership.create({
      data: { teamId, userId: driver.user.id, role: TeamRole.DRIVER },
    });

    const pads = await crew.caller.garage.addItem({
      teamId,
      name: `Front pads ${run}`,
      partNumber: "HB100",
      category: PartCategory.BRAKES,
      quantity: 6,
      minQuantity: 2,
      unit: "set",
      location: "Trailer shelf 3",
    });
    padsId = pads.id;
    padsToken = pads.qrToken!;

    const box = await crew.caller.garage.addItem({
      teamId,
      name: `Gearbox ${run}`,
      category: PartCategory.DRIVETRAIN,
      quantity: 0,
      unit: "each",
    });
    boxId = box.id;
  });

  afterAll(async () => {
    if (!ENABLED) return;
    await db.team.deleteMany({ where: { id: teamId } });
    await db.user.deleteMany({
      where: {
        id: { in: [crew.user.id, driver.user.id, outsider.user.id] },
      },
    });
    await db.$disconnect();
  });

  it("labels a line the moment it is created", () => {
    // A line somebody has to go back and "enable labels" on is a line that
    // never gets one.
    expect(padsToken).toBeTruthy();
    expect(padsToken.length).toBeGreaterThanOrEqual(24);
  });

  it("tells somebody what a label is without changing anything", async () => {
    const found = await crew.caller.garage.identify({
      scanned: partLabelUrl("line", padsToken),
    });
    expect(found.found).toBe(true);
    if (!found.found) return;
    expect(found.kind).toBe("line");
    expect(found.item.quantity).toBe(6);
    expect(found.team.id).toBe(teamId);
  });

  it("moves the count and writes the ledger together", async () => {
    const result = await crew.caller.garage.scanPart({
      scanned: partLabelUrl("line", padsToken),
      mode: "out",
      amount: 2,
    });
    expect(result.applied).toBe(true);
    expect(result.balance).toBe(4);

    const item = await db.inventoryItem.findUniqueOrThrow({
      where: { id: padsId },
    });
    expect(item.quantity).toBe(4);

    const movement = await db.inventoryMovement.findFirstOrThrow({
      where: { itemId: padsId },
      orderBy: { createdAt: "desc" },
    });
    expect(movement.kind).toBe(StockMoveKind.CONSUMED);
    expect(movement.delta).toBe(-2);
    // The balance the movement produced, so the ledger reads without
    // recomputing every row before it.
    expect(movement.balance).toBe(4);
  });

  it("records when the scan happened, not when it arrived", async () => {
    // A trailer at a circuit has no signal, so scans land later. Without this
    // the ledger would say the shelf emptied on the drive home.
    const scannedAt = new Date(Date.now() - 3 * 60 * 60 * 1000);
    const result = await crew.caller.garage.scanPart({
      scanned: partLabelUrl("line", padsToken),
      mode: "in",
      amount: 1,
      scannedAt,
    });
    const movement = await db.inventoryMovement.findUniqueOrThrow({
      where: { id: result.movementId! },
    });
    expect(movement.scannedAt?.toISOString()).toBe(scannedAt.toISOString());
    expect(movement.kind).toBe(StockMoveKind.RETURNED);
  });

  it("refuses a scan time from a clock set to next year", async () => {
    const result = await crew.caller.garage.scanPart({
      scanned: partLabelUrl("line", padsToken),
      mode: "out",
      amount: 1,
      scannedAt: new Date(Date.now() + 365 * 86_400_000),
    });
    const movement = await db.inventoryMovement.findUniqueOrThrow({
      where: { id: result.movementId! },
    });
    expect(movement.scannedAt!.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it("will not take the shelf below zero", async () => {
    await expect(
      crew.caller.garage.scanPart({
        scanned: partLabelUrl("line", padsToken),
        mode: "out",
        amount: 500,
      }),
    ).rejects.toThrow(/in stock/i);
  });

  it("undoes a scan with a reversal rather than a delete", async () => {
    const before = await db.inventoryItem.findUniqueOrThrow({
      where: { id: padsId },
    });
    const scan = await crew.caller.garage.scanPart({
      scanned: partLabelUrl("line", padsToken),
      mode: "out",
      amount: 1,
    });
    await crew.caller.garage.undoScan({ movementId: scan.movementId! });

    const after = await db.inventoryItem.findUniqueOrThrow({
      where: { id: padsId },
    });
    expect(after.quantity).toBe(before.quantity);

    // The mis-scan is still in the ledger, marked. A row that can vanish makes
    // "who took the last set" an answer nobody can rely on.
    const original = await db.inventoryMovement.findUniqueOrThrow({
      where: { id: scan.movementId! },
    });
    expect(original.reversedById).not.toBeNull();
  });

  it("refuses to undo the same scan twice", async () => {
    const scan = await crew.caller.garage.scanPart({
      scanned: partLabelUrl("line", padsToken),
      mode: "out",
      amount: 1,
    });
    await crew.caller.garage.undoScan({ movementId: scan.movementId! });
    await expect(
      crew.caller.garage.undoScan({ movementId: scan.movementId! }),
    ).rejects.toThrow(/already been undone/i);
  });

  // -- Individually labelled parts ------------------------------------------

  it("makes a label per part and counts them onto the shelf", async () => {
    const units = await crew.caller.garage.addUnits({
      itemId: boxId,
      serials: ["Gearbox A", "Gearbox B"],
    });
    expect(units).toHaveLength(2);
    expect(new Set(units.map((unit) => unit.qrToken)).size).toBe(2);

    const item = await db.inventoryItem.findUniqueOrThrow({
      where: { id: boxId },
    });
    expect(item.quantity).toBe(2);
    // A line with labelled parts on it is a tracked line by definition.
    expect(item.trackUnits).toBe(true);
  });

  it("takes the quantity keypad away once a line is labelled part by part", async () => {
    // Two ways to change one count is two counts. The keypad refusing is what
    // stops them drifting apart invisibly.
    await expect(
      crew.caller.garage.recordMovement({
        itemId: boxId,
        kind: StockMoveKind.CONSUMED,
        amount: 1,
      }),
    ).rejects.toThrow(/scan the part instead/i);
  });

  it("signs one part out with a single scan", async () => {
    const units = await crew.caller.garage.units({ itemId: boxId });
    const first = units.units[0]!;

    const result = await crew.caller.garage.scanPart({
      scanned: partLabelUrl("unit", first.qrToken),
      mode: "out",
    });
    expect(result.applied).toBe(true);
    expect(result.amount).toBe(1);
    expect(result.balance).toBe(1);
    expect(result.serial).toBe(first.serial);

    const moved = await db.inventoryUnit.findUniqueOrThrow({
      where: { id: first.id },
    });
    expect(moved.status).toBe(InventoryUnitStatus.OUT);
  });

  it("counts a part scanned out twice only once", async () => {
    /*
     * Two people scanning the same box. Not an error worth stopping for, but a
     * second movement would take one gearbox off the shelf twice and the count
     * would be wrong in a way nobody could unpick later.
     */
    const units = await crew.caller.garage.units({ itemId: boxId });
    const out = units.units.find((u) => u.status === InventoryUnitStatus.OUT)!;

    const before = await db.inventoryItem.findUniqueOrThrow({
      where: { id: boxId },
    });
    const result = await crew.caller.garage.scanPart({
      scanned: partLabelUrl("unit", out.qrToken),
      mode: "out",
    });
    expect(result.applied).toBe(false);
    expect(result.note).toMatch(/already/i);

    const after = await db.inventoryItem.findUniqueOrThrow({
      where: { id: boxId },
    });
    expect(after.quantity).toBe(before.quantity);
  });

  it("puts a part back with one scan the other way", async () => {
    const units = await crew.caller.garage.units({ itemId: boxId });
    const out = units.units.find((u) => u.status === InventoryUnitStatus.OUT)!;

    const result = await crew.caller.garage.scanPart({
      scanned: partLabelUrl("unit", out.qrToken),
      mode: "in",
    });
    expect(result.applied).toBe(true);
    expect(result.balance).toBe(2);

    const back = await db.inventoryUnit.findUniqueOrThrow({
      where: { id: out.id },
    });
    expect(back.status).toBe(InventoryUnitStatus.IN_STOCK);
  });

  it("retires a part off the shelf, and refuses to scan it again", async () => {
    const units = await crew.caller.garage.units({ itemId: boxId });
    const target = units.units[0]!;

    await crew.caller.garage.updateUnit({ unitId: target.id, retire: true });
    const item = await db.inventoryItem.findUniqueOrThrow({
      where: { id: boxId },
    });
    expect(item.quantity).toBe(1);

    const result = await crew.caller.garage.scanPart({
      scanned: partLabelUrl("unit", target.qrToken),
      mode: "in",
    });
    expect(result.applied).toBe(false);
    expect(result.note).toMatch(/retired/i);
  });

  it("does not count a part off the shelf twice when it is retired while out", async () => {
    // It was counted out when it was scanned; taking another one off now would
    // debit a shelf that never held it.
    const made = await crew.caller.garage.addUnits({ itemId: boxId, count: 1 });
    const unit = made[0]!;
    await crew.caller.garage.scanPart({
      scanned: partLabelUrl("unit", unit.qrToken),
      mode: "out",
    });

    const before = await db.inventoryItem.findUniqueOrThrow({
      where: { id: boxId },
    });
    await crew.caller.garage.updateUnit({ unitId: unit.id, retire: true });
    const after = await db.inventoryItem.findUniqueOrThrow({
      where: { id: boxId },
    });
    expect(after.quantity).toBe(before.quantity);
  });

  it("wants one serial each or none at all", async () => {
    await expect(
      crew.caller.garage.addUnits({
        itemId: boxId,
        count: 3,
        serials: ["only one"],
      }),
    ).rejects.toThrow(/one each/i);
  });

  // -- Who may scan ---------------------------------------------------------

  it("lets a driver read a label but not move stock with it", async () => {
    // Not a slight: a driver marking a part consumed from the paddock is how a
    // count stops matching the shelf.
    const found = await driver.caller.garage.identify({
      scanned: partLabelUrl("line", padsToken),
    });
    expect(found.found).toBe(true);
    if (found.found) expect(found.canWrite).toBe(false);

    await expect(
      driver.caller.garage.scanPart({
        scanned: partLabelUrl("line", padsToken),
        mode: "out",
      }),
    ).rejects.toThrow(/managers, engineers and crew/i);
  });

  it("tells somebody outside the team nothing at all", async () => {
    const found = await outsider.caller.garage.identify({
      scanned: partLabelUrl("line", padsToken),
    });
    // Not "forbidden" — a label photographed at a track should not confirm
    // that it belongs to anybody in particular.
    expect(found.found).toBe(false);

    await expect(
      outsider.caller.garage.scanPart({
        scanned: partLabelUrl("line", padsToken),
        mode: "out",
      }),
    ).rejects.toThrow();
  });

  it("mints a code for a line that predates labels, once", async () => {
    // Not backfilled in SQL: Postgres' random() is not a CSPRNG, and a
    // predictable token would let anybody who saw one label walk the list.
    await db.inventoryItem.update({
      where: { id: padsId },
      data: { qrToken: null },
    });

    const first = await crew.caller.garage.labelSheet({ teamId });
    const line = first.items.find((item) => item.id === padsId)!;
    expect(line.qrToken).toBeTruthy();

    const second = await crew.caller.garage.labelSheet({ teamId });
    expect(second.items.find((item) => item.id === padsId)!.qrToken).toBe(
      line.qrToken,
    );
    padsToken = line.qrToken;
  });

  it("puts every bin and every labelled part on the sheet", async () => {
    const sheet = await crew.caller.garage.labelSheet({ teamId });
    const box = sheet.items.find((item) => item.id === boxId)!;
    expect(box.units.length).toBeGreaterThan(0);
    // Retired parts are history and never need another label.
    for (const unit of box.units) expect(unit.qrToken).toBeTruthy();
    expect(sheet.items.every((item) => item.qrToken)).toBe(true);
  });
});
