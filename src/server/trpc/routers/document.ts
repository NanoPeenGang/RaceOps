import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  AnnouncementUrgency,
  DocumentType,
  DocumentVisibility,
  NotificationType,
} from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import {
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
} from "@/server/trpc/trpc";
import {
  assertEventOrganizer,
  assertSeriesRole,
  getSeriesRole,
  SERIES_EVENT_ROLES,
} from "@/server/services/series-auth";
import { notify } from "@/server/services/notifications";
import {
  credentialSheetDocument,
  entryListDocument,
  gridDocument,
  timetableDocument,
  timingSheetDocument,
} from "@/server/services/race-documents";
import { commentatorPack } from "@/server/services/commentator-pack";

/**
 * Regulations library and organizer notices.
 *
 * Documents (rule books, supplementary regs, tech sheets, race-control
 * bulletins, entry lists, approved media kits) attach to a series for the
 * season or to a single event. Announcements are messages rather than files.
 */

const scopeSchema = z
  .object({
    seriesId: z.string().cuid().optional(),
    eventId: z.string().cuid().optional(),
  })
  .refine(
    (scope) => Boolean(scope.seriesId) !== Boolean(scope.eventId),
    "Attach to exactly one of a series or an event.",
  );

type Scope = z.infer<typeof scopeSchema>;

async function assertScopeOrganizer(
  db: PrismaClient,
  scope: Scope,
  userId: string,
): Promise<void> {
  if (scope.seriesId) {
    await assertSeriesRole(db, scope.seriesId, userId, SERIES_EVENT_ROLES);
    return;
  }
  if (scope.eventId) {
    await assertEventOrganizer(db, scope.eventId, userId, SERIES_EVENT_ROLES);
    return;
  }
  throw new TRPCError({ code: "BAD_REQUEST", message: "No scope provided." });
}

/** Resolves the series a scope belongs to, for visibility checks. */
async function seriesIdForScope(
  db: PrismaClient,
  scope: Scope,
): Promise<string | null> {
  if (scope.seriesId) return scope.seriesId;
  if (!scope.eventId) return null;
  const event = await db.raceEvent.findUnique({
    where: { id: scope.eventId },
    select: { seriesId: true },
  });
  return event?.seriesId ?? null;
}

/** Everyone entered in a series or event, for notice fan-out. */
async function competitorContacts(
  db: PrismaClient,
  scope: Scope,
): Promise<string[]> {
  const registrations = await db.eventRegistration.findMany({
    where: {
      status: { in: ["PENDING", "CONFIRMED", "WAITLISTED"] },
      event: scope.eventId
        ? { id: scope.eventId }
        : { seriesId: scope.seriesId },
    },
    select: { submittedById: true },
  });
  return [...new Set(registrations.map((r) => r.submittedById))];
}

