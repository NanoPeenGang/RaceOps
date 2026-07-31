import type { PrismaClient } from "@prisma/client";
import { resolveBranding, type ResolvedBranding } from "@/lib/branding";

/**
 * Loading branding with its inheritance chain.
 *
 * An event falls back to its series, a series to its organization, an
 * organization to RaceOps. Resolving the chain server-side rather than in each
 * page means one query shape and one set of fallback rules — the alternative
 * is every landing page reimplementing the same three-level lookup slightly
 * differently.
 */

const brandingSelect = {
  logoUrl: true,
  bannerUrl: true,
  primaryColor: true,
  accentColor: true,
  tagline: true,
} as const;

export async function brandingForEvent(
  db: PrismaClient,
  eventId: string,
): Promise<ResolvedBranding> {
  const event = await db.raceEvent.findUnique({
    where: { id: eventId },
    select: {
      branding: { select: brandingSelect },
      series: {
        select: {
          logoUrl: true,
          branding: { select: brandingSelect },
          organization: {
            select: { branding: { select: brandingSelect } },
          },
        },
      },
    },
  });
  return resolveBranding(
    event?.branding,
    event?.series?.branding,
    // The pre-branding `Series.logoUrl` still counts as a logo. Ignoring it
    // would blank the mark on every series that set one before this existed.
    event?.series?.logoUrl ? { logoUrl: event.series.logoUrl } : null,
    event?.series?.organization?.branding,
  );
}

export async function brandingForSeries(
  db: PrismaClient,
  seriesId: string,
): Promise<ResolvedBranding> {
  const series = await db.series.findUnique({
    where: { id: seriesId },
    select: {
      logoUrl: true,
      branding: { select: brandingSelect },
      organization: { select: { branding: { select: brandingSelect } } },
    },
  });
  return resolveBranding(
    series?.branding,
    series?.logoUrl ? { logoUrl: series.logoUrl } : null,
    series?.organization?.branding,
  );
}

export async function brandingForTeam(
  db: PrismaClient,
  teamId: string,
): Promise<ResolvedBranding> {
  const team = await db.team.findUnique({
    where: { id: teamId },
    select: {
      logoUrl: true,
      branding: { select: brandingSelect },
      organization: { select: { branding: { select: brandingSelect } } },
    },
  });
  return resolveBranding(
    team?.branding,
    team?.logoUrl ? { logoUrl: team.logoUrl } : null,
    team?.organization?.branding,
  );
}

export async function brandingForOrganization(
  db: PrismaClient,
  organizationId: string,
): Promise<ResolvedBranding> {
  const organization = await db.organization.findUnique({
    where: { id: organizationId },
    select: { branding: { select: brandingSelect } },
  });
  return resolveBranding(organization?.branding);
}
