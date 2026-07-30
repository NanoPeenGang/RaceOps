import { z } from "zod";
import { TRPCError } from "@trpc/server";
import type { PrismaClient } from "@prisma/client";
import { createTRPCRouter, protectedProcedure } from "@/server/trpc/trpc";
import {
  getSeriesRole,
  SERIES_EVENT_ROLES,
} from "@/server/services/series-auth";
import { isTeamManager } from "@/lib/teams";
import { broadcastChatMessage } from "@/server/services/realtime";

/**
 * Chat rooms. Two kinds, one implementation:
 *
 * - **Event paddock chat** — organizers of the owning series, anyone with an
 *   entry, and signed-up volunteers.
 * - **Team chat** — the team's own current roster, nobody else.
 *
 * Neither is a public comment section, so reads require a signed-in member of
 * the room. A message belongs to exactly one room; the database enforces that
 * with a check constraint as well.
 */

const scopeSchema = z
  .object({
    eventId: z.string().cuid().optional(),
    teamId: z.string().cuid().optional(),
  })
  .refine(
    (scope) => Boolean(scope.eventId) !== Boolean(scope.teamId),
    "Chat in exactly one of an event or a team.",
  );

type Scope = z.infer<typeof scopeSchema>;

interface ChatAccess {
  /** Can delete anyone's message in this room. */
  canModerate: boolean;
}

async function assertChatAccess(
  db: PrismaClient,
  scope: Scope,
  userId: string,
): Promise<ChatAccess> {
  if (scope.teamId) return assertTeamChatAccess(db, scope.teamId, userId);
  if (scope.eventId) return assertEventChatAccess(db, scope.eventId, userId);
  throw new TRPCError({ code: "BAD_REQUEST", message: "No room provided." });
}

/** Team chat is for the current roster. Managers moderate. */
async function assertTeamChatAccess(
  db: PrismaClient,
  teamId: string,
  userId: string,
): Promise<ChatAccess> {
  const membership = await db.teamMembership.findUnique({
    where: { teamId_userId: { teamId, userId } },
    select: { role: true, endDate: true },
  });
  if (!membership || membership.endDate !== null) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Team chat is for current team members.",
    });
  }
  return { canModerate: isTeamManager(membership.role) };
}

async function assertEventChatAccess(
  db: PrismaClient,
  eventId: string,
  userId: string,
): Promise<ChatAccess> {
  const event = await db.raceEvent.findUnique({
    where: { id: eventId },
    select: { seriesId: true },
  });
  if (!event) throw new TRPCError({ code: "NOT_FOUND" });

  const role = event.seriesId
    ? await getSeriesRole(db, event.seriesId, userId)
    : null;
  if (role && SERIES_EVENT_ROLES.includes(role)) {
    return { canModerate: true };
  }

  const [entry, shift] = await Promise.all([
    db.eventRegistration.findFirst({
      where: {
        eventId,
        status: { in: ["PENDING", "CONFIRMED", "WAITLISTED"] },
        OR: [{ submittedById: userId }, { entrantUserId: userId }],
      },
      select: { id: true },
    }),
    db.volunteerSignup.findFirst({
      where: { userId, shift: { eventId } },
      select: { id: true },
    }),
  ]);

  if (entry || shift || role) {
    // A non-event series role (steward, volunteer coordinator) still belongs
    // in the room, just without moderation rights.
    return { canModerate: false };
  }

  throw new TRPCError({
    code: "FORBIDDEN",
    message: "Paddock chat is for entrants, volunteers and organizers.",
  });
}

export const chatRouter = createTRPCRouter({
  /** Recent messages, oldest first so the transcript reads top-to-bottom. */
  forRoom: protectedProcedure
    .input(
      z.object({
        scope: scopeSchema,
        limit: z.number().int().min(1).max(200).default(100),
      }),
    )
    .query(async ({ ctx, input }) => {
      const access = await assertChatAccess(ctx.db, input.scope, ctx.user.id);
      const messages = await ctx.db.chatMessage.findMany({
        where: input.scope,
        orderBy: { createdAt: "desc" },
        take: input.limit,
        include: {
          user: {
            select: {
              id: true,
              profile: { select: { displayName: true } },
            },
          },
        },
      });
      return {
        messages: messages.reverse(),
        myUserId: ctx.user.id,
        canModerate: access.canModerate,
      };
    }),

  send: protectedProcedure
    .input(
      z.object({
        scope: scopeSchema,
        body: z.string().min(1).max(2000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertChatAccess(ctx.db, input.scope, ctx.user.id);
      const message = await ctx.db.chatMessage.create({
        data: {
          ...input.scope,
          userId: ctx.user.id,
          body: input.body.trim(),
        },
      });
      await broadcastChatMessage(input.scope);
      return message;
    }),

  /** Authors delete their own messages; room moderators delete anyone's. */
  remove: protectedProcedure
    .input(z.object({ messageId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const message = await ctx.db.chatMessage.findUnique({
        where: { id: input.messageId },
        select: { id: true, eventId: true, teamId: true, userId: true },
      });
      if (!message) throw new TRPCError({ code: "NOT_FOUND" });

      const scope: Scope = {
        eventId: message.eventId ?? undefined,
        teamId: message.teamId ?? undefined,
      };

      // Membership of the room is required either way — the author check alone
      // would let someone removed from a team keep tidying its history.
      const access = await assertChatAccess(ctx.db, scope, ctx.user.id);
      if (message.userId !== ctx.user.id && !access.canModerate) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only the author or a moderator can delete a message.",
        });
      }

      await ctx.db.chatMessage.delete({ where: { id: message.id } });
      await broadcastChatMessage(scope);
      return { deleted: true };
    }),
});
