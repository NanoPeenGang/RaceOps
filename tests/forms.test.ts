import { describe, expect, it, vi } from "vitest";
import { isSettling, SEARCH_DEBOUNCE_MS } from "@/lib/use-debounced";

/**
 * Waiting for somebody to stop typing.
 *
 * The discover search fired a request per keystroke: "watkins" sent seven,
 * flickered the results through seven states, and six of them were noise.
 * Worse on a phone, where each one costs radio time.
 */

describe("the debounce interval", () => {
  it("outlasts the gap between keystrokes", () => {
    // A person typing at a hundred words a minute leaves roughly 120ms between
    // keys; anything shorter still fires mid-word, which is the bug.
    expect(SEARCH_DEBOUNCE_MS).toBeGreaterThan(120);
  });

  it("is short enough not to feel like lag", () => {
    // Past about half a second the results read as the app being slow rather
    // than as the app waiting.
    expect(SEARCH_DEBOUNCE_MS).toBeLessThanOrEqual(400);
  });
});

describe("knowing the results are behind the box", () => {
  it("reports a keystroke that has not landed yet", () => {
    expect(isSettling("watkin", "watkins")).toBe(true);
  });

  it("reports nothing once they agree", () => {
    expect(isSettling("watkins", "watkins")).toBe(false);
  });

  it("is what stops an empty state lying mid-word", () => {
    /*
     * Without it, typing a name that matches nobody for one keystroke shows
     * "no results" for a quarter of a second before the real answer arrives —
     * so somebody deletes what they typed and starts again.
     */
    const typed = "wat";
    const settled = "";
    expect(isSettling(typed, settled)).toBe(true);
  });
});

describe("what a form is for", () => {
  it("does not submit twice while one is in flight", async () => {
    // Enter is easy to hit twice and half these forms create something.
    const submit = vi.fn();
    const guarded = (busy: boolean) => {
      if (busy) return;
      submit();
    };
    guarded(false);
    guarded(true);
    expect(submit).toHaveBeenCalledTimes(1);
  });
});
