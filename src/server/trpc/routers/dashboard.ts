import {
  EventStatus,
  RegistrationStatus,
  SessionStatus,
  VolunteerSignupStatus,
} from "@prisma/client";
import { createTRPCRouter, protectedProcedure } from "@/server/trpc/trpc";
import { entryActions, sortActions, type ActionItem } from "@/lib/dashboard";
import { entryWaiverState } from "@/server/services/waivers";
import { eligibilityForRegistration } from "@/server/services/eligibility";
import { blockingFindings } from "@/lib/eligibility";

/**
 * Everything the signed-in home page needs, in one call.
 *
 * One query rather than eight, because this page is the first thing a person
 * sees after signing in and a staggered cascade of spinners is what makes an
 * app feel slow. The shape is deliberately "what needs me" first.
 */
export const dashboardRouter = createTRPCRouter({
  home: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.user.id;
    const now = new Date();

    const [profile, entries, shifts, teams, organizations, seriesRoles] =
      await Promise.all([
        ctx.db.profile.findUnique({
          where: { userId },
          select: { displayName: true, avatarUrl: true },
        }),
        ctx.db.eventRegistration.findMany({
          where: {
            OR: [{ entrantUserId: userId }, { submittedById: userId }],
            status: { not: RegistrationStatus.WITHDRAWN },
            event: { status: { not: EventStatus.CANCELED } },
          },
          orderBy: { event: { date: "asc" } },
          select: {
            id: true,
            status: true,
            carNumber: true,
            event: {
              select: {
                id: true,
                name: true,
                date: true,
                venue: true,
                status: true,
                series: { select: { name: true, slug: true } },
                trackLayout: {
                  select: { name: true, track: { select: { name: true } } },
                },
              },
            },
            team: { select: { id: true, name: true, slug: true } },
          },
        }),
        ctx.db.volunteerSignup.findMany({
          where: {
            userId,
            status: { not: VolunteerSignupStatus.CANCELED },
            shift: { startsAt: { gte: now } },
          },
          orderBy: { shift: { startsAt: "asc" } },
          take: 10,
          select: {
            id: true,
            status: true,
            shift: {
              select: {
                id: true,
                title: true,
                startsAt: true,
                event: { select: { id: true, name: true } },
              },
            },
          },
        }),
        ctx.db.teamMembership.findMany({
          where: { userId, endDate: null },
          select: {
            role: true,
            team: {
              select: {
                id: true,
                name: true,
                slug: true,
                branding: { select: { logoUrl: true } },
                logoUrl: true,
              },
            },
          },
        }),
        ctx.db.organizationMembership.findMany({
          where: { userId },
          select: {
            role: true,
            organization: {
              select: {
                id: true,
                name: true,
                slug: true,
                branding: { select: { logoUrl: true } },
              },
            },
          },
        }),
        ctx.db.seriesMembership.findMany({
          where: { userId },
          select: {
            role: true,
            series: {
              select: {
                id: true,
                name: true,
                slug: true,
                logoUrl: true,
                branding: { select: { logoUrl: true } },
              },
            },
          },
        }),
      ]);

    const upcoming = entries.filter((entry) => entry.event.date >= now);
    const past = entries
      .filter((entry) => entry.event.date < now)
      .slice(-5)
      .reverse();

    // Only the next few entries are checked for blockers. Resolving waivers
    // and eligibility is several queries each, and nobody needs to be told on
    // Monday about a waiver for a race in November.
    const soon = upcoming.slice(0, 5);
    const blockers = await Promise.all(
      soon.map(async (entry) => {
        const [waivers, eligibility] = await Promise.all([
          entryWaiverState(ctx.db, entry.id),
          eligibilityForRegistration(ctx.db, entry.id).catch(() => null),
        ]);
        return {
          id: entry.id,
          status: entry.status,
          eventId: entry.event.id,
          eventName: entry.event.name,
          eventDate: entry.event.date,
          outstandingWaivers: waivers.outstanding.reduce(
            (count, person) => count + person.waivers.length,
            0,
          ),
          outstandingRequirements: eligibility
            ? blockingFindings(eligibility.findings).length
            : 0,
        };
      }),
    );

    // Sessions running right now at an event this person is entered in or
    // helping run — the single most time-critical thing on the page.
    const involvedEventIds = [
      ...new Set([
        ...entries.map((entry) => entry.event.id),
        ...shifts.map((signup) => signup.shift.event.id),
      ]),
    ];
    const liveSessions = involvedEventIds.length
      ? await ctx.db.eventSession.findMany({
          where: {
            eventId: { in: involvedEventIds },
            status: SessionStatus.LIVE,
          },
          select: {
            id: true,
            name: true,
            flagState: true,
            event: { select: { id: true, name: true } },
          },
        })
      : [];

    const actions: ActionItem[] = entryActions(blockers, now);
    for (const session of liveSessions) {
      actions.unshift({
        id: `live-${session.id}`,
        urgency: "now",
        title: `${session.name} is running now`,
        detail: session.event.name,
        href: `/events/${session.event.id}/timing`,
        actionLabel: "Open timing",
      });
    }

    return {
      profile,
      actions: sortActions(actions),
      upcoming: upcoming.slice(0, 5),
      past,
      shifts,
      teams: teams.map((membership) => ({
        ...membership.team,
        myRole: membership.role,
      })),
      organizations: organizations.map((membership) => ({
        ...membership.organization,
        myRole: membership.role,
      })),
      series: seriesRoles.map((membership) => ({
        ...membership.series,
        myRole: membership.role,
      })),
      counts: {
        upcomingEntries: upcoming.length,
        shifts: shifts.length,
        needsAction: actions.length,
      },
    };
  }),
});
