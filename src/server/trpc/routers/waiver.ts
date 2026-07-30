import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { AuditAction, LogCategory, WaiverAudience } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import {
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
} from "@/server/trpc/trpc";
import {
  assertEventOrganizer,
  assertSeriesRole,
  SERIES_ADMIN_ROLES,
} from "@/server/services/series-auth";
import {
  isAcceptableSignature,
  outstandingWaivers,
  signingCapacity,
  waiverStatuses,
  type ParticipantRole,
} from "@/lib/waivers";
import { waiversForEvent } from "@/server/services/waivers";
import { recordAudit } from "@/server/services/audit";
import { logOfficialAction } from "@/server/services/officials-log";

/**
 * Waivers and e-signature.
 *
 * Two rules run through everything here. Wording is versioned rather than
 * edited, because a signature only means something against the exact text that
 * was on screen. And signatures are never edited or deleted: a withdrawn
 * consent is a new fact, not an erasure, so there is deliberately no mutation
 * that removes one.
 */

const scopeSchema = z
  .object({
    seriesId: z.string().cuid().optional(),
    eventId: z.string().cuid().optional(),
  })
  .refine(
    (scope) => Boolean(scope.seriesId) !== Boolean(scope.eventId),
    "Scope a waiver to a series or an event, not both.",
  );

type Scope = z.infer<typeof scopeSchema>;

async function assertScopeAdmin(
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
  throw new TRPCError({ code: "BAD_REQUEST" });
}

