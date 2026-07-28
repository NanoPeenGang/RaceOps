import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { EndorsementCategory } from "@prisma/client";
import { createTRPCRouter, protectedProcedure } from "@/server/trpc/trpc";

export const endorsementRouter = createTRPCRouter({
  give: protectedProcedure
    .input(
      z.object({
        toUserId: z.string().cuid(),
        category: z.nativeEnum(EndorsementCategory),
        note: z.string().max(1000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.toUserId === ctx.user.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You cannot endorse yourself.",
        });
      }
      const existing = await ctx.db.endorsement.findUnique({
        where: {
          fromUserId_toUserId_category: {
            fromUserId: ctx.user.id,
            toUserId: input.toUserId,
            category: input.category,
          },
        },
      });
      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "You have already endorsed this person in this category.",
        });
      }
      return ctx.db.endorsement.create({
        data: {
          fromUserId: ctx.user.id,
          toUserId: input.toUserId,
          category: input.category,
          note: input.note,
        },
      });
    }),

  revoke: protectedProcedure
    .input(
      z.object({
        toUserId: z.string().cuid(),
        category: z.nativeEnum(EndorsementCategory),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.db.endorsement.deleteMany({
        where: {
          fromUserId: ctx.user.id,
          toUserId: input.toUserId,
          category: input.category,
        },
      });
      if (result.count === 0) throw new TRPCError({ code: "NOT_FOUND" });
      return { revoked: true };
    }),
});
