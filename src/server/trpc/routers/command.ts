import { z } from "zod";
import { EventStatus, RegistrationStatus, SessionStatus } from "@prisma/client";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "@/server/trpc/trpc";
import { TEAM_ROLE_LABELS, isTeamManager } from "@/lib/teams";
import { ORG_ROLE_LABELS, SERIES_ROLE_LABELS } from "@/lib/permissions";
import { canReview, effectivePlatformRole } from "@/server/services/platform-admin";
import type {
  PaletteContexts,
  PaletteEvent,
} from "@/lib/command-set";

/**
 * What the command palette needs to know.
 *
 * Two procedures with different shapes on purpose. `contexts` is everything
 * about *you* — the teams, series and race weekends you are part of — fetched
 * once when the palette opens and then matched locally, because the whole
 * point of a palette is that it answers between keystrokes. `search` is the
 * long tail: the rest of the platform, which is far too large to ship to the
 * client and is queried only once somebody has typed enough to mean something.
 */

/** Cheap and stable: the palette shows a date, not a countdown. */
const WHEN = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/**
 * How many of a person's race weekends to offer.
 *
 * Every event here multiplies into console tabs and sub-pages, so this number
 * is really "about a hundred and fifty commands", not "eight rows". Somebody
 * with a full season does not want their whole calendar in a palette; they
 * want the one they are standing at.
 */
const EVENT_LIMIT = 8;

