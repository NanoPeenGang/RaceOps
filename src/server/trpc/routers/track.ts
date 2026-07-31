import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  AuditAction,
  LayoutShape,
  Prisma,
  TrackDirection,
  TrackKind,
  TrackRuleKind,
} from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import {
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
} from "@/server/trpc/trpc";
import { slugify } from "@/lib/slug";
import { MAX_TURN_NAME_LENGTH } from "@/lib/tracks";
import { trackRecordsForLayout } from "@/server/services/track-records";
import { recordAudit } from "@/server/services/audit";

/**
 * Tracks are shared reference data rather than something a series owns: two
 * championships racing at the same circuit must be able to compare lap times,
 * which they cannot do if each keeps its own copy of the venue.
 *
 * There is no platform-admin role in RaceOps, so curation is by the person who
 * added the track. Anyone signed in may add one; only its creator may edit it;
 * and a track referenced by an event cannot be deleted at all, because doing
 * so would quietly detach results and records from the place they happened.
 */

/** Finds a free slug, disambiguating "Silverstone" from "Silverstone". */
async function uniqueTrackSlug(
  db: PrismaClient,
  name: string,
  country: string | null | undefined,
): Promise<string> {
  const base = slugify(country ? `${name} ${country}` : name) || "track";
  let candidate = base;
  for (let suffix = 2; suffix < 50; suffix += 1) {
    const clash = await db.track.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!clash) return candidate;
    candidate = `${base}-${suffix}`;
  }
  throw new TRPCError({
    code: "CONFLICT",
    message: "Too many tracks share that name. Add a region to tell them apart.",
  });
}

/**
 * Throws unless the caller may curate this track.
 *
 * Two regimes. A community track is curated by whoever added it. A reference
 * track — the canonical venues shipped with the platform — has no creator, so
 * the same rule would lock it permanently and a typo in a seeded circuit could
 * never be fixed by anyone. Those are open to correction by anyone signed in,
 * with every change written to the audit trail, which is what makes open
 * editing defensible rather than a free-for-all.
 */
async function assertTrackCurator(
  db: PrismaClient,
  trackId: string,
  userId: string,
): Promise<{ isReference: boolean; name: string }> {
  const track = await db.track.findUnique({
    where: { id: trackId },
    select: { createdById: true, isReference: true, name: true },
  });
  if (!track) throw new TRPCError({ code: "NOT_FOUND" });
  if (track.isReference) {
    return { isReference: true, name: track.name };
  }
  if (track.createdById !== userId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "Only the person who added this track can edit it. Ask them, or add the layout you need to a track of your own.",
    });
  }
  return { isReference: false, name: track.name };
}

/** Same check resolved from a layout. */
async function assertLayoutCurator(
  db: PrismaClient,
  layoutId: string,
  userId: string,
): Promise<string> {
  const layout = await db.trackLayout.findUnique({
    where: { id: layoutId },
    select: { trackId: true },
  });
  if (!layout) throw new TRPCError({ code: "NOT_FOUND" });
  await assertTrackCurator(db, layout.trackId, userId);
  return layout.trackId;
}

const layoutInclude = {
  turns: { orderBy: { number: "asc" } },
  sectors: { orderBy: { number: "asc" } },
} satisfies Prisma.TrackLayoutInclude;

