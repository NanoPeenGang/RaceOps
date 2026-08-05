import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { NotificationType } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { createTRPCRouter, protectedProcedure } from "@/server/trpc/trpc";
import { isVisibleTo, pairKeyFor, unreadCount } from "@/lib/direct-messages";
import { notify } from "@/server/services/notifications";
import { broadcastChatMessage } from "@/server/services/realtime";

/**
 * Direct messages between people.
 *
 * The one room on the platform with no organizational scope, which is exactly
 * why it is wanted: an engineer who needs a word with a driver on another team
 * has nowhere else to have it, and routing that through a team channel makes
 * it everyone's business.
 *
 * Messages live in `ChatMessage` alongside every other room, so sending,
 * deleting and rendering all work the same way. This router owns the threads.
 */

/** Throws unless the caller is in the thread. */
async function assertParticipant(
  db: PrismaClient,
  threadId: string,
  userId: string,
): Promise<void> {
  const participant = await db.directParticipant.findUnique({
    where: { threadId_userId: { threadId, userId } },
    select: { id: true },
  });
  if (!participant) {
    // NOT_FOUND rather than FORBIDDEN: whether a conversation exists between
    // two other people is itself private, and FORBIDDEN would confirm it.
    throw new TRPCError({ code: "NOT_FOUND" });
  }
}

