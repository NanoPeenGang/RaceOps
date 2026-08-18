"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { AccessZone, ScanResult } from "@prisma/client";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/trpc/root";
import { api } from "@/lib/trpc/client";
import { Badge } from "@/components/ui/badge";
import { QrScanner } from "@/components/qr-scanner";
import { ACCESS_ZONE_LABELS, ACCESS_ZONE_ORDER } from "@/lib/credentials";
import {
  DUPLICATE_WINDOW_MS,
  isDuplicateScan,
  SCAN_RESULT_LABELS,
  SCAN_RESULT_TONE,
  extractToken,
} from "@/lib/gate";

type CheckIn = inferRouterOutputs<AppRouter>["paddock"]["checkIn"];

/**
 * The gate.
 *
 * Built for one person doing one thing repeatedly, outdoors, with a queue in
 * front of them: point the camera, read the verdict, wave the next one through.
 * So the verdict is the whole screen and everything else is small, the camera
 * keeps running between people, and the result clears itself rather than
 * needing a tap that a gloved hand will miss.
 *
 * The gate's zone is set once at the start of a shift and remembered while the
 * page is open. That is what makes the tool say "admit" or "wrong gate" rather
 * than listing zones and leaving a marshal to work it out with a queue
 * building — which is the entire difference between this and scanning a badge
 * with the phone's own camera app.
 */