export const commandRouter = createTRPCRouter({
  contexts: protectedProcedure.query(async ({ ctx }): Promise<PaletteContexts> => {
    const userId = ctx.user.id;
    const now = new Date();

    const [teams, seriesRoles, organizations] = await Promise.all([
      ctx.db.teamMembership.findMany({
        where: { userId, endDate: null },
        select: { role: true, team: { select: { name: true, slug: true } } },
      }),
      ctx.db.seriesMembership.findMany({
        where: { userId },
        select: { role: true, series: { select: { id: true, name: true, slug: true } } },
      }),
      ctx.db.organizationMembership.findMany({
        where: { userId },
        select: { role: true, organization: { select: { name: true, slug: true } } },
      }),
    ]);

    // Reads the live role rather than the stored column, so an address named
    // in the environment can still reach the queue when every admin row has
    // been demoted — the same rule the admin pages themselves apply.
    const staff = canReview(effectivePlatformRole(ctx.user));

    /*
     * The events worth offering are the ones somebody has a reason to open:
     * a weekend they run, or one they are entered in. Both are fetched and
     * merged rather than unioned in SQL, because "can I manage this" comes
     * from the series side and "am I entered" comes from the registration
     * side, and a single query would have to answer both for every row.
     */
    const manageableSeriesIds = seriesRoles.map((entry) => entry.series.id);

    const [runs, entered] = await Promise.all([
      manageableSeriesIds.length > 0
        ? ctx.db.raceEvent.findMany({
            where: {
              seriesId: { in: manageableSeriesIds },
              status: { not: EventStatus.CANCELED },
              // Past weekends stop being somewhere you are going and start
              // being a results page; a week is enough to finish the paperwork.
              date: { gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) },
            },
            orderBy: { date: "asc" },
            take: EVENT_LIMIT,
            select: {
              id: true,
              name: true,
              date: true,
              series: { select: { name: true } },
              sessions: {
                where: { status: SessionStatus.LIVE },
                select: { id: true },
                take: 1,
              },
            },
          })
        : Promise.resolve([]),
      ctx.db.eventRegistration.findMany({
        where: {
          OR: [{ entrantUserId: userId }, { submittedById: userId }],
          status: { not: RegistrationStatus.WITHDRAWN },
          event: {
            status: { not: EventStatus.CANCELED },
            date: { gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) },
          },
        },
        orderBy: { event: { date: "asc" } },
        take: EVENT_LIMIT,
        select: {
          event: {
            select: {
              id: true,
              name: true,
              date: true,
              series: { select: { name: true } },
              sessions: {
                where: { status: SessionStatus.LIVE },
                select: { id: true },
                take: 1,
              },
            },
          },
        },
      }),
    ]);

    const events = new Map<string, PaletteEvent>();
    for (const event of runs) {
      events.set(event.id, {
        id: event.id,
        name: event.name,
        when: WHEN.format(event.date),
        seriesName: event.series?.name ?? null,
        live: event.sessions.length > 0,
        canManage: true,
      });
    }
    for (const { event } of entered) {
      // An event somebody both runs and is entered in keeps the console link.
      if (events.has(event.id)) continue;
      events.set(event.id, {
        id: event.id,
        name: event.name,
        when: WHEN.format(event.date),
        seriesName: event.series?.name ?? null,
        live: event.sessions.length > 0,
        canManage: false,
      });
    }

    return {
      teams: teams.map((entry) => ({
        name: entry.team.name,
        slug: entry.team.slug,
        role: TEAM_ROLE_LABELS[entry.role],
        canManage: isTeamManager(entry.role),
      })),
      series: seriesRoles.map((entry) => ({
        name: entry.series.name,
        slug: entry.series.slug,
        role: SERIES_ROLE_LABELS[entry.role],
        // The series console admits anybody with a role; what they can change
        // inside it is decided per panel, not at the door.
        canManage: true,
      })),
      organizations: organizations.map((entry) => ({
        name: entry.organization.name,
        slug: entry.organization.slug,
        role: ORG_ROLE_LABELS[entry.role],
      })),
      events: [...events.values()]
        .sort((a, b) => Number(b.live) - Number(a.live))
        .slice(0, EVENT_LIMIT),
      isPlatformStaff: staff,
    };
  }),

  /**
   * Name search across the four public directories.
   *
   * Public, because the palette is useful before you are signed in and none
   * of this is private — it is the same set of things the directory pages
   * already list. Published events only: a draft is not findable by name
   * until its organiser says so.
   */
  search: publicProcedure
    .input(
      z.object({
        query: z.string().min(2).max(80),
        limit: z.number().int().min(1).max(8).default(4),
      }),
    )
    .query(async ({ ctx, input }) => {
      const contains = { contains: input.query, mode: "insensitive" as const };
      const take = input.limit;

      const [events, series, teams, tracks] = await Promise.all([
        ctx.db.raceEvent.findMany({
          where: {
            name: contains,
            status: { in: [EventStatus.PUBLISHED, EventStatus.COMPLETED] },
          },
          orderBy: { date: "desc" },
          take,
          select: {
            id: true,
            name: true,
            date: true,
            series: { select: { name: true } },
            seriesLabel: true,
          },
        }),
        ctx.db.series.findMany({
          where: { name: contains },
          orderBy: { name: "asc" },
          take,
          select: { name: true, slug: true, organization: { select: { name: true } } },
        }),
        ctx.db.team.findMany({
          where: { name: contains },
          orderBy: { name: "asc" },
          take,
          select: { name: true, slug: true, homeBase: true },
        }),
        ctx.db.track.findMany({
          where: { name: contains },
          orderBy: { name: "asc" },
          take,
          select: { name: true, slug: true, city: true, region: true },
        }),
      ]);

      return {
        events: events.map((event) => ({
          id: event.id,
          name: event.name,
          hint: `${event.series?.name ?? event.seriesLabel} · ${WHEN.format(event.date)}`,
        })),
        series: series.map((entry) => ({
          slug: entry.slug,
          name: entry.name,
          hint: entry.organization?.name ?? "Series",
        })),
        teams: teams.map((team) => ({
          slug: team.slug,
          name: team.name,
          hint: team.homeBase ?? "Team",
        })),
        tracks: tracks.map((track) => ({
          slug: track.slug,
          name: track.name,
          hint: [track.city, track.region].filter(Boolean).join(", ") || "Track",
        })),
      };
    }),
});
