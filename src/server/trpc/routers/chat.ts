import { z } from "zod";
import { TRPCError } from "@trpc/server";
import type { PrismaClient } from "@prisma/client";
import { createTRPCRouter, protectedProcedure } from "@/server/trpc/trpc";
import {
  getSeriesRole,
  SERIES_EVENT_ROLES,
} from "@/server/services/series-auth";
import { broadcastChatMessage } from "@/server/services/realtime";

/**
 * Paddock chat — a per-event room for the people actually at the meeting.
 *
 * Access is deliberately narrow: organizers of the owning series, anyone with
 * an entry, and signed-up volunteers. It is not a public comment section, so
 * both reads and writes require a signed-in participant.
 */

interface ChatAccess {
  canPost: boolean;
  isOrganizer: boolean;
}

async function assertChatAccess(
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
    return { canPost: true, isOrganizer: true };
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
    return { canPost: true, isOrganizer: false };
  }

  throw new TRPCError({
    code: "FORBIDDEN",
    message: "Paddock chat is for entrants, volunteers and organizers.",
  });
}

export const chatRouter = createTRPCRouter({
  /** Recent messages, oldest first so the transcript reads top-to-bottom. */
  forEvent: protectedProcedure
    .input(
      z.object({
        eventId: z.string().cuid(),
        limit: z.number().int().min(1).max(200).default(100),
      }),
    )
    .query(async ({ ctx, input }) => {
      const access = await assertChatAccess(ctx.db, input.eventId, ctx.user.id);
      const messages = await ctx.db.chatMessage.findMany({
        where: { eventId: input.eventId },
        orderBy: { createdAt: "desc" },
        take: input.limit,
        include: {
          user: {
            select: {
              id: true,
              profile: {
                select: { displayName: true },
              },
            },
          },
        },
      });
      return {
        messages: messages.reverse(),
        myUserId: ctx.user.id,
        canModerate: access.isOrganizer,
      };
    }),

  send: protectedProcedure
    .input(
      z.object({
        eventId: z.string().cuid(),
        body: z.string().min(1).max(2000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertChatAccess(ctx.db, input.eventId, ctx.user.id);
      const message = await ctx.db.chatMessage.create({
        data: {
          eventId: input.eventId,
          userId: ctx.user.id,
          body: input.body.trim(),
        },
      });
      await broadcastChatMessage(input.eventId);
      return message;
    }),

  /** Authors delete their own messages; organizers moderate anyone's. */
  remove: protectedProcedure
    .input(z.object({ messageId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const message = await ctx.db.chatMessage.findUnique({
        where: { id: input.messageId },
        select: { id: true, eventId: true, userId: true },
      });
      if (!message) throw new TRPCError({ code: "NOT_FOUND" });

      if (message.userId !== ctx.user.id) {
        const access = await assertChatAccess(
          ctx.db,
          message.eventId,
          ctx.user.id,
        );
        if (!access.isOrganizer) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only the author or an organizer can delete a message.",
          });
        }
      }

      await ctx.db.chatMessage.delete({ where: { id: message.id } });
      await broadcastChatMessage(message.eventId);
      return { deleted: true };
    }),
});
