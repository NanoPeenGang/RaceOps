"use client";

import { useState } from "react";
import { TireSetStatus } from "@prisma/client";
import { api } from "@/lib/trpc/client";
import { TIRE_STATUS_LABELS, describeAllocation } from "@/lib/cars";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Tire allocation and transponder assignment — the scrutineering bay's two
 * pieces of paperwork.
 *
 * Sets are records rather than a counter so an allocation can be audited: a
 * mis-scanned set is voided, not deleted, and a voided set stops counting
 * against the allowance while staying visible.
 */
export function TiresPanel({ eventId }: { eventId: string }) {
  const utils = api.useUtils();
  const allocation = api.car.tireSetsForEvent.useQuery(
    { eventId },
    { retry: false },
  );
  const map = api.car.transponderMap.useQuery({ eventId }, { retry: false });
  const [open, setOpen] = useState<string | null>(null);

  const refresh = () => utils.car.tireSetsForEvent.invalidate({ eventId });

  // Officials only; the query 403s for everyone else.
  if (allocation.error) return null;
  if (allocation.isLoading) return null;
  const data = allocation.data!;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-xl font-semibold">Tires &amp; transponders</h2>
          <AllowanceField eventId={eventId} allowance={data.allowance} />
        </div>
        <p className="text-xs text-brand-black/60">
          {data.allowance
            ? `${data.allowance} sets per entry`
            : "No tire allowance set"}
          {map.data
            ? ` · ${map.data.entries.length} transponder${map.data.entries.length === 1 ? "" : "s"} assigned`
            : ""}
          {map.data && map.data.unassigned > 0
            ? ` · ${map.data.unassigned} confirmed entr${map.data.unassigned === 1 ? "y has" : "ies have"} none`
            : ""}
        </p>
      </div>

      {data.entries.length === 0 ? (
        <p className="text-sm text-brand-black/60">No confirmed entries yet.</p>
      ) : (
        <div className="space-y-2">
          {data.entries.map((entry) => (
            <Card key={entry.registrationId}>
              <CardContent className="space-y-3 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium">
                      {entry.carNumber ? `#${entry.carNumber} ` : ""}
                      {entry.label}
                    </p>
                    <p className="text-xs text-brand-black/60">
                      {describeAllocation(entry.allocation)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {entry.allocation.overAllowance && (
                      <Badge variant="verified">Over allowance</Badge>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setOpen((current) =>
                          current === entry.registrationId
                            ? null
                            : entry.registrationId,
                        )
                      }
                    >
                      {open === entry.registrationId ? "Hide" : "Sets"}
                    </Button>
                  </div>
                </div>

                {open === entry.registrationId && (
                  <div className="space-y-3 border-t border-brand-black/10 pt-3">
                    <AllocateForm
                      registrationId={entry.registrationId}
                      onSaved={refresh}
                    />
                    {entry.sets.length === 0 ? (
                      <p className="text-sm text-brand-black/60">
                        Nothing issued to this entry yet.
                      </p>
                    ) : (
                      <ul className="space-y-1 text-sm">
                        {entry.sets.map((set) => (
                          <li
                            key={set.id}
                            className="flex flex-wrap items-center justify-between gap-2"
                          >
                            <span
                              className={
                                set.status === TireSetStatus.VOID
                                  ? "text-brand-black/40 line-through"
                                  : ""
                              }
                            >
                              <span className="font-mono">
                                {set.identifier}
                              </span>
                              {set.compound ? ` · ${set.compound}` : ""}
                              {set.dimension ? ` · ${set.dimension}` : ""}
                            </span>
                            <StatusButtons set={set} onSaved={refresh} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}

function StatusButtons({
  set,
  onSaved,
}: {
  set: { id: string; status: TireSetStatus };
  onSaved: () => void;
}) {
  const update = api.car.setTireStatus.useMutation({
    meta: { silenceError: true },
    onSuccess: onSaved,
  });
  return (
    <span className="flex flex-wrap gap-1">
      {Object.values(TireSetStatus).map((status) => (
        <Button
          key={status}
          size="sm"
          variant={status === set.status ? "primary" : "outline"}
          disabled={update.isPending}
          onClick={() => update.mutate({ tireSetId: set.id, status })}
        >
          {TIRE_STATUS_LABELS[status]}
        </Button>
      ))}
    </span>
  );
}

function AllocateForm({
  registrationId,
  onSaved,
}: {
  registrationId: string;
  onSaved: () => void;
}) {
  const [identifier, setIdentifier] = useState("");
  const [compound, setCompound] = useState("");
  const [dimension, setDimension] = useState("");

  const allocate = api.car.allocateTireSet.useMutation({
    onSuccess: () => {
      onSaved();
      setIdentifier("");
    },
  });

  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
        <input
          aria-label="Set identifier"
          className="rounded-md border border-brand-black/20 px-2 py-1.5 text-sm"
          placeholder="Barcode or set number"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
        />
        <input
          aria-label="Compound"
          className="rounded-md border border-brand-black/20 px-2 py-1.5 text-sm"
          placeholder="Medium"
          value={compound}
          onChange={(e) => setCompound(e.target.value)}
        />
        <input
          aria-label="Dimension"
          className="rounded-md border border-brand-black/20 px-2 py-1.5 text-sm"
          placeholder="305/680R18"
          value={dimension}
          onChange={(e) => setDimension(e.target.value)}
        />
        <Button
          size="sm"
          variant="primary"
          disabled={allocate.isPending || identifier.trim().length === 0}
          onClick={() =>
            allocate.mutate({
              registrationId,
              identifier: identifier.trim(),
              compound: compound.trim() || undefined,
              dimension: dimension.trim() || undefined,
            })
          }
        >
          {allocate.isPending ? "Issuing…" : "Issue set"}
        </Button>
      </div>
      {allocate.error && (
        <p className="text-sm text-brand-red">{allocate.error.message}</p>
      )}
    </div>
  );
}

/** The regulation: how many sets each entry may use across the meeting. */
function AllowanceField({
  eventId,
  allowance,
}: {
  eventId: string;
  allowance: number | null;
}) {
  const utils = api.useUtils();
  const [value, setValue] = useState(allowance ? String(allowance) : "");
  const update = api.event.update.useMutation({
    onSuccess: () => {
      utils.car.tireSetsForEvent.invalidate({ eventId });
      utils.event.byId.invalidate({ eventId });
    },
  });

  return (
    <span className="flex items-center gap-2 text-sm">
      <label className="text-brand-black/60" htmlFor="tire-allowance">
        Allowance
      </label>
      <input
        id="tire-allowance"
        inputMode="numeric"
        className="w-20 rounded-md border border-brand-black/20 px-2 py-1 text-sm"
        placeholder="none"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() =>
          update.mutate({
            eventId,
            tireSetAllowance: value.trim() ? Number(value) : null,
          })
        }
      />
      {update.error && (
        <span className="text-xs text-brand-red">{update.error.message}</span>
      )}
    </span>
  );
}
