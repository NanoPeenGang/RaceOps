"use client";

import { useEffect, useState } from "react";
import { CredentialStatus } from "@prisma/client";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/trpc/root";
import { api } from "@/lib/trpc/client";
import {
  ALLOCATION_FIELD_LABELS,
  CREDENTIAL_STATUS_LABELS,
} from "@/lib/paddock";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * The allocation sheet and the accreditation list.
 *
 * A clashing allocation is reported rather than refused: an organizer moving
 * four entries around passes through clashing states, and blocking the
 * intermediate step makes the sheet unusable. What matters is that nobody
 * arrives on the Thursday to find two transporters in one bay.
 */
export function PaddockPanel({ eventId }: { eventId: string }) {
  const utils = api.useUtils();
  const sheet = api.paddock.forEvent.useQuery({ eventId }, { retry: false });
  const accreditation = api.paddock.credentialsForEvent.useQuery(
    { eventId },
    { retry: false },
  );
  const [tab, setTab] = useState<"places" | "passes">("places");

  const refresh = () => {
    utils.paddock.forEvent.invalidate({ eventId });
    utils.paddock.credentialsForEvent.invalidate({ eventId });
  };

  // Officials only; the query 403s for everyone else.
  if (sheet.error || sheet.isLoading) return null;
  const data = sheet.data!;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold">Paddock &amp; credentials</h2>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={tab === "places" ? "primary" : "outline"}
            onClick={() => setTab("places")}
          >
            Places
          </Button>
          <Button
            size="sm"
            variant={tab === "passes" ? "primary" : "outline"}
            onClick={() => setTab("passes")}
          >
            Passes
          </Button>
        </div>
      </div>

      {tab === "places" ? (
        <>
          {data.clashes.length > 0 && (
            <Card className="border-brand-red/40">
              <CardContent className="space-y-1 p-4">
                <p className="text-sm font-semibold text-brand-red">
                  {data.clashes.length} place
                  {data.clashes.length === 1 ? " is" : "s are"} double-booked
                </p>
                <ul className="text-xs text-brand-black/70">
                  {data.clashes.map((clash) => (
                    <li key={`${clash.field}-${clash.value}`}>
                      {ALLOCATION_FIELD_LABELS[clash.field]} {clash.value} —{" "}
                      {clash.registrationIds.length} entries
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {data.pitBoxOverflow !== null && data.pitBoxOverflow > 0 && (
            <p className="text-sm text-brand-red">
              {data.pitBoxOverflow} more pit box
              {data.pitBoxOverflow === 1 ? " has" : "es have"} been allocated
              than the circuit records ({data.pitBoxCount}).
            </p>
          )}

          {data.entries.length === 0 ? (
            <p className="text-sm text-brand-black/60">
              No confirmed entries to place yet.
            </p>
          ) : (
            <div className="space-y-2">
              {data.entries.map((entry) => (
                <AllocationRow
                  key={entry.registrationId}
                  entry={entry}
                  onSaved={refresh}
                />
              ))}
            </div>
          )}
        </>
      ) : (
        <AccreditationTab
          eventId={eventId}
          data={accreditation.data}
          onChanged={refresh}
        />
      )}
    </section>
  );
}

type RouterOutputs = inferRouterOutputs<AppRouter>;
type SheetEntry = RouterOutputs["paddock"]["forEvent"]["entries"][number];

function AllocationRow({
  entry,
  onSaved,
}: {
  entry: SheetEntry;
  onSaved: () => void;
}) {
  const toDraft = () => ({
    garage: entry.allocation?.garage ?? "",
    pitBox: entry.allocation?.pitBox ?? "",
    paddockSpace: entry.allocation?.paddockSpace ?? "",
    transporterBay: entry.allocation?.transporterBay ?? "",
  });
  const [draft, setDraft] = useState(toDraft);
  useEffect(() => setDraft(toDraft()), [entry.allocation]); // eslint-disable-line react-hooks/exhaustive-deps

  const allocate = api.paddock.allocate.useMutation({ onSuccess: onSaved });

  const save = () =>
    allocate.mutate({
      registrationId: entry.registrationId,
      garage: draft.garage.trim() || null,
      pitBox: draft.pitBox.trim() || null,
      paddockSpace: draft.paddockSpace.trim() || null,
      transporterBay: draft.transporterBay.trim() || null,
    });

  return (
    <Card>
      <CardContent className="grid gap-2 p-3 sm:grid-cols-[minmax(9rem,1fr)_repeat(4,minmax(5rem,1fr))_auto]">
        <p className="self-center text-sm font-medium">
          {entry.carNumber ? `#${entry.carNumber} ` : ""}
          {entry.label}
        </p>
        {(["garage", "pitBox", "paddockSpace", "transporterBay"] as const).map(
          (field) => (
            <input
              key={field}
              aria-label={ALLOCATION_FIELD_LABELS[field]}
              placeholder={ALLOCATION_FIELD_LABELS[field]}
              className="rounded-md border border-brand-black/20 px-2 py-1.5 text-sm"
              value={draft[field]}
              onChange={(e) =>
                setDraft((current) => ({ ...current, [field]: e.target.value }))
              }
              onBlur={save}
            />
          ),
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={allocate.isPending}
          onClick={save}
        >
          {allocate.isPending ? "Saving…" : "Save"}
        </Button>
      </CardContent>
    </Card>
  );
}

type Accreditation = RouterOutputs["paddock"]["credentialsForEvent"];

function AccreditationTab({
  eventId,
  data,
  onChanged,
}: {
  eventId: string;
  data: Accreditation | undefined;
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  if (!data) return <p className="text-sm text-brand-black/60">Loading…</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-3 text-xs text-brand-black/60">
          {data.issuance.length === 0 ? (
            <span>No pass types defined yet.</span>
          ) : (
            data.issuance.map((type) => (
              <span key={type.typeId}>
                {type.typeName}: {type.issued}
                {type.totalAvailable !== null ? ` / ${type.totalAvailable}` : ""}
                {type.exhausted ? " (exhausted)" : ""}
              </span>
            ))
          )}
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setAdding((open) => !open)}
        >
          {adding ? "Cancel" : "Add pass type"}
        </Button>
      </div>

      {adding && (
        <AddTypeForm
          eventId={eventId}
          onSaved={() => {
            onChanged();
            setAdding(false);
          }}
        />
      )}

      {data.credentials.length === 0 ? (
        <p className="text-sm text-brand-black/60">
          Nobody named yet. Teams request passes for their own crew from their
          entry; you approve them here.
        </p>
      ) : (
        <ul className="space-y-1">
          {data.credentials.map((credential) => (
            <li
              key={credential.id}
              className="flex flex-wrap items-center justify-between gap-2 border-b border-brand-black/5 py-2 text-sm last:border-0"
            >
              <span>
                <span className="font-medium">{credential.holderName}</span>
                <span className="text-brand-black/60">
                  {" "}
                  · {credential.credentialType.name}
                  {credential.holderRole ? ` · ${credential.holderRole}` : ""}
                  {credential.registration
                    ? ` · ${credential.registration.carNumber ? `#${credential.registration.carNumber} ` : ""}${
                        credential.registration.team?.name ??
                        credential.registration.entrantUser?.profile
                          ?.displayName ??
                        "Entry"
                      }`
                    : " · no entry"}
                </span>
              </span>
              <StatusButtons credential={credential} onSaved={onChanged} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StatusButtons({
  credential,
  onSaved,
}: {
  credential: { id: string; status: CredentialStatus };
  onSaved: () => void;
}) {
  const update = api.paddock.setCredentialStatus.useMutation({
    onSuccess: onSaved,
  });
  return (
    <span className="flex flex-wrap gap-1">
      {Object.values(CredentialStatus).map((status) => (
        <Button
          key={status}
          size="sm"
          variant={status === credential.status ? "primary" : "outline"}
          disabled={update.isPending}
          onClick={() =>
            update.mutate({ credentialId: credential.id, status })
          }
        >
          {CREDENTIAL_STATUS_LABELS[status]}
        </Button>
      ))}
    </span>
  );
}

function AddTypeForm({
  eventId,
  onSaved,
}: {
  eventId: string;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [allowancePerEntry, setAllowance] = useState("4");
  const [totalAvailable, setTotal] = useState("");

  const add = api.paddock.addCredentialType.useMutation({ onSuccess: onSaved });

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <p className="text-xs text-brand-black/60">
          Whatever this event calls its passes. A club meeting issues one
          &ldquo;working pass&rdquo;; a pro round splits paddock, pit lane and
          grid.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block text-sm font-medium">
            Name
            <input
              className="mt-1 w-full rounded-md border border-brand-black/20 px-2 py-1.5 text-sm"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Paddock"
            />
          </label>
          <label className="block text-sm font-medium">
            Per entry
            <input
              inputMode="numeric"
              className="mt-1 w-full rounded-md border border-brand-black/20 px-2 py-1.5 text-sm"
              value={allowancePerEntry}
              onChange={(e) => setAllowance(e.target.value)}
            />
          </label>
          <label className="block text-sm font-medium">
            Total available
            <input
              inputMode="numeric"
              className="mt-1 w-full rounded-md border border-brand-black/20 px-2 py-1.5 text-sm"
              value={totalAvailable}
              onChange={(e) => setTotal(e.target.value)}
              placeholder="No cap"
            />
          </label>
        </div>
        {add.error && <p className="text-sm text-brand-red">{add.error.message}</p>}
        <Button
          size="sm"
          variant="primary"
          disabled={add.isPending || name.trim().length === 0}
          onClick={() =>
            add.mutate({
              eventId,
              name: name.trim(),
              allowancePerEntry: Number(allowancePerEntry) || 0,
              totalAvailable: totalAvailable.trim()
                ? Number(totalAvailable)
                : undefined,
            })
          }
        >
          {add.isPending ? "Adding…" : "Add pass type"}
        </Button>
      </CardContent>
    </Card>
  );
}
