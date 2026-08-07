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
import { carRouter } from "@/server/trpc/routers/car";
import { paddockRouter } from "@/server/trpc/routers/paddock";
import { logRouter } from "@/server/trpc/routers/log";
import { waiverRouter } from "@/server/trpc/routers/waiver";
import { organizationRouter } from "@/server/trpc/routers/organization";
import { uploadRouter } from "@/server/trpc/routers/upload";
import { brandingRouter } from "@/server/trpc/routers/branding";
import { dashboardRouter } from "@/server/trpc/routers/dashboard";
import { garageRouter } from "@/server/trpc/routers/garage";
import { pitStopRouter } from "@/server/trpc/routers/pitstop";
import { channelRouter } from "@/server/trpc/routers/channel";
import { messageRouter } from "@/server/trpc/routers/message";
import { hiringRouter } from "@/server/trpc/routers/hiring";
import { payrollRouter } from "@/server/trpc/routers/payroll";
import { accessRouter } from "@/server/trpc/routers/access";
import { sponsorRouter } from "@/server/trpc/routers/sponsor";

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
  car: carRouter,
  paddock: paddockRouter,
  log: logRouter,
  waiver: waiverRouter,
  organization: organizationRouter,
  upload: uploadRouter,
  branding: brandingRouter,
  dashboard: dashboardRouter,
  garage: garageRouter,
  pitStop: pitStopRouter,
  channel: channelRouter,
  message: messageRouter,
  hiring: hiringRouter,
  payroll: payrollRouter,
  access: accessRouter,
  sponsor: sponsorRouter,
});

export type AppRouter = typeof appRouter;

export const createCaller = createCallerFactory(appRouter);
