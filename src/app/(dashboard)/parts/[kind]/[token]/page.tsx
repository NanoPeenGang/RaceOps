import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { InventoryUnitStatus } from "@prisma/client";
import { serverApi } from "@/server/trpc/server-caller";
import { PART_CATEGORY_LABELS, stockLevel, STOCK_LEVEL_LABELS } from "@/lib/inventory";
import {
  expiryState,
  EXPIRY_STATE_LABELS,
  UNIT_STATUS_LABELS,
} from "@/lib/part-labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Where a label points when somebody scans it with the phone's own camera.
 *
 * Not everybody opens the station first. A crew member holding a box in the
 * shop points the camera at it to answer one question — what is this and how
 * many are left — and making them pick a direction before they can see that
 * would be answering a question they did not ask.
 *
 * Signed in and team-scoped, unlike a pass. A marshal on a gate has no
 * account, so a pass page is public; a parts shelf is nobody's business but
 * the team's, and a label photographed at a track should not leak the trailer.
 */

export const metadata: Metadata = {
  title: "Part · RaceOps",
  robots: { index: false, follow: false },
};

export default async function PartPage({
  params,
}: {
  params: Promise<{ kind: string; token: string }>;
}) {
  const { kind, token } = await params;
  if (kind !== "i" && kind !== "u") notFound();

  const api = await serverApi();
  const found = await api.garage.identify({ scanned: `/parts/${kind}/${token}` });

  if (!found.found) {
    return (
      <div className="mx-auto max-w-md space-y-3 p-4 text-center">
        <h1 className="text-xl font-semibold">Label not found</h1>
        <p className="text-sm text-brand-black/60">
          This label is not on any team you are on — or it belonged to a line
          that has since been reprinted. Peel it off and print a fresh one.
        </p>
        <Link href="/home" className="inline-block text-sm text-brand-red hover:underline">
          ← Home
        </Link>
      </div>
    );
  }

  const { item, team, canWrite } = found;
  const level = stockLevel(item);
  const unit = found.kind === "unit" ? found.unit : null;
  const expiry = unit ? expiryState(unit) : "none";

  return (
    <div className="mx-auto max-w-md space-y-4">
      <Link
        href={`/teams/${team.slug}/manage?tab=garage`}
        className="text-sm text-brand-red hover:underline"
      >
        ← {team.name} garage
      </Link>

      <Card>
        <CardContent className="space-y-3 p-5">
          <div>
            <h1 className="text-2xl font-bold">{item.name}</h1>
            <p className="text-sm text-brand-black/60">
              {[item.partNumber, item.location, PART_CATEGORY_LABELS[item.category]]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>

          {/* The number they came here for, before anything else. */}
          <div className="rounded-lg border border-brand-black/10 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-black/50">
              On the shelf
            </p>
            <p className="text-3xl font-bold tabular-nums">
              {item.quantity}{" "}
              <span className="text-base font-normal text-brand-black/60">
                {item.unit}
              </span>
            </p>
            <Badge variant={level === "ok" ? "outline" : "verified"}>
              {STOCK_LEVEL_LABELS[level]}
            </Badge>
          </div>

          {unit && (
            <div className="space-y-2 rounded-lg border border-brand-black/10 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-brand-black/50">
                This part
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {unit.serial && <p className="font-medium">{unit.serial}</p>}
                <Badge
                  variant={
                    unit.status === InventoryUnitStatus.IN_STOCK
                      ? "outline"
                      : "verified"
                  }
                >
                  {UNIT_STATUS_LABELS[unit.status]}
                </Badge>
                {expiry !== "none" && (
                  <Badge variant={expiry === "ok" ? "outline" : "verified"}>
                    {EXPIRY_STATE_LABELS[expiry]}
                  </Badge>
                )}
              </div>
              {unit.expiresOn && (
                <p className="text-sm text-brand-black/60">
                  Life runs out {unit.expiresOn.toISOString().slice(0, 10)}.
                </p>
              )}
            </div>
          )}

          {canWrite ? (
            <Link href={`/teams/${team.slug}/scan`} className="block">
              <Button variant="primary">Open the scanner</Button>
            </Link>
          ) : (
            <p className="text-sm text-brand-black/60">
              Managers, engineers and crew log stock in and out. You can see
              what is here.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
