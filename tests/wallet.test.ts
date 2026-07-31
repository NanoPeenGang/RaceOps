import { describe, expect, it } from "vitest";
import { AccessZone, CredentialStatus } from "@prisma/client";
import {
  buildPassJson,
  endOfDay,
  isWalletEligible,
  rgb,
  type WalletPassInput,
} from "@/lib/wallet";

/**
 * What goes on the card. The signing is checked elsewhere; these are the
 * failures that produce a pass which installs perfectly and says the wrong
 * thing on a lock screen.
 */

const CONFIG = {
  passTypeIdentifier: "pass.com.raceops.credential",
  teamIdentifier: "TEAM123456",
  organizationName: "RaceOps",
};

function input(overrides: Partial<WalletPassInput> = {}): WalletPassInput {
  return {
    token: "xQ7mA3pLn2ZbK9dR4tS8vWy1",
    holderName: "Jordan Alvarez",
    holderRole: "Driver",
    typeName: "Competitor",
    zones: [AccessZone.PADDOCK, AccessZone.PIT_LANE],
    teamName: "Apex Competition",
    carNumber: "24",
    serial: "P-0042",
    status: CredentialStatus.ISSUED,
    eventName: "Round 3",
    seriesName: "Demo Cup",
    eventDate: new Date(2026, 7, 20, 9, 0),
    venue: "Road America — Full Course",
    url: "https://raceops.test/pass/xQ7mA3pLn2ZbK9dR4tS8vWy1",
    ...overrides,
  };
}

type PassJson = ReturnType<typeof buildPassJson> & {
  eventTicket: Record<string, { key: string; value: unknown }[]>;
  barcodes: { message: string; format: string }[];
};

const build = (overrides: Partial<WalletPassInput> = {}) =>
  buildPassJson(input(overrides), CONFIG) as PassJson;

function field(pass: PassJson, group: string, key: string) {
  return pass.eventTicket[group]?.find((f) => f.key === key);
}

describe("rgb", () => {
  it("converts hex the way Wallet expects", () => {
    expect(rgb("#D91E1E")).toBe("rgb(217, 30, 30)");
    expect(rgb("0A0A0A")).toBe("rgb(10, 10, 10)");
  });

  it("expands shorthand", () => {
    expect(rgb("#fff")).toBe("rgb(255, 255, 255)");
  });
});

describe("buildPassJson", () => {
  it("carries the identifiers iOS checks against the signature", () => {
    const pass = build();
    expect(pass.passTypeIdentifier).toBe(CONFIG.passTypeIdentifier);
    expect(pass.teamIdentifier).toBe(CONFIG.teamIdentifier);
    expect(pass.formatVersion).toBe(1);
  });

  it("uses the QR token as the serial number", () => {
    // Not the row id: the same value the QR encodes, so a pass in Wallet and a
    // pass scanned at a gate cannot come to disagree.
    const pass = build();
    expect(pass.serialNumber).toBe("xQ7mA3pLn2ZbK9dR4tS8vWy1");
  });

  it("encodes the verification URL in the barcode, not the token alone", () => {
    const pass = build();
    expect(pass.barcodes[0].message).toBe(
      "https://raceops.test/pass/xQ7mA3pLn2ZbK9dR4tS8vWy1",
    );
    // QR, matching the printed badge, so a gate has one code path not two.
    expect(pass.barcodes[0].format).toBe("PKBarcodeFormatQR");
  });

  it("leads with the holder's name, which is all a lock screen shows", () => {
    expect(field(build(), "primaryFields", "holder")?.value).toBe(
      "Jordan Alvarez",
    );
  });

  it("puts the car and entrant together, the way a marshal reads them", () => {
    expect(field(build(), "secondaryFields", "entrant")?.value).toBe(
      "#24 Apex Competition",
    );
  });

  it("omits the entrant field entirely for somebody with no entry", () => {
    // An official has no car. A blank labelled row is worse than no row.
    const pass = build({ teamName: null, carNumber: null });
    expect(field(pass, "secondaryFields", "entrant")).toBeUndefined();
    expect(field(pass, "secondaryFields", "role")?.value).toBe("Driver");
  });

  it("spells out the access zones on the back", () => {
    expect(field(build(), "backFields", "access")?.value).toBe(
      "Paddock · Pit lane",
    );
  });

  it("never leaves access blank", () => {
    // An empty access line reads as "no restrictions", which is the opposite
    // of what an unconfigured pass type means.
    const pass = build({ zones: [] });
    expect(field(pass, "backFields", "access")?.value).toMatch(
      /not specified/i,
    );
    expect(field(pass, "backFields", "zoneCount")).toBeUndefined();
  });

  it("says plainly on the card when a pass is not valid", () => {
    const pass = build({ status: CredentialStatus.VOID });
    expect(field(pass, "backFields", "status")?.value).toMatch(/NOT VALID/);
    // And greys the card, so it does not look like a working pass at a glance.
    expect(pass.backgroundColor).not.toBe(build().backgroundColor);
  });

  it("expires at the end of the event day, not at the green flag", () => {
    // A pass that expires at the session start has stopped working by lunch.
    const pass = build();
    const expiry = new Date(pass.expirationDate as string);
    expect(expiry.getHours()).toBe(23);
    expect(expiry.getDate()).toBe(20);
  });

  it("is relevant from the event's start, so it surfaces on the day", () => {
    const pass = build();
    expect(new Date(pass.relevantDate as string).getHours()).toBe(9);
  });

  it("carries the venue and serial where they are known", () => {
    const pass = build();
    expect(field(pass, "backFields", "venue")?.value).toContain("Road America");
    expect(field(pass, "backFields", "serial")?.value).toBe("P-0042");
  });

  it("drops the venue and serial rather than printing empty rows", () => {
    const pass = build({ venue: null, serial: null });
    expect(field(pass, "backFields", "venue")).toBeUndefined();
    expect(field(pass, "backFields", "serial")).toBeUndefined();
  });

  it("falls back to the event name when there is no series", () => {
    expect(build({ seriesName: null }).logoText).toBe("Round 3");
  });
});

describe("endOfDay", () => {
  it("does not move the date", () => {
    const end = endOfDay(new Date(2026, 7, 20, 9, 0));
    expect(end.getDate()).toBe(20);
    expect(end.getMonth()).toBe(7);
    expect(end.getHours()).toBe(23);
  });
});

describe("isWalletEligible", () => {
  it("allows only a pass that would actually admit somebody", () => {
    // Once a .pkpass is on a phone it is cached. A cancelled pass in Wallet is
    // a greyed-out card somebody waves at a gate in poor light.
    expect(isWalletEligible(CredentialStatus.ISSUED)).toBe(true);
    expect(isWalletEligible(CredentialStatus.COLLECTED)).toBe(true);
    expect(isWalletEligible(CredentialStatus.REQUESTED)).toBe(false);
    expect(isWalletEligible(CredentialStatus.VOID)).toBe(false);
  });
});
