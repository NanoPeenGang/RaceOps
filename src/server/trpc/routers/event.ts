import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  EventStatus,
  NotificationType,
  RegistrationStatus,
  ResultStatus,
  TeamRole,
  VolunteerRoleType,
  VolunteerSignupStatus,
} from "@prisma/client";
import {
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
} from "@/server/trpc/trpc";
import {
  assertEventOrganizer,
  assertSeriesRole,
  eventOrganizerIds,
  getSeriesRole,
  SERIES_EVENT_ROLES,
  SERIES_VOLUNTEER_ROLES,
} from "@/server/services/series-auth";
import { notify } from "@/server/services/notifications";
import {
  canOrganizerSetRegistrationStatus,
  canTransitionEvent,
  hasCapacityForConfirm,
  isRegistrationOpen,
  nextWaitlistPromotion,
  ORGANIZER_SETTABLE_REGISTRATION_STATUSES,
  registrationWindowState,
  resolveVolunteerSignupStatus,
  ACTIVE_VOLUNTEER_STATUSES,
} from "@/lib/events";

const TEAM_ENTRY_ROLES: TeamRole[] = [TeamRole.OWNER, TeamRole.MANAGER];

export const eventRouter = createTRPCRouter({
  // -------------------------------------------------------------------------
  // Event lifecycle (organizers)
  // -------------------------------------------------------------------------

  /** Upcoming published events across all series — the entrant-facing list. */
  listPublished: publicProcedure
    .input(
      z.object({
        seriesId: z.string().cuid().optional(),
        cursor: z.string().cuid().optional(),
        limit: z.number().int().min(1).max(50).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      const items = await ctx.db.raceEvent.findMany({
        where: {
          status: { in: [EventStatus.PUBLISHED, EventStatus.COMPLETED] },
          ...(input.seriesId ? { seriesId: input.seriesId } : {}),
        },
        take: input.limit + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        orderBy: { date: "asc" },
        include: {
          series: { select: { name: true, slug: true } },
          _count: { select: { registrations: true } },
        },
      });
      let nextCursor: string | undefined;
      if (items.length > input.limit) nextCursor = items.pop()!.id;
      return { items, nextCursor };
    }),

  byId: publicProcedure
    .input(z.object({ eventId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const event = await ctx.db.raceEvent.findUnique({
        where: { id: input.eventId },
        include: {
          series: { select: { id: true, name: true, slug: true } },
          volunteerShifts: {
            orderBy: { startsAt: "asc" },
            include: { signups: { select: { status: true, userId: true } } },
          },
          _count: { select: { registrations: true } },
        },
      });
      if (!event) throw new TRPCError({ code: "NOT_FOUND" });

      const localUser = ctx.clerkUserId
        ? await ctx.db.user.findUnique({
            where: { authProviderId: ctx.clerkUserId },
            select: { id: true },
          })
        : null;
      const myRole =
        localUser && event.seriesId
          ? await getSeriesRole(ctx.db, event.seriesId, localUser.id)
          : null;

      // Draft events are organizer-only.
      if (event.status === EventStatus.DRAFT && !myRole) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const confirmedCount = await ctx.db.eventRegistration.count({
        where: { eventId: event.id, status: RegistrationStatus.CONFIRMED },
      });

      return {
        ...event,
        myRole,
        // Lets the client identify its own volunteer signup / entry rows.
        myUserId: localUser?.id ?? null,
        confirmedCount,
        registrationState: registrationWindowState(event),
        myRegistration: localUser
          ? await ctx.db.eventRegistration.findFirst({
              where: {
                eventId: event.id,
                OR: [
                  { entrantUserId: localUser.id },
                  { submittedById: localUser.id },
                ],
              },
            })
          : null,
      };
    }),

  create: protectedProcedure
    .input(
      z.object({
        seriesId: z.string().cuid(),
        name: z.string().min(2).max(160),
        date: z.date(),
        platform: z.string().min(1).max(120),
        venue: z.string().max(160).optional(),
        description: z.string().max(8000).optional(),
        entryCapacity: z.number().int().min(1).max(1000).optional(),
        registrationOpensAt: z.date().optional(),
        registrationClosesAt: z.date().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertSeriesRole(
        ctx.db,
        input.seriesId,
        ctx.user.id,
        SERIES_EVENT_ROLES,
      );
      if (
        input.registrationOpensAt &&
        input.registrationClosesAt &&
        input.registrationOpensAt >= input.registrationClosesAt
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Registration must open before it closes.",
        });
      }
      const series = await ctx.db.series.findUniqueOrThrow({
        where: { id: input.seriesId },
        select: { name: true },
      });
      return ctx.db.raceEvent.create({
        data: { ...input, seriesLabel: series.name },
      });
    }),

  update: protectedProcedure
    .input(
      z.object({
        eventId: z.string().cuid(),
        name: z.string().min(2).max(160).optional(),
        date: z.date().optional(),
        venue: z.string().max(160).nullish(),
        description: z.string().max(8000).nullish(),
        entryCapacity: z.number().int().min(1).max(1000).nullish(),
        registrationOpensAt: z.date().nullish(),
        registrationClosesAt: z.date().nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertEventOrganizer(
        ctx.db,
        input.eventId,
        ctx.user.id,
        SERIES_EVENT_ROLES,
      );
      const { eventId, ...data } = input;
      return ctx.db.raceEvent.update({ where: { id: eventId }, data });
    }),

  setStatus: protectedProcedure
    .input(
      z.object({
        eventId: z.string().cuid(),
        status: z.nativeEnum(EventStatus),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertEventOrganizer(
        ctx.db,
        input.eventId,
        ctx.user.id,
        SERIES_EVENT_ROLES,
      );
      const event = await ctx.db.raceEvent.findUniqueOrThrow({
        where: { id: input.eventId },
      });
      if (!canTransitionEvent(event.status, input.status)) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Cannot move an event from ${event.status} to ${input.status}.`,
        });
      }
      const updated = await ctx.db.raceEvent.update({
        where: { id: input.eventId },
        data: { status: input.status },
      });

      // Cancelling is worth telling every entrant about.
      if (input.status === EventStatus.CANCELED) {
        const registrations = await ctx.db.eventRegistration.findMany({
          where: {
            eventId: input.eventId,
            status: {
              in: [
                RegistrationStatus.PENDING,
                RegistrationStatus.CONFIRMED,
                RegistrationStatus.WAITLISTED,
              ],
            },
          },
          select: { submittedById: true },
        });
        const recipients = new Set(registrations.map((r) => r.submittedById));
        await Promise.all(
          [...recipients].map((userId) =>
            notify(ctx.db, {
              userId,
              type: NotificationType.SYSTEM,
              title: `Event canceled: ${event.name}`,
              linkUrl: `/events/${event.id}`,
            }),
          ),
        );
      }
      return updated;
    }),

  // -------------------------------------------------------------------------
  // Registrations
  // -------------------------------------------------------------------------

  /** Register a team (owner/manager only) or yourself for an event. */
  register: protectedProcedure
    .input(
      z.object({
        eventId: z.string().cuid(),
        teamId: z.string().cuid().optional(),
        carNumber: z.string().max(10).optional(),
        carClass: z.string().max(60).optional(),
        notes: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const event = await ctx.db.raceEvent.findUnique({
        where: { id: input.eventId },
      });
      if (!event) throw new TRPCError({ code: "NOT_FOUND" });
      if (!isRegistrationOpen(event)) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Registration is not open (${registrationWindowState(event)}).`,
        });
      }

      if (input.teamId) {
        const membership = await ctx.db.teamMembership.findUnique({
          where: {
            teamId_userId: { teamId: input.teamId, userId: ctx.user.id },
          },
        });
        if (
          !membership ||
          membership.endDate !== null ||
          !TEAM_ENTRY_ROLES.includes(membership.role)
        ) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only team owners/managers can enter a team.",
          });
        }
      }

      const existing = await ctx.db.eventRegistration.findFirst({
        where: {
          eventId: input.eventId,
          ...(input.teamId
            ? { teamId: input.teamId }
            : { entrantUserId: ctx.user.id }),
        },
      });
      if (existing && existing.status !== RegistrationStatus.WITHDRAWN) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "An entry already exists for this event.",
        });
      }

      const data = {
        eventId: input.eventId,
        teamId: input.teamId ?? null,
        entrantUserId: input.teamId ? null : ctx.user.id,
        submittedById: ctx.user.id,
        carNumber: input.carNumber,
        carClass: input.carClass,
        notes: input.notes,
        status: RegistrationStatus.PENDING,
      };

      let registration;
      try {
        registration = existing
          ? await ctx.db.eventRegistration.update({
              where: { id: existing.id },
              data,
            })
          : await ctx.db.eventRegistration.create({ data });
      } catch (error) {
        // Unique constraint on (eventId, carNumber).
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "P2002"
        ) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `Car number ${input.carNumber} is already taken for this event.`,
          });
        }
        throw error;
      }

      if (event.seriesId) {
        const organizerIds = await eventOrganizerIds(ctx.db, event.seriesId);
        await Promise.all(
          organizerIds
            .filter((id) => id !== ctx.user.id)
            .map((userId) =>
              notify(ctx.db, {
                userId,
                type: NotificationType.SYSTEM,
                title: `New entry for ${event.name}`,
                linkUrl: `/events/${event.id}/manage`,
              }),
            ),
        );
      }
      return registration;
    }),

  withdrawRegistration: protectedProcedure
    .input(z.object({ registrationId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const registration = await ctx.db.eventRegistration.findUnique({
        where: { id: input.registrationId },
      });
      if (!registration || registration.submittedById !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      const freedSlot = registration.status === RegistrationStatus.CONFIRMED;
      const updated = await ctx.db.eventRegistration.update({
        where: { id: registration.id },
        data: { status: RegistrationStatus.WITHDRAWN },
      });
      if (freedSlot) {
        await promoteFromWaitlist(ctx.db, registration.eventId);
      }
      return updated;
    }),

  /** Entries for an event — organizer view. */
  registrationsFor: protectedProcedure
    .input(z.object({ eventId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      await assertEventOrganizer(
        ctx.db,
        input.eventId,
        ctx.user.id,
        SERIES_EVENT_ROLES,
      );
      return ctx.db.eventRegistration.findMany({
        where: { eventId: input.eventId },
        orderBy: { createdAt: "asc" },
        include: {
          team: { select: { id: true, name: true, slug: true } },
          entrantUser: {
            select: {
              id: true,
              profile: { select: { displayName: true, location: true } },
            },
          },
        },
      });
    }),

  setRegistrationStatus: protectedProcedure
    .input(
      z.object({
        registrationId: z.string().cuid(),
        status: z.enum(
          ORGANIZER_SETTABLE_REGISTRATION_STATUSES.map((s) => s.toString()) as [
            string,
            ...string[],
          ],
        ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const registration = await ctx.db.eventRegistration.findUnique({
        where: { id: input.registrationId },
        include: { event: true },
      });
      if (!registration) throw new TRPCError({ code: "NOT_FOUND" });
      await assertEventOrganizer(
        ctx.db,
        registration.eventId,
        ctx.user.id,
        SERIES_EVENT_ROLES,
      );

      const next = input.status as RegistrationStatus;
      if (!canOrganizerSetRegistrationStatus(registration.status, next)) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Cannot move an entry from ${registration.status} to ${next}.`,
        });
      }

      if (next === RegistrationStatus.CONFIRMED) {
        const confirmedCount = await ctx.db.eventRegistration.count({
          where: {
            eventId: registration.eventId,
            status: RegistrationStatus.CONFIRMED,
          },
        });
        if (
          !hasCapacityForConfirm(
            registration.event.entryCapacity,
            confirmedCount,
          )
        ) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "The grid is full. Waitlist this entry or raise the entry capacity.",
          });
        }
      }

      const updated = await ctx.db.eventRegistration.update({
        where: { id: registration.id },
        data: { status: next },
      });

      // Freeing a confirmed slot pulls the longest-waiting entry up.
      if (
        registration.status === RegistrationStatus.CONFIRMED &&
        next !== RegistrationStatus.CONFIRMED
      ) {
        await promoteFromWaitlist(ctx.db, registration.eventId);
      }

      await notify(ctx.db, {
        userId: registration.submittedById,
        type: NotificationType.SYSTEM,
        title: `Entry ${next.toLowerCase()} — ${registration.event.name}`,
        linkUrl: `/events/${registration.eventId}`,
      });
      return updated;
    }),

  // -------------------------------------------------------------------------
  // Results
  // -------------------------------------------------------------------------

  /** Classified results for an event — public. */
  resultsFor: publicProcedure
    .input(z.object({ eventId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.db.eventResult.findMany({
        where: { eventId: input.eventId },
        orderBy: [{ finishPosition: "asc" }, { status: "asc" }],
        include: {
          registration: {
            select: {
              id: true,
              carNumber: true,
              carClass: true,
              team: { select: { id: true, name: true } },
              entrantUser: {
                select: { id: true, profile: { select: { displayName: true } } },
              },
            },
          },
        },
      });
    }),

  /** Record or amend one entry's result (race control). */
  recordResult: protectedProcedure
    .input(
      z.object({
        registrationId: z.string().cuid(),
        finishPosition: z.number().int().min(1).max(200).nullish(),
        status: z.nativeEnum(ResultStatus).default(ResultStatus.FINISHED),
        lapsCompleted: z.number().int().min(0).max(10000).nullish(),
        fastestLap: z.boolean().default(false),
        pointsOverride: z.number().int().min(0).max(1000).nullish(),
        notes: z.string().max(2000).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const registration = await ctx.db.eventRegistration.findUnique({
        where: { id: input.registrationId },
        select: { eventId: true, status: true },
      });
      if (!registration) throw new TRPCError({ code: "NOT_FOUND" });
      await assertEventOrganizer(
        ctx.db,
        registration.eventId,
        ctx.user.id,
        SERIES_EVENT_ROLES,
      );
      if (registration.status !== RegistrationStatus.CONFIRMED) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Only confirmed entries can be classified.",
        });
      }
      if (
        input.status === ResultStatus.FINISHED &&
        (input.finishPosition === null || input.finishPosition === undefined)
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "A finishing position is required for a classified finish.",
        });
      }

      const { registrationId, ...data } = input;
      // One fastest lap per event.
      if (input.fastestLap) {
        await ctx.db.eventResult.updateMany({
          where: { eventId: registration.eventId, fastestLap: true },
          data: { fastestLap: false },
        });
      }
      return ctx.db.eventResult.upsert({
        where: { registrationId },
        create: {
          registrationId,
          eventId: registration.eventId,
          ...data,
        },
        update: data,
      });
    }),

  /** Events the caller has entered (or entered a team into). */
  myRegistrations: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.eventRegistration.findMany({
      where: { submittedById: ctx.user.id },
      orderBy: { createdAt: "desc" },
      include: {
        event: {
          select: { id: true, name: true, date: true, status: true },
        },
        team: { select: { name: true } },
      },
    });
  }),

  // -------------------------------------------------------------------------
  // Volunteers
  // -------------------------------------------------------------------------

  createShift: protectedProcedure
    .input(
      z.object({
        eventId: z.string().cuid(),
        role: z.nativeEnum(VolunteerRoleType),
        title: z.string().min(2).max(120),
        startsAt: z.date(),
        endsAt: z.date(),
        capacity: z.number().int().min(1).max(500),
        notes: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertEventOrganizer(
        ctx.db,
        input.eventId,
        ctx.user.id,
        SERIES_VOLUNTEER_ROLES,
      );
      if (input.startsAt >= input.endsAt) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "A shift must start before it ends.",
        });
      }
      return ctx.db.volunteerShift.create({ data: input });
    }),

  deleteShift: protectedProcedure
    .input(z.object({ shiftId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const shift = await ctx.db.volunteerShift.findUnique({
        where: { id: input.shiftId },
        select: { eventId: true },
      });
      if (!shift) throw new TRPCError({ code: "NOT_FOUND" });
      await assertEventOrganizer(
        ctx.db,
        shift.eventId,
        ctx.user.id,
        SERIES_VOLUNTEER_ROLES,
      );
      await ctx.db.volunteerShift.delete({ where: { id: input.shiftId } });
      return { deleted: true };
    }),

  /** Shifts with signup detail — organizer view. */
  shiftsFor: protectedProcedure
    .input(z.object({ eventId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      await assertEventOrganizer(
        ctx.db,
        input.eventId,
        ctx.user.id,
        SERIES_VOLUNTEER_ROLES,
      );
      return ctx.db.volunteerShift.findMany({
        where: { eventId: input.eventId },
        orderBy: { startsAt: "asc" },
        include: {
          signups: {
            orderBy: { createdAt: "asc" },
            include: {
              user: {
                select: {
                  id: true,
                  profile: { select: { displayName: true } },
                },
              },
            },
          },
        },
      });
    }),

  volunteerSignUp: protectedProcedure
    .input(z.object({ shiftId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const shift = await ctx.db.volunteerShift.findUnique({
        where: { id: input.shiftId },
        include: { event: true, signups: { select: { status: true } } },
      });
      if (!shift) throw new TRPCError({ code: "NOT_FOUND" });
      if (shift.event.status === EventStatus.CANCELED) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "This event has been canceled.",
        });
      }

      const activeCount = shift.signups.filter((s) =>
        ACTIVE_VOLUNTEER_STATUSES.includes(s.status),
      ).length;
      const status = resolveVolunteerSignupStatus(shift.capacity, activeCount);

      const existing = await ctx.db.volunteerSignup.findUnique({
        where: { shiftId_userId: { shiftId: shift.id, userId: ctx.user.id } },
      });
      if (existing && existing.status !== VolunteerSignupStatus.CANCELED) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "You are already signed up for this shift.",
        });
      }
      return existing
        ? ctx.db.volunteerSignup.update({
            where: { id: existing.id },
            data: { status },
          })
        : ctx.db.volunteerSignup.create({
            data: { shiftId: shift.id, userId: ctx.user.id, status },
          });
    }),

  volunteerCancel: protectedProcedure
    .input(z.object({ shiftId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const signup = await ctx.db.volunteerSignup.findUnique({
        where: { shiftId_userId: { shiftId: input.shiftId, userId: ctx.user.id } },
      });
      if (!signup) throw new TRPCError({ code: "NOT_FOUND" });
      const freedSlot = ACTIVE_VOLUNTEER_STATUSES.includes(signup.status);
      const updated = await ctx.db.volunteerSignup.update({
        where: { id: signup.id },
        data: { status: VolunteerSignupStatus.CANCELED },
      });
      if (freedSlot) {
        await promoteVolunteerWaitlist(ctx.db, input.shiftId);
      }
      return updated;
    }),

  myVolunteerShifts: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.volunteerSignup.findMany({
      where: {
        userId: ctx.user.id,
        status: { not: VolunteerSignupStatus.CANCELED },
      },
      orderBy: { createdAt: "desc" },
      include: {
        shift: {
          include: { event: { select: { id: true, name: true, date: true } } },
        },
      },
    });
  }),
});

// ---------------------------------------------------------------------------
// Waitlist promotion helpers
// ---------------------------------------------------------------------------

type Db = Parameters<typeof notify>[0];

async function promoteFromWaitlist(db: Db, eventId: string): Promise<void> {
  const event = await db.raceEvent.findUnique({
    where: { id: eventId },
    select: { entryCapacity: true, name: true },
  });
  if (!event) return;

  const registrations = await db.eventRegistration.findMany({
    where: { eventId },
    select: { id: true, status: true, createdAt: true, submittedById: true },
  });
  const confirmedCount = registrations.filter(
    (r) => r.status === RegistrationStatus.CONFIRMED,
  ).length;
  if (!hasCapacityForConfirm(event.entryCapacity, confirmedCount)) return;

  const promote = nextWaitlistPromotion(registrations);
  if (!promote) return;

  await db.eventRegistration.update({
    where: { id: promote.id },
    data: { status: RegistrationStatus.CONFIRMED },
  });
  await notify(db, {
    userId: promote.submittedById,
    type: NotificationType.SYSTEM,
    title: `You're off the waitlist — ${event.name}`,
    linkUrl: `/events/${eventId}`,
  });
}

async function promoteVolunteerWaitlist(
  db: Db,
  shiftId: string,
): Promise<void> {
  const shift = await db.volunteerShift.findUnique({
    where: { id: shiftId },
    include: {
      event: { select: { name: true, id: true } },
      signups: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!shift) return;

  const activeCount = shift.signups.filter((s) =>
    ACTIVE_VOLUNTEER_STATUSES.includes(s.status),
  ).length;
  if (activeCount >= shift.capacity) return;

  const next = shift.signups.find(
    (s) => s.status === VolunteerSignupStatus.WAITLISTED,
  );
  if (!next) return;

  await db.volunteerSignup.update({
    where: { id: next.id },
    data: { status: VolunteerSignupStatus.SIGNED_UP },
  });
  await notify(db, {
    userId: next.userId,
    type: NotificationType.SYSTEM,
    title: `Volunteer slot open — ${shift.title} (${shift.event.name})`,
    linkUrl: `/events/${shift.event.id}`,
  });
}
