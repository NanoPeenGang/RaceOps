"use client";

import { useEffect, useState } from "react";

/**
 * A value that lags behind the one being typed.
 *
 * The discover search fired a request on every keystroke: typing "watkins"
 * sent seven round trips and flickered the results through seven states, the
 * last six of which nobody wanted. Worse on a phone, where each one costs
 * radio time.
 *
 * 250ms is chosen against typing speed rather than as a round number. A person
 * typing at a hundred words a minute leaves roughly 120ms between keys, so a
 * shorter delay would still fire mid-word; much longer and the results feel
 * like they are lagging the keyboard.
 */
export const SEARCH_DEBOUNCE_MS = 250;

export function useDebounced<T>(value: T, delayMs = SEARCH_DEBOUNCE_MS): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return settled;
}

/**
 * Whether what is on screen is behind what has been typed.
 *
 * Worth surfacing. Without it a debounce reads as a slow app — results sit
 * unchanged for a quarter of a second after the last keystroke and somebody
 * types the word again. A quiet "searching" beats a spinner that flashes.
 */
export function isSettling<T>(typed: T, settled: T): boolean {
  return typed !== settled;
}
