import { TRPCError } from "@trpc/server";
import type { PrismaClient } from "@prisma/client";
import {
  blockingFindings,
  checkEligibility,
  summarizeEligibility,
} from "@/lib/eligibility";
import type { EligibilityFinding } from "@/lib/eligibility";

/**
 * Evaluates an entry against its series' entry requirements.
 *
 * Lives in a service rather than a router because entry confirmation depends
 * on it: a blocking requirement has to stop a confirmation, and the event
 * router should not be importing from another router to find that out.
 */

/** Loads everything needed to evaluate one entry, then evaluates it. */
export async function eligibilityForRegistration(
  db: PrismaClient,
  registrationId: string,
): Promise<{
  findings: EligibilityFinding[];
  eligible: boolean;
  summary: string;
}> {
  const registration = await db.eventRegistration.findUnique({
    where: { id: registrationId },
    select: {
      id: true,
      seriesClassId: true,
      entrantUserId: true,
      event: { select: { date: true, seriesId: true } },
      lineup: {
        select: {
          userId: true,
          user: {
            select: {
              id: true,
              profile: {
                select: {
                  displayName: true,
                  dateOfBirth: true,
                  simStats: true,
                  realWorldCredentials: { select: { kind: true } },
                },
              },
            },
          },
        },
      },
      waivers: {
        select: { requirementId: true, userId: true, granted: true },
      },
    },
  });
  if (!registration) throw new TRPCError({ code: "NOT_FOUND" });

  if (!registration.event.seriesId) {
    return { findings: [], eligible: true, summary: "No requirements" };
  }

  const requirements = await db.entryRequirement.findMany({
    where: { seriesId: registration.event.seriesId, active: true },
  });

  // Fall back to the entrant when no crew is declared, so a sprint entry is
  // still checked against the series' licence rules.
  let drivers = registration.lineup.map((entry) => ({
    userId: entry.userId,
    displayName: entry.user.profile?.displayName ?? "Unnamed driver",
    dateOfBirth: entry.user.profile?.dateOfBirth ?? null,
    credentialKinds:
      entry.user.profile?.realWorldCredentials.map((c) => c.kind) ?? [],
    simStats: entry.user.profile?.simStats ?? null,
  }));

  if (drivers.length === 0 && registration.entrantUserId) {
    const entrant = await db.user.findUnique({
      where: { id: registration.entrantUserId },
      select: {
        id: true,
        profile: {
          select: {
            displayName: true,
            dateOfBirth: true,
            simStats: true,
            realWorldCredentials: { select: { kind: true } },
          },
        },
      },
    });
    if (entrant) {
      drivers = [
        {
          userId: entrant.id,
          displayName: entrant.profile?.displayName ?? "Unnamed driver",
          dateOfBirth: entrant.profile?.dateOfBirth ?? null,
          credentialKinds:
            entrant.profile?.realWorldCredentials.map((c) => c.kind) ?? [],
          simStats: entrant.profile?.simStats ?? null,
        },
      ];
    }
  }

  const findings = checkEligibility({
    requirements,
    seriesClassId: registration.seriesClassId,
    drivers,
    waivers: registration.waivers,
    on: registration.event.date,
  });

  return {
    findings,
    eligible: blockingFindings(findings).length === 0,
    summary: summarizeEligibility(findings),
  };
}
