import { describe, expect, it } from "vitest";
import { AccessRequestKind, AccessRequestStatus } from "@prisma/client";
import {
  ACCESS_KIND_CRITERIA,
  ACCESS_KIND_DESCRIPTIONS,
  ACCESS_KIND_LABELS,
  ACCESS_STATUS_LABELS,
  canApplyFor,
  canDecide,
  canWithdraw,
  checkRequest,
  createsAnEntity,
  daysPending,
  grantsRecruitingAccess,
  grantsSponsorAccess,
  isOverdue,
  isSpendable,
  needsSubject,
  REVIEW_SLA_DAYS,
  sortQueue,
} from "@/lib/access-requests";

/**
 * The rules behind the application queue.
 *
 * The load-bearing one is `isSpendable`: an approval is consumed by the thing
 * it creates. Without that, one approved application is a standing licence to
 * publish, which is the spam problem the queue exists to solve, reintroduced
 * one step further down.
 */

const approved = (over: Partial<Parameters<typeof isSpendable>[0]> = {}) => ({
  kind: AccessRequestKind.TEAM,
  status: AccessRequestStatus.APPROVED,
  fulfilledEntityId: null,
  ...over,
});

describe("what an approval covers", () => {
  it("lets an approved applicant create the thing once", () => {
    expect(isSpendable(approved())).toBe(true);
  });

  it("is spent by the creation it paid for", () => {
    expect(isSpendable(approved({ fulfilledEntityId: "team_1" }))).toBe(false);
  });

  it("does not let a pending or declined application create anything", () => {
    for (const status of [
      AccessRequestStatus.PENDING,
      AccessRequestStatus.REJECTED,
      AccessRequestStatus.WITHDRAWN,
    ]) {
      expect(isSpendable(approved({ status }))).toBe(false);
    }
  });

  it("does not treat a recruiting approval as something to spend", () => {
    /*
     * A team that hires once will hire again. Consuming the approval on the
     * first advert would mean re-applying every time somebody leaves, which is
     * the queue doing work for no benefit.
     */
    const recruiting = approved({ kind: AccessRequestKind.RECRUITING });
    expect(isSpendable(recruiting)).toBe(false);
    expect(grantsRecruitingAccess(recruiting)).toBe(true);
  });

  it("only grants recruiting from an approved recruiting application", () => {
    expect(
      grantsRecruitingAccess(
        approved({
          kind: AccessRequestKind.RECRUITING,
          status: AccessRequestStatus.PENDING,
        }),
      ),
    ).toBe(false);
    // A team approval is permission to exist, not permission to advertise.
    expect(grantsRecruitingAccess(approved())).toBe(false);
  });

  it("knows which kinds belong to a body rather than a person", () => {
    /*
     * The distinction the whole scoping rests on: recruiting attaches to the
     * team, so a manager who applies and then leaves does not take the team's
     * ability to hire with them.
     */
    expect(needsSubject(AccessRequestKind.RECRUITING)).toBe(true);
    for (const kind of [
      AccessRequestKind.TEAM,
      AccessRequestKind.ORGANIZATION,
      AccessRequestKind.SERIES,
      AccessRequestKind.SPONSOR,
    ]) {
      expect(needsSubject(kind)).toBe(false);
    }
  });

  it("does not treat a sponsor approval as something to spend", () => {
    // Nothing is created, so there is nothing to consume it — the approval is
    // the grant, and spending it would silently revoke sponsor access.
    const sponsor = approved({ kind: AccessRequestKind.SPONSOR });
    expect(isSpendable(sponsor)).toBe(false);
    expect(grantsSponsorAccess(sponsor)).toBe(true);
  });

  it("only grants sponsor access from an approved sponsor application", () => {
    expect(
      grantsSponsorAccess(
        approved({
          kind: AccessRequestKind.SPONSOR,
          status: AccessRequestStatus.PENDING,
        }),
      ),
    ).toBe(false);
    expect(grantsSponsorAccess(approved())).toBe(false);
  });

  it("agrees with itself about which kinds create something", () => {
    expect(createsAnEntity(AccessRequestKind.TEAM)).toBe(true);
    expect(createsAnEntity(AccessRequestKind.ORGANIZATION)).toBe(true);
    expect(createsAnEntity(AccessRequestKind.SERIES)).toBe(true);
    expect(createsAnEntity(AccessRequestKind.SPONSOR)).toBe(false);
    expect(createsAnEntity(AccessRequestKind.RECRUITING)).toBe(false);
  });
});

