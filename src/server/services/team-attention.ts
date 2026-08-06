import {
  ApplicationStatus,
  InterviewStatus,
  PayRunStatus,
  ServiceStatus,
} from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { EMPTY_ATTENTION, type TeamAttention } from "@/lib/attention";
import { STALE_AFTER_DAYS } from "@/lib/hiring";
import { stockLevel } from "@/lib/inventory";
import { upcomingServices } from "@/lib/service";

/**
 * Computes what is waiting on the managers of one or more teams.
 *
 * Batched across every team in one call rather than looped, because the home
 * dashboard asks this for every team somebody manages and a query per team
 * would put the N+1 straight back after last week's work removing three of
 * them. Six queries, whether that is one team or twenty.
 *
 * Two of the counts cannot be expressed in SQL and are finished in JS on a
 * deliberately small result set:
 *
 * - **Overdue services** depend on `assessDue`, which compares either a date
 *   or a running-hours figure against the car's own hours. Open service jobs
 *   per team are a handful.
 * - **Low stock** is a column-against-column comparison (`quantity <=
 *   minQuantity`) that Prisma cannot express, so the rows with a threshold set
 *   are fetched and compared. Only items *with* a threshold are loaded, which
 *   is a fraction of a stock list.
 */
export async function teamAttention(
  db: PrismaClient,
  teams: readonly { id: string; name: string; slug: string }[],
  now: Date = new Date(),
): Promise<Map<string, TeamAttention>> {
  const result = new Map<string, TeamAttention>(
    teams.map((team) => [
      team.id,
      {
        ...EMPTY_ATTENTION,
        teamId: team.id,
        teamName: team.name,
        teamSlug: team.slug,
      },
    ]),
  );
  if (teams.length === 0) return result;

  const teamIds = teams.map((team) => team.id);
  const staleBefore = new Date(
    now.getTime() - STALE_AFTER_DAYS * 86_400_000,
  );

  const [postings, payRuns, unpaidLines, services, stock] = await Promise.all([
    // Applications hang off an opportunity, so the team comes through the
    // posting. Fetched as ids first so the counts below can be grouped.
    db.opportunity.findMany({
      where: { postedByTeamId: { in: teamIds } },
      select: { id: true, postedByTeamId: true },
    }),
    db.payRun.groupBy({
      by: ["teamId", "status"],
      where: { teamId: { in: teamIds } },
      _count: { _all: true },
    }),
    db.payrollLine.findMany({
      where: {
        paidAt: null,
        payRun: { teamId: { in: teamIds }, status: PayRunStatus.APPROVED },
      },
      select: { payRun: { select: { id: true, teamId: true } } },
    }),
    db.carService.findMany({
      where: {
        status: { in: [ServiceStatus.PLANNED, ServiceStatus.IN_PROGRESS] },
        car: { teamId: { in: teamIds } },
      },
      select: {
        id: true,
        status: true,
        nextDueOn: true,
        nextDueHours: true,
        car: { select: { teamId: true, runningHours: true } },
      },
    }),
    db.inventoryItem.findMany({
      where: {
        teamId: { in: teamIds },
        active: true,
        minQuantity: { not: null },
      },
      select: { teamId: true, quantity: true, minQuantity: true },
    }),
  ]);

  const teamForPosting = new Map(
    postings.map((posting) => [posting.id, posting.postedByTeamId]),
  );
  const opportunityIds = postings.map((posting) => posting.id);

  const [newByPosting, staleByPosting, interviews] = await Promise.all([
    opportunityIds.length
      ? db.application.groupBy({
          by: ["opportunityId"],
          where: {
            opportunityId: { in: opportunityIds },
            status: ApplicationStatus.SUBMITTED,
          },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    opportunityIds.length
      ? db.application.groupBy({
          by: ["opportunityId"],
          where: {
            opportunityId: { in: opportunityIds },
            createdAt: { lt: staleBefore },
            status: {
              in: [
                ApplicationStatus.SUBMITTED,
                ApplicationStatus.REVIEWING,
                ApplicationStatus.INTERVIEWING,
                ApplicationStatus.OFFERED,
              ],
            },
          },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    opportunityIds.length
      ? db.interview.findMany({
          where: {
            application: { opportunityId: { in: opportunityIds } },
            // Declined needs the team to offer new times; confirmed-and-past
            // needs somebody to say how it went. Both are the team's move.
            OR: [
              { status: InterviewStatus.DECLINED },
              {
                status: InterviewStatus.CONFIRMED,
                scheduledAt: { lt: now },
              },
            ],
          },
          select: { application: { select: { opportunityId: true } } },
        })
      : Promise.resolve([]),
  ]);

  const bump = (
    teamId: string | null | undefined,
    key: keyof typeof EMPTY_ATTENTION,
    by = 1,
  ) => {
    if (!teamId) return;
    const row = result.get(teamId);
    if (row) row[key] += by;
  };

  for (const group of newByPosting) {
    bump(
      teamForPosting.get(group.opportunityId),
      "newApplications",
      group._count._all,
    );
  }
  for (const group of staleByPosting) {
    bump(
      teamForPosting.get(group.opportunityId),
      "staleApplications",
      group._count._all,
    );
  }
  for (const interview of interviews) {
    bump(
      teamForPosting.get(interview.application.opportunityId),
      "interviewsToArrange",
    );
  }

  for (const group of payRuns) {
    if (group.status === PayRunStatus.DRAFT) {
      bump(group.teamId, "payRunsToApprove", group._count._all);
    }
  }

  // One approved run with six unpaid lines is one thing to do, not six.
  const runsOwing = new Map<string, Set<string>>();
  for (const line of unpaidLines) {
    const existing = runsOwing.get(line.payRun.teamId) ?? new Set<string>();
    existing.add(line.payRun.id);
    runsOwing.set(line.payRun.teamId, existing);
  }
  for (const [teamId, runs] of runsOwing) {
    bump(teamId, "payRunsToPay", runs.size);
  }

  // Each job is assessed against its *own* car's hours, which is why the row
  // carries them: two cars on one team are rarely at the same figure.
  for (const service of services) {
    const overdue = upcomingServices(
      [service],
      service.car.runningHours,
      now,
    ).some(({ assessment }) => assessment.urgency === "overdue");
    if (overdue) bump(service.car.teamId, "overdueServices");
  }

  for (const item of stock) {
    const level = stockLevel(item);
    if (level === "low" || level === "out") bump(item.teamId, "lowStock");
  }

  return result;
}

/**
 * The same thing for a single team, or null when the caller does not run it.
 *
 * Null rather than a zeroed shape: "nothing needs attention" and "you are not
 * allowed to know" are different answers, and a console that showed the second
 * as the first would quietly tell a driver the team has no outstanding pay
 * runs.
 */
export async function attentionForTeam(
  db: PrismaClient,
  team: { id: string; name: string; slug: string },
  now: Date = new Date(),
): Promise<TeamAttention> {
  const map = await teamAttention(db, [team], now);
  return map.get(team.id)!;
}
