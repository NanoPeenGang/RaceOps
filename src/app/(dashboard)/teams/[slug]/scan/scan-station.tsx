"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/trpc/client";
import { QrScanner } from "@/components/qr-scanner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useOfflineMutation } from "@/lib/trpc/offline-mutation";
import { useOffline } from "@/components/offline-provider";
import {
  isRepeatScan,
  parseLabel,
  pruneRecent,
  SCAN_MODE_LABELS,
  tally,
  type RecentScan,
  type ScanMode,
  type ScanRecord,
} from "@/lib/part-labels";

/**
 * The station itself.
 *
 * Three decisions carry the whole design:
 *
 * 1. **The direction is set once**, not per scan. Somebody loading a trailer
 *    is doing the same thing twenty times, and a question after every part is
 *    what makes people go back to a clipboard.
 * 2. **A scan commits immediately.** No confirm step, no form. Getting it
 *    wrong is fixed by Undo, which is one tap and still on screen — a dialog
 *    in front of every part would be read once and then tapped through.
 * 3. **The same code is ignored for ten seconds.** A camera decodes eight
 *    times a second; without this, holding a phone over a label empties the
 *    shelf forty times and the count is wrong by a margin nobody can rebuild.
 */

interface Logged extends ScanRecord {
  key: string;
  movementId: string | null;
  name: string;
  serial: string | null;
  balance: number;
  unitLabel: string;
  low: boolean;
  note: string | null;
  undone: boolean;
}