export const trackRouter = createTRPCRouter({
  /** Public directory, with a name search for the event venue picker. */
  list: publicProcedure
    .input(
      z.object({
        query: z.string().max(120).optional(),
        kind: z.nativeEnum(TrackKind).optional(),
        country: z.string().length(2).optional(),
        /// State or province, exactly as stored — see `track.facets`.
        region: z.string().max(120).optional(),
        limit: z.number().int().min(1).max(50).default(20),
        cursor: z.string().cuid().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const search = input.query?.trim();
      const items = await ctx.db.track.findMany({
        where: {
          ...(search
            ? {
                OR: [
                  { name: { contains: search, mode: "insensitive" } },
                  { city: { contains: search, mode: "insensitive" } },
                  { region: { contains: search, mode: "insensitive" } },
                ],
              }
            : {}),
          ...(input.kind ? { kind: input.kind } : {}),
          ...(input.country ? { country: input.country.toUpperCase() } : {}),
          ...(input.region ? { region: input.region } : {}),
        },
        take: input.limit + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        orderBy: [{ name: "asc" }],
        include: {
          layouts: {
            where: { active: true },
            orderBy: [{ isPrimary: "desc" }, { name: "asc" }],
            select: {
              id: true,
              name: true,
              platform: true,
              isPrimary: true,
              lengthMeters: true,
              turnCount: true,
              shape: true,
              direction: true,
              diagramUrl: true,
            },
          },
        },
      });
      let nextCursor: string | undefined;
      if (items.length > input.limit) nextCursor = items.pop()!.id;
      return { items, nextCursor };
    }),

  /**
   * What is actually in the directory, for the filter controls.
   *
   * Offering a fixed list of countries and states would be wrong in both
   * directions: it would show fifty empty states to a British club, and hide
   * a venue the moment somebody adds one somewhere we had not thought of. So
   * the filters are built from the rows that exist, with counts, and a filter
   * that would return nothing is simply not offered.
   */
  facets: publicProcedure.query(async ({ ctx }) => {
    const [countries, regions] = await Promise.all([
      ctx.db.track.groupBy({
        by: ["country"],
        _count: { _all: true },
        orderBy: { _count: { id: "desc" } },
      }),
      ctx.db.track.groupBy({
        by: ["country", "region"],
        _count: { _all: true },
        orderBy: [{ country: "asc" }, { region: "asc" }],
      }),
    ]);

    return {
      countries: countries
        .filter((row) => row.country !== null)
        .map((row) => ({ code: row.country!, count: row._count._all })),
      regions: regions
        .filter((row) => row.region !== null)
        .map((row) => ({
          country: row.country,
          region: row.region!,
          count: row._count._all,
        })),
    };
  }),

  bySlug: publicProcedure
    .input(z.object({ slug: z.string().min(1).max(120) }))
    .query(async ({ ctx, input }) => {
      const track = await ctx.db.track.findUnique({
        where: { slug: input.slug },
        include: {
          layouts: {
            orderBy: [{ isPrimary: "desc" }, { name: "asc" }],
            include: {
              ...layoutInclude,
              _count: { select: { events: true } },
            },
          },
          rules: { orderBy: [{ kind: "asc" }, { createdAt: "asc" }] },
          createdBy: { select: { id: true, profile: true } },
        },
      });
      if (!track) throw new TRPCError({ code: "NOT_FOUND" });
      return track;
    }),

  byId: publicProcedure
    .input(z.object({ trackId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const track = await ctx.db.track.findUnique({
        where: { id: input.trackId },
        include: {
          layouts: {
            orderBy: [{ isPrimary: "desc" }, { name: "asc" }],
            include: layoutInclude,
          },
        },
      });
      if (!track) throw new TRPCError({ code: "NOT_FOUND" });
      return track;
    }),

  /**
   * Fastest admissible lap on a layout, overall and per class.
   * Public: a record nobody can see is not a record.
   */
  records: publicProcedure
    .input(
      z.object({
        layoutId: z.string().cuid(),
        seriesId: z.string().cuid().optional(),
        dryOnly: z.boolean().default(false),
      }),
    )
    .query(({ ctx, input }) =>
      trackRecordsForLayout(ctx.db, input.layoutId, {
        seriesId: input.seriesId,
        dryOnly: input.dryOnly,
      }),
    ),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(2).max(120),
        kind: z.nativeEnum(TrackKind).default(TrackKind.CIRCUIT),
        country: z.string().length(2).optional(),
        region: z.string().max(120).optional(),
        city: z.string().max(120).optional(),
        addressLine: z.string().max(200).optional(),
        postalCode: z.string().max(20).optional(),
        latitude: z.number().min(-90).max(90).optional(),
        longitude: z.number().min(-180).max(180).optional(),
        timezone: z.string().max(60).optional(),
        websiteUrl: z.string().url().max(300).optional(),
        licenceGrade: z.string().max(80).optional(),
        pitBoxCount: z.number().int().min(0).max(200).optional(),
        garageCount: z.number().int().min(0).max(200).optional(),
        notes: z.string().max(4000).optional(),
        /// Created alongside the track so a new venue is immediately usable.
        firstLayoutName: z.string().min(1).max(80).default("Full course"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { firstLayoutName, country, ...rest } = input;
      const normalizedCountry = country?.toUpperCase();
      const slug = await uniqueTrackSlug(ctx.db, input.name, normalizedCountry);
      return ctx.db.track.create({
        data: {
          ...rest,
          country: normalizedCountry,
          slug,
          createdById: ctx.user.id,
          layouts: { create: { name: firstLayoutName, isPrimary: true } },
        },
        include: { layouts: true },
      });
    }),

  update: protectedProcedure
    .input(
      z.object({
        trackId: z.string().cuid(),
        name: z.string().min(2).max(120).optional(),
        kind: z.nativeEnum(TrackKind).optional(),
        country: z.string().length(2).nullish(),
        region: z.string().max(120).nullish(),
        city: z.string().max(120).nullish(),
        addressLine: z.string().max(200).nullish(),
        postalCode: z.string().max(20).nullish(),
        latitude: z.number().min(-90).max(90).nullish(),
        longitude: z.number().min(-180).max(180).nullish(),
        timezone: z.string().max(60).nullish(),
        websiteUrl: z.string().url().max(300).nullish(),
        licenceGrade: z.string().max(80).nullish(),
        pitBoxCount: z.number().int().min(0).max(200).nullish(),
        garageCount: z.number().int().min(0).max(200).nullish(),
        notes: z.string().max(4000).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { trackId, country, ...rest } = input;
      const track = await assertTrackCurator(ctx.db, trackId, ctx.user.id);
      if (track.isReference) {
        // Open editing is only defensible with a trail: a reference track is
        // shared by every series, so a wrong correction has to be traceable.
        await recordAudit(ctx.db, {
          actorId: ctx.user.id,
          action: AuditAction.UPDATE,
          entityType: "Track",
          entityId: trackId,
          summary: `Corrected the reference track "${track.name}"`,
        });
      }
      return ctx.db.track.update({
        where: { id: trackId },
        // The slug is deliberately left alone on rename: it is in URLs that
        // have already been shared, and a circuit changing sponsor name is
        // not a reason to break every link to it.
        data: {
          ...rest,
          ...(country === undefined
            ? {}
            : { country: country ? country.toUpperCase() : null }),
        },
      });
    }),

  delete: protectedProcedure
    .input(z.object({ trackId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const track = await assertTrackCurator(ctx.db, input.trackId, ctx.user.id);
      if (track.isReference) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "This is a reference track shared by everyone on RaceOps. Correct it if something is wrong, but it cannot be deleted.",
        });
      }
      const used = await ctx.db.raceEvent.count({
        where: { trackLayout: { trackId: input.trackId } },
      });
      if (used > 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `${used} event${used === 1 ? " has" : "s have"} been run here. Tracks with history cannot be deleted.`,
        });
      }
      await ctx.db.track.delete({ where: { id: input.trackId } });
      return { deleted: true };
    }),

  // -- Facility rules ------------------------------------------------------

  /*
   * Rules are curated exactly like the track they hang off: the person who
   * added the venue, or anyone signed in on a reference track. Deliberately
   * not restricted to the facility itself — RaceOps has no way to prove
   * somebody works for a circuit, and the club that runs there every month
   * knows the sound limit better than a verification flow would.
   */

  addRule: protectedProcedure
    .input(
      z.object({
        trackId: z.string().cuid(),
        kind: z.nativeEnum(TrackRuleKind),
        title: z.string().min(3).max(160),
        detail: z.string().max(4000).optional(),
        source: z.string().max(200).optional(),
        sourceUrl: z.string().url().max(600).optional(),
        verifiedOn: z.date().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { trackId, ...rest } = input;
      const track = await assertTrackCurator(ctx.db, trackId, ctx.user.id);
      if (track.isReference) {
        await recordAudit(ctx.db, {
          actorId: ctx.user.id,
          action: AuditAction.CREATE,
          entityType: "TrackRule",
          entityId: trackId,
          summary: `Added a facility rule to "${track.name}": ${input.title}`,
        });
      }
      return ctx.db.trackRule.create({ data: { ...rest, trackId } });
    }),

  updateRule: protectedProcedure
    .input(
      z.object({
        ruleId: z.string().cuid(),
        kind: z.nativeEnum(TrackRuleKind).optional(),
        title: z.string().min(3).max(160).optional(),
        detail: z.string().max(4000).nullish(),
        source: z.string().max(200).nullish(),
        sourceUrl: z.string().url().max(600).nullish(),
        verifiedOn: z.date().nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { ruleId, ...rest } = input;
      const rule = await ctx.db.trackRule.findUnique({
        where: { id: ruleId },
        select: { trackId: true, title: true },
      });
      if (!rule) throw new TRPCError({ code: "NOT_FOUND" });
      const track = await assertTrackCurator(ctx.db, rule.trackId, ctx.user.id);
      if (track.isReference) {
        await recordAudit(ctx.db, {
          actorId: ctx.user.id,
          action: AuditAction.UPDATE,
          entityType: "TrackRule",
          entityId: ruleId,
          summary: `Corrected a facility rule on "${track.name}": ${rule.title}`,
        });
      }
      return ctx.db.trackRule.update({ where: { id: ruleId }, data: rest });
    }),

  /**
   * Marks a rule as checked today.
   *
   * Separate from `updateRule` because it is a different act: confirming a
   * limit is still what it says is the common case, and burying it inside an
   * edit form means nobody ever does it and every rule looks stale.
   */
  verifyRule: protectedProcedure
    .input(z.object({ ruleId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const rule = await ctx.db.trackRule.findUnique({
        where: { id: input.ruleId },
        select: { trackId: true },
      });
      if (!rule) throw new TRPCError({ code: "NOT_FOUND" });
      await assertTrackCurator(ctx.db, rule.trackId, ctx.user.id);
      return ctx.db.trackRule.update({
        where: { id: input.ruleId },
        data: { verifiedOn: new Date() },
      });
    }),

  deleteRule: protectedProcedure
    .input(z.object({ ruleId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const rule = await ctx.db.trackRule.findUnique({
        where: { id: input.ruleId },
        select: { trackId: true, title: true },
      });
      if (!rule) throw new TRPCError({ code: "NOT_FOUND" });
      const track = await assertTrackCurator(ctx.db, rule.trackId, ctx.user.id);
      if (track.isReference) {
        await recordAudit(ctx.db, {
          actorId: ctx.user.id,
          action: AuditAction.DELETE,
          entityType: "TrackRule",
          entityId: input.ruleId,
          summary: `Removed a facility rule from "${track.name}": ${rule.title}`,
        });
      }
      await ctx.db.trackRule.delete({ where: { id: input.ruleId } });
      return { deleted: true };
    }),

  // -- Layouts -------------------------------------------------------------

  addLayout: protectedProcedure
    .input(
      z.object({
        trackId: z.string().cuid(),
        name: z.string().min(1).max(80),
        platform: z.string().max(80).optional(),
        lengthMeters: z.number().int().min(1).max(200_000).optional(),
        direction: z.nativeEnum(TrackDirection).default(TrackDirection.CLOCKWISE),
        elevationMeters: z.number().int().min(0).max(5_000).optional(),
        turnCount: z.number().int().min(1).max(100).optional(),
        shape: z.nativeEnum(LayoutShape).optional(),
        bankingDegrees: z.number().int().min(0).max(60).optional(),
        diagramUrl: z.string().url().max(600).optional(),
        diagramCredit: z.string().max(200).optional(),
        notes: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { trackId, ...rest } = input;
      await assertTrackCurator(ctx.db, trackId, ctx.user.id);
      const existing = await ctx.db.trackLayout.count({ where: { trackId } });
      try {
        return await ctx.db.trackLayout.create({
          data: { ...rest, trackId, isPrimary: existing === 0 },
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "This track already has a layout with that name.",
          });
        }
        throw error;
      }
    }),

  updateLayout: protectedProcedure
    .input(
      z.object({
        layoutId: z.string().cuid(),
        name: z.string().min(1).max(80).optional(),
        platform: z.string().max(80).nullish(),
        lengthMeters: z.number().int().min(1).max(200_000).nullish(),
        direction: z.nativeEnum(TrackDirection).optional(),
        elevationMeters: z.number().int().min(0).max(5_000).nullish(),
        turnCount: z.number().int().min(1).max(100).nullish(),
        shape: z.nativeEnum(LayoutShape).nullish(),
        bankingDegrees: z.number().int().min(0).max(60).nullish(),
        diagramUrl: z.string().url().max(600).nullish(),
        diagramCredit: z.string().max(200).nullish(),
        active: z.boolean().optional(),
        notes: z.string().max(2000).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { layoutId, ...rest } = input;
      await assertLayoutCurator(ctx.db, layoutId, ctx.user.id);
      return ctx.db.trackLayout.update({ where: { id: layoutId }, data: rest });
    }),

  /** Moves the "primary" flag, which is what events default to. */
  setPrimaryLayout: protectedProcedure
    .input(z.object({ layoutId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const trackId = await assertLayoutCurator(
        ctx.db,
        input.layoutId,
        ctx.user.id,
      );
      // A partial unique index enforces one primary per track, so the clear
      // and the set have to happen together or the write fails halfway.
      await ctx.db.$transaction([
        ctx.db.trackLayout.updateMany({
          where: { trackId, isPrimary: true },
          data: { isPrimary: false },
        }),
        ctx.db.trackLayout.update({
          where: { id: input.layoutId },
          data: { isPrimary: true },
        }),
      ]);
      return { ok: true };
    }),

  deleteLayout: protectedProcedure
    .input(z.object({ layoutId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertLayoutCurator(ctx.db, input.layoutId, ctx.user.id);
      const used = await ctx.db.raceEvent.count({
        where: { trackLayoutId: input.layoutId },
      });
      if (used > 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Events have been run on this layout. Mark it inactive instead — that hides it from the picker without detaching the results.",
        });
      }
      await ctx.db.trackLayout.delete({ where: { id: input.layoutId } });
      return { deleted: true };
    }),

  // -- Turns & sectors -----------------------------------------------------

  /**
   * Replaces a layout's turns wholesale. Corner numbering is edited as a set
   * — renumbering one turn on a circuit that has added a chicane means
   * renumbering all of them — so a diffing API would be harder to use and
   * would leave gaps mid-edit.
   */
  setTurns: protectedProcedure
    .input(
      z.object({
        layoutId: z.string().cuid(),
        turns: z
          .array(
            z.object({
              number: z.number().int().min(1).max(200),
              name: z.string().max(MAX_TURN_NAME_LENGTH).nullish(),
              sector: z.number().int().min(1).max(20).nullish(),
              marshalPost: z.string().max(40).nullish(),
              notes: z.string().max(500).nullish(),
            }),
          )
          .max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertLayoutCurator(ctx.db, input.layoutId, ctx.user.id);

      const numbers = new Set(input.turns.map((turn) => turn.number));
      if (numbers.size !== input.turns.length) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Two turns share a number.",
        });
      }

      // Incidents point at turns. Deleting and recreating would null every
      // one of those references (the FK is ON DELETE SET NULL), so existing
      // numbers are updated in place and only genuinely removed turns go.
      const existing = await ctx.db.trackTurn.findMany({
        where: { layoutId: input.layoutId },
        select: { id: true, number: true },
      });
      const byNumber = new Map(existing.map((turn) => [turn.number, turn.id]));

      await ctx.db.$transaction([
        ctx.db.trackTurn.deleteMany({
          where: {
            layoutId: input.layoutId,
            number: { notIn: [...numbers] },
          },
        }),
        ...input.turns.map((turn) => {
          const id = byNumber.get(turn.number);
          const data = {
            name: turn.name ?? null,
            sector: turn.sector ?? null,
            marshalPost: turn.marshalPost ?? null,
            notes: turn.notes ?? null,
          };
          return id
            ? ctx.db.trackTurn.update({ where: { id }, data })
            : ctx.db.trackTurn.create({
                data: { ...data, layoutId: input.layoutId, number: turn.number },
              });
        }),
      ]);

      return ctx.db.trackTurn.findMany({
        where: { layoutId: input.layoutId },
        orderBy: { number: "asc" },
      });
    }),

  setSectors: protectedProcedure
    .input(
      z.object({
        layoutId: z.string().cuid(),
        sectors: z
          .array(
            z.object({
              number: z.number().int().min(1).max(20),
              name: z.string().max(60).nullish(),
              lengthMeters: z.number().int().min(1).max(200_000).nullish(),
            }),
          )
          .max(20),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertLayoutCurator(ctx.db, input.layoutId, ctx.user.id);
      const numbers = input.sectors.map((sector) => sector.number);
      if (new Set(numbers).size !== numbers.length) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Two sectors share a number.",
        });
      }
      await ctx.db.$transaction([
        ctx.db.trackSector.deleteMany({ where: { layoutId: input.layoutId } }),
        ctx.db.trackSector.createMany({
          data: input.sectors.map((sector) => ({
            layoutId: input.layoutId,
            number: sector.number,
            name: sector.name ?? null,
            lengthMeters: sector.lengthMeters ?? null,
          })),
        }),
      ]);
      return ctx.db.trackSector.findMany({
        where: { layoutId: input.layoutId },
        orderBy: { number: "asc" },
      });
    }),
});
