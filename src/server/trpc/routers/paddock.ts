import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { CredentialStatus, Prisma, RegistrationStatus } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { createTRPCRouter, protectedProcedure } from "@/server/trpc/trpc";
import {
  assertEventOrganizer,
  SERIES_EVENT_ROLES,
} from "@/server/services/series-auth";
import { TEAM_MANAGER_ROLES } from "@/lib/teams";
import {
  allocationClashes,
  credentialCounts,
  eventIssuance,
  pitBoxOverflow,
} from "@/lib/paddock";

/**
 * Paddock allocation and credentials.
 *
 * Officials allocate places and issue passes; entrants request passes for
 * their own crew and see where they have been put. The split matters: a team
 * naming its own mechanics is the useful half of accreditation, and an
 * organizer approving them is the half that has to stay controlled.
 */

/** Whether the caller may act for an entry — the entrant or a team manager. */
async function assertCanActForRegistration(
  db: PrismaClient,
  registrationId: string,
  userId: string,
): Promise<{ eventId: string }> {
  const registration = await db.eventRegistration.findUnique({
    where: { id: registrationId },
    select: {
      eventId: true,
      teamId: true,
      entrantUserId: true,
      submittedById: true,
    },
  });
  if (!registration) throw new TRPCError({ code: "NOT_FOUND" });
  if (
    registration.submittedById === userId ||
    registration.entrantUserId === userId
  ) {
    return { eventId: registration.eventId };
  }
  if (registration.teamId) {
    const membership = await db.teamMembership.findUnique({
      where: { teamId_userId: { teamId: registration.teamId, userId } },
      select: { role: true, endDate: true },
    });
    if (
      membership &&
      membership.endDate === null &&
      TEAM_MANAGER_ROLES.includes(membership.role)
    ) {
      return { eventId: registration.eventId };
    }
  }
  throw new TRPCError({
    code: "FORBIDDEN",
    message: "You cannot act for that entry.",
  });
}