export function ScanStation({
  teamId,
  teamSlug,
}: {
  teamId: string;
  teamSlug: string;
}) {
  const utils = api.useUtils();
  const { online } = useOffline();
  const [mode, setMode] = useState<ScanMode>("out");
  const [log, setLog] = useState<Logged[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  // A ref, not state: the suppression window has to be read inside the scan
  // callback, and a stale closure over state would let every frame through.
  const recent = useRef<RecentScan[]>([]);

  const scan = api.garage.scanPart.useMutation({
    onSuccess: async (result) => {
      setError(null);
      setLog((entries) => [
        {
          key: result.movementId ?? `${Date.now()}`,
          movementId: result.movementId,
          mode,
          amount: result.amount,
          itemId: result.itemId,
          name: result.itemName,
          serial: result.serial,
          balance: result.balance,
          unitLabel: result.unitLabel,
          low: result.low,
          note: result.note,
          undone: false,
        },
        ...entries,
      ]);
      await utils.garage.inventory.invalidate({ teamId });
    },
    onError: (mutationError) => setError(mutationError.message),
  });

  const undo = api.garage.undoScan.useMutation({
    onSuccess: async (_reversal, variables) => {
      setLog((entries) =>
        entries.map((entry) =>
          entry.movementId === variables.movementId
            ? { ...entry, undone: true }
            : entry,
        ),
      );
      await utils.garage.inventory.invalidate({ teamId });
    },
    onError: (mutationError) => setError(mutationError.message),
  });

  /*
   * Queued when there is no signal, which is the case this is really for: a
   * trailer at a circuit has no bars, and loading one is exactly when somebody
   * scans twenty things in a row. The scan carries the time it happened so the
   * ledger does not say the shelf emptied on the drive home.
   */
  const queued = useOfflineMutation(
    async (input: Parameters<typeof scan.mutate>[0]) => {
      await scan.mutateAsync(input);
    },
    {
      procedure: "garage.scanPart",
      label: (input) =>
        `${SCAN_MODE_LABELS[input.mode as ScanMode]}: ${input.scanned.slice(-8)}`,
    },
  );

  const handleScan = useCallback(
    (value: string) => {
      const parsed = parseLabel(value);
      if (!parsed) {
        setError("That is not a RaceOps part label.");
        return;
      }

      const now = Date.now();
      recent.current = pruneRecent(recent.current, now);
      if (isRepeatScan(parsed.token, recent.current, now)) return;
      recent.current = [...recent.current, { token: parsed.token, at: now }];

      const input = { scanned: value, mode, amount: 1, scannedAt: new Date() };
      void queued.run(input).then(({ queued: wasQueued }) => {
        if (!wasQueued) return;
        setLog((entries) => [
          {
            key: `queued-${now}`,
            movementId: null,
            mode,
            amount: 1,
            itemId: parsed.token,
            name: "Waiting for signal",
            serial: null,
            balance: 0,
            unitLabel: "",
            low: false,
            note: "Queued — it will land when you are back on the network.",
            undone: false,
          },
          ...entries,
        ]);
      });
    },
    [mode, queued],
  );

  const counts = tally(log.filter((entry) => !entry.undone && entry.movementId));

  return (
    <div className="space-y-4">
      {/* Big, and the only thing above the camera. Somebody glances at this
          between parts to check they are still going the right way. */}
      <div className="grid grid-cols-2 gap-2">
        {(["out", "in"] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={mode === option}
            onClick={() => setMode(option)}
            className={
              mode === option
                ? "rounded-lg border-2 border-brand-red bg-brand-red px-4 py-5 text-lg font-bold text-on-red"
                : "rounded-lg border-2 border-brand-black/15 px-4 py-5 text-lg font-semibold text-brand-black/60"
            }
          >
            {SCAN_MODE_LABELS[option]}
          </button>
        ))}
      </div>

      {!online && (
        <p className="rounded-md border border-brand-black/20 bg-brand-black/[0.03] p-3 text-sm">
          No signal. Scans are being saved on this phone and will send
          themselves when you are back on the network — keep going.
        </p>
      )}

      {error && (
        <p role="alert" className="rounded-md bg-brand-red/10 p-3 text-sm">
          {error}
        </p>
      )}

      <QrScanner onScan={handleScan} disabled={scan.isPending} />

      <form
        className="flex gap-2"
        onSubmit={(submit) => {
          submit.preventDefault();
          const value = manual.trim();
          if (!value) return;
          handleScan(value);
          setManual("");
        }}
      >
        <input
          className="min-w-0 flex-1 rounded-md border border-brand-black/20 px-3 py-3 text-base"
          value={manual}
          onChange={(change) => setManual(change.target.value)}
          placeholder="Or type the code off the label"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
        <Button type="submit" variant="outline">
          Log it
        </Button>
      </form>

      <div className="flex flex-wrap gap-4 rounded-lg border border-brand-black/10 p-3 text-sm">
        <Tally label="Taken out" value={counts.out} />
        <Tally label="Put back" value={counts.in} />
        <Tally label="Lines touched" value={counts.lines} />
      </div>

      {log.length === 0 ? (
        <p className="text-sm text-brand-black/55">
          Point the camera at a part label. Set the direction above once and
          then keep scanning — every part logs itself.
        </p>
      ) : (
        <ul className="divide-y divide-brand-black/5">
          {log.map((entry) => (
            <li key={entry.key} className="flex flex-wrap gap-2 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {entry.name}
                  {entry.serial && (
                    <span className="text-brand-black/55"> · {entry.serial}</span>
                  )}
                </p>
                <p className="text-sm text-brand-black/60">
                  {entry.note ??
                    `${entry.balance} ${entry.unitLabel} left${
                      entry.low ? " — running low" : ""
                    }`}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {entry.undone ? (
                  <Badge variant="outline">Undone</Badge>
                ) : (
                  <>
                    <Badge variant={entry.low ? "verified" : "outline"}>
                      {entry.mode === "out" ? `−${entry.amount}` : `+${entry.amount}`}
                    </Badge>
                    {entry.movementId && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={undo.isPending}
                        onClick={() =>
                          undo.mutate({ movementId: entry.movementId! })
                        }
                      >
                        Undo
                      </Button>
                    )}
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-3 text-sm">
        <Link
          href={`/teams/${teamSlug}/labels`}
          className="text-brand-red hover:underline"
        >
          Print labels →
        </Link>
        <Link
          href={`/teams/${teamSlug}/manage?tab=garage`}
          className="text-brand-red hover:underline"
        >
          Garage console →
        </Link>
      </div>
    </div>
  );
}

function Tally({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-brand-black/50">
        {label}
      </p>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
    </div>
  );
}
