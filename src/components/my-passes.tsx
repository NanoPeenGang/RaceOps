"use client";

import Link from "next/link";
import { api } from "@/lib/trpc/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Section } from "@/components/ui/page";
import { zoneSummary } from "@/lib/credentials";
import { relativeDay } from "@/lib/dashboard";
import { eventVenueLabel } from "@/lib/tracks";

/**
 * The passes a person is holding, on the page they land on when they sign in.
 *
 * Accreditation only works if somebody arrives at a gate with the right thing
 * in their hand. Making them remember which event page it was on, at a circuit
 * with patchy signal, is how people end up queueing at the accreditation desk
 * for a pass that was issued three weeks ago.
 *
 * Renders nothing at all when there are no passes: an empty "Your passes" card
 * on the dashboard of somebody who has never been issued one is a permanent
 * reminder of a feature that does not apply to them.
 */
export function MyPasses() {
  const passes = api.paddock.myCredentials.useQuery();
  const credentials = passes.data?.credentials ?? [];

  if (credentials.length === 0) return null;

  return (
    <Section
      title="Your passes"
      description="Show the code at the gate. Each page works offline once it has loaded."
      actions={
        credentials.length > 2 ? (
          <Link href="/passes">
            <Button size="sm" variant="outline">
              All {credentials.length}
            </Button>
          </Link>
        ) : undefined
      }
    >
      <div className="space-y-2">
        {credentials.slice(0, 3).map((pass) => {
          const access = zoneSummary(pass.credentialType.zones);
          return (
            <Card key={pass.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
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
                  <p className="truncate text-sm text-brand-black/60">
                    {[
                      pass.event.series?.name,
                      eventVenueLabel(pass.event),
                      relativeDay(new Date(pass.event.date)),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {access && (
                    <p className="truncate text-xs text-brand-black/50">
                      {access}
                    </p>
                  )}
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
              </CardContent>
            </Card>
          );
        })}
      </div>
    </Section>
  );
}
