"use client";

import { useState } from "react";
import { WaiverAudience } from "@prisma/client";
import { api } from "@/lib/trpc/client";
import {
  WAIVER_AUDIENCE_DESCRIPTIONS,
  WAIVER_AUDIENCE_LABELS,
} from "@/lib/waivers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Waivers for an event, and the signatures collected against them.
 *
 * Editing the wording reissues the waiver as a new version and invalidates
 * every signature against the old text. That is the correct and unavoidable
 * consequence — people signed the old words — so the form says so plainly
 * rather than letting an organizer discover it afterwards.
 */
export function WaiversPanel({ eventId }: { eventId: string }) {
  const utils = api.useUtils();
  const waivers = api.waiver.forEvent.useQuery({ eventId });
  const [adding, setAdding] = useState(false);
  const [openSignatures, setOpenSignatures] = useState<string | null>(null);

  const refresh = () => {
    utils.waiver.forEvent.invalidate({ eventId });
    utils.waiver.mine.invalidate({ eventId });
  };

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold">Waivers</h2>
          <p className="text-sm text-brand-black/60">
            Signed by the participants themselves — an organizer cannot sign or
            waive one. Required waivers block entry confirmation.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setAdding((open) => !open)}
        >
          {adding ? "Cancel" : "Add waiver"}
        </Button>
      </div>

      {adding && (
        <WaiverForm
          eventId={eventId}
          onSaved={() => {
            refresh();
            setAdding(false);
          }}
        />
      )}

      {waivers.data?.length === 0 && !adding && (
        <p className="text-sm text-brand-black/60">
          No waivers. Real-world events almost always need at least an
          indemnity; a series-wide one covers every round.
        </p>
      )}

      <div className="space-y-2">
        {waivers.data?.map((waiver) => (
          <Card key={waiver.id}>
            <CardContent className="space-y-2 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium">
                    {waiver.title}{" "}
                    <span className="text-xs font-normal text-brand-black/50">
                      v{waiver.version}
                    </span>
                  </p>
                  <p className="text-xs text-brand-black/60">
                    {WAIVER_AUDIENCE_LABELS[waiver.audience]}
                    {waiver.required ? " · required" : " · optional"}
                    {waiver.minSigningAge
                      ? ` · ${waiver.minSigningAge}+ to sign for themselves`
                      : ""}
                    {waiver.eventId ? "" : " · series-wide"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {!waiver.active && <Badge variant="outline">Retired</Badge>}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setOpenSignatures((open) =>
                        open === waiver.id ? null : waiver.id,
                      )
                    }
                  >
                    {openSignatures === waiver.id ? "Hide" : "Signatures"}
                  </Button>
                </div>
              </div>

              {openSignatures === waiver.id && (
                <SignatureList waiverId={waiver.id} version={waiver.version} />
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

function SignatureList({
  waiverId,
  version,
}: {
  waiverId: string;
  version: number;
}) {
  const signatures = api.waiver.signatures.useQuery(
    { waiverId },
    { retry: false },
  );

  if (signatures.error) {
    return (
      <p className="text-sm text-brand-black/60">
        Only the series owner or an admin can read the signature record.
      </p>
    );
  }
  if (!signatures.data) return <p className="text-sm">Loading…</p>;
  if (signatures.data.items.length === 0) {
    return <p className="text-sm text-brand-black/60">Nobody has signed yet.</p>;
  }

  return (
    <ul className="space-y-1 border-t border-brand-black/10 pt-2 text-sm">
      {signatures.data.items.map((signature) => (
        <li
          key={signature.id}
          className="flex flex-wrap items-baseline justify-between gap-2"
        >
          <span>
            {signature.signedName}
            {signature.guardianName && (
              <span className="text-brand-black/60">
                {" "}
                · signed by {signature.guardianName}
                {signature.guardianRelation
                  ? ` (${signature.guardianRelation})`
                  : ""}
              </span>
            )}
            {signature.registration?.carNumber && (
              <span className="text-brand-black/60">
                {" "}
                · #{signature.registration.carNumber}
              </span>
            )}
          </span>
          <span className="text-xs text-brand-black/60">
            v{signature.waiverVersion}
            {signature.waiverVersion !== version ? " (superseded)" : ""} ·{" "}
            {new Date(signature.signedAt).toLocaleString()}
          </span>
        </li>
      ))}
    </ul>
  );
}

function WaiverForm({
  eventId,
  onSaved,
}: {
  eventId: string;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<WaiverAudience>(
    WaiverAudience.ALL_PARTICIPANTS,
  );
  const [required, setRequired] = useState(true);
  const [minSigningAge, setMinSigningAge] = useState("18");

  const create = api.waiver.create.useMutation({ onSuccess: onSaved });

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <label className="block text-sm font-medium">
          Title
          <input
            className="mt-1 w-full rounded-md border border-brand-black/20 px-2 py-1.5 text-sm"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Indemnity and assumption of risk"
          />
        </label>
        <label className="block text-sm font-medium">
          Wording
          <textarea
            rows={8}
            className="mt-1 w-full rounded-md border border-brand-black/20 px-2 py-1.5 text-sm"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="The full text participants will be shown and asked to agree to."
          />
        </label>
        <p className="text-xs text-brand-black/60">
          This exact text is what people sign. Changing it later reissues the
          waiver as a new version and every existing signature stops covering
          it — so get the wording from whoever writes your regulations.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block text-sm font-medium sm:col-span-2">
            Who must sign
            <select
              className="mt-1 w-full rounded-md border border-brand-black/20 px-2 py-1.5 text-sm"
              value={audience}
              onChange={(e) => setAudience(e.target.value as WaiverAudience)}
            >
              {Object.entries(WAIVER_AUDIENCE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs font-normal text-brand-black/60">
              {WAIVER_AUDIENCE_DESCRIPTIONS[audience]}
            </span>
          </label>
          <label className="block text-sm font-medium">
            Minimum signing age
            <input
              inputMode="numeric"
              className="mt-1 w-full rounded-md border border-brand-black/20 px-2 py-1.5 text-sm"
              value={minSigningAge}
              onChange={(e) => setMinSigningAge(e.target.value)}
              placeholder="No minimum"
            />
            <span className="mt-1 block text-xs font-normal text-brand-black/60">
              Below this, a guardian signs.
            </span>
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={required}
            onChange={(e) => setRequired(e.target.checked)}
          />
          Block entry confirmation until signed
        </label>
        {create.error && (
          <p className="text-sm text-brand-red">{create.error.message}</p>
        )}
        <Button
          size="sm"
          variant="primary"
          disabled={
            create.isPending || title.trim().length < 3 || body.trim().length < 20
          }
          onClick={() =>
            create.mutate({
              eventId,
              title: title.trim(),
              body: body.trim(),
              audience,
              required,
              minSigningAge: minSigningAge.trim()
                ? Number(minSigningAge)
                : undefined,
            })
          }
        >
          {create.isPending ? "Publishing…" : "Publish waiver"}
        </Button>
      </CardContent>
    </Card>
  );
}
