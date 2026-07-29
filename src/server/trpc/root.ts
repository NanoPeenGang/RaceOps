import { createCallerFactory, createTRPCRouter } from "@/server/trpc/trpc";
import { userRouter } from "@/server/trpc/routers/user";
import { profileRouter } from "@/server/trpc/routers/profile";
import { teamRouter } from "@/server/trpc/routers/team";
import { opportunityRouter } from "@/server/trpc/routers/opportunity";
import { searchRouter } from "@/server/trpc/routers/search";
import { endorsementRouter } from "@/server/trpc/routers/endorsement";
import { billingRouter } from "@/server/trpc/routers/billing";
import { notificationRouter } from "@/server/trpc/routers/notification";
import { seriesRouter } from "@/server/trpc/routers/series";
import { eventRouter } from "@/server/trpc/routers/event";
import { strategyRouter } from "@/server/trpc/routers/strategy";

export const appRouter = createTRPCRouter({
  user: userRouter,
  profile: profileRouter,
  team: teamRouter,
  opportunity: opportunityRouter,
  search: searchRouter,
  endorsement: endorsementRouter,
  billing: billingRouter,
  notification: notificationRouter,
  series: seriesRouter,
  event: eventRouter,
  strategy: strategyRouter,
});

export type AppRouter = typeof appRouter;

export const createCaller = createCallerFactory(appRouter);
