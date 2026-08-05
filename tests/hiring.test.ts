import { describe, expect, it } from "vitest";
import { ApplicationStatus } from "@prisma/client";
import {
  APPLICATION_STATUS_DESCRIPTIONS,
  APPLICATION_STATUS_LABELS,
  CLOSED_STATUSES,
  PIPELINE_STAGES,
  STALE_AFTER_DAYS,
  buildPipeline,
  canApplicantWithdraw,
  canTeamTransition,
  daysWaiting,
  inboxCounts,
  isClosed,
  isStale,
} from "@/lib/hiring";

const NOW = new Date("2026-06-10T12:00:00Z");
const daysAgo = (days: number) =>
  new Date(NOW.getTime() - days * 86_400_000);

const application = (
  status: ApplicationStatus,
  ageDays = 0,
): { status: ApplicationStatus; createdAt: Date; updatedAt: Date } => ({
  status,
  createdAt: daysAgo(ageDays),
  updatedAt: NOW,
});

describe("application vocabulary", () => {
  it("labels and describes every status", () => {
    for (const status of Object.values(ApplicationStatus)) {
      expect(APPLICATION_STATUS_LABELS[status], status).toBeTruthy();
      expect(APPLICATION_STATUS_DESCRIPTIONS[status], status).toBeTruthy();
    }
  });

  it("accounts for every status as either a live stage or a closed one", () => {
    const covered = [...PIPELINE_STAGES, ...CLOSED_STATUSES].sort();
    expect(covered).toEqual(Object.values(ApplicationStatus).sort());
  });

  it("does not put a closed status in the pipeline", () => {
    // A board where three of seven columns are closed cases is a board nobody
    // can read.
    for (const stage of PIPELINE_STAGES) {
      expect(isClosed(stage), stage).toBe(false);
    }
  });

  it("runs the pipeline in the order hiring actually happens", () => {
    expect(PIPELINE_STAGES).toEqual([
      ApplicationStatus.SUBMITTED,
      ApplicationStatus.REVIEWING,
      ApplicationStatus.INTERVIEWING,
      ApplicationStatus.OFFERED,
    ]);
  });
});

describe("canTeamTransition", () => {
  it("lets a team say yes outright without running the whole pipeline", () => {
    // Most club hiring is a conversation and a handshake. Forcing every team
    // through the paperwork makes this something people work around.
    expect(
      canTeamTransition(
        ApplicationStatus.SUBMITTED,
        ApplicationStatus.ACCEPTED,
      ),
    ).toBe(true);
  });

  it("lets a team move through the stages", () => {
    expect(
      canTeamTransition(
        ApplicationStatus.SUBMITTED,
        ApplicationStatus.REVIEWING,
      ),
    ).toBe(true);
    expect(
      canTeamTransition(
        ApplicationStatus.REVIEWING,
        ApplicationStatus.INTERVIEWING,
      ),
    ).toBe(true);
  });

  it("will not reopen a decision the applicant has been told about", () => {
    expect(
      canTeamTransition(
        ApplicationStatus.REJECTED,
        ApplicationStatus.REVIEWING,
      ),
    ).toBe(false);
    expect(
      canTeamTransition(ApplicationStatus.ACCEPTED, ApplicationStatus.REJECTED),
    ).toBe(false);
    expect(
      canTeamTransition(
        ApplicationStatus.WITHDRAWN,
        ApplicationStatus.REVIEWING,
      ),
    ).toBe(false);
  });

  it("will not let a team write the applicant's answer down for them", () => {
    // Only the applicant declines an offer.
    expect(
      canTeamTransition(
        ApplicationStatus.OFFERED,
        ApplicationStatus.OFFER_DECLINED,
      ),
    ).toBe(false);
    expect(
      canTeamTransition(
        ApplicationStatus.OFFERED,
        ApplicationStatus.WITHDRAWN,
      ),
    ).toBe(false);
  });

  it("is a no-op to the same status", () => {
    expect(
      canTeamTransition(
        ApplicationStatus.REVIEWING,
        ApplicationStatus.REVIEWING,
      ),
    ).toBe(false);
  });
});

describe("canApplicantWithdraw", () => {
  it("allows it right up until something is settled", () => {
    expect(canApplicantWithdraw(ApplicationStatus.SUBMITTED)).toBe(true);
    expect(canApplicantWithdraw(ApplicationStatus.OFFERED)).toBe(true);
  });

  it("refuses once it is closed", () => {
    expect(canApplicantWithdraw(ApplicationStatus.ACCEPTED)).toBe(false);
    expect(canApplicantWithdraw(ApplicationStatus.REJECTED)).toBe(false);
  });
});

describe("buildPipeline", () => {
  it("makes a column per live stage, in order", () => {
    const pipeline = buildPipeline([application(ApplicationStatus.SUBMITTED)]);
    expect(pipeline.map((stage) => stage.status)).toEqual([
      ...PIPELINE_STAGES,
    ]);
  });

  it("puts whoever has waited longest at the top", () => {
    // The person waiting longest is the one the team owes an answer; a
    // newest-first inbox buries them under every arrival since.
    const pipeline = buildPipeline([
      { ...application(ApplicationStatus.SUBMITTED, 1), id: "new" },
      { ...application(ApplicationStatus.SUBMITTED, 30), id: "old" },
    ]);
    const column = pipeline.find(
      (stage) => stage.status === ApplicationStatus.SUBMITTED,
    )!;
    expect(column.applications.map((row) => row.id)).toEqual(["old", "new"]);
  });

  it("leaves closed applications out of the board", () => {
    const pipeline = buildPipeline([
      application(ApplicationStatus.REJECTED),
      application(ApplicationStatus.ACCEPTED),
    ]);
    expect(
      pipeline.every((stage) => stage.applications.length === 0),
    ).toBe(true);
  });
});

describe("daysWaiting and isStale", () => {
  it("measures from when they applied, not from the last poke", () => {
    // Nudging somebody from "new" to "in review" without answering them is
    // not progress, and resetting the clock would hide exactly the
    // applications this number exists to surface.
    const stale = {
      status: ApplicationStatus.REVIEWING,
      createdAt: daysAgo(20),
      updatedAt: NOW,
    };
    expect(daysWaiting(stale, NOW)).toBe(20);
    expect(isStale(stale, NOW)).toBe(true);
  });

  it("is not stale inside the window", () => {
    expect(
      isStale(application(ApplicationStatus.SUBMITTED, 2), NOW),
    ).toBe(false);
    expect(
      isStale(
        application(ApplicationStatus.SUBMITTED, STALE_AFTER_DAYS),
        NOW,
      ),
    ).toBe(true);
  });

  it("never nags about a closed application", () => {
    expect(
      isStale(application(ApplicationStatus.REJECTED, 400), NOW),
    ).toBe(false);
  });
});

describe("inboxCounts", () => {
  it("counts the four numbers a manager looks at", () => {
    const counts = inboxCounts(
      [
        application(ApplicationStatus.SUBMITTED, 1),
        application(ApplicationStatus.SUBMITTED, 40),
        application(ApplicationStatus.INTERVIEWING, 3),
        application(ApplicationStatus.ACCEPTED, 60),
        application(ApplicationStatus.REJECTED, 60),
      ],
      NOW,
    );
    expect(counts.unread).toBe(2);
    expect(counts.open).toBe(3);
    expect(counts.waiting).toBe(1);
    expect(counts.hired).toBe(1);
  });

  it("is all zeros for an empty inbox", () => {
    expect(inboxCounts([], NOW)).toEqual({
      unread: 0,
      open: 0,
      waiting: 0,
      hired: 0,
    });
  });
});
