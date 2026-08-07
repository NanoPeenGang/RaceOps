import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PlatformRole,
  PrismaClient,
  SeriesDiscipline,
} from "@prisma/client";
import { createCaller } from "@/server/trpc/root";

/** Branding, and the inheritance chain from organization down to event. */
const ENABLED = process.env.RUN_DB_TESTS === "1";
const db = ENABLED ? new PrismaClient() : (null as unknown as PrismaClient);

function callerFor(clerkUserId: string | null) {
  return createCaller({ db, clerkUserId, headers: new Headers() });
}

async function makeUser(suffix: string) {
  const user = await db.user.create({
    data: {
      email: `${suffix}@example.test`,
      authProviderId: `clerk_${suffix}`,
      // Platform staff, so these fixtures bypass the access-request queue —
      // the queue itself is exercised in access-flow.test.ts, and making every
      // suite apply for a team first would test one gate thirty times.
      platformRole: PlatformRole.ADMIN,
      profile: { create: { displayName: suffix } },
    },
  });
  return { user, caller: callerFor(user.authProviderId) };
}

describe.skipIf(!ENABLED)("branding (integration)", () => {
  const run = Date.now();
  let owner: Awaited<ReturnType<typeof makeUser>>;
  let outsider: Awaited<ReturnType<typeof makeUser>>;
  let orgId: string;
  let seriesId: string;
  let eventId: string;

  beforeAll(async () => {
    owner = await makeUser(`brdown_${run}`);
    outsider = await makeUser(`brdout_${run}`);

    const organization = await owner.caller.organization.create({
      name: `Livery Club ${run}`,
    });
    orgId = organization.id;

    const series = await owner.caller.series.create({
      name: `Livery Cup ${run}`,
      discipline: SeriesDiscipline.REAL_WORLD,
      platform: "Circuit",
    });
    seriesId = series.id;
    await owner.caller.organization.adoptSeries({
      organizationId: orgId,
      seriesId,
    });

    const event = await owner.caller.event.create({
      seriesId,
      name: "Round 1",
      date: new Date(Date.now() + 864e5),
      platform: "Circuit",
    });
    eventId = event.id;
  });

  afterAll(async () => {
    if (ENABLED) await db.$disconnect();
  });

  it("falls back to the RaceOps palette before anything is set", async () => {
    const theme = await callerFor(null).branding.resolved({ eventId });
    expect(theme.primary).toBe("#D91E1E");
    expect(theme.isDefault).toBe(true);
  });

  it("inherits an organization's colours all the way down to an event", async () => {
    await owner.caller.branding.update({
      organizationId: orgId,
      primaryColor: "#1E3A8A",
      logoUrl: "https://media.test/club-logo.png",
      tagline: "Since 1974",
    });

    // The point of inheritance: set it once, and every round picks it up.
    const eventTheme = await callerFor(null).branding.resolved({ eventId });
    expect(eventTheme.primary).toBe("#1E3A8A");
    expect(eventTheme.logoUrl).toBe("https://media.test/club-logo.png");
    expect(eventTheme.tagline).toBe("Since 1974");
    expect(eventTheme.onPrimary).toBe("#FFFFFF");
  });

  it("lets a series override one field and keep the rest", async () => {
    await owner.caller.branding.update({
      seriesId,
      logoUrl: "https://media.test/series-logo.png",
    });

    const theme = await callerFor(null).branding.resolved({ eventId });
    expect(theme.logoUrl).toBe("https://media.test/series-logo.png");
    // Setting one field must not discard the organization's colour.
    expect(theme.primary).toBe("#1E3A8A");
    expect(theme.tagline).toBe("Since 1974");
  });

  it("computes a readable foreground for a pale brand colour", async () => {
    await owner.caller.branding.update({
      eventId,
      primaryColor: "#FFE680",
    });
    const theme = await callerFor(null).branding.resolved({ eventId });
    // White on pale gold is the classic way brand theming ends up unreadable.
    expect(theme.primary).toBe("#FFE680");
    expect(theme.onPrimary).toBe("#0A0A0A");
  });

  it("normalizes hex however it was pasted", async () => {
    await owner.caller.branding.update({ eventId, primaryColor: "abc" });
    const theme = await callerFor(null).branding.resolved({ eventId });
    expect(theme.primary).toBe("#AABBCC");
  });

  it("refuses a colour it cannot parse rather than storing it", async () => {
    // Storing it would render as the default with no explanation.
    await expect(
      owner.caller.branding.update({
        eventId,
        primaryColor: "rebeccapurple",
      }),
    ).rejects.toThrow(/hex colour/i);
  });

  it("shows the editor what this scope sets versus what it inherits", async () => {
    const state = await owner.caller.branding.own({ seriesId });
    expect(state.own?.logoUrl).toBe("https://media.test/series-logo.png");
    // The series sets no colour of its own; it inherits the club's.
    expect(state.own?.primaryColor).toBeNull();
    expect(state.inherited.primary).toBe("#1E3A8A");
  });

  it("updates in place rather than stacking rows", async () => {
    await owner.caller.branding.update({ seriesId, tagline: "One" });
    await owner.caller.branding.update({ seriesId, tagline: "Two" });
    const rows = await db.branding.count({ where: { seriesId } });
    expect(rows).toBe(1);
  });

  it("resets a scope back to inheriting", async () => {
    await owner.caller.branding.reset({ eventId });
    const theme = await callerFor(null).branding.resolved({ eventId });
    expect(theme.primary).toBe("#1E3A8A");
  });

  it("keeps branding to people who administer the thing", async () => {
    await expect(
      outsider.caller.branding.update({ seriesId, tagline: "Not yours" }),
    ).rejects.toThrow(/permission/i);
    await expect(
      outsider.caller.branding.own({ seriesId }),
    ).rejects.toThrow(/permission/i);
  });

  it("serves the resolved theme publicly, since landing pages are public", async () => {
    const theme = await callerFor(null).branding.resolved({ seriesId });
    expect(theme.primary).toBe("#1E3A8A");
  });
});
