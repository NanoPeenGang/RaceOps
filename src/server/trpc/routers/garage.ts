import { randomBytes } from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  GarageFileKind,
  InventoryUnitStatus,
  PartCategory,
  ServiceKind,
  ServiceStatus,
  StockMoveKind,
  TeamRole,
} from "@prisma/client";
import type { Prisma, PrismaClient } from "@prisma/client";
import { createTRPCRouter, protectedProcedure } from "@/server/trpc/trpc";
import { TEAM_MANAGER_ROLES } from "@/lib/teams";
import { balanceAfter, checkMovement, deltaFor } from "@/lib/inventory";
import {
  parseLabel,
  SCAN_MODE_KIND,
  SCAN_MODE_UNIT_STATUS,
  unitIsScannable,
  unitScanIsRedundant,
  type ScanMode,
} from "@/lib/part-labels";
import { upcomingServices } from "@/lib/service";
import { seatTimeByDriver, type SeasonStint } from "@/lib/seat-time";

/**
 * The garage: parts stock, telemetry and setup files, and car servicing.
 *
 * Two levels of authorization, and the split is deliberate. Reading the
 * garage is for the whole roster — a driver should be able to find the setup
 * they ran last time without asking a manager. Changing stock and logging
 * work is for the people who actually run the car: managers, engineers and
 * crew. Drivers are readers here, which is not a slight; it is that a driver
 * marking a part consumed from the paddock is how a count stops matching the
 * shelf.
 */

/** Roles that may change what is in the garage. */
const GARAGE_WRITE_ROLES: readonly TeamRole[] = [
  TeamRole.OWNER,
  TeamRole.MANAGER,
  TeamRole.ENGINEER,
  TeamRole.CREW,
];

interface TeamStanding {
  role: TeamRole;
  canWrite: boolean;
  canManage: boolean;
}

/** Throws unless the caller is on the team's current roster. */
async function assertGarageRead(
  db: PrismaClient,
  teamId: string,
  userId: string,
): Promise<TeamStanding> {
  const membership = await db.teamMembership.findUnique({
    where: { teamId_userId: { teamId, userId } },
    select: { role: true, endDate: true },
  });
  if (!membership || membership.endDate !== null) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "The garage is for the team's current members.",
    });
  }
  return {
    role: membership.role,
    canWrite: GARAGE_WRITE_ROLES.includes(membership.role),
    canManage: TEAM_MANAGER_ROLES.includes(membership.role),
  };
}

async function assertGarageWrite(
  db: PrismaClient,
  teamId: string,
  userId: string,
): Promise<TeamStanding> {
  const standing = await assertGarageRead(db, teamId, userId);
  if (!standing.canWrite) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "Managers, engineers and crew keep the garage records. Ask one of them to log this.",
    });
  }
  return standing;
}

/** The team a car belongs to, refusing cars that belong to no team. */
async function teamForCar(db: PrismaClient, carId: string): Promise<string> {
  const car = await db.car.findUnique({
    where: { id: carId },
    select: { teamId: true },
  });
  if (!car) throw new TRPCError({ code: "NOT_FOUND" });
  if (!car.teamId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "That car is not on a team, so it has no garage.",
    });
  }
  return car.teamId;
}


/**
 * A label token: 24 bytes of CSPRNG in base64url.
 *
 * Deliberately not derived from the row id. An id turns up in URLs and in the
 * team's own tooling, and a label whose code could be worked out from one
 * somebody had already seen would let anybody photograph one bin and then walk
 * the whole parts list.
 */
function mintToken(): string {
  return randomBytes(24).toString("base64url");
}

interface ResolvedLine {
  kind: "line";
  item: {
    id: string;
    teamId: string;
    name: string;
    unit: string;
    quantity: number;
    minQuantity: number | null;
    trackUnits: boolean;
    partNumber: string | null;
    location: string | null;
    category: PartCategory;
  };
}

interface ResolvedUnit extends Omit<ResolvedLine, "kind"> {
  kind: "unit";
  unit: {
    id: string;
    status: InventoryUnitStatus;
    serial: string | null;
    expiresOn: Date | null;
  };
}

type Resolved = ResolvedLine | ResolvedUnit;

const ITEM_FOR_SCAN = {
  id: true,
  teamId: true,
  name: true,
  unit: true,
  quantity: true,
  minQuantity: true,
  trackUnits: true,
  partNumber: true,
  location: true,
  category: true,
} as const;

/**
 * Turns whatever the camera read into a part, or says why it could not.
 *
 * A bare token typed into the manual box carries no kind, so it is looked up
 * against both tables. That is two queries in the uncommon case rather than
 * one in every case, and it is what lets somebody read the code off the back
 * of a label without knowing or caring which sort of label it is.
 */
