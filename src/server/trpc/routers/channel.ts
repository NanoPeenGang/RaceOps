import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  ChannelKind,
  OrgRole,
  SeriesRole,
  TeamRole,
} from "@prisma/client";
import { createTRPCRouter, protectedProcedure } from "@/server/trpc/trpc";
import { availableTemplates, describeAudienceProblem } from "@/lib/channels";
import { slugify } from "@/lib/slug";
import {
  assertCanManageChannels,
  channelAccess,
} from "@/server/services/channel-access";

/**
 * Department channels: creating them, and listing the ones you can see.
 *
 * Messages themselves go through the chat router, which already knows how to
 * read and write a room. This router is only about the rooms.
 */

const scopeSchema = z
  .object({
    teamId: z.string().cuid().optional(),
    eventId: z.string().cuid().optional(),
    seriesId: z.string().cuid().optional(),
    organizationId: z.string().cuid().optional(),
  })
  .refine(
    (scope) =>
      [scope.teamId, scope.eventId, scope.seriesId, scope.organizationId].filter(
        Boolean,
      ).length === 1,
    "A channel belongs to exactly one team, event, series or organization.",
  );

export const channelRouter = createTRPCRouter({
  /**
   * The channels in a scope that the caller may actually enter.
   *
   * Filtered rather than listed-and-locked. A room list showing four channels
   * you cannot open tells everyone what departments exist and who is in them,
   * which is information a private channel is supposed to be keeping.
   */
  list: protectedProcedure
    .input(
      z.object({
        scope: scopeSchema,
        includeArchived: z.boolean().default(false),
      }),
    )
    .query(async ({ ctx, input }) => {
      const channels = await ctx.db.chatChannel.findMany({
        where: {
          ...input.scope,
          ...(input.includeArchived ? {} : { archived: false }),
        },
        orderBy: [{ kind: "asc" }, { name: "asc" }],
        include: {
          staffRole: { select: { id: true, name: true } },
          _count: { select: { messages: true } },
        },
      });

      const visible: typeof channels = [];
      let canManage = false;
      for (const channel of channels) {
        const access = await channelAccess(ctx.db, channel, ctx.user.id);
        if (access.canModerate) canManage = true;
        if (access.allowed) visible.push(channel);
      }

      /*
       * `canManage` is derived from the channels above when there are any, but
       * a scope with no channels yet still needs to know whether to offer the
       * "add one" button — which is the state every team starts in.
       */
      if (channels.length === 0) {
        canManage = await canManageScope(ctx.db, input.scope, ctx.user.id);
      }

      return {
        channels: visible,
        canManage,
        suggestions: input.scope.teamId
          ? availableTemplates(channels.map((channel) => channel.slug))
          : [],
      };
    }),

  create: protectedProcedure
    .input(
      z.object({
        scope: scopeSchema,
        name: z.string().min(1).max(80),
        description: z.string().max(300).nullish(),
        kind: z.nativeEnum(ChannelKind).default(ChannelKind.DEPARTMENT),
        teamRoles: z.array(z.nativeEnum(TeamRole)).max(6).default([]),
        seriesRoles: z.array(z.nativeEnum(SeriesRole)).max(10).default([]),
        orgRoles: z.array(z.nativeEnum(OrgRole)).max(3).default([]),
        staffRoleId: z.string().cuid().nullish(),
        includesEntrantTeams: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertCanManageChannels(ctx.db, input.scope, ctx.user.id);

      // The same rule the database CHECK enforces, stated here so the form
      // gets a sentence instead of a constraint violation.
      const problem = describeAudienceProblem({
        kind: input.kind,
        teamRoles: input.teamRoles,
        seriesRoles: input.seriesRoles,
        orgRoles: input.orgRoles,
        staffRoleId: input.staffRoleId ?? null,
      });
      if (problem) {
        throw new TRPCError({ code: "BAD_REQUEST", message: problem });
      }

      const slug = slugify(input.name);
      const clash = await ctx.db.chatChannel.findFirst({
        where: { ...input.scope, slug },
        select: { id: true },
      });
      if (clash) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "There is already a channel with that name here.",
        });
      }

      return ctx.db.chatChannel.create({
        data: {
          ...input.scope,
          name: input.name.trim(),
          slug,
          description: input.description ?? null,
          kind: input.kind,
          teamRoles: input.teamRoles,
          seriesRoles: input.seriesRoles,
          orgRoles: input.orgRoles,
          staffRoleId: input.staffRoleId ?? null,
          includesEntrantTeams: input.includesEntrantTeams,
          createdById: ctx.user.id,
        },
      });
    }),

  update: protectedProcedure
    .input(
      z.object({
        channelId: z.string().cuid(),
        name: z.string().min(1).max(80).optional(),
        description: z.string().max(300).nullish(),
        teamRoles: z.array(z.nativeEnum(TeamRole)).max(6).optional(),
        seriesRoles: z.array(z.nativeEnum(SeriesRole)).max(10).optional(),
        orgRoles: z.array(z.nativeEnum(OrgRole)).max(3).optional(),
        staffRoleId: z.string().cuid().nullish(),
        includesEntrantTeams: z.boolean().optional(),
        archived: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { channelId, ...changes } = input;
      const channel = await ctx.db.chatChannel.findUnique({
        where: { id: channelId },
      });
      if (!channel) throw new TRPCError({ code: "NOT_FOUND" });
      await assertCanManageChannels(ctx.db, channel, ctx.user.id);

      const merged = {
        kind: channel.kind,
        teamRoles: changes.teamRoles ?? channel.teamRoles,
        seriesRoles: changes.seriesRoles ?? channel.seriesRoles,
        orgRoles: changes.orgRoles ?? channel.orgRoles,
        staffRoleId:
          changes.staffRoleId === undefined
            ? channel.staffRoleId
            : (changes.staffRoleId ?? null),
      };
      const problem = describeAudienceProblem(merged);
      if (problem) {
        throw new TRPCError({ code: "BAD_REQUEST", message: problem });
      }

      return ctx.db.chatChannel.update({
        where: { id: channelId },
        data: {
          ...changes,
          ...(changes.name ? { slug: slugify(changes.name) } : {}),
        },
      });
    }),

  /**
   * Archives a channel. There is deliberately no delete.
   *
   * A department channel is where decisions get made — what fuel number was
   * agreed, who called the driver in. Deleting it destroys that for everyone
   * at once, and an archived channel is readable, silent and reversible.
   */
  archive: protectedProcedure
    .input(z.object({ channelId: z.string().cuid(), archived: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const channel = await ctx.db.chatChannel.findUnique({
        where: { id: input.channelId },
      });
      if (!channel) throw new TRPCError({ code: "NOT_FOUND" });
      await assertCanManageChannels(ctx.db, channel, ctx.user.id);

      return ctx.db.chatChannel.update({
        where: { id: input.channelId },
        data: { archived: input.archived },
      });
    }),

  /** Who is actually in a department right now, derived from the roster. */
  members: protectedProcedure
    .input(z.object({ channelId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const channel = await ctx.db.chatChannel.findUnique({
        where: { id: input.channelId },
      });
      if (!channel) throw new TRPCError({ code: "NOT_FOUND" });

      const access = await channelAccess(ctx.db, channel, ctx.user.id);
      if (!access.allowed) throw new TRPCError({ code: "FORBIDDEN" });

      // Only the team case can be answered from one table. The event case
      // spans every entry in the meeting and is deliberately not offered
      // here — a paddock-wide department has no short member list.
      if (!channel.teamId) return { members: null as null | never[] };

      const roster = await ctx.db.teamMembership.findMany({
        where: {
          teamId: channel.teamId,
          endDate: null,
          ...(channel.kind === ChannelKind.DEPARTMENT
            ? { role: { in: channel.teamRoles } }
            : {}),
        },
        select: {
          role: true,
          user: {
            select: { id: true, profile: { select: { displayName: true } } },
          },
        },
      });
      return {
        members: roster.map((member) => ({
          userId: member.user.id,
          role: member.role,
          displayName: member.user.profile?.displayName ?? null,
        })),
      };
    }),
});

async function canManageScope(
  db: Parameters<typeof assertCanManageChannels>[0],
  scope: z.infer<typeof scopeSchema>,
  userId: string,
): Promise<boolean> {
  try {
    await assertCanManageChannels(db, scope, userId);
    return true;
  } catch {
    return false;
  }
}
