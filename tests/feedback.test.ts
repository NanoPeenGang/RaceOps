import { describe, expect, it } from "vitest";
import {
  describeFailure,
  dismissesItself,
  DISMISS_AFTER_MS,
  MAX_VISIBLE_TOASTS,
  trimToasts,
} from "@/lib/feedback";

/**
 * Saying what happened.
 *
 * Before this, every mutation in the app showed a busy state and then simply
 * stopped: no confirmation, and for a quarter of them no error either. People
 * clicked twice. These are the rules that replaced the silence.
 */

describe("how long a message stays", () => {
  it("never dismisses a failure on its own", () => {
    // One that vanishes before it is read is worse than none: the person knows
    // something failed, has no idea what, and can only try again and hope.
    expect(DISMISS_AFTER_MS.error).toBeNull();
    expect(dismissesItself("error")).toBe(false);
  });

  it("clears a confirmation without being asked", () => {
    expect(dismissesItself("success")).toBe(true);
    expect(DISMISS_AFTER_MS.success).toBeGreaterThan(2_000);
  });

  it("leaves an aside up longer than a confirmation", () => {
    // "Saved" is read at a glance; anything with content in it is not.
    expect(DISMISS_AFTER_MS.info!).toBeGreaterThan(DISMISS_AFTER_MS.success!);
  });
});

describe("what a failure actually says", () => {
  it("shows the server's sentence when there is one", () => {
    expect(describeFailure(new Error("That name is already taken."))).toBe(
      "That name is already taken.",
    );
  });

  it("does not put a wall of Zod issues on screen", () => {
    // Accurate and unreadable. A stack of field paths is worse than the
    // silence this replaced.
    const zod = new Error(
      '[\n  {\n    "code": "too_small",\n    "path": ["name"]\n  }\n]',
    );
    expect(describeFailure(zod)).toMatch(/check the fields/i);
    expect(describeFailure(zod)).not.toContain("too_small");
  });

  it("says something rather than nothing when the error is empty", () => {
    expect(describeFailure(new Error(""))).toBeTruthy();
    expect(describeFailure(undefined)).toBeTruthy();
    expect(describeFailure("   ")).toBeTruthy();
  });

  it("takes a bare string, which is what a thrown literal gives you", () => {
    expect(describeFailure("Network request failed")).toBe(
      "Network request failed",
    );
  });
});

describe("how many are on screen at once", () => {
  it("keeps the newest and drops the rest", () => {
    /*
     * Newest rather than oldest: the last thing somebody did is the thing they
     * are waiting on. Keeping the first three would leave a person watching a
     * stale confirmation while the action they just took said nothing.
     */
    let toasts: string[] = [];
    for (const entry of ["a", "b", "c", "d"]) {
      toasts = trimToasts(toasts, entry, 3);
    }
    expect(toasts).toEqual(["b", "c", "d"]);
  });

  it("does not mutate the list it was given", () => {
    const current = ["a"];
    trimToasts(current, "b", 3);
    expect(current).toEqual(["a"]);
  });

  it("shows more than one, so a second action is not swallowed", () => {
    expect(MAX_VISIBLE_TOASTS).toBeGreaterThan(1);
  });
});