async function resolveLabel(
  db: PrismaClient,
  scanned: string,
): Promise<Resolved | null> {
  const parsed = parseLabel(scanned);
  if (!parsed) return null;

  const explicit = /\/parts\/[iu]\//.test(scanned.trim());

  if (parsed.kind === "unit" || !explicit) {
    const unit = await db.inventoryUnit.findUnique({
      where: { qrToken: parsed.token },
      select: {
        id: true,
        status: true,
        serial: true,
        expiresOn: true,
        item: { select: ITEM_FOR_SCAN },
      },
    });
    if (unit) {
      return {
        kind: "unit",
        item: unit.item,
        unit: {
          id: unit.id,
          status: unit.status,
          serial: unit.serial,
          expiresOn: unit.expiresOn,
        },
      };
    }
    if (parsed.kind === "unit") return null;
  }

  const item = await db.inventoryItem.findUnique({
    where: { qrToken: parsed.token },
    select: ITEM_FOR_SCAN,
  });
  return item ? { kind: "line", item } : null;
}


/**
 * Keeps a client-sent scan time honest.
 *
 * The station sends when the person actually scanned, because a queued scan
 * lands minutes or hours later. That means trusting a clock this server does
 * not control, so: never in the future, and never more than a week back. A
 * phone with the date set to 2031 should not put stock movements there, and a
 * scan older than a week is a bug rather than a slow drive home.
 */
const MAX_SCAN_BACKDATE_MS = 7 * 24 * 60 * 60 * 1000;

function clampScanTime(scannedAt: Date | undefined): Date | null {
  if (!scannedAt) return null;
  const now = Date.now();
  const at = scannedAt.getTime();
  if (at > now) return new Date(now);
  if (now - at > MAX_SCAN_BACKDATE_MS) return null;
  return scannedAt;
}

/**
 * Moves one labelled part, and the line's count with it.
 *
 * Scanning something out that is already out is not an error: it usually means
 * two people scanned the same box. It returns "no change" rather than throwing
 * — but it must not write a second movement, or one gearbox leaves the shelf
 * twice and the count goes wrong in a way nobody can unpick later.
 */
async function scanOneUnit(
  db: PrismaClient,
  args: {
    resolved: ResolvedUnit;
    mode: ScanMode;
    kind: StockMoveKind;
    scannedAt: Date | null;
    reason: string | null;
    eventId: string | null;
    userId: string;
  },
) {
  const { resolved, mode, kind, scannedAt, reason, eventId, userId } = args;
  const shared = {
    kind: "unit" as const,
    itemId: resolved.item.id,
    itemName: resolved.item.name,
    unitLabel: resolved.item.unit,
    serial: resolved.unit.serial,
  };

  if (!unitIsScannable(resolved.unit.status)) {
    return {
      ...shared,
      applied: false as const,
      movementId: null,
      amount: 0,
      balance: resolved.item.quantity,
      low: false,
      note: "That part is retired — it does not come back through the scanner.",
    };
  }

  if (unitScanIsRedundant(resolved.unit.status, mode)) {
    return {
      ...shared,
      applied: false as const,
      movementId: null,
      amount: 0,
      balance: resolved.item.quantity,
      low: false,
      note:
        mode === "out"
          ? "Already signed out — counted once."
          : "Already on the shelf — counted once.",
    };
  }

  const delta = mode === "out" ? -1 : 1;
  const balance = resolved.item.quantity + delta;
  if (balance < 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `${resolved.item.name} already reads zero, so that part was not counted in. Record a stock check.`,
    });
  }

  const movement = await db.$transaction(async (tx) => {
    const created = await tx.inventoryMovement.create({
      data: {
        itemId: resolved.item.id,
        unitId: resolved.unit.id,
        kind,
        delta,
        balance,
        reason,
        eventId,
        scannedAt,
        userId,
      },
    });
    await tx.inventoryUnit.update({
      where: { id: resolved.unit.id },
      data: { status: SCAN_MODE_UNIT_STATUS[mode] },
    });
    await tx.inventoryItem.update({
      where: { id: resolved.item.id },
      data: { quantity: balance },
    });
    return created;
  });

  return {
    ...shared,
    applied: true as const,
    movementId: movement.id,
    amount: 1,
    balance,
    low: balance <= (resolved.item.minQuantity ?? -1),
    note: null,
  };
}

const moneySchema = z.number().int().min(0).max(100_000_000).nullish();

