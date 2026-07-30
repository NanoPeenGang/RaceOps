"use client";

import { useState } from "react";
import { useOffline } from "@/components/offline-provider";
import { Button } from "@/components/ui/button";

/**
 * The outbox: what is waiting to reach the server, and why.
 *
 * Visible only when there is something to say. A marshal needs to know their
 * report is queued rather than sent — a silent outbox is indistinguishable
 * from a lost report, which is exactly the anxiety that sends people back to
 * paper.
 */
export function OfflineIndicator() {
  const { online, summary, queue, flush, discardParked } = useOffline();
  const [open, setOpen] = useState(false);

  if (online && summary.total === 0) return null;

  const waitedMinutes = summary.oldestQueuedAt
    ? Math.floor((Date.now() - summary.oldestQueuedAt) / 60_000)
    : 0;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 print:hidden">
      <div className="mx-auto max-w-3xl p-3">
        <div
          className={`rounded-lg border p-3 shadow-lg ${
            summary.parked > 0
              ? "border-brand-red/40 bg-white"
              : "border-brand-black/15 bg-white"
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm">
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  online ? "bg-brand-red" : "bg-brand-black/40"
                }`}
              />
              <span>
                {!online && "No signal · "}
                {summary.total === 0
                  ? "Everything sent"
                  : `${summary.total} waiting to send`}
                {summary.parked > 0 &&
                  ` · ${summary.parked} need${summary.parked === 1 ? "s" : ""} attention`}
                {summary.total > 0 && waitedMinutes >= 1 && (
                  <span className="text-brand-black/60">
                    {" "}
                    · oldest {waitedMinutes} min ago
                  </span>
                )}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {summary.total > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setOpen((current) => !current)}
                >
                  {open ? "Hide" : "Show"}
                </Button>
              )}
              {online && summary.pending > 0 && (
                <Button size="sm" variant="primary" onClick={flush}>
                  Send now
                </Button>
              )}
            </div>
          </div>

          {open && queue.length > 0 && (
            <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto border-t border-brand-black/10 pt-2 text-xs">
              {queue.map((item) => (
                <li key={item.id} className="flex justify-between gap-2">
                  <span>{item.label}</span>
                  <span className="shrink-0 text-brand-black/60">
                    {item.attempts >= 6
                      ? (item.lastError ?? "Gave up")
                      : item.status === "sending"
                        ? "sending…"
                        : `${new Date(item.queuedAt).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}`}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {open && summary.parked > 0 && (
            <div className="mt-2 space-y-1 border-t border-brand-black/10 pt-2">
              <p className="text-xs text-brand-black/70">
                These could not be sent and will not be retried. Copy anything
                you need before discarding them.
              </p>
              <Button size="sm" variant="outline" onClick={discardParked}>
                Discard {summary.parked}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
