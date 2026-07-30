import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/trpc/root";

type RouterOutputs = inferRouterOutputs<AppRouter>;

/** The team console's data, shared by its panels. */
export type TeamDashboard = RouterOutputs["team"]["dashboard"];
export type TeamSeason = RouterOutputs["team"]["season"];
export type TeamSponsorships = RouterOutputs["sponsorship"]["forTeam"];
