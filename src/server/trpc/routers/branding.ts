import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { Permission } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import {
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
} from "@/server/trpc/trpc";
import { normalizeHex, resolveBranding } from "@/lib/branding";
import {
  brandingForEvent,
  brandingForOrganization,
  brandingForSeries,
  brandingForTeam,
} from "@/server/services/branding";
import {
  assertEventOrganizer,
  assertSeriesRole,
  SERIES_ADMIN_ROLES,
} from "@/server/services/series-auth";
import { TEAM_MANAGER_ROLES } from "@/lib/teams";

/**
 * Branding: the logo, banner and colours on a public page.
 *
 * One router for four scopes because the shape and the rules are identical;
 * only the permission check differs. Splitting it four ways would mean four
 * places to keep the colour validation in step.
 */

const scopeSchema = z
  .object({
    organizationId: z.string().cuid().optional(),
    seriesId: z.string().cuid().optional(),
    eventId: z.string().cuid().optional(),
    teamId: z.string().cuid().optional(),
  })
  .refine(
    (scope) => Object.values(scope).filter(Boolean).length === 1,
    "Brand exactly one of an organization, series, event or team.",
  );

type Scope = z.infer<typeof scopeSchema>;

/** Whoever administers the thing may brand it. */
async function assertCanBrand(
  db: PrismaClient,
  scope: Scope,
  userId: string,
): Promise<void> {
  if (scope.seriesId) {
    await assertSeriesRole(db, scope.seriesId, userId, SERIES_ADMIN_ROLES);
    return;
  }
  if (scope.eventId) {
    await assertEventOrganizer(db, scope.eventId, userId, SERIES_ADMIN_ROLES);
    return;
  }
  if (scope.teamId) {
    const membership = await db.teamMembership.findUnique({
      where: { teamId_userId: { teamId: scope.teamId, userId } },
      select: { role: true, endDate: true },
    });
    if (
      !membership ||
      membership.endDate !== null ||
      !TEAM_MANAGER_ROLES.includes(membership.role)
    ) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Only the team's owner or a manager can change its branding.",
      });
    }
    return;
  }
  if (scope.organizationId) {
    const [membership, assignments] = await Promise.all([
      db.organizationMembership.findUnique({
        where: {
          organizationId_userId: {
            organizationId: scope.organizationId,
            userId,
          },
        },
        select: { role: true },
      }),
      db.staffAssignment.findMany({
        where: {
          userId,
          staffRole: {
            organizationId: scope.organizationId,
            permissions: { has: Permission.ORG_MANAGE },
          },
        },
        select: { id: true },
      }),
    ]);
    const isAdmin =
      membership?.role === "OWNER" || membership?.role === "ADMIN";
    if (!isAdmin && assignments.length === 0) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "You do not have permission to change this branding.",
      });
    }
    return;
  }
  throw new TRPCError({ code: "BAD_REQUEST" });
}

/**
 * Colour input.
 *
 * Normalized rather than rejected on case or a missing `#`: people paste
 * `d91e1e` from a brand guide as often as `#D91E1E`, and refusing that is a
 * pointless obstacle. Genuinely unparseable input is rejected, because storing
 * it would render as the default with no explanation.
 */
const colourSchema = z
  .string()
  // Loose enough that a pasted CSS colour name reaches the hex check and gets
  // "use a hex colour like #D91E1E" rather than "too long", which tells
  // someone nothing about what they did wrong.
  .max(32)
  .nullish()
  .transform((value, ctx) => {
    if (value === null || value === undefined || value.trim() === "") {
      return null;
    }
    const normalized = normalizeHex(value);
    if (!normalized) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Use a hex colour like #D91E1E.",
      });
      return z.NEVER;
    }
    return normalized;
  });

export const brandingRouter = createTRPCRouter({
  /**
   * The resolved theme for a scope, inheritance applied. Public: it is what a
   * landing page renders, and landing pages are public.
   */
  resolved: publicProcedure
    .input(scopeSchema)
    .query(async ({ ctx, input }) => {
      if (input.eventId) return brandingForEvent(ctx.db, input.eventId);
      if (input.seriesId) return brandingForSeries(ctx.db, input.seriesId);
      if (input.teamId) return brandingForTeam(ctx.db, input.teamId);
      if (input.organizationId) {
        return brandingForOrganization(ctx.db, input.organizationId);
      }
      return resolveBranding();
    }),

  /**
   * What this scope sets *itself*, as opposed to what it inherits.
   *
   * The editor needs both: showing the resolved theme in the form would make
   * an inherited colour look like one this scope had chosen, and clearing it
   * would then appear to do nothing.
   */
  own: protectedProcedure
    .input(scopeSchema)
    .query(async ({ ctx, input }) => {
      await assertCanBrand(ctx.db, input, ctx.user.id);
      const branding = await ctx.db.branding.findFirst({
        where: {
          organizationId: input.organizationId ?? null,
          seriesId: input.seriesId ?? null,
          eventId: input.eventId ?? null,
          teamId: input.teamId ?? null,
        },
      });
      const inherited = input.eventId
        ? await brandingForEvent(ctx.db, input.eventId)
        : input.seriesId
          ? await brandingForSeries(ctx.db, input.seriesId)
          : input.teamId
            ? await brandingForTeam(ctx.db, input.teamId)
            : await brandingForOrganization(ctx.db, input.organizationId!);
      return { own: branding, inherited };
    }),

  update: protectedProcedure
    .input(
      scopeSchema.and(
        z.object({
          logoUrl: z.string().url().max(2000).nullish(),
          bannerUrl: z.string().url().max(2000).nullish(),
          primaryColor: colourSchema,
          accentColor: colourSchema,
          tagline: z.string().max(160).nullish(),
        }),
      ),
    )
    .mutation(async ({ ctx, input }) => {
      const {
        organizationId,
        seriesId,
        eventId,
        teamId,
        ...fields
      } = input;
      const scope = { organizationId, seriesId, eventId, teamId };
      await assertCanBrand(ctx.db, scope, ctx.user.id);

      const owner = {
        organizationId: organizationId ?? null,
        seriesId: seriesId ?? null,
        eventId: eventId ?? null,
        teamId: teamId ?? null,
      };
      // findFirst + create rather than upsert: the unique columns are
      // nullable, and Postgres does not treat two NULLs as equal, so an
      // upsert against them would insert a second row instead of updating.
      const existing = await ctx.db.branding.findFirst({
        where: owner,
        select: { id: true },
      });

      return existing
        ? ctx.db.branding.update({ where: { id: existing.id }, data: fields })
        : ctx.db.branding.create({ data: { ...owner, ...fields } });
    }),

  /** Drop this scope's own branding so it inherits again. */
  reset: protectedProcedure
    .input(scopeSchema)
    .mutation(async ({ ctx, input }) => {
      await assertCanBrand(ctx.db, input, ctx.user.id);
      await ctx.db.branding.deleteMany({
        where: {
          organizationId: input.organizationId ?? null,
          seriesId: input.seriesId ?? null,
          eventId: input.eventId ?? null,
          teamId: input.teamId ?? null,
        },
      });
      return { reset: true };
    }),
});
