import { initTRPC, TRPCError } from "@trpc/server";
import { auth } from "@clerk/nextjs/server";
import superjson from "superjson";
import { ZodError } from "zod";
import { db } from "@/server/db/client";

/**
 * tRPC context: created per request. Carries the database client and the
 * authenticated Clerk user id (null for anonymous requests).
 */
export async function createTRPCContext(opts: { headers: Headers }) {
  const { userId } = await auth();
  return {
    db,
    clerkUserId: userId,
    headers: opts.headers,
  };
}

export type TRPCContext = Awaited<ReturnType<typeof createTRPCContext>>;

const t = initTRPC.context<TRPCContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError:
          error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    };
  },
});

export const createTRPCRouter = t.router;
export const createCallerFactory = t.createCallerFactory;

export const publicProcedure = t.procedure;

/**
 * Requires a signed-in Clerk session AND a provisioned local User row.
 * Row-level authorization: downstream procedures always scope queries by
 * `ctx.user.id` — never trust client-supplied ids alone.
 */
export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.clerkUserId) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  const user = await ctx.db.user.findUnique({
    where: { authProviderId: ctx.clerkUserId },
  });
  if (!user) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Account not provisioned. Complete onboarding first.",
    });
  }
  return next({ ctx: { ...ctx, user } });
});
