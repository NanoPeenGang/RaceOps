import { describe, expect, it } from "vitest";
import { ApplicationStatus } from "@prisma/client";
import {
  canPosterTransition,
  POSTER_SETTABLE_STATUSES,
} from "@/lib/applications";

describe("canPosterTransition", () => {
  it("allows the standard review flow", () => {
    expect(
      canPosterTransition(ApplicationStatus.SUBMITTED, ApplicationStatus.REVIEWING),
    ).toBe(true);
    expect(
      canPosterTransition(ApplicationStatus.REVIEWING, ApplicationStatus.ACCEPTED),
    ).toBe(true);
    expect(
      canPosterTransition(ApplicationStatus.REVIEWING, ApplicationStatus.REJECTED),
    ).toBe(true);
    // Direct accept/reject without a review step is allowed
    expect(
      canPosterTransition(ApplicationStatus.SUBMITTED, ApplicationStatus.ACCEPTED),
    ).toBe(true);
  });

  it("blocks transitions out of terminal states", () => {
    for (const terminal of [
      ApplicationStatus.ACCEPTED,
      ApplicationStatus.REJECTED,
      ApplicationStatus.WITHDRAWN,
    ]) {
      for (const target of POSTER_SETTABLE_STATUSES) {
        expect(canPosterTransition(terminal, target)).toBe(false);
      }
    }
  });

  it("blocks the poster from setting WITHDRAWN or SUBMITTED", () => {
    expect(
      canPosterTransition(ApplicationStatus.REVIEWING, ApplicationStatus.WITHDRAWN),
    ).toBe(false);
    expect(
      canPosterTransition(ApplicationStatus.REVIEWING, ApplicationStatus.SUBMITTED),
    ).toBe(false);
  });

  it("blocks no-op transitions", () => {
    expect(
      canPosterTransition(ApplicationStatus.REVIEWING, ApplicationStatus.REVIEWING),
    ).toBe(false);
  });
});