export const waiverRouter = createTRPCRouter({
  /**
   * Waivers in force for a scope. Public: someone deciding whether to enter is
   * entitled to read what they will be asked to sign first.
   */
  list: publicProcedure
    .input(scopeSchema)
    .query(async ({ ctx, input }) =>
      ctx.db.waiver.findMany({
        where: {
          ...(input.seriesId ? { seriesId: input.seriesId } : {}),
          ...(input.eventId ? { eventId: input.eventId } : {}),
          active: true,
        },
        orderBy: { createdAt: "asc" },
      }),
    ),

  /**
   * Every waiver that applies at an event — its own and its series'.
   * This is the list an entrant actually has to satisfy.
   */
  forEvent: publicProcedure
    .input(z.object({ eventId: z.string().cuid() }))
    .query(({ ctx, input }) => waiversForEvent(ctx.db, input.eventId)),

  byId: publicProcedure
    .input(z.object({ waiverId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const waiver = await ctx.db.waiver.findUnique({
        where: { id: input.waiverId },
        include: {
          event: { select: { id: true, name: true } },
          series: { select: { id: true, name: true, slug: true } },
        },
      });
      if (!waiver) throw new TRPCError({ code: "NOT_FOUND" });
      return waiver;
    }),

  /** How the caller stands against everything they need to sign. */
  mine: protectedProcedure
    .input(
      z.object({
        eventId: z.string().cuid(),
        role: z
          .enum(["driver", "crew", "volunteer", "pass_holder"])
          .default("driver"),
      }),
    )
    .query(async ({ ctx, input }) => {
      const waivers = await waiversForEvent(ctx.db, input.eventId);
      const signatures = await ctx.db.waiverSignature.findMany({
        where: {
          signerUserId: ctx.user.id,
          waiverId: { in: waivers.map((waiver) => waiver.id) },
        },
        select: {
          waiverId: true,
          waiverVersion: true,
          signerUserId: true,
          signedName: true,
          signedAt: true,
        },
      });
      const profile = await ctx.db.profile.findUnique({
        where: { userId: ctx.user.id },
        select: { dateOfBirth: true },
      });

      const statuses = waiverStatuses(
        waivers,
        signatures,
        ctx.user.id,
        input.role as ParticipantRole,
      );
      return {
        waivers,
        signatures,
        statuses,
        outstanding: outstandingWaivers(statuses),
        capacity: Object.fromEntries(
          waivers.map((waiver) => [
            waiver.id,
            signingCapacity(waiver, profile?.dateOfBirth ?? null),
          ]),
        ),
      };
    }),

  /**
   * Sign a waiver.
   *
   * The typed name is the signature; the version, time, address and user agent
   * are what make it hold up. Signing an older version than the one in force
   * is refused outright — a signature has to be against the wording that was
   * actually on screen.
   */
  sign: protectedProcedure
    .input(
      z.object({
        waiverId: z.string().cuid(),
        /// The version the signer was shown. Checked against the live one.
        waiverVersion: z.number().int().min(1),
        signedName: z.string().min(2).max(120),
        registrationId: z.string().cuid().optional(),
        guardianName: z.string().max(120).optional(),
        guardianRelation: z.string().max(60).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const waiver = await ctx.db.waiver.findUnique({
        where: { id: input.waiverId },
        select: {
          id: true,
          title: true,
          version: true,
          active: true,
          minSigningAge: true,
          eventId: true,
          seriesId: true,
        },
      });
      if (!waiver) throw new TRPCError({ code: "NOT_FOUND" });
      if (!waiver.active) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "This waiver is no longer in force.",
        });
      }

      // The client sends back the version it rendered. A mismatch means the
      // wording changed between load and submit, and signing the old text
      // would produce a signature against something nobody agreed to.
      if (input.waiverVersion !== waiver.version) {
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "The wording of this waiver has changed since you opened it. Please read it again and sign the current version.",
        });
      }

      if (!isAcceptableSignature(input.signedName)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Type your name to sign.",
        });
      }

      const profile = await ctx.db.profile.findUnique({
        where: { userId: ctx.user.id },
        select: { dateOfBirth: true },
      });
      const capacity = signingCapacity(waiver, profile?.dateOfBirth ?? null);
      if (capacity === "guardian" && !input.guardianName) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `You must be ${waiver.minSigningAge} to sign this yourself. A parent or guardian has to sign on your behalf.`,
        });
      }

      const existing = await ctx.db.waiverSignature.findFirst({
        where: {
          waiverId: waiver.id,
          waiverVersion: waiver.version,
          signerUserId: ctx.user.id,
        },
      });
      // Idempotent rather than an error: a double submit on a slow form is a
      // person signing once, and refusing the second click would be confusing.
      if (existing) return existing;

      const signature = await ctx.db.waiverSignature.create({
        data: {
          waiverId: waiver.id,
          waiverVersion: waiver.version,
          signerUserId: ctx.user.id,
          signedName: input.signedName.trim(),
          signedEmail: ctx.user.email,
          registrationId: input.registrationId,
          guardianName: input.guardianName,
          guardianRelation: input.guardianRelation,
          // Evidence, not decoration: these are what a signature rests on.
          // `x-forwarded-for` is the client address behind Vercel's proxy.
          ipAddress:
            ctx.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
          userAgent: ctx.headers.get("user-agent") ?? null,
        },
      });

      await recordAudit(ctx.db, {
        actorId: ctx.user.id,
        action: AuditAction.CREATE,
        entityType: "WaiverSignature",
        entityId: signature.id,
        eventId: waiver.eventId,
        seriesId: waiver.seriesId,
        summary: `Signed "${waiver.title}" v${waiver.version}`,
      });

      return signature;
    }),

  /** Signatures collected, for accreditation and for the insurer. */
  signatures: protectedProcedure
    .input(
      z.object({
        waiverId: z.string().cuid(),
        limit: z.number().int().min(1).max(500).default(100),
        cursor: z.string().cuid().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const waiver = await ctx.db.waiver.findUnique({
        where: { id: input.waiverId },
        select: { seriesId: true, eventId: true },
      });
      if (!waiver) throw new TRPCError({ code: "NOT_FOUND" });
      await assertScopeAdmin(
        ctx.db,
        { seriesId: waiver.seriesId ?? undefined, eventId: waiver.eventId ?? undefined },
        ctx.user.id,
      );

      const items = await ctx.db.waiverSignature.findMany({
        where: { waiverId: input.waiverId },
        take: input.limit + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        orderBy: { signedAt: "desc" },
        include: {
          signer: {
            select: { id: true, profile: { select: { displayName: true } } },
          },
          registration: { select: { id: true, carNumber: true } },
        },
      });
      let nextCursor: string | undefined;
      if (items.length > input.limit) nextCursor = items.pop()!.id;
      return { items, nextCursor };
    }),

  create: protectedProcedure
    .input(
      scopeSchema.and(
        z.object({
          title: z.string().min(3).max(160),
          body: z.string().min(20).max(50_000),
          audience: z
            .nativeEnum(WaiverAudience)
            .default(WaiverAudience.ALL_PARTICIPANTS),
          required: z.boolean().default(true),
          minSigningAge: z.number().int().min(1).max(25).optional(),
        }),
      ),
    )
    .mutation(async ({ ctx, input }) => {
      await assertScopeAdmin(ctx.db, input, ctx.user.id);
      const waiver = await ctx.db.waiver.create({
        data: { ...input, createdById: ctx.user.id },
      });
      await recordAudit(ctx.db, {
        actorId: ctx.user.id,
        action: AuditAction.CREATE,
        entityType: "Waiver",
        entityId: waiver.id,
        eventId: input.eventId ?? null,
        seriesId: input.seriesId ?? null,
        summary: `Published waiver "${waiver.title}"`,
      });
      return waiver;
    }),

  /**
   * Change a waiver.
   *
   * Editing the wording bumps the version and invalidates every signature
   * against the old text, which is the correct and unavoidable consequence:
   * people signed the old words. Changing only the title or the audience does
   * not, because neither is part of what was agreed to.
   */
  update: protectedProcedure
    .input(
      z.object({
        waiverId: z.string().cuid(),
        title: z.string().min(3).max(160).optional(),
        body: z.string().min(20).max(50_000).optional(),
        audience: z.nativeEnum(WaiverAudience).optional(),
        required: z.boolean().optional(),
        minSigningAge: z.number().int().min(1).max(25).nullish(),
        active: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const waiver = await ctx.db.waiver.findUnique({
        where: { id: input.waiverId },
        select: {
          seriesId: true,
          eventId: true,
          body: true,
          version: true,
          title: true,
        },
      });
      if (!waiver) throw new TRPCError({ code: "NOT_FOUND" });
      await assertScopeAdmin(
        ctx.db,
        { seriesId: waiver.seriesId ?? undefined, eventId: waiver.eventId ?? undefined },
        ctx.user.id,
      );

      const { waiverId, ...data } = input;
      const wordingChanged =
        data.body !== undefined && data.body !== waiver.body;

      const updated = await ctx.db.waiver.update({
        where: { id: waiverId },
        data: {
          ...data,
          ...(wordingChanged ? { version: { increment: 1 } } : {}),
        },
      });

      await recordAudit(ctx.db, {
        actorId: ctx.user.id,
        action: AuditAction.UPDATE,
        entityType: "Waiver",
        entityId: waiverId,
        eventId: waiver.eventId,
        seriesId: waiver.seriesId,
        summary: wordingChanged
          ? `Reissued "${updated.title}" as v${updated.version} — earlier signatures no longer cover it`
          : `Edited waiver "${updated.title}"`,
        ...(wordingChanged
          ? { changes: { version: { from: waiver.version, to: updated.version } } }
          : {}),
      });

      if (wordingChanged && waiver.eventId) {
        await logOfficialAction(ctx.db, {
          eventId: waiver.eventId,
          category: LogCategory.DOCUMENT,
          summary: `${updated.title} reissued as v${updated.version}`,
          detail: "Signatures against the previous version no longer apply.",
          officialId: ctx.user.id,
          published: true,
        });
      }

      return updated;
    }),

  /**
   * Retire a waiver. Never deleted while it has signatures: those signatures
   * are the record of what people agreed to, and they have to be producible
   * years later.
   */
  retire: protectedProcedure
    .input(z.object({ waiverId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const waiver = await ctx.db.waiver.findUnique({
        where: { id: input.waiverId },
        select: {
          seriesId: true,
          eventId: true,
          _count: { select: { signatures: true } },
        },
      });
      if (!waiver) throw new TRPCError({ code: "NOT_FOUND" });
      await assertScopeAdmin(
        ctx.db,
        { seriesId: waiver.seriesId ?? undefined, eventId: waiver.eventId ?? undefined },
        ctx.user.id,
      );

      if (waiver._count.signatures > 0) {
        return ctx.db.waiver.update({
          where: { id: input.waiverId },
          data: { active: false, supersededAt: new Date() },
        });
      }
      await ctx.db.waiver.delete({ where: { id: input.waiverId } });
      return null;
    }),
});
