import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AnnouncementUrgency,
  DocumentType,
  DocumentVisibility,
  PlatformRole,
  PrismaClient,
  SeriesDiscipline,
  SeriesRole,
} from "@prisma/client";
import { createCaller } from "@/server/trpc/root";

/**
 * Regulations library, notices, race reports and paddock chat end-to-end.
 * Opt in with RUN_DB_TESTS=1.
 */
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

const anon = () => callerFor(null);

describe.skipIf(!ENABLED)("documents, notices, reports & chat (integration)", () => {
  const run = Date.now();
  let owner: Awaited<ReturnType<typeof makeUser>>;
  let coordinator: Awaited<ReturnType<typeof makeUser>>;
  let racer: Awaited<ReturnType<typeof makeUser>>;
  let outsider: Awaited<ReturnType<typeof makeUser>>;
  let seriesId: string;
  let eventId: string;

  beforeAll(async () => {
    owner = await makeUser(`docowner_${run}`);
    coordinator = await makeUser(`doccoord_${run}`);
    racer = await makeUser(`docracer_${run}`);
    outsider = await makeUser(`docout_${run}`);

    const series = await owner.caller.series.create({
      name: `Docs Cup ${run}`,
      discipline: SeriesDiscipline.REAL_WORLD,
      platform: "Club circuit",
    });
    seriesId = series.id;
    await owner.caller.series.setOrganizer({
      seriesId,
      userId: coordinator.user.id,
      role: SeriesRole.VOLUNTEER_COORDINATOR,
    });

    const event = await owner.caller.event.create({
      seriesId,
      name: "Docs Round",
      date: new Date(Date.now() + 864e5),
      platform: "Club circuit",
    });
    eventId = event.id;
    await owner.caller.event.setStatus({ eventId, status: "PUBLISHED" });

    const registration = await racer.caller.event.register({ eventId });
    await owner.caller.event.setRegistrationStatus({
      registrationId: registration.id,
      status: "CONFIRMED",
    });
  });

  afterAll(async () => {
    if (!ENABLED) return;
    await db.raceReport.deleteMany({ where: { authorId: racer.user.id } });
    await db.series.deleteMany({ where: { id: seriesId } });
    await db.user.deleteMany({
      where: {
        authProviderId: {
          in: [owner, coordinator, racer, outsider].map(
            (u) => u.user.authProviderId!,
          ),
        },
      },
    });
    await db.$disconnect();
  });

  // -------------------------------------------------------------------------
  // Documents
  // -------------------------------------------------------------------------

  it("publishes a rule book to the series that anyone can read", async () => {
    await owner.caller.document.publish({
      scope: { seriesId },
      type: DocumentType.RULEBOOK,
      title: "Sporting Regulations",
      fileUrl: "https://cdn.example.test/regs-v1.pdf",
      version: "v1",
    });

    const publicView = await anon().document.list({ seriesId });
    expect(publicView.map((d) => d.title)).toContain("Sporting Regulations");
  });

  it("hides entrant-only and organizer-only documents from the public", async () => {
    await owner.caller.document.publish({
      scope: { seriesId },
      type: DocumentType.TECH_SHEET,
      title: "Restrictor Tolerances",
      fileUrl: "https://cdn.example.test/tech.pdf",
      visibility: DocumentVisibility.COMPETITORS,
    });
    await owner.caller.document.publish({
      scope: { seriesId },
      type: DocumentType.OTHER,
      title: "Steward Briefing Notes",
      fileUrl: "https://cdn.example.test/notes.pdf",
      visibility: DocumentVisibility.ORGANIZERS,
    });

    const titlesFor = async (caller: ReturnType<typeof callerFor>) =>
      (await caller.document.list({ seriesId })).map((d) => d.title);

    expect(await titlesFor(anon())).not.toContain("Restrictor Tolerances");
    expect(await titlesFor(outsider.caller)).not.toContain(
      "Restrictor Tolerances",
    );
    // An entrant in the series sees competitor documents but not organizer ones.
    const racerTitles = await titlesFor(racer.caller);
    expect(racerTitles).toContain("Restrictor Tolerances");
    expect(racerTitles).not.toContain("Steward Briefing Notes");
    // A series role sees everything, even a non-event role.
    expect(await titlesFor(coordinator.caller)).toContain(
      "Steward Briefing Notes",
    );
  });

  it("supersedes a previous revision when a new one replaces it", async () => {
    const first = await owner.caller.document.publish({
      scope: { eventId },
      type: DocumentType.SUPPLEMENTARY_REGS,
      title: "Supplementary Regs",
      fileUrl: "https://cdn.example.test/supps-1.pdf",
      version: "Issue 1",
    });
    await owner.caller.document.publish({
      scope: { eventId },
      type: DocumentType.SUPPLEMENTARY_REGS,
      title: "Supplementary Regs",
      fileUrl: "https://cdn.example.test/supps-2.pdf",
      version: "Issue 2",
      supersedesId: first.id,
    });

    const docs = await anon().document.list({ eventId });
    const retired = docs.find((d) => d.id === first.id)!;
    expect(retired.supersededAt).not.toBeNull();
    // Current revisions sort ahead of retired ones.
    expect(docs[0].version).toBe("Issue 2");
  });

  it("notifies entrants when a bulletin says to", async () => {
    const before = await db.notification.count({
      where: { userId: racer.user.id },
    });
    await owner.caller.document.publish({
      scope: { eventId },
      type: DocumentType.BULLETIN,
      title: "Bulletin 1 — pit lane speed limit",
      fileUrl: "https://cdn.example.test/bulletin-1.pdf",
      notifyCompetitors: true,
    });
    expect(
      await db.notification.count({ where: { userId: racer.user.id } }),
    ).toBe(before + 1);
  });

  it("refuses to attach a document to both a series and an event", async () => {
    await expect(
      owner.caller.document.publish({
        scope: { seriesId, eventId },
        type: DocumentType.OTHER,
        title: "Ambiguous",
        fileUrl: "https://cdn.example.test/x.pdf",
      }),
    ).rejects.toThrow();
  });

  it("does not let an entrant or a coordinator publish documents", async () => {
    for (const caller of [racer.caller, coordinator.caller]) {
      await expect(
        caller.document.publish({
          scope: { seriesId },
          type: DocumentType.RULEBOOK,
          title: "Unauthorized regs",
          fileUrl: "https://cdn.example.test/nope.pdf",
        }),
      ).rejects.toThrow(/permission/i);
    }
  });

  // -------------------------------------------------------------------------
  // Announcements
  // -------------------------------------------------------------------------

  it("posts a pinned urgent notice and notifies entrants", async () => {
    const before = await db.notification.count({
      where: { userId: racer.user.id },
    });
    await owner.caller.document.postAnnouncement({
      scope: { eventId },
      title: "Sunday warm-up moved to 09:15",
      body: "Track cleaning overran.",
      urgency: AnnouncementUrgency.URGENT,
      pinned: true,
    });
    await owner.caller.document.postAnnouncement({
      scope: { eventId },
      title: "Paddock gates open 07:00",
      body: "Please display passes.",
      notifyCompetitors: false,
    });

    const notices = await anon().document.listAnnouncements({ eventId });
    // Pinned first regardless of age.
    expect(notices[0].title).toBe("Sunday warm-up moved to 09:15");

    const after = await db.notification.count({
      where: { userId: racer.user.id },
    });
    expect(after).toBe(before + 1);
    const latest = await db.notification.findFirstOrThrow({
      where: { userId: racer.user.id },
      orderBy: { createdAt: "desc" },
    });
    expect(latest.title).toMatch(/^URGENT — /);
  });

  it("lets an organizer delete a notice but not an outsider", async () => {
    const notice = await owner.caller.document.postAnnouncement({
      scope: { seriesId },
      title: "Temporary notice",
      body: "To be removed.",
      notifyCompetitors: false,
    });
    await expect(
      outsider.caller.document.removeAnnouncement({
        announcementId: notice.id,
      }),
    ).rejects.toThrow(/permission/i);

    await owner.caller.document.removeAnnouncement({
      announcementId: notice.id,
    });
    const notices = await anon().document.listAnnouncements({ seriesId });
    expect(notices.map((n) => n.id)).not.toContain(notice.id);
  });

  // -------------------------------------------------------------------------
  // Race reports
  // -------------------------------------------------------------------------

  it("keeps a draft report out of the public feed", async () => {
    const draft = await racer.caller.report.create({
      title: "Unfinished thoughts",
      body: "Still writing.",
      eventId,
      published: false,
    });

    const feed = await anon().report.feed({});
    expect(feed.reports.map((r) => r.id)).not.toContain(draft.id);
    // Nor readable by anyone else, even with the id.
    await expect(
      outsider.caller.report.byId({ reportId: draft.id }),
    ).rejects.toThrow();

    const own = await racer.caller.report.byId({ reportId: draft.id });
    expect(own.isAuthor).toBe(true);

    await racer.caller.report.update({ reportId: draft.id, published: true });
    const published = await anon().report.feed({ eventId });
    expect(published.reports.map((r) => r.id)).toContain(draft.id);
  });

  it("normalizes tags so filtering matches", async () => {
    const report = await racer.caller.report.create({
      title: "Wet race at the club circuit",
      body: "Aquaplaning everywhere.",
      tags: ["  Endurance ", "ENDURANCE", "GT3"],
    });
    expect(report.tags).toEqual(["endurance", "gt3"]);

    const filtered = await anon().report.feed({ tag: "endurance" });
    expect(filtered.reports.map((r) => r.id)).toContain(report.id);
  });

  it("only lets the author edit or delete a report", async () => {
    const report = await racer.caller.report.create({
      title: "Someone else's report",
      body: "Hands off.",
    });
    await expect(
      outsider.caller.report.update({ reportId: report.id, title: "Hijacked" }),
    ).rejects.toThrow(/your own reports/i);
    await expect(
      outsider.caller.report.remove({ reportId: report.id }),
    ).rejects.toThrow(/your own reports/i);

    await racer.caller.report.remove({ reportId: report.id });
  });

  it("scopes report media to the author", async () => {
    const report = await racer.caller.report.create({
      title: "Report with media",
      body: "Photos below.",
    });
    await expect(
      outsider.caller.media.attach({
        url: "https://cdn.example.test/not-mine.jpg",
        kind: "image",
        scope: { reportId: report.id },
      }),
    ).rejects.toThrow(/only the author/i);

    await racer.caller.media.attach({
      url: "https://cdn.example.test/mine.jpg",
      kind: "image",
      scope: { reportId: report.id },
    });
    const media = await anon().media.forScope({ reportId: report.id });
    expect(media).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // Paddock chat
  // -------------------------------------------------------------------------

  it("opens the chat to entrants and organizers only", async () => {
    await expect(
      outsider.caller.chat.forRoom({ scope: { eventId } }),
    ).rejects.toThrow(/entrants, volunteers and organizers/i);

    await racer.caller.chat.send({ scope: { eventId }, body: "Anyone got a spare set?" });
    const view = await racer.caller.chat.forRoom({ scope: { eventId } });
    expect(view.messages.map((m) => m.body)).toContain(
      "Anyone got a spare set?",
    );
    // An entrant is in the room, but is not moderating it.
    expect(view.canModerate).toBe(false);

    const organizerView = await owner.caller.chat.forRoom({ scope: { eventId } });
    expect(organizerView.canModerate).toBe(true);
  });

  it("lets organizers moderate but outsiders do nothing", async () => {
    const message = await racer.caller.chat.send({
      scope: { eventId },
      body: "Please delete this.",
    });
    await expect(
      outsider.caller.chat.remove({ messageId: message.id }),
    ).rejects.toThrow(/entrants, volunteers and organizers/i);

    await owner.caller.chat.remove({ messageId: message.id });
    const view = await racer.caller.chat.forRoom({ scope: { eventId } });
    expect(view.messages.map((m) => m.id)).not.toContain(message.id);
  });

  it("returns the transcript oldest first", async () => {
    const marker = `seq-${Date.now()}`;
    await racer.caller.chat.send({ scope: { eventId }, body: `${marker}-first` });
    await racer.caller.chat.send({ scope: { eventId }, body: `${marker}-second` });

    const view = await racer.caller.chat.forRoom({ scope: { eventId } });
    const bodies = view.messages.map((m) => m.body);
    expect(bodies.indexOf(`${marker}-first`)).toBeLessThan(
      bodies.indexOf(`${marker}-second`),
    );
  });
});
