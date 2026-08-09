"use client";

import { useState } from "react";
import { api } from "@/lib/trpc/client";
import { carLabel } from "@/lib/cars";
import { isTeamManager } from "@/lib/teams";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { TeamDashboard } from "./types";

/**
 * The team's cars and transponders.
 *
 * Cars are records rather than a free-text field on an entry so that results
 * follow the chassis as well as the team — the same car under three team names
 * over five seasons is one history, not three. Transponders sit here because
 * they are equipment a team owns and carries between meetings.
 */
export function GaragePanel({ team }: { team: TeamDashboard }) {
  const utils = api.useUtils();
  const canManage = isTeamManager(team.myRole);
  const cars = api.car.forTeam.useQuery({ teamId: team.id });
  const transponders = api.car.myTransponders.useQuery(undefined, {
    enabled: canManage,
  });
  const [addingCar, setAddingCar] = useState(false);
  const [addingTransponder, setAddingTransponder] = useState(false);

  const refresh = () => {
    utils.car.forTeam.invalidate({ teamId: team.id });
    utils.car.myTransponders.invalidate();
  };

  const teamTransponders =
    transponders.data?.filter((unit) => unit.team?.id === team.id) ?? [];

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold">Garage</h2>
        {canManage && (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setAddingCar((open) => !open)}
            >
              {addingCar ? "Cancel" : "Add car"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setAddingTransponder((open) => !open)}
            >
              {addingTransponder ? "Cancel" : "Add transponder"}
            </Button>
          </div>
        )}
      </div>

      {addingCar && (
        <AddCarForm
          teamId={team.id}
          onSaved={() => {
            refresh();
            setAddingCar(false);
          }}
        />
      )}

      {addingTransponder && (
        <AddTransponderForm
          teamId={team.id}
          onSaved={() => {
            refresh();
            setAddingTransponder(false);
          }}
        />
      )}

      {cars.data?.length === 0 && !addingCar && (
        <p className="text-sm text-brand-black/60">
          No cars on the books. Adding one lets entries carry the chassis, so
          results follow the car as well as the team.
        </p>
      )}

      <div className="space-y-2">
        {cars.data?.map((car) => (
          <Card key={car.id}>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <p className="font-medium">{carLabel(car)}</p>
                <p className="text-xs text-brand-black/60">
                  {[
                    car.classLabel,
                    car.engine,
                    car.chassisNumber ? `Chassis ${car.chassisNumber}` : null,
                    car.homologation
                      ? `Homologation ${car.homologation}`
                      : null,
                    `${car._count.registrations} entr${car._count.registrations === 1 ? "y" : "ies"}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {!car.active && <Badge variant="outline">Retired</Badge>}
                {canManage && <RetireButton car={car} onSaved={refresh} />}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {canManage && teamTransponders.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Transponders</h3>
          <ul className="flex flex-wrap gap-2">
            {teamTransponders.map((unit) => (
              <li
                key={unit.id}
                className="rounded-full bg-brand-black/5 px-3 py-1 text-xs"
              >
                {unit.number}
                {unit.make ? ` · ${unit.make}` : ""}
                {!unit.active ? " · inactive" : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function RetireButton({
  car,
  onSaved,
}: {
  car: { id: string; active: boolean };
  onSaved: () => void;
}) {
  const update = api.car.update.useMutation({ onSuccess: onSaved });
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={update.isPending}
      onClick={() => update.mutate({ carId: car.id, active: !car.active })}
    >
      {car.active ? "Retire" : "Return to service"}
    </Button>
  );
}

function AddCarForm({
  teamId,
  onSaved,
}: {
  teamId: string;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("");
  const [engine, setEngine] = useState("");
  const [chassisNumber, setChassisNumber] = useState("");
  const [homologation, setHomologation] = useState("");
  const [classLabel, setClassLabel] = useState("");

  const create = api.car.create.useMutation({
    meta: { silenceError: true },
    onSuccess: onSaved,
  });

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block text-sm font-medium">
            Name
            <input
              className="mt-1 w-full rounded-md border border-brand-black/20 px-2 py-1.5 text-sm"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Car 7"
            />
          </label>
          <label className="block text-sm font-medium">
            Make
            <input
              className="mt-1 w-full rounded-md border border-brand-black/20 px-2 py-1.5 text-sm"
              value={make}
              onChange={(e) => setMake(e.target.value)}
              placeholder="Porsche"
            />
          </label>
          <label className="block text-sm font-medium">
            Model
            <input
              className="mt-1 w-full rounded-md border border-brand-black/20 px-2 py-1.5 text-sm"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="911 GT3 R"
            />
          </label>
          <label className="block text-sm font-medium">
            Year
            <input
              inputMode="numeric"
              className="mt-1 w-full rounded-md border border-brand-black/20 px-2 py-1.5 text-sm"
              value={year}
              onChange={(e) => setYear(e.target.value)}
            />
          </label>
          <label className="block text-sm font-medium">
            Engine
            <input
              className="mt-1 w-full rounded-md border border-brand-black/20 px-2 py-1.5 text-sm"
              value={engine}
              onChange={(e) => setEngine(e.target.value)}
            />
          </label>
          <label className="block text-sm font-medium">
            Chassis number
            <input
              className="mt-1 w-full rounded-md border border-brand-black/20 px-2 py-1.5 text-sm"
              value={chassisNumber}
              onChange={(e) => setChassisNumber(e.target.value)}
            />
          </label>
          <label className="block text-sm font-medium">
            Homologation
            <input
              className="mt-1 w-full rounded-md border border-brand-black/20 px-2 py-1.5 text-sm"
              value={homologation}
              onChange={(e) => setHomologation(e.target.value)}
            />
          </label>
          <label className="block text-sm font-medium">
            Class it is built to
            <input
              className="mt-1 w-full rounded-md border border-brand-black/20 px-2 py-1.5 text-sm"
              value={classLabel}
              onChange={(e) => setClassLabel(e.target.value)}
              placeholder="GT3 / ST-X / Improved Production"
            />
          </label>
        </div>
        {create.error && (
          <p className="text-sm text-brand-red">{create.error.message}</p>
        )}
        <Button
          size="sm"
          variant="primary"
          disabled={create.isPending || name.trim().length === 0}
          onClick={() =>
            create.mutate({
              teamId,
              name: name.trim(),
              make: make.trim() || undefined,
              model: model.trim() || undefined,
              year: year.trim() ? Number(year) : undefined,
              engine: engine.trim() || undefined,
              chassisNumber: chassisNumber.trim() || undefined,
              homologation: homologation.trim() || undefined,
              classLabel: classLabel.trim() || undefined,
            })
          }
        >
          {create.isPending ? "Adding…" : "Add car"}
        </Button>
      </CardContent>
    </Card>
  );
}

function AddTransponderForm({
  teamId,
  onSaved,
}: {
  teamId: string;
  onSaved: () => void;
}) {
  const [number, setNumber] = useState("");
  const [make, setMake] = useState("");
  const register = api.car.registerTransponder.useMutation({
    onSuccess: onSaved,
  });

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <p className="text-xs text-brand-black/60">
          The number printed on the unit. Timing systems key on this rather than
          on the entry, so registering it is what lets a live feed be reconciled
          to the grid.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-medium">
            Number
            <input
              className="mt-1 w-full rounded-md border border-brand-black/20 px-2 py-1.5 text-sm"
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              placeholder="1234567"
            />
          </label>
          <label className="block text-sm font-medium">
            Make
            <input
              className="mt-1 w-full rounded-md border border-brand-black/20 px-2 py-1.5 text-sm"
              value={make}
              onChange={(e) => setMake(e.target.value)}
              placeholder="MyLaps X2"
            />
          </label>
        </div>
        {register.error && (
          <p className="text-sm text-brand-red">{register.error.message}</p>
        )}
        <Button
          size="sm"
          variant="primary"
          disabled={register.isPending || number.trim().length === 0}
          onClick={() =>
            register.mutate({
              teamId,
              number: number.trim(),
              make: make.trim() || undefined,
            })
          }
        >
          {register.isPending ? "Registering…" : "Register transponder"}
        </Button>
      </CardContent>
    </Card>
  );
}
