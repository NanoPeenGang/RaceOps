"use client";

import { api } from "@/lib/trpc/client";
import { TEAM_ROLE_LABELS } from "@/lib/teams";
import {
  driversWithoutSeatTime,
  formatMinutes,
  seatTimeBalance,
} from "@/lib/seat-time";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Who has been in the car this season.
 *
 * The event line-up panel answers "is this entry legal". This answers the
 * question asked between events and which nothing else can: who is owed a run.
 * That is why drivers with *no* seat time are listed explicitly — they are
 * invisible in a table built from stints, and they are the whole point.
 */
export function SeatTimePanel({ teamId }: { teamId: string }) {
  const seatTime = api.garage.seatTime.useQuery(
    { teamId },
    { meta: { silenceError: true } },
  );

  if (seatTime.isLoading) {
    return <p className="text-sm text-brand-black/60">Loading seat time…</p>;
  }
  if (seatTime.error) {
    return <p className="text-sm text-brand-red">{seatTime.error.message}</p>;
  }

  const data = seatTime.data!;
  const names = new Map(
    data.roster.map((member) => [member.userId, member.displayName]),
  );
  const balance = seatTimeBalance(data.drivers);

  const rosterDrivers = data.roster
    .filter((member) => member.role === "DRIVER")
    .map((member) => member.userId);
  const unseated = driversWithoutSeatTime(rosterDrivers, data.drivers);

  const longest = data.drivers[0]?.totalMinutes ?? 0;

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Seat time</h2>
        <p className="text-sm text-brand-black/60">
          Time in the car across every event this team has entered.
        </p>
      </div>

      {data.drivers.length === 0 ? (
        <p className="rounded-lg border border-dashed border-brand-black/20 p-6 text-center text-sm text-brand-black/55">
          No stints logged yet. Seat time is built from the stints recorded
          against each entry, so it fills in as the season runs.
        </p>
      ) : (
        <Card>
          <CardContent className="space-y-3 p-4">
            {data.drivers.map((driver) => (
              <div key={driver.userId} className="space-y-1">
                <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                  <span className="font-medium">
                    {names.get(driver.userId) ?? "Unnamed"}
                    {driver.inCar && (
                      <Badge variant="verified" className="ml-2">
                        In the car
                      </Badge>
                    )}
                  </span>
                  <span className="tabular-nums text-brand-black/70">
                    {formatMinutes(driver.totalMinutes)}
                    <span className="ml-2 text-xs text-brand-black/50">
                      {driver.stintCount} stint
                      {driver.stintCount === 1 ? "" : "s"} · {driver.eventCount}{" "}
                      event
                      {driver.eventCount === 1 ? "" : "s"}
                      {driver.laps > 0 && ` · ${driver.laps} laps`}
                    </span>
                  </span>
                </div>
                {/* Bar widths are relative to the busiest driver, not to the
                    total: comparing drivers to each other is the point, and a
                    share-of-total bar makes every driver on a four-car team
                    look idle. */}
                <div className="h-1.5 overflow-hidden rounded-full bg-brand-black/10">
                  <div
                    className="h-full rounded-full bg-brand-red"
                    style={{
                      width: `${longest > 0 ? (driver.totalMinutes / longest) * 100 : 0}%`,
                    }}
                  />
                </div>
                {driver.lastEventName && (
                  <p className="text-xs text-brand-black/50">
                    Last out at {driver.lastEventName}
                    {driver.lastEventDate &&
                      ` · ${new Date(driver.lastEventDate).toLocaleDateString()}`}
                    {` · longest stint ${formatMinutes(driver.longestStintMinutes)}`}
                  </p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-brand-black/55">
        <span>Team total: {formatMinutes(data.totalMinutes)}</span>
        {balance !== null && (
          <span>Split evenness: {Math.round(balance * 100)}%</span>
        )}
        {data.unattributedMinutes > 0 && (
          <span>
            {formatMinutes(data.unattributedMinutes)} from stints whose driver
            has since left a line-up — counted in the team total, not against
            anyone.
          </span>
        )}
      </div>

      {unseated.length > 0 && (
        <Card className="border-brand-black/20 bg-brand-black/[0.03]">
          <CardContent className="p-4 text-sm">
            <p className="font-medium">Not been out yet</p>
            <p className="text-brand-black/70">
              {unseated
                .map((userId) => names.get(userId) ?? "Unnamed")
                .join(", ")}{" "}
              — on the books as {TEAM_ROLE_LABELS.DRIVER.toLowerCase()}s with no
              stints logged.
            </p>
          </CardContent>
        </Card>
      )}
    </section>
  );
}
