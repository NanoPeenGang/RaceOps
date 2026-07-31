import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  AccessZone,
  CredentialAudience,
  CredentialStatus,
  Prisma,
  RegistrationStatus,
} from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import {
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
} from "@/server/trpc/trpc";
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
import { planCredentials } from "@/lib/credentials";
import {
  credentialToken,
  gatherCandidates,
} from "@/server/services/credential-sweep";
import { walletConfig } from "@/server/services/pkpass";

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

  // Zones and the audience are what turn a pass type from a name into
  // something the generator and a gate marshal can both act on.
  addCredentialType: protectedProcedure
    .input(
      z.object({
        eventId: z.string().cuid(),
        name: z.string().min(1).max(60),
        description: z.string().max(300).optional(),
        allowancePerEntry: z.number().int().min(0).max(200).default(0),
        totalAvailable: z.number().int().min(0).max(100_000).optional(),
        sortOrder: z.number().int().min(0).max(100).default(0),
        zones: z.array(z.nativeEnum(AccessZone)).default([]),
        autoIssueTo: z.nativeEnum(CredentialAudience).optional(),
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
        zones: z.array(z.nativeEnum(AccessZone)).optional(),
        autoIssueTo: z.nativeEnum(CredentialAudience).nullish(),
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
            credentialType: {
              select: { id: true, name: true, zones: true, autoIssueTo: true },
            },
            registration: {
              select: {
                id: true,
                carNumber: true,
                carClass: true,
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
      const existing = await ctx.db.credential.findUnique({
        where: { id: input.credentialId },
        select: { eventId: true, qrToken: true },
      });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      await assertEventOrganizer(
        ctx.db,
        existing.eventId,
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
            // A pass only needs a code once it is real. Minting it on issue
            // means a request that is never approved never becomes scannable.
            ...(status === CredentialStatus.ISSUED
              ? { issuedAt: now, qrToken: existing.qrToken ?? credentialToken() }
              : {}),
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

  // -- What a person holds -------------------------------------------------

  /**
   * Every pass issued to the signed-in person, across every event.
   *
   * The point of accreditation is that somebody arrives at a gate holding the
   * right thing. Making them dig through an event page for it, at a circuit
   * with no signal, is how people end up in a queue at accreditation for a
   * pass that was issued weeks ago.
   *
   * Only passes that are actually valid: a requested one is not something they
   * can use yet, and a voided one showing up in a personal list would be waved
   * at a gate in poor light.
   */
  myCredentials: protectedProcedure.query(async ({ ctx }) => {
    const credentials = await ctx.db.credential.findMany({
      where: {
        holderUserId: ctx.user.id,
        status: { in: [CredentialStatus.ISSUED, CredentialStatus.COLLECTED] },
      },
      orderBy: [{ event: { date: "asc" } }],
      select: {
        id: true,
        holderName: true,
        holderRole: true,
        serial: true,
        qrToken: true,
        status: true,
        credentialType: {
          select: { name: true, description: true, zones: true },
        },
        registration: {
          select: {
            carNumber: true,
            carClass: true,
            team: { select: { name: true, slug: true } },
          },
        },
        event: {
          select: {
            id: true,
            name: true,
            date: true,
            venue: true,
            series: { select: { name: true, slug: true } },
            trackLayout: {
              select: { name: true, track: { select: { name: true } } },
            },
          },
        },
      },
    });

    return {
      credentials,
      /*
       * Whether this deployment can sign Apple Wallet passes at all. Asked
       * here so the UI can hide the button rather than hand somebody a file
       * their phone silently refuses — which is worse than no button, because
       * they will believe they have a pass.
       */
      walletAvailable: walletConfig() !== null,
    };
  }),

  /** One of my passes, by id, for the full-screen and print views. */
  myCredential: protectedProcedure
    .input(z.object({ credentialId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const credential = await ctx.db.credential.findUnique({
        where: { id: input.credentialId },
        select: {
          id: true,
          holderUserId: true,
          holderName: true,
          holderRole: true,
          serial: true,
          qrToken: true,
          status: true,
          credentialType: {
            select: { name: true, description: true, zones: true },
          },
          registration: {
            select: {
              carNumber: true,
              carClass: true,
              team: { select: { name: true } },
            },
          },
          event: {
            select: {
              id: true,
              name: true,
              date: true,
              venue: true,
              series: { select: { name: true } },
              trackLayout: {
                select: { name: true, track: { select: { name: true } } },
              },
            },
          },
        },
      });
      if (!credential || credential.holderUserId !== ctx.user.id) {
        // Not FORBIDDEN: whether a given id is a pass at all is not something
        // to confirm to somebody it does not belong to.
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      return { ...credential, walletAvailable: walletConfig() !== null };
    }),

  // -- Generating and scanning ---------------------------------------------

  /**
   * What a sweep would do, without doing it.
   *
   * Shown before the button is pressed, because a generator that silently
   * creates two hundred passes is one people run once and then never trust
   * again. It also surfaces who matches no configured type — the drivers who
   * would otherwise turn up on Saturday with nothing, and never appear in any
   * error message.
   */
  previewCredentialSweep: protectedProcedure
    .input(z.object({ eventId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      await assertEventOrganizer(
        ctx.db,
        input.eventId,
        ctx.user.id,
        SERIES_EVENT_ROLES,
      );
      const [candidates, types, existing] = await Promise.all([
        gatherCandidates(ctx.db, input.eventId),
        ctx.db.credentialType.findMany({
          where: { eventId: input.eventId },
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        }),
        ctx.db.credential.findMany({
          where: { eventId: input.eventId },
          select: {
            credentialTypeId: true,
            holderUserId: true,
            holderName: true,
            status: true,
          },
        }),
      ]);
      return { plan: planCredentials(candidates, types, existing), types };
    }),

  /**
   * Issues every pass the sweep found missing.
   *
   * Passes come out ISSUED rather than REQUESTED: an organizer pressing this
   * has decided, and leaving two hundred rows for them to approve one at a
   * time would make the feature slower than doing it by hand.
   */
  generateCredentials: protectedProcedure
    .input(z.object({ eventId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertEventOrganizer(
        ctx.db,
        input.eventId,
        ctx.user.id,
        SERIES_EVENT_ROLES,
      );
      const [candidates, types, existing] = await Promise.all([
        gatherCandidates(ctx.db, input.eventId),
        ctx.db.credentialType.findMany({ where: { eventId: input.eventId } }),
        ctx.db.credential.findMany({
          where: { eventId: input.eventId },
          select: {
            credentialTypeId: true,
            holderUserId: true,
            holderName: true,
            status: true,
          },
        }),
      ]);

      const plan = planCredentials(candidates, types, existing);
      if (plan.toIssue.length === 0) {
        return { created: 0, unmatched: plan.unmatched.length };
      }

      const now = new Date();
      await ctx.db.credential.createMany({
        data: plan.toIssue.map((entry) => ({
          eventId: input.eventId,
          credentialTypeId: entry.credentialTypeId,
          registrationId: entry.candidate.registrationId,
          holderName: entry.candidate.name,
          holderUserId: entry.candidate.userId,
          holderRole: entry.candidate.role,
          qrToken: credentialToken(),
          status: CredentialStatus.ISSUED,
          issuedAt: now,
        })),
      });

      return { created: plan.toIssue.length, unmatched: plan.unmatched.length };
    }),

  /**
   * Gives an existing pass a QR code, or a fresh one.
   *
   * Rotating is what happens when a badge is lost: the old code stops
   * resolving immediately and the pass keeps its history, which a delete-and-
   * reissue would throw away along with the audit trail.
   */
  refreshCredentialToken: protectedProcedure
    .input(z.object({ credentialId: z.string().cuid() }))
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
      return ctx.db.credential.update({
        where: { id: input.credentialId },
        data: { qrToken: credentialToken() },
      });
    }),

  /**
   * Resolves a scanned QR code.
   *
   * Public on purpose. The person scanning is a marshal on a gate at 07:00
   * with a phone and no reason to have a RaceOps account, and a check that
   * only works for signed-in staff is a check nobody performs. What it returns
   * is what the badge already prints — name, team, role, zones — so holding
   * the token grants no more than holding the pass does.
   *
   * The token is 24 random bytes precisely so that this being public is safe:
   * it cannot be enumerated, and it can be rotated the moment a pass is lost.
   */
  scanCredential: publicProcedure
    .input(z.object({ token: z.string().min(8).max(120) }))
    .query(async ({ ctx, input }) => {
      const credential = await ctx.db.credential.findUnique({
        where: { qrToken: input.token },
        select: {
          id: true,
          holderName: true,
          holderRole: true,
          status: true,
          serial: true,
          issuedAt: true,
          collectedAt: true,
          credentialType: {
            select: { name: true, description: true, zones: true },
          },
          registration: {
            select: {
              carNumber: true,
              carClass: true,
              team: { select: { name: true, slug: true } },
              entrantUser: {
                select: { profile: { select: { displayName: true } } },
              },
            },
          },
          event: {
            select: {
              id: true,
              name: true,
              date: true,
              series: { select: { name: true } },
            },
          },
        },
      });
      if (!credential) {
        // Deliberately the same shape as a real answer rather than a 404: a
        // marshal needs to be told "this is not one of ours", not shown an
        // error page they have to interpret.
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No pass matches that code. It is not one issued here.",
        });
      }
      return credential;
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
          qrToken: credentialToken(),
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