export const paddockRouter = createTRPCRouter({
  /** The allocation sheet: every confirmed entry, where it sits, and clashes. */
  forEvent: protectedProcedure
    .input(z.object({ eventId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      await assertEventOrganizer(
        ctx.db,
        input.eventId,
        ctx.user.id,
        SERIES_EVENT_ROLES,
      );

      const event = await ctx.db.raceEvent.findUniqueOrThrow({
        where: { id: input.eventId },
        select: {
          trackLayout: { select: { track: { select: { pitBoxCount: true } } } },
        },
      });

      const registrations = await ctx.db.eventRegistration.findMany({
        where: {
          eventId: input.eventId,
          status: RegistrationStatus.CONFIRMED,
        },
        orderBy: { carNumber: "asc" },
        select: {
          id: true,
          carNumber: true,
          team: { select: { id: true, name: true } },
          entrantUser: {
            select: { profile: { select: { displayName: true } } },
          },
          paddock: true,
        },
      });

      const allocations = registrations
        .map((registration) => registration.paddock)
        .filter((allocation) => allocation !== null);

      return {
        pitBoxCount: event.trackLayout?.track.pitBoxCount ?? null,
        entries: registrations.map((registration) => ({
          registrationId: registration.id,
          carNumber: registration.carNumber,
          label:
            registration.team?.name ??
            registration.entrantUser?.profile?.displayName ??
            "Entry",
          allocation: registration.paddock,
        })),
        clashes: allocationClashes(allocations),
        pitBoxOverflow: pitBoxOverflow(
          allocations,
          event.trackLayout?.track.pitBoxCount,
        ),
      };
    }),

  /** Put an entry somewhere. Officials only. */
  allocate: protectedProcedure
    .input(
      z.object({
        registrationId: z.string().cuid(),
        garage: z.string().max(60).nullish(),
        pitBox: z.string().max(60).nullish(),
        paddockSpace: z.string().max(60).nullish(),
        transporterBay: z.string().max(60).nullish(),
        powerHookup: z.string().max(60).nullish(),
        notes: z.string().max(1000).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const registration = await ctx.db.eventRegistration.findUnique({
        where: { id: input.registrationId },
        select: { eventId: true },
      });
      if (!registration) throw new TRPCError({ code: "NOT_FOUND" });
      await assertEventOrganizer(
        ctx.db,
        registration.eventId,
        ctx.user.id,
        SERIES_EVENT_ROLES,
      );

      const { registrationId, ...fields } = input;
      // Double-booking is allowed to be saved rather than refused: an
      // organizer moving four entries around will pass through a clashing
      // state, and refusing the intermediate step makes the sheet unusable.
      // `forEvent` reports clashes so nobody arrives to find out.
      return ctx.db.paddockAllocation.upsert({
        where: { registrationId },
        create: {
          ...fields,
          registrationId,
          eventId: registration.eventId,
          assignedById: ctx.user.id,
        },
        update: { ...fields, assignedById: ctx.user.id },
      });
    }),

  clearAllocation: protectedProcedure
    .input(z.object({ registrationId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const allocation = await ctx.db.paddockAllocation.findUnique({
        where: { registrationId: input.registrationId },
        select: { eventId: true },
      });
      if (!allocation) return { cleared: false };
      await assertEventOrganizer(
        ctx.db,
        allocation.eventId,
        ctx.user.id,
        SERIES_EVENT_ROLES,
      );
      await ctx.db.paddockAllocation.delete({
        where: { registrationId: input.registrationId },
      });
      return { cleared: true };
    }),

  // -- Credential types ----------------------------------------------------

  credentialTypes: protectedProcedure
    .input(z.object({ eventId: z.string().cuid() }))
    .query(({ ctx, input }) =>
      ctx.db.credentialType.findMany({
        where: { eventId: input.eventId },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      }),
    ),

  addCredentialType: protectedProcedure
    .input(
      z.object({
        eventId: z.string().cuid(),
        name: z.string().min(1).max(60),
        description: z.string().max(300).optional(),
        allowancePerEntry: z.number().int().min(0).max(200).default(0),
        totalAvailable: z.number().int().min(0).max(100_000).optional(),
        sortOrder: z.number().int().min(0).max(100).default(0),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertEventOrganizer(
        ctx.db,
        input.eventId,
        ctx.user.id,
        SERIES_EVENT_ROLES,
      );
      try {
        return await ctx.db.credentialType.create({ data: input });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "This event already has a pass called that.",
          });
        }
        throw error;
      }
    }),

  updateCredentialType: protectedProcedure
    .input(
      z.object({
        credentialTypeId: z.string().cuid(),
        name: z.string().min(1).max(60).optional(),
        description: z.string().max(300).nullish(),
        allowancePerEntry: z.number().int().min(0).max(200).optional(),
        totalAvailable: z.number().int().min(0).max(100_000).nullish(),
        sortOrder: z.number().int().min(0).max(100).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const type = await ctx.db.credentialType.findUnique({
        where: { id: input.credentialTypeId },
        select: { eventId: true },
      });
      if (!type) throw new TRPCError({ code: "NOT_FOUND" });
      await assertEventOrganizer(
        ctx.db,
        type.eventId,
        ctx.user.id,
        SERIES_EVENT_ROLES,
      );
      const { credentialTypeId, ...data } = input;
      return ctx.db.credentialType.update({
        where: { id: credentialTypeId },
        data,
      });
    }),

  deleteCredentialType: protectedProcedure
    .input(z.object({ credentialTypeId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const type = await ctx.db.credentialType.findUnique({
        where: { id: input.credentialTypeId },
        select: { eventId: true, _count: { select: { credentials: true } } },
      });
      if (!type) throw new TRPCError({ code: "NOT_FOUND" });
      await assertEventOrganizer(
        ctx.db,
        type.eventId,
        ctx.user.id,
        SERIES_EVENT_ROLES,
      );
      if (type._count.credentials > 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `${type._count.credentials} pass${type._count.credentials === 1 ? " has" : "es have"} been issued of this type. Set the allowance to zero instead.`,
        });
      }
      await ctx.db.credentialType.delete({
        where: { id: input.credentialTypeId },
      });
      return { deleted: true };
    }),

  // -- Credentials ---------------------------------------------------------

  /** The accreditation list for an event. Officials only. */
  credentialsForEvent: protectedProcedure
    .input(z.object({ eventId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      await assertEventOrganizer(
        ctx.db,
        input.eventId,
        ctx.user.id,
        SERIES_EVENT_ROLES,
      );
      const [types, credentials] = await Promise.all([
        ctx.db.credentialType.findMany({
          where: { eventId: input.eventId },
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        }),
        ctx.db.credential.findMany({
          where: { eventId: input.eventId },
          orderBy: [{ holderName: "asc" }],
          include: {
            credentialType: { select: { id: true, name: true } },
            registration: {
              select: {
                id: true,
                carNumber: true,
                team: { select: { name: true } },
                entrantUser: {
                  select: { profile: { select: { displayName: true } } },
                },
              },
            },
          },
        }),
      ]);
      return {
        types,
        credentials,
        issuance: eventIssuance(types, credentials),
      };
    }),

  /** An entry's own crew list and how it stands against each allowance. */
  credentialsForRegistration: protectedProcedure
    .input(z.object({ registrationId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const { eventId } = await assertCanActForRegistration(
        ctx.db,
        input.registrationId,
        ctx.user.id,
      );
      const [types, credentials, allocation] = await Promise.all([
        ctx.db.credentialType.findMany({
          where: { eventId },
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        }),
        ctx.db.credential.findMany({
          where: { registrationId: input.registrationId },
          orderBy: { holderName: "asc" },
          include: { credentialType: { select: { id: true, name: true } } },
        }),
        ctx.db.paddockAllocation.findUnique({
          where: { registrationId: input.registrationId },
        }),
      ]);
      return {
        types,
        credentials,
        allocation,
        counts: credentialCounts(types, credentials),
      };
    }),

  /**
   * Name someone on a pass. Open to the entry as well as to officials — a
   * team naming its own mechanics is the useful half of accreditation.
   * Requests land as REQUESTED and an official issues them.
   */
  requestCredential: protectedProcedure
    .input(
      z.object({
        registrationId: z.string().cuid(),
        credentialTypeId: z.string().cuid(),
        holderName: z.string().min(1).max(120),
        holderRole: z.string().max(60).optional(),
        holderUserId: z.string().cuid().optional(),
        notes: z.string().max(300).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { eventId } = await assertCanActForRegistration(
        ctx.db,
        input.registrationId,
        ctx.user.id,
      );

      const type = await ctx.db.credentialType.findUnique({
        where: { id: input.credentialTypeId },
        select: { eventId: true, name: true, allowancePerEntry: true },
      });
      if (!type || type.eventId !== eventId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "That pass is not issued at this event.",
        });
      }

      // The allowance is the whole point; an entry cannot ask past it, though
      // an official can still issue over it deliberately.
      const existing = await ctx.db.credential.findMany({
        where: {
          registrationId: input.registrationId,
          credentialTypeId: input.credentialTypeId,
        },
        select: { credentialTypeId: true, status: true },
      });
      const [count] = credentialCounts([
        {
          id: input.credentialTypeId,
          name: type.name,
          allowancePerEntry: type.allowancePerEntry,
        },
      ], existing);
      if (count.remaining <= 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Your allowance of ${type.allowancePerEntry} ${type.name} pass${type.allowancePerEntry === 1 ? "" : "es"} is used. Ask the organizers for more.`,
        });
      }

      return ctx.db.credential.create({
        data: { ...input, eventId },
      });
    }),

  /** Issue, collect or void a pass. Officials only. */
  setCredentialStatus: protectedProcedure
    .input(
      z.object({
        credentialId: z.string().cuid(),
        status: z.nativeEnum(CredentialStatus),
        serial: z.string().max(60).nullish(),
        notes: z.string().max(300).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const credential = await ctx.db.credential.findUnique({
        where: { id: input.credentialId },
        select: { eventId: true },
      });
      if (!credential) throw new TRPCError({ code: "NOT_FOUND" });
      await assertEventOrganizer(
        ctx.db,
        credential.eventId,
        ctx.user.id,
        SERIES_EVENT_ROLES,
      );

      const now = new Date();
      const { credentialId, status, ...rest } = input;
      try {
        return await ctx.db.credential.update({
          where: { id: credentialId },
          data: {
            ...rest,
            status,
            ...(status === CredentialStatus.ISSUED ? { issuedAt: now } : {}),
            ...(status === CredentialStatus.COLLECTED
              ? { collectedAt: now }
              : {}),
          },
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Another pass at this event already carries that serial.",
          });
        }
        throw error;
      }
    }),

  /**
   * A pass for someone with no entry — officials, media, staff.
   * Officials only, since it bypasses the per-entry allowance entirely.
   */
  issueStandaloneCredential: protectedProcedure
    .input(
      z.object({
        eventId: z.string().cuid(),
        credentialTypeId: z.string().cuid(),
        holderName: z.string().min(1).max(120),
        holderRole: z.string().max(60).optional(),
        holderUserId: z.string().cuid().optional(),
        serial: z.string().max(60).optional(),
        notes: z.string().max(300).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertEventOrganizer(
        ctx.db,
        input.eventId,
        ctx.user.id,
        SERIES_EVENT_ROLES,
      );
      const type = await ctx.db.credentialType.findUnique({
        where: { id: input.credentialTypeId },
        select: { eventId: true },
      });
      if (!type || type.eventId !== input.eventId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "That pass is not issued at this event.",
        });
      }
      return ctx.db.credential.create({
        data: {
          ...input,
          status: CredentialStatus.ISSUED,
          issuedAt: new Date(),
        },
      });
    }),

  removeCredential: protectedProcedure
    .input(z.object({ credentialId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const credential = await ctx.db.credential.findUnique({
        where: { id: input.credentialId },
        select: { eventId: true, registrationId: true, status: true },
      });
      if (!credential) throw new TRPCError({ code: "NOT_FOUND" });

      // A pass that has been issued is a physical object someone is holding.
      // Voiding it is a record; deleting it is not, so only unissued requests
      // can actually be removed.
      if (credential.status !== CredentialStatus.REQUESTED) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "This pass has been issued. Void it instead — a pass that vanishes cannot be reconciled at the gate.",
        });
      }

      if (credential.registrationId) {
        await assertCanActForRegistration(
          ctx.db,
          credential.registrationId,
          ctx.user.id,
        );
      } else {
        await assertEventOrganizer(
          ctx.db,
          credential.eventId,
          ctx.user.id,
          SERIES_EVENT_ROLES,
        );
      }

      await ctx.db.credential.delete({ where: { id: input.credentialId } });
      return { deleted: true };
    }),
});
