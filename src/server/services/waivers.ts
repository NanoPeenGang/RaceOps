import type { PrismaClient } from "@prisma/client";
import {
  audienceCovers,
  outstandingWaivers,
  waiverStatuses,
  type WaiverStatus,
} from "@/lib/waivers";

/**
 * Which waivers apply where, and who still has to sign.
 *
 * An event inherits its series' waivers as well as carrying its own: a
 * championship's standing indemnity is signed once for the season, while a
 * circuit-specific one belongs to the round. Both have to be satisfied.
 */

export async function waiversForEvent(db: PrismaClient, eventId: string) {
  const event = await db.raceEvent.findUnique({
    where: { id: eventId },
    select: { seriesId: true },
  });
  if (!event) return [];

  return db.waiver.findMany({
    where: {
      active: true,
      OR: [
        { eventId },
        ...(event.seriesId ? [{ seriesId: event.seriesId }] : []),
      ],
    },
    orderBy: [{ required: "desc" }, { createdAt: "asc" }],
  });
}

export interface EntryWaiverState {
  /// Everyone on the entry who still owes a required signature.
  outstanding: { userId: string; name: string; waivers: WaiverStatus[] }[];
  satisfied: boolean;
}

/**
 * Whether an entry's declared people have signed everything required.
 *
 * Checked before a confirmation, alongside the existing eligibility gate.
 * Only people with accounts are checked: a crew member named on a pass with
 * no RaceOps login signs at accreditation, which is out of scope here and
 * deliberately not treated as a blocker on the entry.
 */
export async function entryWaiverState(
  db: PrismaClient,
  registrationId: string,
): Promise<EntryWaiverState> {
  const registration = await db.eventRegistration.findUnique({
    where: { id: registrationId },
    select: {
      eventId: true,
      entrantUserId: true,
      entrantUser: {
        select: { id: true, profile: { select: { displayName: true } } },
      },
      lineup: {
        select: {
          userId: true,
          user: {
            select: { id: true, profile: { select: { displayName: true } } },
          },
        },
      },
    },
  });
  if (!registration) return { outstanding: [], satisfied: true };

  const waivers = await waiversForEvent(db, registration.eventId);
  const applicable = waivers.filter(
    (waiver) => waiver.required && audienceCovers(waiver.audience, "driver"),
  );
  if (applicable.length === 0) return { outstanding: [], satisfied: true };

  // A declared crew signs; a single-driver entry falls back to the entrant,
  // matching how the eligibility gate resolves the same question.
  const people =
    registration.lineup.length > 0
      ? registration.lineup.map((driver) => ({
          id: driver.userId,
          name: driver.user.profile?.displayName ?? "Driver",
        }))
      : registration.entrantUser
        ? [
            {
              id: registration.entrantUser.id,
              name: registration.entrantUser.profile?.displayName ?? "Entrant",
            },
          ]
        : [];

  const signatures = await db.waiverSignature.findMany({
    where: {
      waiverId: { in: applicable.map((waiver) => waiver.id) },
      signerUserId: { in: people.map((person) => person.id) },
    },
    select: {
      waiverId: true,
      waiverVersion: true,
      signerUserId: true,
      signedName: true,
    },
  });

  const outstanding = people
    .map((person) => ({
      userId: person.id,
      name: person.name,
      waivers: outstandingWaivers(
        waiverStatuses(applicable, signatures, person.id, "driver"),
      ),
    }))
    .filter((person) => person.waivers.length > 0);

  return { outstanding, satisfied: outstanding.length === 0 };
}
