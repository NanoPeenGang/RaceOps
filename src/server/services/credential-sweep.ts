import { randomBytes } from "node:crypto";
import {
  CredentialAudience,
  RegistrationStatus,
  VolunteerSignupStatus,
} from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { VOLUNTEER_ROLE_LABELS } from "@/lib/events";
import { LINEUP_ROLE_LABELS } from "@/lib/lineup";
import { SERIES_ROLE_LABELS } from "@/lib/permissions";
import type { CredentialCandidate } from "@/lib/credentials";

/**
 * Collecting everyone at an event who needs a pass.
 *
 * The database queries live here; the decision about who gets what is pure and
 * lives in `@/lib/credentials`, so the organizer can be shown exactly what a
 * sweep would do before it does it.
 */

/**
 * An unguessable code for a QR.
 *
 * 24 bytes of CSPRNG in base64url. Deliberately not derived from the row id or
 * the holder's name: a pass whose code could be worked out from either would
 * be forgeable by anyone who had seen one badge, which is the entire attack
 * against a paper accreditation system.
 */
export function credentialToken(): string {
  return randomBytes(24).toString("base64url");
}

/**
 * Everyone the event owes a pass to, in the order they should be issued.
 *
 * Drivers first because they are the ones who cannot race without one, and
 * because ordering the sweep means a run that fails partway through has done
 * the most important half.
 */
export async function gatherCandidates(
  db: PrismaClient,
  eventId: string,
): Promise<CredentialCandidate[]> {
  const [registrations, signups, event] = await Promise.all([
    db.eventRegistration.findMany({
      where: { eventId, status: RegistrationStatus.CONFIRMED },
      select: {
        id: true,
        carNumber: true,
        team: { select: { name: true } },
        entrantUserId: true,
        entrantUser: {
          select: { id: true, profile: { select: { displayName: true } } },
        },
        lineup: {
          select: {
            role: true,
            user: {
              select: { id: true, profile: { select: { displayName: true } } },
            },
          },
        },
      },
    }),
    db.volunteerSignup.findMany({
      where: {
        shift: { eventId },
        status: VolunteerSignupStatus.CONFIRMED,
      },
      select: {
        shift: { select: { role: true } },
        user: {
          select: { id: true, profile: { select: { displayName: true } } },
        },
      },
    }),
    db.raceEvent.findUnique({
      where: { id: eventId },
      select: {
        series: {
          select: {
            organizers: {
              select: {
                role: true,
                user: {
                  select: {
                    id: true,
                    profile: { select: { displayName: true } },
                  },
                },
              },
            },
          },
        },
      },
    }),
  ]);

  const candidates: CredentialCandidate[] = [];

  for (const registration of registrations) {
    const teamName = registration.team?.name ?? null;
    const driverIds = new Set<string>();

    for (const driver of registration.lineup) {
      driverIds.add(driver.user.id);
      candidates.push({
        audience: CredentialAudience.DRIVER,
        name: driver.user.profile?.displayName ?? "Unnamed driver",
        userId: driver.user.id,
        role: LINEUP_ROLE_LABELS[driver.role] ?? "Driver",
        registrationId: registration.id,
        teamName,
        carNumber: registration.carNumber,
      });
    }

    /*
     * The entrant only gets their own pass when they are not already driving.
     * A solo entrant is both, and issuing them a driver pass and an entrant
     * pass is the kind of duplicate that makes an accreditation list stop
     * matching the number of lanyards actually printed.
     */
    if (
      registration.entrantUser &&
      !driverIds.has(registration.entrantUser.id)
    ) {
      candidates.push({
        audience: CredentialAudience.ENTRANT,
        name: registration.entrantUser.profile?.displayName ?? "Entrant",
        userId: registration.entrantUser.id,
        role: teamName ? "Team entrant" : "Entrant",
        registrationId: registration.id,
        teamName,
        carNumber: registration.carNumber,
      });
    }
  }

  for (const signup of signups) {
    candidates.push({
      audience: CredentialAudience.VOLUNTEER,
      name: signup.user.profile?.displayName ?? "Volunteer",
      userId: signup.user.id,
      role: VOLUNTEER_ROLE_LABELS[signup.shift.role] ?? "Volunteer",
      registrationId: null,
      teamName: null,
      carNumber: null,
    });
  }

  for (const membership of event?.series?.organizers ?? []) {
    candidates.push({
      audience: CredentialAudience.ORGANIZER,
      name: membership.user.profile?.displayName ?? "Official",
      userId: membership.user.id,
      role: SERIES_ROLE_LABELS[membership.role] ?? "Official",
      registrationId: null,
      teamName: null,
      carNumber: null,
    });
  }

  return candidates;
}