export const documentRouter = createTRPCRouter({
  /**
   * Documents for a scope. COMPETITORS-only items require an entry in the
   * series; ORGANIZERS-only items require a series role.
   */
  list: publicProcedure
    .input(scopeSchema)
    .query(async ({ ctx, input }) => {
      const seriesId = await seriesIdForScope(ctx.db, input);
      const localUser = ctx.clerkUserId
        ? await ctx.db.user.findUnique({
            where: { authProviderId: ctx.clerkUserId },
            select: { id: true },
          })
        : null;

      const role =
        localUser && seriesId
          ? await getSeriesRole(ctx.db, seriesId, localUser.id)
          : null;

      let isCompetitor = false;
      if (!role && localUser && seriesId) {
        const entry = await ctx.db.eventRegistration.findFirst({
          where: {
            submittedById: localUser.id,
            event: { seriesId },
          },
          select: { id: true },
        });
        isCompetitor = Boolean(entry);
      }

      const allowed: DocumentVisibility[] = [DocumentVisibility.PUBLIC];
      if (role || isCompetitor) allowed.push(DocumentVisibility.COMPETITORS);
      if (role) allowed.push(DocumentVisibility.ORGANIZERS);

      return ctx.db.raceDocument.findMany({
        where: { ...input, visibility: { in: allowed } },
        // Current revisions first (supersededAt is null), newest within each.
        orderBy: [
          { supersededAt: { sort: "asc", nulls: "first" } },
          { createdAt: "desc" },
        ],
        include: {
          uploadedBy: {
            select: { id: true, profile: { select: { displayName: true } } },
          },
        },
      });
    }),

  publish: protectedProcedure
    .input(
      z.object({
        scope: scopeSchema,
        type: z.nativeEnum(DocumentType),
        title: z.string().min(2).max(200),
        description: z.string().max(4000).optional(),
        fileUrl: z.string().url().max(2000),
        version: z.string().max(40).optional(),
        visibility: z
          .nativeEnum(DocumentVisibility)
          .default(DocumentVisibility.PUBLIC),
        /** Marks a previous revision as superseded in the same step. */
        supersedesId: z.string().cuid().optional(),
        /** Notify entrants — used for bulletins and regulation changes. */
        notifyCompetitors: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertScopeOrganizer(ctx.db, input.scope, ctx.user.id);

      const document = await ctx.db.raceDocument.create({
        data: {
          ...input.scope,
          uploadedById: ctx.user.id,
          type: input.type,
          title: input.title,
          description: input.description,
          fileUrl: input.fileUrl,
          version: input.version,
          visibility: input.visibility,
        },
      });

      if (input.supersedesId) {
        await ctx.db.raceDocument.updateMany({
          where: { id: input.supersedesId, ...input.scope },
          data: { supersededAt: new Date() },
        });
      }

      if (input.notifyCompetitors) {
        const contacts = await competitorContacts(ctx.db, input.scope);
        await Promise.all(
          contacts
            .filter((id) => id !== ctx.user.id)
            .map((userId) =>
              notify(ctx.db, {
                userId,
                type: NotificationType.SYSTEM,
                title: `New document: ${input.title}`,
                body: input.description,
                linkUrl: input.scope.eventId
                  ? `/events/${input.scope.eventId}/documents`
                  : `/series`,
              }),
            ),
        );
      }
      return document;
    }),

  supersede: protectedProcedure
    .input(z.object({ documentId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const document = await ctx.db.raceDocument.findUnique({
        where: { id: input.documentId },
      });
      if (!document) throw new TRPCError({ code: "NOT_FOUND" });
      await assertScopeOrganizer(
        ctx.db,
        {
          seriesId: document.seriesId ?? undefined,
          eventId: document.eventId ?? undefined,
        },
        ctx.user.id,
      );
      return ctx.db.raceDocument.update({
        where: { id: document.id },
        data: { supersededAt: new Date() },
      });
    }),

  remove: protectedProcedure
    .input(z.object({ documentId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const document = await ctx.db.raceDocument.findUnique({
        where: { id: input.documentId },
      });
      if (!document) throw new TRPCError({ code: "NOT_FOUND" });
      await assertScopeOrganizer(
        ctx.db,
        {
          seriesId: document.seriesId ?? undefined,
          eventId: document.eventId ?? undefined,
        },
        ctx.user.id,
      );
      await ctx.db.raceDocument.delete({ where: { id: document.id } });
      return { deleted: true };
    }),

  // -------------------------------------------------------------------------
  // Announcements & notices
  // -------------------------------------------------------------------------

  listAnnouncements: publicProcedure
    .input(scopeSchema)
    .query(async ({ ctx, input }) => {
      return ctx.db.announcement.findMany({
        where: input,
        orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
        take: 50,
        include: {
          author: {
            select: { id: true, profile: { select: { displayName: true } } },
          },
        },
      });
    }),

  postAnnouncement: protectedProcedure
    .input(
      z.object({
        scope: scopeSchema,
        title: z.string().min(2).max(200),
        body: z.string().min(1).max(8000),
        urgency: z
          .nativeEnum(AnnouncementUrgency)
          .default(AnnouncementUrgency.INFO),
        pinned: z.boolean().default(false),
        notifyCompetitors: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertScopeOrganizer(ctx.db, input.scope, ctx.user.id);
      const announcement = await ctx.db.announcement.create({
        data: {
          ...input.scope,
          authorId: ctx.user.id,
          title: input.title,
          body: input.body,
          urgency: input.urgency,
          pinned: input.pinned,
        },
      });

      if (input.notifyCompetitors) {
        const contacts = await competitorContacts(ctx.db, input.scope);
        await Promise.all(
          contacts
            .filter((id) => id !== ctx.user.id)
            .map((userId) =>
              notify(ctx.db, {
                userId,
                type: NotificationType.SYSTEM,
                title:
                  input.urgency === AnnouncementUrgency.URGENT
                    ? `URGENT — ${input.title}`
                    : input.title,
                body: input.body.slice(0, 300),
                linkUrl: input.scope.eventId
                  ? `/events/${input.scope.eventId}/documents`
                  : `/series`,
              }),
            ),
        );
      }
      return announcement;
    }),

  removeAnnouncement: protectedProcedure
    .input(z.object({ announcementId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const announcement = await ctx.db.announcement.findUnique({
        where: { id: input.announcementId },
      });
      if (!announcement) throw new TRPCError({ code: "NOT_FOUND" });
      await assertScopeOrganizer(
        ctx.db,
        {
          seriesId: announcement.seriesId ?? undefined,
          eventId: announcement.eventId ?? undefined,
        },
        ctx.user.id,
      );
      await ctx.db.announcement.delete({ where: { id: announcement.id } });
      return { deleted: true };
    }),

  // -------------------------------------------------------------------------
  // Generated documents
  // -------------------------------------------------------------------------

  /**
   * The entry list, built from confirmed entries.
   *
   * Public, like the uploaded version it replaces. The difference is that a
   * generated list cannot drift: an uploaded PDF is wrong the moment somebody
   * withdraws, and nobody re-uploads it.
   */
  /**
   * The badge sheet. Organizers only, unlike the other generated documents.
   *
   * A sheet of scannable passes is a sheet of working credentials: anybody who
   * can load it can print themselves paddock access. The entry list is public
   * because it is already on the event page; this never can be.
   */
  credentialSheet: protectedProcedure
    .input(z.object({ eventId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      await assertEventOrganizer(
        ctx.db,
        input.eventId,
        ctx.user.id,
        SERIES_EVENT_ROLES,
      );
      const document = await credentialSheetDocument(ctx.db, input.eventId);
      if (!document) throw new TRPCError({ code: "NOT_FOUND" });
      return document;
    }),

  entryList: publicProcedure
    .input(z.object({ eventId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const document = await entryListDocument(ctx.db, input.eventId);
      if (!document) throw new TRPCError({ code: "NOT_FOUND" });
      return document;
    }),

  /** The running order, from the sessions already scheduled. */
  timetable: publicProcedure
    .input(z.object({ eventId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const document = await timetableDocument(ctx.db, input.eventId);
      if (!document) throw new TRPCError({ code: "NOT_FOUND" });
      return document;
    }),

  /** Starting order from a qualifying session's timing board. */
  gridSheet: publicProcedure
    .input(
      z.object({
        eventId: z.string().cuid(),
        sessionId: z.string().cuid().optional(),
        /// Karting and some club grids form up three or four abreast.
        carsPerRow: z.number().int().min(1).max(6).default(2),
      }),
    )
    .query(async ({ ctx, input }) => {
      const document = await gridDocument(ctx.db, input.eventId, {
        sessionId: input.sessionId,
        carsPerRow: input.carsPerRow,
      });
      if (!document) throw new TRPCError({ code: "NOT_FOUND" });
      return document;
    }),

  /** Ruled paper before a session; the classification after it. */
  timingSheet: publicProcedure
    .input(
      z.object({
        eventId: z.string().cuid(),
        sessionId: z.string().cuid().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const document = await timingSheetDocument(
        ctx.db,
        input.eventId,
        input.sessionId,
      );
      if (!document) throw new TRPCError({ code: "NOT_FOUND" });
      return document;
    }),

  /**
   * The commentator pack: the entry list with what each entry means for the
   * championship. Public — a stream's value is that people can read along.
   */
  commentatorPack: publicProcedure
    .input(z.object({ eventId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const pack = await commentatorPack(ctx.db, input.eventId);
      if (!pack) throw new TRPCError({ code: "NOT_FOUND" });
      return pack;
    }),
});
