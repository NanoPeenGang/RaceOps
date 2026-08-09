"use client";

import { useState } from "react";
import { api } from "@/lib/trpc/client";
import { CREDENTIAL_STATUS_LABELS, describeAllocation } from "@/lib/paddock";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Where the entry has been put, and who it has named on passes.
 *
 * Naming the crew is the half of accreditation that only the team can do, so
 * it happens here rather than on an organizer's spreadsheet. Requests land
 * unapproved; an official issues them.
 */
export function EntryCredentials({
  registrationId,
}: {
  registrationId: string;
}) {
  const utils = api.useUtils();
  const data = api.paddock.credentialsForRegistration.useQuery(
    { registrationId },
    { retry: false },
  );
  const [holderName, setHolderName] = useState("");
  const [holderRole, setHolderRole] = useState("");
  const [typeId, setTypeId] = useState("");

  const refresh = () =>
    utils.paddock.credentialsForRegistration.invalidate({ registrationId });

  const request = api.paddock.requestCredential.useMutation({
    meta: { silenceError: true },
    onSuccess: () => {
      refresh();
      setHolderName("");
      setHolderRole("");
    },
  });
  const remove = api.paddock.removeCredential.useMutation({
    onSuccess: refresh,
  });

  if (data.error || !data.data) return null;
  const { types, credentials, counts, allocation } = data.data;
  const place = describeAllocation(allocation);

  // An event that has defined no passes and allocated no places has nothing
  // to show; rendering an empty card would just be noise on the entry page.
  if (types.length === 0 && !place) return null;

  const selectedType = typeId || types[0]?.id || "";
  const selectedCount = counts.find((count) => count.typeId === selectedType);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Paddock &amp; passes</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="text-sm font-medium">Your place</p>
          <p className="text-sm text-brand-black/60">
            {place ??
              "Not allocated yet — organizers publish this before the event."}
          </p>
          {allocation?.notes && (
            <p className="mt-1 text-xs text-brand-black/60">
              {allocation.notes}
            </p>
          )}
        </div>

        {types.length > 0 && (
          <div className="space-y-3 border-t border-brand-black/10 pt-3">
            <div className="flex flex-wrap gap-3 text-xs text-brand-black/60">
              {counts.map((count) => (
                <span key={count.typeId}>
                  {count.typeName}: {count.used} of {count.allowance}
                  {count.overAllowance ? " (over)" : ""}
                </span>
              ))}
            </div>

            {credentials.length > 0 && (
              <ul className="space-y-1 text-sm">
                {credentials.map((credential) => (
                  <li
                    key={credential.id}
                    className="flex flex-wrap items-center justify-between gap-2"
                  >
                    <span>
                      {credential.holderName}
                      <span className="text-brand-black/60">
                        {" "}
                        · {credential.credentialType.name}
                        {credential.holderRole
                          ? ` · ${credential.holderRole}`
                          : ""}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      <Badge
                        variant={
                          credential.status === "COLLECTED" ||
                          credential.status === "ISSUED"
                            ? "verified"
                            : "default"
                        }
                      >
                        {CREDENTIAL_STATUS_LABELS[credential.status]}
                      </Badge>
                      {credential.status === "REQUESTED" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={remove.isPending}
                          onClick={() =>
                            remove.mutate({ credentialId: credential.id })
                          }
                        >
                          Remove
                        </Button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto]">
              <input
                aria-label="Name on the pass"
                className="rounded-md border border-brand-black/20 px-2 py-1.5 text-sm"
                placeholder="Name"
                value={holderName}
                onChange={(e) => setHolderName(e.target.value)}
              />
              <input
                aria-label="Role"
                className="rounded-md border border-brand-black/20 px-2 py-1.5 text-sm"
                placeholder="Mechanic"
                value={holderRole}
                onChange={(e) => setHolderRole(e.target.value)}
              />
              <select
                aria-label="Pass type"
                className="rounded-md border border-brand-black/20 px-2 py-1.5 text-sm"
                value={selectedType}
                onChange={(e) => setTypeId(e.target.value)}
              >
                {types.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.name}
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                variant="primary"
                disabled={
                  request.isPending ||
                  holderName.trim().length === 0 ||
                  !selectedType ||
                  (selectedCount?.remaining ?? 1) <= 0
                }
                onClick={() =>
                  request.mutate({
                    registrationId,
                    credentialTypeId: selectedType,
                    holderName: holderName.trim(),
                    holderRole: holderRole.trim() || undefined,
                  })
                }
              >
                {request.isPending ? "Requesting…" : "Request"}
              </Button>
            </div>
            {request.error && (
              <p className="text-sm text-brand-red">{request.error.message}</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
