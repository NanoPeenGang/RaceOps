"use client";

import Link from "next/link";
import { api } from "@/lib/trpc/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/page";
import { ACCESS_ZONE_LABELS, sortZones } from "@/lib/credentials";
import { relativeDay } from "@/lib/dashboard";
import { eventVenueLabel } from "@/lib/tracks";

/**
 * Every pass a person holds, on its own page.
 *
 * The dashboard shows the same list, but this exists as a destination in its
 * own right for the moment it is actually needed: standing at a gate, on a
 * phone, wanting the shortest possible path from unlocking the screen to a
 * code somebody can scan. Two taps from the account menu, and each pass page
 * keeps working once loaded even where the signal does not.
 */
export default function PassesPage() {
  const passes = api.paddock.myCredentials.useQuery();
  const credentials = passes.data?.credentials ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Your passes"
        description="Accreditation issued to you. Show the code at the gate — a pass page keeps working once it has loaded, which matters in a paddock with no signal."
      />

      {passes.isLoading && <p className="text-brand-black/60">Loading…</p>}

      {!passes.isLoading && credentials.length === 0 && (
        <EmptyState
          title="No passes yet"
          description="Organizers issue these once your entry is confirmed, or once you are signed up to a shift. They will appear here and on your dashboard."
          action={
            <Link href="/events">
              <Button size="sm" variant="primary">
                Find an event
              </Button>
            </Link>
          }
        />
      )}

      <div className="space-y-3">
        {credentials.map((pass) => {
          const zones = sortZones(pass.credentialType.zones);
          return (
            <Card key={pass.id}>
              <CardContent className="space-y-3 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 font-medium">
                      {pass.event.name}
                      <Badge variant="verified">
                        {pass.credentialType.name}
                      </Badge>
                      {pass.registration?.carNumber && (
                        <Badge variant="outline">
                          #{pass.registration.carNumber}
                        </Badge>
                      )}
                    </p>
                    <p className="text-sm text-brand-black/60">
                      {[
                        pass.event.series?.name,
                        eventVenueLabel(pass.event),
                        relativeDay(new Date(pass.event.date)),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    <p className="text-sm text-brand-black/70">
                      {[pass.holderName, pass.holderRole]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {passes.data?.walletAvailable && (
                      <a href={`/api/passes/${pass.id}`}>
                        <Button size="sm" variant="outline">
                          Apple Wallet
                        </Button>
                      </a>
                    )}
                    <Link href={`/passes/${pass.id}`}>
                      <Button size="sm" variant="primary">
                        Show code
                      </Button>
                    </Link>
                  </div>
                </div>

                {zones.length > 0 && (
                  <ul className="flex flex-wrap gap-1.5 border-t border-brand-black/10 pt-3">
                    {zones.map((zone) => (
                      <li key={zone}>
                        <Badge variant="outline">
                          {ACCESS_ZONE_LABELS[zone]}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