export function GateConsole({ eventId }: { eventId: string }) {
  const utils = api.useUtils();
  const [zone, setZone] = useState<AccessZone | "">("");
  const [gate, setGate] = useState("");
  const [last, setLast] = useState<CheckIn | null>(null);
  const [error, setError] = useState<string | null>(null);

  /*
   * A camera reads the same code eight times a second. Without this the log
   * fills with identical rows and the count of who came through the gate stops
   * meaning anything. Held in a ref so a repeat is rejected before any state
   * update — a re-render is far too slow to be the guard here.
   */
  const recent = useRef<{ token: string | null; at: number }[]>([]);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const counts = api.paddock.scanCounts.useQuery({ eventId });
  const log = api.paddock.scanLog.useQuery({ eventId, limit: 12 });

  const checkIn = api.paddock.checkIn.useMutation({
    onSuccess: async (result) => {
      setLast(result);
      setError(null);
      await Promise.all([
        utils.paddock.scanCounts.invalidate({ eventId }),
        utils.paddock.scanLog.invalidate({ eventId }),
      ]);
      // Clear after a beat so the next person can be scanned without a tap.
      // Long enough to read a refusal, short enough not to hold a queue up.
      if (clearTimer.current) clearTimeout(clearTimer.current);
      clearTimer.current = setTimeout(
        () => setLast(null),
        result.result === ScanResult.ADMITTED ? 2500 : 6000,
      );
    },
    onError: (mutationError) => setError(mutationError.message),
  });

  const handleScan = useCallback(
    (scanned: string) => {
      const token = extractToken(scanned);
      const now = Date.now();
      recent.current = recent.current.filter(
        (entry) => now - entry.at < DUPLICATE_WINDOW_MS,
      );
      if (token && isDuplicateScan(token, recent.current, now)) return;
      if (checkIn.isPending) return;

      recent.current.push({ token, at: now });
      checkIn.mutate({
        eventId,
        scanned,
        zone: zone || null,
        gate: gate.trim() || null,
      });
    },
    [checkIn, eventId, zone, gate],
  );

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-medium">
          This gate checks
          <select
            className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
            value={zone}
            onChange={(event) => setZone(event.target.value as AccessZone | "")}
          >
            <option value="">Any area — identity check only</option>
            {ACCESS_ZONE_ORDER.map((value) => (
              <option key={value} value={value}>
                {ACCESS_ZONE_LABELS[value]}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-brand-black/55">
            {zone
              ? `A pass that does not open ${ACCESS_ZONE_LABELS[zone]} will read as the wrong gate.`
              : "Any valid pass will be admitted. Pick an area to check against it."}
          </span>
        </label>
        <label className="block text-sm font-medium">
          Gate name
          <input
            className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
            value={gate}
            onChange={(event) => setGate(event.target.value)}
            placeholder="Paddock gate 2"
          />
          <span className="mt-1 block text-xs text-brand-black/55">
            Recorded against every scan, so the log says where somebody came in.
          </span>
        </label>
      </div>

      <Verdict result={last} pending={checkIn.isPending} error={error} />

      <QrScanner
        onScan={handleScan}
        paused={Boolean(last) || checkIn.isPending}
      />

      <div className="flex flex-wrap gap-4 text-sm">
        <Tally label="Admitted" value={counts.data?.admitted} tone="ok" />
        <Tally label="Wrong gate" value={counts.data?.wrongZone} tone="warn" />
        <Tally label="Refused" value={counts.data?.notValid} tone="stop" />
        <Tally label="Unknown" value={counts.data?.unknown} tone="stop" />
      </div>

      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Recent scans</h2>
          <Link
            href={`/events/${eventId}/manage`}
            className="text-xs text-brand-red hover:underline"
          >
            Event console →
          </Link>
        </div>
        {log.data?.items.length === 0 ? (
          <p className="text-sm text-brand-black/55">
            Nothing scanned yet at this event.
          </p>
        ) : (
          <ul className="divide-y divide-brand-black/5 text-sm">
            {log.data?.items.map((scan) => (
              <li
                key={scan.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2"
              >
                <span className="min-w-0">
                  <span className="font-medium">
                    {scan.credential?.holderName ?? "Unknown code"}
                  </span>
                  <span className="text-brand-black/55">
                    {[
                      scan.credential?.credentialType.name,
                      scan.credential?.registration?.carNumber
                        ? `#${scan.credential.registration.carNumber}`
                        : null,
                      scan.gate,
                      scan.zone ? ACCESS_ZONE_LABELS[scan.zone] : null,
                    ]
                      .filter(Boolean)
                      .map((part) => ` · ${part}`)
                      .join("")}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="text-xs tabular-nums text-brand-black/45">
                    {new Date(scan.scannedAt).toLocaleTimeString(undefined, {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  <Badge
                    variant={
                      scan.result === ScanResult.ADMITTED ? "verified" : "outline"
                    }
                  >
                    {SCAN_RESULT_LABELS[scan.result]}
                  </Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** The answer, sized to be read at arm's length with a queue waiting. */
function Verdict({
  result,
  pending,
  error,
}: {
  result: CheckIn | null;
  pending: boolean;
  error: string | null;
}) {
  if (error) {
    return (
      <div className="rounded-lg bg-brand-black p-5 text-center text-on-ink">
        <p className="text-xl font-bold">Could not check</p>
        <p className="mt-1 text-sm opacity-90">{error}</p>
      </div>
    );
  }

  if (pending) {
    return (
      <div className="rounded-lg border border-brand-black/15 p-5 text-center">
        <p className="text-lg font-medium text-brand-black/60">Checking…</p>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="rounded-lg border border-dashed border-brand-black/20 p-5 text-center">
        <p className="text-sm text-brand-black/55">
          Point the camera at a pass.
        </p>
      </div>
    );
  }

  const tone = SCAN_RESULT_TONE[result.result];
  const styles = {
    ok: "bg-green-600 text-white",
    warn: "bg-amber-500 text-white",
    stop: "bg-brand-red text-on-red",
  }[tone];

  return (
    <div className={`space-y-3 rounded-lg p-5 ${styles}`}>
      <div className="text-center">
        <p className="text-3xl font-bold">
          {SCAN_RESULT_LABELS[result.result]}
        </p>
        <p className="mt-1 text-sm opacity-95">{result.instruction}</p>
        {result.wrongEvent && (
          <p className="mt-1 text-sm font-medium">
            That pass was issued for a different event.
          </p>
        )}
      </div>

      {result.credential && (
        <div className="rounded bg-black/15 p-3 text-center">
          <p className="text-2xl font-bold leading-tight">
            {result.credential.holderName}
          </p>
          <p className="text-sm opacity-95">
            {[
              result.credential.holderRole,
              result.credential.credentialType.name,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {(result.credential.registration?.team?.name ||
            result.credential.registration?.carNumber) && (
            <p className="text-sm opacity-90">
              {[
                result.credential.registration?.carNumber
                  ? `#${result.credential.registration.carNumber}`
                  : null,
                result.credential.registration?.team?.name,
                result.credential.registration?.carClass,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
          {result.credential.serial && (
            <p className="text-xs opacity-75">{result.credential.serial}</p>
          )}
        </div>
      )}
    </div>
  );
}

function Tally({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | undefined;
  tone: "ok" | "warn" | "stop";
}) {
  const color = {
    ok: "text-green-700",
    warn: "text-amber-600",
    stop: "text-brand-red",
  }[tone];
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-brand-black/45">
        {label}
      </p>
      <p className={`text-xl font-bold tabular-nums ${color}`}>
        {value ?? "—"}
      </p>
    </div>
  );
}