export const messageRouter = createTRPCRouter({
  /** Every thread the caller can see, unread first. */
  inbox: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(50) }))
    .query(async ({ ctx, input }) => {
      const participations = await ctx.db.directParticipant.findMany({
        where: { userId: ctx.user.id },
        orderBy: { thread: { lastMessageAt: "desc" } },
        take: input.limit,
        include: {
          thread: {
            include: {
              participants: {
                include: {
                  user: {
                    select: {
                      id: true,
                      profile: {
                        select: { displayName: true, avatarUrl: true },
                      },
                    },
                  },
                },
              },
              messages: {
                orderBy: { createdAt: "desc" },
                take: 1,
                select: { body: true, createdAt: true, userId: true },
              },
            },
          },
        },
      });

      const visible = participations.filter((participation) =>
        isVisibleTo(participation, participation.thread.lastMessageAt),
      );

      // One grouped count rather than a query per thread: an inbox of fifty
      // threads should not be fifty round trips.
      const counts = await ctx.db.chatMessage.groupBy({
        by: ["threadId"],
        where: {
          threadId: { in: visible.map((p) => p.threadId) },
          userId: { not: ctx.user.id },
        },
        _count: { _all: true },
        _max: { createdAt: true },
      });
      const unreadByThread = new Map<string, number>();
      for (const participation of visible) {
        const row = counts.find((c) => c.threadId === participation.threadId);
        if (!row) {
          unreadByThread.set(participation.threadId, 0);
          continue;
        }
        // The grouped query gives totals, not per-message times, so a thread
        // whose newest message predates the read mark is fully read; anything
        // else is counted precisely below.
        if (
          participation.readAt &&
          row._max.createdAt &&
          row._max.createdAt <= participation.readAt
        ) {
          unreadByThread.set(participation.threadId, 0);
        } else if (!participation.readAt) {
          unreadByThread.set(participation.threadId, row._count._all);
        } else {
          const since = await ctx.db.chatMessage.count({
            where: {
              threadId: participation.threadId,
              userId: { not: ctx.user.id },
              createdAt: { gt: participation.readAt },
            },
          });
          unreadByThread.set(participation.threadId, since);
        }
      }

      return {
        threads: visible.map((participation) => ({
          id: participation.threadId,
          subject: participation.thread.subject,
          lastMessageAt: participation.thread.lastMessageAt,
          lastMessage: participation.thread.messages[0] ?? null,
          unread: unreadByThread.get(participation.threadId) ?? 0,
          participants: participation.thread.participants.map((other) => ({
            userId: other.userId,
            displayName: other.user.profile?.displayName ?? null,
            avatarUrl: other.user.profile?.avatarUrl ?? null,
          })),
        })),
        myUserId: ctx.user.id,
      };
    }),

  /** Unread total across every thread — the badge in the header. */
  unreadTotal: protectedProcedure.query(async ({ ctx }) => {
    const participations = await ctx.db.directParticipant.findMany({
      where: { userId: ctx.user.id, leftAt: null },
      select: { threadId: true, readAt: true },
    });
    let total = 0;
    for (const participation of participations) {
      total += await ctx.db.chatMessage.count({
        where: {
          threadId: participation.threadId,
          userId: { not: ctx.user.id },
          ...(participation.readAt
            ? { createdAt: { gt: participation.readAt } }
            : {}),
        },
      });
    }
    return { unread: total };
  }),

  /**
   * Finds or starts a conversation with somebody.
   *
   * Idempotent for a two-person thread through `pairKey`, so "message this
   * person" from three different pages lands in the same conversation rather
   * than opening a third one beside the two already holding half the history.
   */
  openWith: protectedProcedure
    .input(
      z.object({
        userIds: z.array(z.string().cuid()).min(1).max(20),
        subject: z.string().max(120).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const members = [...new Set([...input.userIds, ctx.user.id])];
      if (members.length < 2) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Pick somebody to message.",
        });
      }

      const known = await ctx.db.user.findMany({
        where: { id: { in: members } },
        select: { id: true },
      });
      if (known.length !== members.length) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No such person." });
      }

      const pairKey = pairKeyFor(members);
      if (pairKey) {
        const existing = await ctx.db.directThread.findUnique({
          where: { pairKey },
          select: { id: true },
        });
        if (existing) {
          // Re-opening a thread you left puts it back in your inbox, rather
          // than leaving you writing into something you cannot see.
          await ctx.db.directParticipant.updateMany({
            where: { threadId: existing.id, userId: ctx.user.id },
            data: { leftAt: null },
          });
          return { threadId: existing.id, created: false };
        }
      }

      const thread = await ctx.db.directThread.create({
        data: {
          pairKey,
          subject: input.subject ?? null,
          createdById: ctx.user.id,
          participants: {
            create: members.map((userId) => ({
              userId,
              // The opener has read their own empty thread by definition.
              readAt: userId === ctx.user.id ? new Date() : null,
            })),
          },
        },
        select: { id: true },
      });
      return { threadId: thread.id, created: true };
    }),

  /** One conversation, oldest first so it reads top to bottom. */
  thread: protectedProcedure
    .input(
      z.object({
        threadId: z.string().cuid(),
        limit: z.number().int().min(1).max(200).default(100),
      }),
    )
    .query(async ({ ctx, input }) => {
      await assertParticipant(ctx.db, input.threadId, ctx.user.id);

      const thread = await ctx.db.directThread.findUniqueOrThrow({
        where: { id: input.threadId },
        include: {
          participants: {
            include: {
              user: {
                select: {
                  id: true,
                  profile: { select: { displayName: true, avatarUrl: true } },
                },
              },
            },
          },
        },
      });

      const messages = await ctx.db.chatMessage.findMany({
        where: { threadId: input.threadId },
        orderBy: { createdAt: "desc" },
        take: input.limit,
        include: {
          user: {
            select: { id: true, profile: { select: { displayName: true } } },
          },
        },
      });

      const me = thread.participants.find(
        (participant) => participant.userId === ctx.user.id,
      )!;

      return {
        thread: {
          id: thread.id,
          subject: thread.subject,
          lastMessageAt: thread.lastMessageAt,
          participants: thread.participants.map((participant) => ({
            userId: participant.userId,
            displayName: participant.user.profile?.displayName ?? null,
            avatarUrl: participant.user.profile?.avatarUrl ?? null,
            leftAt: participant.leftAt,
          })),
        },
        messages: messages.reverse(),
        myUserId: ctx.user.id,
        unread: unreadCount(messages, me),
      };
    }),

  /** Marks the thread read up to now. */
  markRead: protectedProcedure
    .input(z.object({ threadId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertParticipant(ctx.db, input.threadId, ctx.user.id);
      await ctx.db.directParticipant.update({
        where: {
          threadId_userId: { threadId: input.threadId, userId: ctx.user.id },
        },
        data: { readAt: new Date() },
      });
      return { read: true };
    }),

  send: protectedProcedure
    .input(
      z.object({
        threadId: z.string().cuid(),
        body: z.string().min(1).max(4000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertParticipant(ctx.db, input.threadId, ctx.user.id);
      const now = new Date();

      const message = await ctx.db.$transaction(async (tx) => {
        const created = await tx.chatMessage.create({
          data: {
            threadId: input.threadId,
            userId: ctx.user.id,
            body: input.body.trim(),
          },
        });
        await tx.directThread.update({
          where: { id: input.threadId },
          data: { lastMessageAt: now },
        });
        // Sending is reading: a thread you just wrote in should not come back
        // showing your own message as unread.
        await tx.directParticipant.update({
          where: {
            threadId_userId: { threadId: input.threadId, userId: ctx.user.id },
          },
          data: { readAt: now },
        });
        return created;
      });

      await broadcastChatMessage({ threadId: input.threadId });
      await notifyOthers(ctx.db, input.threadId, ctx.user.id, input.body);
      return message;
    }),

  /**
   * Leaves a thread.
   *
   * Hides it rather than destroying it — the other side's copy of a
   * conversation is not the leaver's to delete. A later message brings it
   * back, because a reply to a conversation you left is still addressed to
   * you.
   */
  leave: protectedProcedure
    .input(z.object({ threadId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertParticipant(ctx.db, input.threadId, ctx.user.id);
      await ctx.db.directParticipant.update({
        where: {
          threadId_userId: { threadId: input.threadId, userId: ctx.user.id },
        },
        data: { leftAt: new Date() },
      });
      return { left: true };
    }),
});

/**
 * Tells the other participants, once per message.
 *
 * Best-effort: a notification that fails must not lose the message, which has
 * already been committed by the time this runs.
 */
async function notifyOthers(
  db: PrismaClient,
  threadId: string,
  senderId: string,
  body: string,
): Promise<void> {
  const sender = await db.user.findUnique({
    where: { id: senderId },
    select: { profile: { select: { displayName: true } } },
  });
  const others = await db.directParticipant.findMany({
    where: { threadId, userId: { not: senderId } },
    select: { userId: true },
  });

  const name = sender?.profile?.displayName ?? "Someone";
  await Promise.allSettled(
    others.map((participant) =>
      notify(db, {
        userId: participant.userId,
        type: NotificationType.DIRECT_MESSAGE,
        title: `${name} messaged you`,
        // Truncated: a notification row is a prompt to open the thread, not a
        // copy of it, and a long message would fill the drawer.
        body: body.length > 140 ? `${body.slice(0, 139)}…` : body,
        linkUrl: `/messages/${threadId}`,
      }),
    ),
  );
}
