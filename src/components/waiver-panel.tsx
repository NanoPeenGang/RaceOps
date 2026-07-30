"use client";

import { useState } from "react";
import { api } from "@/lib/trpc/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Signing the event's waivers.
 *
 * The full wording is shown before the signature box rather than behind a
 * link, because a signature against text nobody was shown is the one thing
 * that makes an e-signature worthless. The version is sent back with the
 * signature, so wording that changes while the page is open is caught rather
 * than silently signed.
 */
export function WaiverPanel({
  eventId,
  registrationId,
}: {
  eventId: string;
  registrationId?: string;
}) {
  const utils = api.useUtils();
  const state = api.waiver.mine.useQuery(
    { eventId, role: "driver" },
    { retry: false },
  );

  if (state.error || !state.data) return null;
  const { waivers, statuses, outstanding, capacity } = state.data;
  if (waivers.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Waivers</CardTitle>
          {outstanding.length === 0 ? (
            <Badge variant="verified">All signed</Badge>
          ) : (
            <Badge>
              {outstanding.length} to sign
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {outstanding.length > 0 && (
          <p className="text-sm text-brand-black/70">
            Your entry cannot be confirmed until these are signed. Nobody can
            sign them on your behalf.
          </p>
        )}
        {waivers.map((waiver) => {
          const status = statuses.find((s) => s.waiverId === waiver.id);
          if (!status) return null;
          return (
            <WaiverItem
              key={waiver.id}
              waiver={waiver}
              status={status}
              capacity={capacity[waiver.id] ?? "self"}
              registrationId={registrationId}
              onSigned={() => utils.waiver.mine.invalidate({ eventId })}
            />
          );
        })}
      </CardContent>
    </Card>
  );
}

function WaiverItem({
  waiver,
  status,
  capacity,
  registrationId,
  onSigned,
}: {
  waiver: {
    id: string;
    title: string;
    body: string;
    version: number;
    required: boolean;
    minSigningAge: number | null;
  };
  status: { signed: boolean; signedOldVersion: boolean; required: boolean };
  capacity: string;
  registrationId?: string;
  onSigned: () => void;
}) {
  const [open, setOpen] = useState(!status.signed);
  const [signedName, setSignedName] = useState("");
  const [guardianName, setGuardianName] = useState("");
  const [guardianRelation, setGuardianRelation] = useState("");

  const sign = api.waiver.sign.useMutation({ onSuccess: onSigned });
  const needsGuardian = capacity === "guardian";

  return (
    <div className="space-y-2 border-t border-brand-black/10 pt-3 first:border-0 first:pt-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium">
            {waiver.title}{" "}
            <span className="text-xs font-normal text-brand-black/50">
              v{waiver.version}
            </span>
          </p>
          {status.signedOldVersion && (
            <p className="text-xs text-brand-red">
              You signed an earlier version. The wording has changed and needs
              signing again.
            </p>
          )}
          {!waiver.required && (
            <p className="text-xs text-brand-black/50">Optional</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {status.signed && <Badge variant="verified">Signed</Badge>}
          <Button
            size="sm"
            variant="outline"
            onClick={() => setOpen((current) => !current)}
          >
            {open ? "Hide" : status.signed ? "Read" : "Read & sign"}
          </Button>
        </div>
      </div>

      {open && (
        <div className="space-y-3">
          {/* The wording is the agreement. It is shown, not linked. */}
          <div className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-md border border-brand-black/10 bg-brand-black/[0.02] p-3 text-sm leading-relaxed">
            {waiver.body}
          </div>

          {!status.signed && (
            <>
              {capacity === "unknown" && waiver.minSigningAge && (
                <p className="text-sm text-brand-red">
                  This waiver may only be signed by someone {waiver.minSigningAge}{" "}
                  or over. Add your date of birth to your profile so we can tell
                  whether you can sign it yourself.
                </p>
              )}
              {needsGuardian && (
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="block text-sm font-medium">
                    Parent or guardian&rsquo;s name
                    <input
                      className="mt-1 w-full rounded-md border border-brand-black/20 px-2 py-1.5 text-sm"
                      value={guardianName}
                      onChange={(e) => setGuardianName(e.target.value)}
                    />
                  </label>
                  <label className="block text-sm font-medium">
                    Relationship
                    <input
                      className="mt-1 w-full rounded-md border border-brand-black/20 px-2 py-1.5 text-sm"
                      value={guardianRelation}
                      onChange={(e) => setGuardianRelation(e.target.value)}
                      placeholder="Parent"
                    />
                  </label>
                </div>
              )}
              <label className="block text-sm font-medium">
                Type your full name to sign
                <input
                  className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
                  value={signedName}
                  onChange={(e) => setSignedName(e.target.value)}
                  placeholder="Your name"
                />
              </label>
              <p className="text-xs text-brand-black/50">
                Signing records your name, the time, and the version of this
                document you were shown.
              </p>
              {sign.error && (
                <p className="text-sm text-brand-red">{sign.error.message}</p>
              )}
              <Button
                size="sm"
                variant="primary"
                disabled={
                  sign.isPending ||
                  signedName.trim().length < 2 ||
                  capacity === "unknown" ||
                  (needsGuardian && guardianName.trim().length < 2)
                }
                onClick={() =>
                  sign.mutate({
                    waiverId: waiver.id,
                    // Sent back so wording that changed while this page was
                    // open is caught rather than silently signed.
                    waiverVersion: waiver.version,
                    signedName: signedName.trim(),
                    registrationId,
                    guardianName: needsGuardian
                      ? guardianName.trim()
                      : undefined,
                    guardianRelation: needsGuardian
                      ? guardianRelation.trim() || undefined
                      : undefined,
                  })
                }
              >
                {sign.isPending ? "Signing…" : "Sign"}
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
