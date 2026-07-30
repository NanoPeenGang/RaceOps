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
import { penaltyRouter } from "@/server/trpc/routers/penalty";
import { mediaRouter } from "@/server/trpc/routers/media";
import { sessionRouter } from "@/server/trpc/routers/session";
import { documentRouter } from "@/server/trpc/routers/document";
import { reportRouter } from "@/server/trpc/routers/report";
import { chatRouter } from "@/server/trpc/routers/chat";
import { sponsorshipRouter } from "@/server/trpc/routers/sponsorship";
import { lineupRouter } from "@/server/trpc/routers/lineup";
import { eligibilityRouter } from "@/server/trpc/routers/eligibility";
import { scrutineeringRouter } from "@/server/trpc/routers/scrutineering";
import { incidentRouter } from "@/server/trpc/routers/incident";
import { trackRouter } from "@/server/trpc/routers/track";

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
  penalty: penaltyRouter,
  media: mediaRouter,
  session: sessionRouter,
  document: documentRouter,
  report: reportRouter,
  chat: chatRouter,
  sponsorship: sponsorshipRouter,
  lineup: lineupRouter,
  eligibility: eligibilityRouter,
  scrutineering: scrutineeringRouter,
  incident: incidentRouter,
  track: trackRouter,
});

export type AppRouter = typeof appRouter;

export const createCaller = createCallerFactory(appRouter);
