"use client";

import { api } from "@/lib/trpc/client";
import { carLabel, describeAllocation } from "@/lib/cars";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * What the entrant declares about the car itself: which chassis is being
 * entered, which transponder is fitted, and how the tire allocation stands.
 *
 * The transponder matters more than it looks — a real timing system emits
 * transponder numbers and has no idea what a registration is, so an entry with
 * none is one the feed cannot place.
 */
export function EntryEquipment({
  registrationId,
}: {
  registrationId: string;
}) {
  const utils = api.useUtils();
  const cars = api.car.mine.useQuery();
  const transponders = api.car.myTransponders.useQuery();
  const tires = api.car.myTireAllocation.useQuery(
    { registrationId },
    { retry: false },
  );
  const entry = api.car.forRegistration.useQuery({ registrationId });

  const refresh = () => {
    utils.car.forRegistration.invalidate({ registrationId });
    utils.car.myTireAllocation.invalidate({ registrationId });
  };

  const setCar = api.car.setEntryCar.useMutation({ onSuccess: refresh });
  const assign = api.car.assignTransponder.useMutation({ onSuccess: refresh });
  const remove = api.car.removeTransponder.useMutation({ onSuccess: refresh });

  const assigned = entry.data?.transponders ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Car &amp; equipment</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="block text-sm font-medium">
          Car
          <select
            className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
            value={entry.data?.carId ?? ""}
            onChange={(e) =>
              setCar.mutate({
                registrationId,
                carId: e.target.value || null,
              })
            }
          >
            <option value="">Not declared</option>
            {cars.data
              ?.filter((car) => car.active || car.id === entry.data?.carId)
              .map((car) => (
                <option key={car.id} value={car.id}>
                  {carLabel(car)}
                  {car.team ? ` · ${car.team.name}` : ""}
                </option>
              ))}
          </select>
        </label>
        {cars.data?.length === 0 && (
          <p className="text-xs text-brand-black/60">
            No cars on your books yet. Adding one under your team&rsquo;s garage
            means results follow the chassis as well as the team.
          </p>
        )}
        {setCar.error && (
          <p className="text-sm text-brand-red">{setCar.error.message}</p>
        )}

        <div className="space-y-2">
          <p className="text-sm font-medium">Transponder</p>
          {assigned.length === 0 ? (
            <p className="text-xs text-brand-black/60">
              None fitted. Timing systems key on the transponder, so an entry
              without one has to be placed by hand.
            </p>
          ) : (
            <ul className="space-y-1">
              {assigned.map((assignment) => (
                <li
                  key={assignment.id}
                  className="flex flex-wrap items-center justify-between gap-2 text-sm"
                >
                  <span className="flex items-center gap-2">
                    <span className="font-mono">
                      {assignment.transponder.number}
                    </span>
                    {assignment.isPrimary && (
                      <Badge variant="verified">Primary</Badge>
                    )}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={remove.isPending}
                    onClick={() =>
                      remove.mutate({ assignmentId: assignment.id })
                    }
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {transponders.data && transponders.data.length > 0 && (
            <select
              aria-label="Fit a transponder"
              className="w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
              value=""
              onChange={(e) => {
                if (!e.target.value) return;
                assign.mutate({
                  registrationId,
                  transponderId: e.target.value,
                  // The first unit fitted is the one the feed should see; a
                  // second is the endurance backup.
                  isPrimary: assigned.length === 0,
                });
              }}
            >
              <option value="">Fit a transponder…</option>
              {transponders.data
                .filter(
                  (unit) =>
                    unit.active &&
                    !assigned.some(
                      (assignment) => assignment.transponderId === unit.id,
                    ),
                )
                .map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.number}
                    {unit.make ? ` · ${unit.make}` : ""}
                  </option>
                ))}
            </select>
          )}
          {assign.error && (
            <p className="text-sm text-brand-red">{assign.error.message}</p>
          )}
        </div>

        {tires.data && tires.data.sets.length > 0 && (
          <div className="space-y-1 border-t border-brand-black/10 pt-3">
            <p className="text-sm font-medium">Tires</p>
            <p className="text-xs text-brand-black/60">
              {describeAllocation(tires.data.allocation)}
            </p>
            <ul className="flex flex-wrap gap-1.5">
              {tires.data.sets.map((set) => (
                <li
                  key={set.id}
                  className={`rounded-full px-2.5 py-0.5 text-xs ${
                    set.status === "VOID"
                      ? "bg-brand-black/5 text-brand-black/40 line-through"
                      : "bg-brand-black/5"
                  }`}
                >
                  {set.identifier}
                  {set.compound ? ` · ${set.compound}` : ""}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
