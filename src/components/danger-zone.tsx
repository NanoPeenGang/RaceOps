"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface DeletionImpact {
  name: string;
  events?: number;
  registrations: number;
  results: number;
  penalties: number;
  volunteerShifts: number;
  media: number;
}

/**
 * Irreversible-delete panel. Spells out exactly what will be destroyed and
 * requires the operator to retype the name before the button unlocks.
 */
export function DangerZone({
  title,
  description,
  impact,
  isLoadingImpact,
  onDelete,
  isDeleting,
  error,
}: {
  title: string;
  description: string;
  impact?: DeletionImpact;
  isLoadingImpact?: boolean;
  onDelete: (confirmName: string) => void;
  isDeleting: boolean;
  error?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");

  const matches = Boolean(impact) && typed === impact!.name;

  const lines: Array<[string, number | undefined]> = [
    ["Events", impact?.events],
    ["Entries", impact?.registrations],
    ["Results", impact?.results],
    ["Penalties & appeals", impact?.penalties],
    ["Volunteer shifts", impact?.volunteerShifts],
    ["Media items", impact?.media],
  ];

  return (
    <Card className="border-brand-red/40">
      <CardHeader>
        <CardTitle className="text-brand-red">{title}</CardTitle>
        <p className="text-xs text-brand-black/60">{description}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {!open ? (
          <Button variant="outline" onClick={() => setOpen(true)}>
            Delete permanently
          </Button>
        ) : (
          <div className="space-y-3">
            {isLoadingImpact && (
              <p className="text-sm text-brand-black/60">
                Checking what this would remove…
              </p>
            )}
            {impact && (
              <div className="rounded-lg border border-brand-red/30 bg-brand-red/5 p-3">
                <p className="text-sm font-semibold">
                  This permanently deletes:
                </p>
                <ul className="mt-2 space-y-1 text-sm text-brand-black/80">
                  {lines
                    .filter(([, count]) => count !== undefined)
                    .map(([label, count]) => (
                      <li key={label}>
                        {label}: <strong>{count}</strong>
                      </li>
                    ))}
                </ul>
                {impact.penalties > 0 && (
                  <p className="mt-2 text-xs text-brand-red">
                    This includes the public penalty and appeal record, which
                    cannot be recovered.
                  </p>
                )}
              </div>
            )}
            <label className="block text-sm font-medium">
              Type <span className="font-mono">{impact?.name ?? "…"}</span> to
              confirm
              <input
                className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={impact?.name}
                autoComplete="off"
              />
            </label>
            {error && <p className="text-sm text-brand-red">{error}</p>}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                disabled={!matches || isDeleting}
                onClick={() => onDelete(typed)}
              >
                {isDeleting ? "Deleting…" : "I understand — delete"}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setOpen(false);
                  setTyped("");
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
