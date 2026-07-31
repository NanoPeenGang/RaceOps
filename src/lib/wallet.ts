import { AccessZone, CredentialStatus } from "@prisma/client";
import { isValidPass, sortZones, zoneSummary } from "@/lib/credentials";

/**
 * Building the `pass.json` inside an Apple Wallet pass.
 *
 * Pure, and separate from the signing, because the interesting failures here
 * are content failures: a field in the wrong slot on a phone screen, an expiry
 * that never fires, a barcode that encodes the wrong thing. Those can be
 * tested. The signing either works or the phone refuses the file outright,
 * which is a different kind of problem entirely.
 *
 * The pass style is `eventTicket`, which is what Wallet shows on the lock
 * screen when the event is near — the whole reason for putting a paddock pass
 * in a phone rather than on a lanyard.
 */

export interface WalletPassInput {
  /** The QR token. Also the pass's serial number as far as Wallet is concerned. */
  token: string;
  holderName: string;
  holderRole: string | null;
  typeName: string;
  zones: readonly AccessZone[];
  teamName: string | null;
  carNumber: string | null;
  serial: string | null;
  status: CredentialStatus;
  eventName: string;
  seriesName: string | null;
  eventDate: Date;
  venue: string | null;
  /** Where a scan of this pass resolves. */
  url: string;
}

export interface WalletConfig {
  passTypeIdentifier: string;
  teamIdentifier: string;
  organizationName: string;
}

/** Hex colour to the `rgb(r, g, b)` string Wallet expects. */
export function rgb(hex: string): string {
  const clean = hex.replace("#", "");
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean;
  const value = Number.parseInt(full, 16);
  return `rgb(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255})`;
}

/**
 * The `pass.json` for one credential.
 *
 * Field placement is chosen for the way a pass is actually read. The holder's
 * name is the primary field because on a lock screen that is all you get at a
 * glance; the areas the pass opens are a back field as well as a secondary one
 * because "Paddock · Pit lane · Grid" is too long for the front of a card but
 * is exactly what a marshal asks about.
 */
export function buildPassJson(
  input: WalletPassInput,
  config: WalletConfig,
): Record<string, unknown> {
  const zones = sortZones(input.zones);
  const access = zoneSummary(input.zones);

  const secondaryFields: Record<string, unknown>[] = [];
  if (input.teamName || input.carNumber) {
    secondaryFields.push({
      key: "entrant",
      label: input.carNumber ? "Car / entrant" : "Entrant",
      value: [
        input.carNumber ? `#${input.carNumber}` : null,
        input.teamName,
      ]
        .filter(Boolean)
        .join(" "),
    });
  }
  if (input.holderRole) {
    secondaryFields.push({
      key: "role",
      label: "Role",
      value: input.holderRole,
    });
  }

  return {
    formatVersion: 1,
    passTypeIdentifier: config.passTypeIdentifier,
    teamIdentifier: config.teamIdentifier,
    organizationName: config.organizationName,
    // The token, not the row id: the same value the QR encodes, so a pass
    // updated in Wallet and a pass scanned at a gate cannot disagree.
    serialNumber: input.token,
    description: `${input.typeName} — ${input.eventName}`,
    logoText: input.seriesName ?? input.eventName,
    foregroundColor: rgb("#FFFFFF"),
    backgroundColor: rgb(isValidPass(input.status) ? "#0A0A0A" : "#8A8A8A"),
    labelColor: rgb("#D91E1E"),
    /*
     * Wallet greys a pass out and drops it down the stack once this passes.
     * End of the event day rather than its start time: a pass that expires at
     * the green flag is a pass that has stopped working by lunch.
     */
    expirationDate: endOfDay(input.eventDate).toISOString(),
    relevantDate: input.eventDate.toISOString(),
    barcodes: [
      {
        // QR rather than PDF417: it is what the badge sheet prints, so a gate
        // scanning one scans the other with no second code path.
        format: "PKBarcodeFormatQR",
        message: input.url,
        messageEncoding: "iso-8859-1",
        altText: input.serial ?? undefined,
      },
    ],
    eventTicket: {
      headerFields: [
        {
          key: "passType",
          label: "Pass",
          value: input.typeName,
        },
      ],
      primaryFields: [
        {
          key: "holder",
          label: "Holder",
          value: input.holderName,
        },
      ],
      secondaryFields,
      auxiliaryFields: [
        {
          key: "event",
          label: "Event",
          value: input.eventName,
        },
        {
          key: "date",
          label: "Date",
          value: input.eventDate.toISOString(),
          dateStyle: "PKDateStyleMedium",
          timeStyle: "PKDateStyleNone",
        },
      ],
      backFields: [
        {
          key: "access",
          label: "Access",
          // Never blank: an empty access line on a pass reads as "no
          // restrictions", which is the opposite of what it means.
          value: access ?? "Not specified — check with race control.",
        },
        ...(zones.length > 0
          ? [
              {
                key: "zoneCount",
                label: "Areas",
                value: String(zones.length),
              },
            ]
          : []),
        ...(input.venue
          ? [{ key: "venue", label: "Venue", value: input.venue }]
          : []),
        ...(input.serial
          ? [{ key: "serial", label: "Serial", value: input.serial }]
          : []),
        {
          key: "status",
          label: "Status",
          value: isValidPass(input.status)
            ? "Valid"
            : "NOT VALID — this pass will not admit you.",
        },
        {
          key: "verify",
          label: "Verify",
          value: input.url,
        },
      ],
    },
  };
}

/** 23:59:59 local on the event's day. */
export function endOfDay(date: Date): Date {
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return end;
}

/**
 * Whether a pass is worth putting in a wallet at all.
 *
 * A cancelled pass must never become a `.pkpass`: once it is on a phone it is
 * cached, and somebody waving a greyed-out card at a gate in poor light is a
 * worse outcome than their having nothing to wave.
 */
export function isWalletEligible(status: CredentialStatus): boolean {
  return isValidPass(status);
}