describe("applying again", () => {
  it("blocks a second application while one is pending", () => {
    const existing = [
      { kind: AccessRequestKind.TEAM, status: AccessRequestStatus.PENDING },
    ];
    expect(canApplyFor(AccessRequestKind.TEAM, existing)).toBe(false);
  });

  it("does not block a different kind", () => {
    const existing = [
      { kind: AccessRequestKind.TEAM, status: AccessRequestStatus.PENDING },
    ];
    expect(canApplyFor(AccessRequestKind.SERIES, existing)).toBe(true);
  });

  it("lets somebody re-apply after a rejection", () => {
    // A permanent bar would need an appeals process nobody has asked for, and
    // most rejections are a fixable application rather than a bad actor.
    const existing = [
      { kind: AccessRequestKind.TEAM, status: AccessRequestStatus.REJECTED },
    ];
    expect(canApplyFor(AccessRequestKind.TEAM, existing)).toBe(true);
  });

  it("lets somebody apply again once an approval has been spent", () => {
    const existing = [
      {
        kind: AccessRequestKind.TEAM,
        status: AccessRequestStatus.APPROVED,
        fulfilledEntityId: "team_1",
      },
    ];
    expect(canApplyFor(AccessRequestKind.TEAM, existing)).toBe(true);
  });
});

describe("withdrawing and deciding", () => {
  it("allows both only while pending", () => {
    expect(canWithdraw(AccessRequestStatus.PENDING)).toBe(true);
    expect(canDecide(AccessRequestStatus.PENDING)).toBe(true);
    for (const status of [
      AccessRequestStatus.APPROVED,
      AccessRequestStatus.REJECTED,
      AccessRequestStatus.WITHDRAWN,
    ]) {
      expect(canWithdraw(status)).toBe(false);
      expect(canDecide(status)).toBe(false);
    }
  });
});

describe("what the form insists on", () => {
  it("wants a name", () => {
    expect(
      checkRequest({ proposedName: " ", summary: "x".repeat(50) })?.field,
    ).toBe("proposedName");
  });

  it("wants more than a word about what it is", () => {
    expect(checkRequest({ proposedName: "Apex", summary: "cars" })?.field).toBe(
      "summary",
    );
  });

  it("accepts an ordinary application", () => {
    expect(
      checkRequest({
        proposedName: "Apex Racing",
        summary: "Two of us, one E36, we run ChampCar in the south east.",
      }),
    ).toBeNull();
  });

  it("does not judge quality — that is the reviewer's job", () => {
    // A form that argues before a human has looked loses the applicants you
    // wanted along with the ones you did not.
    expect(
      checkRequest({
        proposedName: "aaa",
        summary: "a".repeat(25),
      }),
    ).toBeNull();
  });
});

describe("how long somebody has been waiting", () => {
  const now = new Date("2026-03-10T12:00:00Z");

  it("counts whole days", () => {
    expect(
      daysPending(
        {
          status: AccessRequestStatus.PENDING,
          createdAt: new Date("2026-03-08T00:00:00Z"),
        },
        now,
      ),
    ).toBe(2);
  });

  it("flags an application over the target", () => {
    const old = {
      status: AccessRequestStatus.PENDING,
      createdAt: new Date("2026-03-01T00:00:00Z"),
    };
    expect(isOverdue(old, now)).toBe(true);
    expect(daysPending(old, now)).toBeGreaterThanOrEqual(REVIEW_SLA_DAYS);
  });

  it("does not flag one that has already been answered", () => {
    expect(
      isOverdue(
        {
          status: AccessRequestStatus.APPROVED,
          createdAt: new Date("2026-01-01T00:00:00Z"),
        },
        now,
      ),
    ).toBe(false);
  });

  it("puts pending first and the longest wait at the top", () => {
    const sorted = sortQueue([
      {
        id: "decided-old",
        status: AccessRequestStatus.APPROVED,
        createdAt: new Date("2026-01-01"),
      },
      {
        id: "pending-new",
        status: AccessRequestStatus.PENDING,
        createdAt: new Date("2026-03-09"),
      },
      {
        id: "pending-old",
        status: AccessRequestStatus.PENDING,
        createdAt: new Date("2026-02-01"),
      },
    ]);
    expect(sorted.map((r) => r.id)).toEqual([
      "pending-old",
      "pending-new",
      "decided-old",
    ]);
  });

  it("does not mutate the array it was given", () => {
    const input = [
      {
        status: AccessRequestStatus.APPROVED,
        createdAt: new Date("2026-01-01"),
      },
      { status: AccessRequestStatus.PENDING, createdAt: new Date("2026-02-01") },
    ];
    const before = [...input];
    sortQueue(input);
    expect(input).toEqual(before);
  });
});

describe("the copy the queue is decided on", () => {
  it("says what each kind is, and what a reviewer is weighing", () => {
    // A queue with no stated bar gets decided on vibes and then
    // inconsistently, which is worse than no queue.
    for (const kind of Object.values(AccessRequestKind)) {
      expect(ACCESS_KIND_LABELS[kind]).toBeTruthy();
      expect(ACCESS_KIND_DESCRIPTIONS[kind]).toBeTruthy();
      expect(ACCESS_KIND_CRITERIA[kind].length).toBeGreaterThan(40);
    }
    for (const status of Object.values(AccessRequestStatus)) {
      expect(ACCESS_STATUS_LABELS[status]).toBeTruthy();
    }
  });
});
