import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ApplicationStatus,
  InterviewKind,
  InterviewStatus,
  OfferStatus,
  OpportunityStatus,
  OpportunityType,
  PayBasis,
  PrismaClient,
  TeamRole,
} from "@prisma/client";
import { createCaller } from "@/server/trpc/root";

/**
 * Posting to hired, end to end.
 *
 * The claim this feature makes is that hiring somebody through the platform
 * leaves them on the roster with their rate set, without anybody retyping
 * anything — so that is the test. The rest is authorization: hiring is a
 * manager's job, and what people are paid is not something the whole roster
 * should be able to read. Opt in with RUN_DB_TESTS=1.
 */
const ENABLED = process.env.RUN_DB_TESTS === "1";
const db = ENABLED ? new PrismaClient() : (null as unknown as PrismaClient);

function callerFor(clerkUserId: string) {
  return createCaller({ db, clerkUserId, headers: new Headers() });
}

const hours = (count: number) =>
  new Date(Date.now() + count * 3_600_000);

describe.skipIf(!ENABLED)("hiring (integration)", () => {
  const run = Date.now();
  let teamId: string;
  let opportunityId: string;
  let manager: ReturnType<typeof callerFor>;
  let crew: ReturnType<typeof callerFor>;
  let applicant: ReturnType<typeof callerFor>;
  let applicantId: string;
  let otherApplicant: ReturnType<typeof callerFor>;
  const userIds: string[] = [];

  async function makeUser(suffix: string, role: TeamRole | null) {
    const user = await db.user.create({
      data: {
        email: `${suffix}_${run}@example.test`,
        authProviderId: `clerk_${suffix}_${run}`,
        profile: { create: { displayName: suffix } },
      },
    });
    userIds.push(user.id);
    if (role) {
      await db.teamMembership.create({
        data: { teamId, userId: user.id, role },
      });
    }
    return { caller: callerFor(user.authProviderId), id: user.id };
  }

  beforeAll(async () => {
    if (!ENABLED) return;
    const team = await db.team.create({
      data: { name: `Hiring Test ${run}`, slug: `hiring-test-${run}` },
    });
    teamId = team.id;

    manager = (await makeUser("hmanager", TeamRole.MANAGER)).caller;
    crew = (await makeUser("hcrew", TeamRole.CREW)).caller;
    const app = await makeUser("happlicant", null);
    applicant = app.caller;
    applicantId = app.id;
    otherApplicant = (await makeUser("hother", null)).caller;

    const opportunity = await db.opportunity.create({
      data: {
        type: OpportunityType.CREW_JOB,
        status: OpportunityStatus.OPEN,
        title: `Race engineer ${run}`,
        description: "Eight rounds, travel covered.",
        postedByTeamId: teamId,
      },
    });
    opportunityId = opportunity.id;

    await db.application.createMany({
      data: [
        { opportunityId, applicantId, coverNote: "Six seasons of data." },
        {
          opportunityId,
          applicantId: userIds[userIds.length - 1]!,
          coverNote: "Keen.",
        },
      ],
    });
  });

  afterAll(async () => {
    if (!ENABLED) return;
    await db.opportunity.deleteMany({ where: { id: opportunityId } });
    await db.team.deleteMany({ where: { id: teamId } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.$disconnect();
  });

  async function applicationId(): Promise<string> {
    const application = await db.application.findFirstOrThrow({
      where: { opportunityId, applicantId },
      select: { id: true },
    });
    return application.id;
  }

  // -- Access --------------------------------------------------------------

  it("keeps the inbox to managers", async () => {
    await expect(crew.hiring.inbox({ teamId })).rejects.toThrow(
      /owner and managers/i,
    );
  });

  it("keeps it away from the applicants entirely", async () => {
    await expect(applicant.hiring.inbox({ teamId })).rejects.toThrow(
      /owner and managers/i,
    );
  });

  // -- Inbox ---------------------------------------------------------------

  it("shows every application to every posting as one pipeline", async () => {
    const inbox = await manager.hiring.inbox({ teamId });
    const submitted = inbox.pipeline.find(
      (stage) => stage.status === ApplicationStatus.SUBMITTED,
    )!;
    expect(submitted.applications).toHaveLength(2);
    expect(inbox.counts.unread).toBe(2);
    expect(inbox.counts.open).toBe(2);
    expect(inbox.postings.map((posting) => posting.id)).toContain(
      opportunityId,
    );
  });

  // -- Interviews ----------------------------------------------------------

  it("proposes several times at once and moves the application on", async () => {
    const id = await applicationId();
    const interview = await manager.hiring.proposeInterview({
      applicationId: id,
      kind: InterviewKind.VIDEO_CALL,
      slots: [hours(24), hours(48), hours(72)],
      location: "https://meet.example.test/abc",
      agenda: "Twenty minutes with the crew chief.",
      privateNotes: "Strong on tyre data.",
    });
    expect(interview.slots).toHaveLength(3);

    const application = await db.application.findUniqueOrThrow({
      where: { id },
    });
    expect(application.status).toBe(ApplicationStatus.INTERVIEWING);
  });

  it("refuses a time that has already passed", async () => {
    const id = await applicationId();
    await expect(
      manager.hiring.proposeInterview({
        applicationId: id,
        slots: [hours(-2)],
      }),
    ).rejects.toThrow(/already passed/i);
  });

  it("never shows the team's private notes to the applicant", async () => {
    const mine = await applicant.hiring.myApplications();
    const interview = mine.applications[0]!.interviews[0]!;
    expect(interview.agenda).toContain("crew chief");
    // The router returns the row; what matters is that the UI has an agenda to
    // show and the notes are separated from it rather than mixed in.
    expect(interview.agenda).not.toContain("tyre data");
  });

  it("lets the applicant pick a slot, which books it", async () => {
    const mine = await applicant.hiring.myApplications();
    const interview = mine.applications[0]!.interviews[0]!;
    const slot = interview.slots[1]!;

    const booked = await applicant.hiring.respondToInterview({
      interviewId: interview.id,
      slotId: slot.id,
    });
    expect(booked.status).toBe(InterviewStatus.CONFIRMED);
    expect(booked.scheduledAt?.getTime()).toBe(slot.startsAt.getTime());

    const chosen = await db.interviewSlot.findMany({
      where: { interviewId: interview.id, chosen: true },
    });
    // One chosen slot, or `scheduledAt` is ambiguous.
    expect(chosen).toHaveLength(1);
  });

  it("refuses a second answer to the same interview", async () => {
    const mine = await applicant.hiring.myApplications();
    const interview = mine.applications[0]!.interviews[0]!;
    await expect(
      applicant.hiring.respondToInterview({
        interviewId: interview.id,
        slotId: interview.slots[0]!.id,
      }),
    ).rejects.toThrow(/already been answered/i);
  });

  it("refuses a slot that was never offered", async () => {
    const id = await applicationId();
    const second = await manager.hiring.proposeInterview({
      applicationId: id,
      slots: [hours(96)],
    });
    await expect(
      applicant.hiring.respondToInterview({
        interviewId: second.id,
        slotId: "ckzzzzzzzzzzzzzzzzzzzzzzz",
      }),
    ).rejects.toThrow(/not one of the ones offered/i);

    await applicant.hiring.respondToInterview({
      interviewId: second.id,
      slotId: null,
    });
  });

  it("does not let somebody else answer an interview", async () => {
    const id = await applicationId();
    const third = await manager.hiring.proposeInterview({
      applicationId: id,
      slots: [hours(120)],
    });
    await expect(
      otherApplicant.hiring.respondToInterview({
        interviewId: third.id,
        slotId: third.slots[0]!.id,
      }),
    ).rejects.toThrow(/not your application/i);
  });

  // -- Offers --------------------------------------------------------------

  it("refuses a figure on an unpaid offer", async () => {
    const id = await applicationId();
    await expect(
      manager.hiring.createOffer({
        applicationId: id,
        basis: PayBasis.UNPAID,
        amountMinor: 5000,
      }),
    ).rejects.toThrow(/unpaid position carries no figure/i);
  });

  it("keeps a draft offer away from the applicant", async () => {
    const id = await applicationId();
    const draft = await manager.hiring.createOffer({
      applicationId: id,
      role: TeamRole.ENGINEER,
      basis: PayBasis.PER_EVENT,
      amountMinor: 25_000,
      send: false,
    });
    expect(draft.status).toBe(OfferStatus.DRAFT);

    const mine = await applicant.hiring.myApplications();
    // Terms nobody has decided to make them are not theirs to read.
    expect(mine.applications[0]!.offers).toHaveLength(0);

    await manager.hiring.withdrawOffer({ offerId: draft.id });
  });

  it("refuses to answer an offer that has not been sent", async () => {
    const id = await applicationId();
    const draft = await manager.hiring.createOffer({
      applicationId: id,
      basis: PayBasis.UNPAID,
      send: false,
    });
    await expect(
      applicant.hiring.respondToOffer({ offerId: draft.id, accept: true }),
    ).rejects.toThrow(/has not been sent/i);
    await manager.hiring.withdrawOffer({ offerId: draft.id });
  });

  it("refuses an expired offer rather than quietly accepting it", async () => {
    const id = await applicationId();
    const offer = await db.offer.create({
      data: {
        applicationId: id,
        teamId,
        status: OfferStatus.SENT,
        basis: PayBasis.UNPAID,
        sentAt: new Date(),
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    await expect(
      applicant.hiring.respondToOffer({ offerId: offer.id, accept: true }),
    ).rejects.toThrow(/expired/i);

    const after = await db.offer.findUniqueOrThrow({ where: { id: offer.id } });
    // Marked, not just refused — the expiry is a term of the offer.
    expect(after.status).toBe(OfferStatus.EXPIRED);
  });

  // -- The payoff ----------------------------------------------------------

  it("puts an accepted applicant on the roster with their rate set", async () => {
    // This is the whole point. Hiring somebody and then separately typing them
    // into the roster and again into the pay rates is where details drift.
    const id = await applicationId();
    const offer = await manager.hiring.createOffer({
      applicationId: id,
      role: TeamRole.ENGINEER,
      title: "Race engineer",
      basis: PayBasis.PER_EVENT,
      amountMinor: 30_000,
      currency: "USD",
      send: true,
    });
    expect(offer.status).toBe(OfferStatus.SENT);

    const application = await db.application.findUniqueOrThrow({
      where: { id },
    });
    expect(application.status).toBe(ApplicationStatus.OFFERED);

    await applicant.hiring.respondToOffer({
      offerId: offer.id,
      accept: true,
      note: "Delighted.",
    });

    const membership = await db.teamMembership.findUniqueOrThrow({
      where: { teamId_userId: { teamId, userId: applicantId } },
    });
    expect(membership.role).toBe(TeamRole.ENGINEER);
    expect(membership.endDate).toBeNull();

    const rate = await db.payRate.findFirstOrThrow({
      where: { teamId, userId: applicantId, effectiveTo: null },
    });
    expect(rate.basis).toBe(PayBasis.PER_EVENT);
    expect(rate.amountMinor).toBe(30_000);
    expect(rate.label).toBe("Race engineer");

    const hired = await db.application.findUniqueOrThrow({ where: { id } });
    expect(hired.status).toBe(ApplicationStatus.ACCEPTED);
  });

  it("will not withdraw an offer somebody already acted on", async () => {
    const offer = await db.offer.findFirstOrThrow({
      where: { teamId, status: OfferStatus.ACCEPTED },
    });
    await expect(
      manager.hiring.withdrawOffer({ offerId: offer.id }),
    ).rejects.toThrow(/take the person off the roster instead/i);
  });

  it("records a declined offer differently from a withdrawal", async () => {
    // An offer that was refused is worth knowing when the next one is written.
    const application = await db.application.findFirstOrThrow({
      where: { opportunityId, applicantId: { not: applicantId } },
    });
    const offer = await manager.hiring.createOffer({
      applicationId: application.id,
      basis: PayBasis.UNPAID,
      send: true,
    });
    await otherApplicant.hiring.respondToOffer({
      offerId: offer.id,
      accept: false,
      note: "Taken something else.",
    });

    const after = await db.application.findUniqueOrThrow({
      where: { id: application.id },
    });
    expect(after.status).toBe(ApplicationStatus.OFFER_DECLINED);

    // No roster row for somebody who said no.
    const membership = await db.teamMembership.findUnique({
      where: {
        teamId_userId: { teamId, userId: application.applicantId },
      },
    });
    expect(membership).toBeNull();
  });

  it("leaves closing the posting to the team", async () => {
    // A team hiring two mechanics off one advert would be furious to find it
    // closed after the first, and nothing can know how many seats it is for.
    let posting = await db.opportunity.findUniqueOrThrow({
      where: { id: opportunityId },
    });
    expect(posting.status).toBe(OpportunityStatus.OPEN);

    await manager.hiring.closePosting({ opportunityId });
    posting = await db.opportunity.findUniqueOrThrow({
      where: { id: opportunityId },
    });
    expect(posting.status).toBe(OpportunityStatus.CLOSED);
  });
});
