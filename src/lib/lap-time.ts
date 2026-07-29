/**
 * Lap-time parsing and formatting, shared by results import and live timing.
 */

/**
 * Lap time as m:ss.mmm (or ss.mmm under a minute). Returns "—" for null so a
 * board never renders a bare zero for a car that has not set a time.
 */
export function formatLapTime(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || ms < 0) return "—";
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const millis = ms % 1000;
  const secondsText = String(seconds).padStart(2, "0");
  const millisText = String(millis).padStart(3, "0");
  return minutes > 0
    ? `${minutes}:${secondsText}.${millisText}`
    : `${seconds}.${millisText}`;
}

/**
 * Parses "1:23.456", "83.456" or a raw millisecond count into milliseconds.
 * Timing officials paste times in whichever form their system emits.
 */
export function parseLapTime(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const withMinutes = /^(\d+):([0-5]?\d)(?:\.(\d{1,3}))?$/.exec(trimmed);
  if (withMinutes) {
    const [, minutes, seconds, fraction = "0"] = withMinutes;
    return (
      Number(minutes) * 60000 +
      Number(seconds) * 1000 +
      Number(fraction.padEnd(3, "0"))
    );
  }

  const secondsOnly = /^(\d+)(?:\.(\d{1,3}))?$/.exec(trimmed);
  if (secondsOnly) {
    const [, seconds, fraction] = secondsOnly;
    // A bare integer with no fraction is treated as raw milliseconds only
    // when it is too large to be a plausible lap time in seconds.
    if (fraction === undefined && Number(seconds) > 3600) {
      return Number(seconds);
    }
    return Number(seconds) * 1000 + Number((fraction ?? "0").padEnd(3, "0"));
  }

  return null;
}