export const garageRouter = createTRPCRouter({
  // -- Inventory -----------------------------------------------------------

  inventory: protectedProcedure
    .input(
      z.object({
        teamId: z.string().cuid(),
        includeRetired: z.boolean().default(false),
      }),
    )
    .query(async ({ ctx, input }) => {
      const standing = await assertGarageRead(ctx.db, input.teamId, ctx.user.id);
      const items = await ctx.db.inventoryItem.findMany({
        where: {
          teamId: input.teamId,
          ...(input.includeRetired ? {} : { active: true }),
        },
        orderBy: [{ category: "asc" }, { name: "asc" }],
        include: {
          car: { select: { id: true, name: true } },
          _count: { select: { movements: true } },
        },
      });
      return { items, canWrite: standing.canWrite };
    }),

  addItem: protectedProcedure
    .input(
      z.object({
        teamId: z.string().cuid(),
        name: z.string().min(1).max(160),
        partNumber: z.string().max(80).nullish(),
        category: z.nativeEnum(PartCategory).default(PartCategory.OTHER),
        location: z.string().max(120).nullish(),
        unit: z.string().min(1).max(24).default("each"),
        /// Opening count. Recorded as a RECEIVED movement, not written
        /// straight to the balance, so the ledger starts where the shelf does.
        quantity: z.number().int().min(0).max(1_000_000).default(0),
        minQuantity: z.number().int().min(0).max(1_000_000).nullish(),
        unitCostMinor: moneySchema,
        currency: z.string().length(3).default("USD"),
        supplier: z.string().max(160).nullish(),
        carId: z.string().cuid().nullish(),
        notes: z.string().max(2000).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertGarageWrite(ctx.db, input.teamId, ctx.user.id);
      const { quantity, ...rest } = input;

      return ctx.db.$transaction(async (tx) => {
        const item = await tx.inventoryItem.create({
          // Labelled from the moment it exists: a line somebody has to go back
          // and "enable labels" on is a line that never gets one.
          data: { ...rest, quantity, qrToken: mintToken(), createdById: ctx.user.id },
        });
        if (quantity > 0) {
          await tx.inventoryMovement.create({
            data: {
              itemId: item.id,
              kind: StockMoveKind.RECEIVED,
              delta: quantity,
              balance: quantity,
              reason: "Opening count",
              userId: ctx.user.id,
            },
          });
        }
        return item;
      });
    }),

  updateItem: protectedProcedure
    .input(
      z.object({
        itemId: z.string().cuid(),
        name: z.string().min(1).max(160).optional(),
        partNumber: z.string().max(80).nullish(),
        category: z.nativeEnum(PartCategory).optional(),
        location: z.string().max(120).nullish(),
        unit: z.string().min(1).max(24).optional(),
        minQuantity: z.number().int().min(0).max(1_000_000).nullish(),
        unitCostMinor: moneySchema,
        currency: z.string().length(3).optional(),
        supplier: z.string().max(160).nullish(),
        carId: z.string().cuid().nullish(),
        notes: z.string().max(2000).nullish(),
        active: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { itemId, ...data } = input;
      const item = await ctx.db.inventoryItem.findUnique({
        where: { id: itemId },
        select: { teamId: true },
      });
      if (!item) throw new TRPCError({ code: "NOT_FOUND" });
      await assertGarageWrite(ctx.db, item.teamId, ctx.user.id);

      /*
       * `quantity` is deliberately absent from this input. The count only
       * moves through `recordMovement`, so there is no path that changes a
       * balance without leaving a ledger line explaining it.
       */
      return ctx.db.inventoryItem.update({ where: { id: itemId }, data });
    }),

  /**
   * Moves stock and writes the ledger line, in one transaction.
   *
   * The two must not come apart: a balance without its movement is a number
   * nobody can explain, and a movement without its balance is a ledger that
   * does not add up to the shelf.
   */
  recordMovement: protectedProcedure
    .input(
      z.object({
        itemId: z.string().cuid(),
        kind: z.nativeEnum(StockMoveKind),
        /// Always positive. For ADJUSTED this is the new count, not a change.
        amount: z.number().int().min(0).max(1_000_000),
        reason: z.string().max(300).nullish(),
        eventId: z.string().cuid().nullish(),
        serviceId: z.string().cuid().nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const item = await ctx.db.inventoryItem.findUnique({
        where: { id: input.itemId },
        select: {
          teamId: true,
          quantity: true,
          minQuantity: true,
          trackUnits: true,
        },
      });
      if (!item) throw new TRPCError({ code: "NOT_FOUND" });
      await assertGarageWrite(ctx.db, item.teamId, ctx.user.id);

      /*
       * A unit-tracked line's count is the number of labelled parts on the
       * shelf, not a number somebody types. Allowing both would let the two
       * drift, and the drift is invisible: the count would look plausible
       * while no longer matching any set of actual parts.
       */
      if (item.trackUnits) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "This line is labelled part by part — scan the part instead, or add and retire units to change the count.",
        });
      }

      const delta = deltaFor(input.kind, input.amount, item.quantity);
      const rejection = checkMovement(item, delta);
      if (rejection) {
        throw new TRPCError({ code: "BAD_REQUEST", message: rejection.message });
      }
      const balance = balanceAfter(item, delta);

      return ctx.db.$transaction(async (tx) => {
        const movement = await tx.inventoryMovement.create({
          data: {
            itemId: input.itemId,
            kind: input.kind,
            delta,
            balance,
            reason: input.reason ?? null,
            eventId: input.eventId ?? null,
            serviceId: input.serviceId ?? null,
            userId: ctx.user.id,
          },
        });
        await tx.inventoryItem.update({
          where: { id: input.itemId },
          data: { quantity: balance },
        });
        return movement;
      });
    }),


  // -- Part labels and scanning --------------------------------------------

  /**
   * What a scanned code is, without changing anything.
   *
   * Its own procedure so a phone that reads a label with the native camera —
   * rather than inside the station — lands on a page that tells it what the
   * part is and how many are left. That is the single most common thing
   * somebody standing at a shelf wants to know, and it should not require
   * picking a direction first.
   */
  identify: protectedProcedure
    .input(z.object({ scanned: z.string().min(1).max(400) }))
    .query(async ({ ctx, input }) => {
      const resolved = await resolveLabel(ctx.db, input.scanned);
      if (!resolved) return { found: false as const };

      /*
       * Somebody outside the team gets "not found", not "forbidden".
       *
       * The difference matters: a label gets photographed in a paddock and
       * left on a bench at a circuit, and a refusal that says "this is
       * somebody's, just not yours" confirms the code is live and worth
       * trying elsewhere. Not-found is the same answer a made-up code gets.
       */
      const membership = await ctx.db.teamMembership.findUnique({
        where: {
          teamId_userId: { teamId: resolved.item.teamId, userId: ctx.user.id },
        },
        select: { role: true, endDate: true },
      });
      if (!membership || membership.endDate !== null) {
        return { found: false as const };
      }

      const team = await ctx.db.team.findUniqueOrThrow({
        where: { id: resolved.item.teamId },
        select: { id: true, name: true, slug: true },
      });
      return {
        found: true as const,
        ...resolved,
        team,
        canWrite: GARAGE_WRITE_ROLES.includes(membership.role),
      };
    }),

  /**
   * Log a part in or out from a scan.
   *
   * The unit of work is one scan. There is no form and no confirm step: the
   * person doing this has a gearbox in the other hand, and anything that needs
   * a second tap per part gets abandoned for a clipboard by the third box.
   * Getting it wrong is corrected by `undoScan` rather than prevented by a
   * dialog nobody reads.
   */
  scanPart: protectedProcedure
    .input(
      z.object({
        scanned: z.string().min(1).max(400),
        mode: z.enum(["out", "in"]),
        /// Lines only. A unit scan *is* the quantity, so it ignores this.
        amount: z.number().int().min(1).max(10_000).default(1),
        reason: z.string().max(300).nullish(),
        eventId: z.string().cuid().nullish(),
        /**
         * When the person actually scanned it.
         *
         * Sent by the client because this is a queued mutation: a trailer at a
         * circuit has no signal, and without it the ledger would say the shelf
         * emptied on the drive home. Clamped below — a clock somebody has set
         * wrong should not put stock movements in the next decade.
         */
        scannedAt: z.date().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const resolved = await resolveLabel(ctx.db, input.scanned);
      if (!resolved) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "That label is not one of yours, or it has been reprinted.",
        });
      }
      await assertGarageWrite(ctx.db, resolved.item.teamId, ctx.user.id);

      const mode = input.mode as ScanMode;
      const kind = SCAN_MODE_KIND[mode];
      const scannedAt = clampScanTime(input.scannedAt);

      if (resolved.kind === "unit") {
        return scanOneUnit(ctx.db, {
          resolved,
          mode,
          kind,
          scannedAt,
          reason: input.reason ?? null,
          eventId: input.eventId ?? null,
          userId: ctx.user.id,
        });
      }

      const delta = deltaFor(kind, input.amount, resolved.item.quantity);
      const rejection = checkMovement(resolved.item, delta);
      if (rejection) {
        throw new TRPCError({ code: "BAD_REQUEST", message: rejection.message });
      }
      const balance = balanceAfter(resolved.item, delta);

      const movement = await ctx.db.$transaction(async (tx) => {
        const created = await tx.inventoryMovement.create({
          data: {
            itemId: resolved.item.id,
            kind,
            delta,
            balance,
            reason: input.reason ?? null,
            eventId: input.eventId ?? null,
            scannedAt,
            userId: ctx.user.id,
          },
        });
        await tx.inventoryItem.update({
          where: { id: resolved.item.id },
          data: { quantity: balance },
        });
        return created;
      });

      return {
        applied: true as const,
        kind: "line" as const,
        movementId: movement.id,
        itemId: resolved.item.id,
        itemName: resolved.item.name,
        unitLabel: resolved.item.unit,
        amount: Math.abs(delta),
        balance,
        low: balance <= (resolved.item.minQuantity ?? -1),
        serial: null,
        note: null,
      };
    }),

  /**
   * Everything that needs a label printed, with its code already minted.
   *
   * One query rather than one per label. A team labelling a trailer for the
   * first time prints a hundred and fifty of these in a sitting, and the
   * version that fetched a code per row was the shape that made the message
   * inbox slow.
   */
  labelSheet: protectedProcedure
    .input(
      z.object({
        teamId: z.string().cuid(),
        /// Blank means the whole active list — the first-run case.
        itemIds: z.array(z.string().cuid()).max(500).optional(),
        /// Include a label for each labelled part, not just the bin.
        includeUnits: z.boolean().default(true),
      }),
    )
    .query(async ({ ctx, input }) => {
      await assertGarageWrite(ctx.db, input.teamId, ctx.user.id);

      const items = await ctx.db.inventoryItem.findMany({
        where: {
          teamId: input.teamId,
          active: true,
          ...(input.itemIds?.length ? { id: { in: input.itemIds } } : {}),
        },
        orderBy: [{ category: "asc" }, { name: "asc" }],
        select: {
          id: true,
          qrToken: true,
          name: true,
          partNumber: true,
          location: true,
          unit: true,
          category: true,
          trackUnits: true,
          units: input.includeUnits
            ? {
                where: { status: { not: InventoryUnitStatus.RETIRED } },
                orderBy: [{ serial: "asc" }, { createdAt: "asc" }],
                select: { id: true, qrToken: true, serial: true, expiresOn: true },
              }
            : false,
        },
      });

      /*
       * Mint the codes the older lines never got, in one statement rather than
       * one per row. Lines created before labels existed have no token, and a
       * sheet that silently skipped them would look complete while leaving
       * bins unlabelled.
       */
      const unlabelled = items.filter((item) => !item.qrToken);
      const minted = new Map<string, string>();
      if (unlabelled.length > 0) {
        await ctx.db.$transaction(
          unlabelled.map((item) => {
            const token = mintToken();
            minted.set(item.id, token);
            return ctx.db.inventoryItem.update({
              where: { id: item.id },
              data: { qrToken: token },
            });
          }),
        );
      }

      return {
        items: items.map((item) => ({
          ...item,
          qrToken: item.qrToken ?? minted.get(item.id)!,
          units: input.includeUnits ? item.units : [],
        })),
      };
    }),

  /**
   * Take back the last scan.
   *
   * A reversing movement rather than a delete. The ledger is the answer to
   * "who took the last set and when", and a row that can vanish makes it an
   * answer nobody can rely on — so a mistake is recorded as a mistake and
   * corrected, exactly as an accounting reversal is.
   */
  undoScan: protectedProcedure
    .input(z.object({ movementId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const movement = await ctx.db.inventoryMovement.findUnique({
        where: { id: input.movementId },
        select: {
          id: true,
          delta: true,
          unitId: true,
          reversedById: true,
          item: { select: { id: true, teamId: true, quantity: true, name: true } },
          unit: { select: { id: true, status: true } },
        },
      });
      if (!movement) throw new TRPCError({ code: "NOT_FOUND" });
      await assertGarageWrite(ctx.db, movement.item.teamId, ctx.user.id);

      if (movement.reversedById) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "That scan has already been undone.",
        });
      }

      const delta = -movement.delta;
      const balance = movement.item.quantity + delta;
      if (balance < 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Undoing that would take ${movement.item.name} to ${balance}. Something else has moved since — record a stock check instead.`,
        });
      }

      return ctx.db.$transaction(async (tx) => {
        const reversal = await tx.inventoryMovement.create({
          data: {
            itemId: movement.item.id,
            kind: StockMoveKind.ADJUSTED,
            delta,
            balance,
            unitId: movement.unitId,
            reason: "Scanned by mistake",
            userId: ctx.user.id,
          },
        });
        await tx.inventoryMovement.update({
          where: { id: movement.id },
          data: { reversedById: reversal.id },
        });
        await tx.inventoryItem.update({
          where: { id: movement.item.id },
          data: { quantity: balance },
        });
        if (movement.unit) {
          // Back where it was: a scan out is undone by putting it on the shelf.
          await tx.inventoryUnit.update({
            where: { id: movement.unit.id },
            data: {
              status:
                delta > 0
                  ? InventoryUnitStatus.IN_STOCK
                  : InventoryUnitStatus.OUT,
            },
          });
        }
        return reversal;
      });
    }),

  /** The labelled parts behind one stock line. */
  units: protectedProcedure
    .input(
      z.object({
        itemId: z.string().cuid(),
        includeRetired: z.boolean().default(false),
      }),
    )
    .query(async ({ ctx, input }) => {
      const item = await ctx.db.inventoryItem.findUnique({
        where: { id: input.itemId },
        select: { teamId: true, name: true, trackUnits: true },
      });
      if (!item) throw new TRPCError({ code: "NOT_FOUND" });
      const standing = await assertGarageRead(ctx.db, item.teamId, ctx.user.id);

      const units = await ctx.db.inventoryUnit.findMany({
        where: {
          itemId: input.itemId,
          ...(input.includeRetired
            ? {}
            : { status: { not: InventoryUnitStatus.RETIRED } }),
        },
        orderBy: [{ status: "asc" }, { serial: "asc" }, { createdAt: "asc" }],
      });
      return { units, item, canWrite: standing.canWrite };
    }),

  /**
   * Adds labelled parts to a line, and turns on unit tracking if it was off.
   *
   * Serials are optional and given per unit rather than generated. A team's
   * own marking — a casting number, an etched serial, "Gearbox B" — is better
   * than one this platform invents, and a label with nothing written on it
   * still scans perfectly well.
   */
  addUnits: protectedProcedure
    .input(
      z.object({
        itemId: z.string().cuid(),
        count: z.number().int().min(1).max(200).optional(),
        serials: z.array(z.string().trim().min(1).max(80)).max(200).optional(),
        expiresOn: z.date().nullish(),
        notes: z.string().max(2000).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const item = await ctx.db.inventoryItem.findUnique({
        where: { id: input.itemId },
        select: { id: true, teamId: true, quantity: true, trackUnits: true },
      });
      if (!item) throw new TRPCError({ code: "NOT_FOUND" });
      await assertGarageWrite(ctx.db, item.teamId, ctx.user.id);

      const serials = input.serials ?? [];
      const count = input.count ?? serials.length;
      if (count < 1) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Say how many labels to make, or list their serials.",
        });
      }
      if (serials.length > 0 && serials.length !== count) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `You gave ${serials.length} serial(s) for ${count} label(s) — one each, or none at all.`,
        });
      }

      return ctx.db.$transaction(async (tx) => {
        const created = [];
        let balance = item.quantity;
        for (let index = 0; index < count; index += 1) {
          const unit = await tx.inventoryUnit.create({
            data: {
              itemId: item.id,
              qrToken: mintToken(),
              serial: serials[index] ?? null,
              expiresOn: input.expiresOn ?? null,
              notes: input.notes ?? null,
              createdById: ctx.user.id,
            },
          });
          balance += 1;
          // One movement each, not one for the batch: the ledger's job is to
          // say where a specific part came from, and a batch row cannot.
          await tx.inventoryMovement.create({
            data: {
              itemId: item.id,
              unitId: unit.id,
              kind: StockMoveKind.RECEIVED,
              delta: 1,
              balance,
              reason: "Labelled",
              userId: ctx.user.id,
            },
          });
          created.push(unit);
        }
        await tx.inventoryItem.update({
          where: { id: item.id },
          // Turning tracking on here rather than in a separate step: a line
          // with labelled parts on it is a tracked line by definition.
          data: { quantity: balance, trackUnits: true },
        });
        return created;
      });
    }),

  /** Serial, expiry, notes — or retiring a part for good. */
  updateUnit: protectedProcedure
    .input(
      z.object({
        unitId: z.string().cuid(),
        serial: z.string().trim().max(80).nullish(),
        expiresOn: z.date().nullish(),
        notes: z.string().max(2000).nullish(),
        retire: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const unit = await ctx.db.inventoryUnit.findUnique({
        where: { id: input.unitId },
        select: {
          id: true,
          status: true,
          item: { select: { id: true, teamId: true, quantity: true } },
        },
      });
      if (!unit) throw new TRPCError({ code: "NOT_FOUND" });
      await assertGarageWrite(ctx.db, unit.item.teamId, ctx.user.id);

      const { unitId, retire, serial, ...rest } = input;
      const data: Prisma.InventoryUnitUpdateInput = { ...rest };
      // A blank serial is stored as absent, never as "": an empty string reads
      // as "this has a marking" everywhere and then prints nothing.
      if (serial !== undefined) data.serial = serial || null;

      if (!retire) {
        return ctx.db.inventoryUnit.update({ where: { id: unitId }, data });
      }

      /*
       * Retiring takes it off the shelf as well as out of the pick list — but
       * only if it was on the shelf. A part already signed out was counted out
       * when it was scanned, and taking another one off now would double-count
       * a shelf that never held it.
       */
      const onShelf = unit.status === InventoryUnitStatus.IN_STOCK;
      const balance = onShelf ? unit.item.quantity - 1 : unit.item.quantity;

      return ctx.db.$transaction(async (tx) => {
        const updated = await tx.inventoryUnit.update({
          where: { id: unitId },
          data: { ...data, status: InventoryUnitStatus.RETIRED },
        });
        if (onShelf) {
          await tx.inventoryMovement.create({
            data: {
              itemId: unit.item.id,
              unitId: unit.id,
              kind: StockMoveKind.CONSUMED,
              delta: -1,
              balance,
              reason: "Retired",
              userId: ctx.user.id,
            },
          });
          await tx.inventoryItem.update({
            where: { id: unit.item.id },
            data: { quantity: balance },
          });
        }
        return updated;
      });
    }),

  /** The ledger for one line, newest first. */
  movements: protectedProcedure
    .input(
      z.object({
        itemId: z.string().cuid(),
        limit: z.number().int().min(1).max(200).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      const item = await ctx.db.inventoryItem.findUnique({
        where: { id: input.itemId },
        select: { teamId: true },
      });
      if (!item) throw new TRPCError({ code: "NOT_FOUND" });
      await assertGarageRead(ctx.db, item.teamId, ctx.user.id);

      return ctx.db.inventoryMovement.findMany({
        where: { itemId: input.itemId },
        orderBy: { createdAt: "desc" },
        take: input.limit,
        include: {
          user: {
            select: { id: true, profile: { select: { displayName: true } } },
          },
          event: { select: { id: true, name: true } },
        },
      });
    }),

  // -- Telemetry, setups and documents -------------------------------------

  files: protectedProcedure
    .input(
      z.object({
        teamId: z.string().cuid(),
        kind: z.nativeEnum(GarageFileKind).optional(),
        carId: z.string().cuid().optional(),
        trackLayoutId: z.string().cuid().optional(),
        limit: z.number().int().min(1).max(200).default(100),
      }),
    )
    .query(async ({ ctx, input }) => {
      const standing = await assertGarageRead(ctx.db, input.teamId, ctx.user.id);
      const files = await ctx.db.garageFile.findMany({
        where: {
          teamId: input.teamId,
          ...(input.kind ? { kind: input.kind } : {}),
          ...(input.carId ? { carId: input.carId } : {}),
          ...(input.trackLayoutId
            ? { trackLayoutId: input.trackLayoutId }
            : {}),
        },
        orderBy: { createdAt: "desc" },
        take: input.limit,
        include: {
          car: { select: { id: true, name: true } },
          event: { select: { id: true, name: true, date: true } },
          trackLayout: {
            select: {
              id: true,
              name: true,
              track: { select: { id: true, name: true } },
            },
          },
          driver: {
            select: { id: true, profile: { select: { displayName: true } } },
          },
          uploadedBy: {
            select: { id: true, profile: { select: { displayName: true } } },
          },
        },
      });
      return { files, canWrite: standing.canWrite };
    }),

  addFile: protectedProcedure
    .input(
      z.object({
        teamId: z.string().cuid(),
        kind: z.nativeEnum(GarageFileKind),
        name: z.string().min(1).max(200),
        url: z.string().url().max(2000),
        fileName: z.string().max(255).nullish(),
        contentType: z.string().max(120).nullish(),
        sizeBytes: z.number().int().min(0).nullish(),
        carId: z.string().cuid().nullish(),
        eventId: z.string().cuid().nullish(),
        sessionId: z.string().cuid().nullish(),
        trackLayoutId: z.string().cuid().nullish(),
        driverUserId: z.string().cuid().nullish(),
        conditions: z.string().max(200).nullish(),
        bestLapMs: z.number().int().min(1).max(3_600_000).nullish(),
        notes: z.string().max(4000).nullish(),
        tags: z.array(z.string().min(1).max(40)).max(12).default([]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertGarageWrite(ctx.db, input.teamId, ctx.user.id);
      return ctx.db.garageFile.create({
        data: { ...input, uploadedById: ctx.user.id },
      });
    }),

  updateFile: protectedProcedure
    .input(
      z.object({
        fileId: z.string().cuid(),
        name: z.string().min(1).max(200).optional(),
        carId: z.string().cuid().nullish(),
        eventId: z.string().cuid().nullish(),
        sessionId: z.string().cuid().nullish(),
        trackLayoutId: z.string().cuid().nullish(),
        driverUserId: z.string().cuid().nullish(),
        conditions: z.string().max(200).nullish(),
        bestLapMs: z.number().int().min(1).max(3_600_000).nullish(),
        notes: z.string().max(4000).nullish(),
        tags: z.array(z.string().min(1).max(40)).max(12).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { fileId, ...data } = input;
      const file = await ctx.db.garageFile.findUnique({
        where: { id: fileId },
        select: { teamId: true },
      });
      if (!file) throw new TRPCError({ code: "NOT_FOUND" });
      await assertGarageWrite(ctx.db, file.teamId, ctx.user.id);
      return ctx.db.garageFile.update({ where: { id: fileId }, data });
    }),

  /** Removing a file is a manager's call — a setup nobody can find is lost. */
  removeFile: protectedProcedure
    .input(z.object({ fileId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const file = await ctx.db.garageFile.findUnique({
        where: { id: input.fileId },
        select: { teamId: true, uploadedById: true },
      });
      if (!file) throw new TRPCError({ code: "NOT_FOUND" });
      const standing = await assertGarageWrite(
        ctx.db,
        file.teamId,
        ctx.user.id,
      );
      if (!standing.canManage && file.uploadedById !== ctx.user.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only the person who uploaded it or a manager can remove it.",
        });
      }
      await ctx.db.garageFile.delete({ where: { id: input.fileId } });
      return { deleted: true };
    }),

  // -- Servicing -----------------------------------------------------------

  /** Every service record for a team's cars, with what is coming due. */
  services: protectedProcedure
    .input(
      z.object({
        teamId: z.string().cuid(),
        carId: z.string().cuid().optional(),
        status: z.nativeEnum(ServiceStatus).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const standing = await assertGarageRead(ctx.db, input.teamId, ctx.user.id);
      const cars = await ctx.db.car.findMany({
        where: {
          teamId: input.teamId,
          ...(input.carId ? { id: input.carId } : {}),
        },
        select: {
          id: true,
          name: true,
          runningHours: true,
          services: {
            where: input.status ? { status: input.status } : {},
            orderBy: [{ status: "asc" }, { nextDueOn: "asc" }],
            include: {
              event: { select: { id: true, name: true, date: true } },
              performedBy: {
                select: { id: true, profile: { select: { displayName: true } } },
              },
              _count: { select: { partsUsed: true } },
            },
          },
        },
        orderBy: { name: "asc" },
      });

      return {
        canWrite: standing.canWrite,
        cars: cars.map((car) => ({
          ...car,
          // Computed here rather than in the client so the console and any
          // future digest agree on what "overdue" means.
          due: upcomingServices(car.services, car.runningHours),
        })),
      };
    }),

  logService: protectedProcedure
    .input(
      z.object({
        carId: z.string().cuid(),
        kind: z.nativeEnum(ServiceKind).default(ServiceKind.SCHEDULED),
        status: z.nativeEnum(ServiceStatus).default(ServiceStatus.PLANNED),
        component: z.string().min(1).max(160),
        description: z.string().max(4000).nullish(),
        hoursAtService: z.number().min(0).max(100_000).nullish(),
        eventId: z.string().cuid().nullish(),
        performedById: z.string().cuid().nullish(),
        performedOn: z.date().nullish(),
        costMinor: moneySchema,
        currency: z.string().length(3).default("USD"),
        nextDueOn: z.date().nullish(),
        nextDueHours: z.number().min(0).max(100_000).nullish(),
        notes: z.string().max(4000).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const teamId = await teamForCar(ctx.db, input.carId);
      await assertGarageWrite(ctx.db, teamId, ctx.user.id);
      return ctx.db.carService.create({
        data: { ...input, createdById: ctx.user.id },
      });
    }),

  updateService: protectedProcedure
    .input(
      z.object({
        serviceId: z.string().cuid(),
        kind: z.nativeEnum(ServiceKind).optional(),
        status: z.nativeEnum(ServiceStatus).optional(),
        component: z.string().min(1).max(160).optional(),
        description: z.string().max(4000).nullish(),
        hoursAtService: z.number().min(0).max(100_000).nullish(),
        eventId: z.string().cuid().nullish(),
        performedById: z.string().cuid().nullish(),
        performedOn: z.date().nullish(),
        costMinor: moneySchema,
        nextDueOn: z.date().nullish(),
        nextDueHours: z.number().min(0).max(100_000).nullish(),
        notes: z.string().max(4000).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { serviceId, ...data } = input;
      const service = await ctx.db.carService.findUnique({
        where: { id: serviceId },
        select: { carId: true },
      });
      if (!service) throw new TRPCError({ code: "NOT_FOUND" });
      const teamId = await teamForCar(ctx.db, service.carId);
      await assertGarageWrite(ctx.db, teamId, ctx.user.id);

      return ctx.db.carService.update({ where: { id: serviceId }, data });
    }),

  /** Updates a car's running hours, which is what intervals measure against. */
  setRunningHours: protectedProcedure
    .input(
      z.object({
        carId: z.string().cuid(),
        runningHours: z.number().min(0).max(100_000).nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const teamId = await teamForCar(ctx.db, input.carId);
      await assertGarageWrite(ctx.db, teamId, ctx.user.id);
      return ctx.db.car.update({
        where: { id: input.carId },
        data: { runningHours: input.runningHours },
      });
    }),

  // -- Seat time -----------------------------------------------------------

  /**
   * Who has been in the car this season, across every event the team entered.
   *
   * The event-level view answers "is this entry legal"; this answers "who is
   * owed a run", which is the question asked between events and which nothing
   * else on the platform could answer.
   */
  seatTime: protectedProcedure
    .input(
      z.object({
        teamId: z.string().cuid(),
        /// Restricts to events starting on or after this date.
        since: z.date().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      await assertGarageRead(ctx.db, input.teamId, ctx.user.id);

      const stints = await ctx.db.stint.findMany({
        where: {
          registration: {
            teamId: input.teamId,
            ...(input.since ? { event: { date: { gte: input.since } } } : {}),
          },
        },
        select: {
          id: true,
          registrationId: true,
          lineupDriverId: true,
          startedAt: true,
          endedAt: true,
          laps: true,
          lineupDriver: { select: { userId: true } },
          registration: {
            select: {
              event: { select: { id: true, name: true, date: true } },
            },
          },
        },
      });

      const seasonStints: SeasonStint[] = stints.map((stint) => ({
        id: stint.id,
        registrationId: stint.registrationId,
        lineupDriverId: stint.lineupDriverId,
        startedAt: stint.startedAt,
        endedAt: stint.endedAt,
        laps: stint.laps,
        userId: stint.lineupDriver?.userId ?? null,
        eventId: stint.registration.event.id,
        eventName: stint.registration.event.name,
        eventDate: stint.registration.event.date,
      }));

      const summary = seatTimeByDriver(seasonStints);

      // Names for the drivers who appear, plus the current roster, so the
      // console can also show who has *not* been out.
      const roster = await ctx.db.teamMembership.findMany({
        where: { teamId: input.teamId, endDate: null },
        select: {
          role: true,
          user: {
            select: { id: true, profile: { select: { displayName: true } } },
          },
        },
      });

      return {
        ...summary,
        roster: roster.map((member) => ({
          userId: member.user.id,
          role: member.role,
          displayName: member.user.profile?.displayName ?? null,
        })),
      };
    }),
});
