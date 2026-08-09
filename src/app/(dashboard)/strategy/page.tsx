"use client";

import { useMemo, useState } from "react";
import { calculateFuelStrategy, planDriverRotation } from "@/lib/strategy";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page";

export default function StrategyPage() {
  const [raceMinutes, setRaceMinutes] = useState(60);
  const [avgLapSeconds, setAvgLapSeconds] = useState(105);
  const [fuelPerLap, setFuelPerLap] = useState(2.8);
  const [tankCapacity, setTankCapacity] = useState(104);
  const [drivers, setDrivers] = useState("Driver 1, Driver 2");
  const [maxStintMinutes, setMaxStintMinutes] = useState(65);

  const fuel = useMemo(() => {
    try {
      return calculateFuelStrategy({
        raceMinutes,
        avgLapSeconds,
        fuelPerLapLitres: fuelPerLap,
        tankCapacityLitres: tankCapacity,
      });
    } catch {
      return null;
    }
  }, [raceMinutes, avgLapSeconds, fuelPerLap, tankCapacity]);

  const rotation = useMemo(() => {
    const driverList = drivers
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean);
    try {
      return planDriverRotation({
        raceMinutes,
        drivers: driverList,
        maxStintMinutes,
      });
    } catch {
      return null;
    }
  }, [raceMinutes, drivers, maxStintMinutes]);

  return (
    <div className="space-y-8">
      <div>
        <PageHeader title="Pit Wall" />
        <p className="mt-1 text-brand-black/60">
          Fuel strategy, stint planning, and driver rotation — usable standalone
          or shared with your team.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Race parameters</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <NumberField
              label="Race length (min)"
              value={raceMinutes}
              onChange={setRaceMinutes}
            />
            <NumberField
              label="Avg lap (sec)"
              value={avgLapSeconds}
              onChange={setAvgLapSeconds}
            />
            <NumberField
              label="Fuel per lap (L)"
              value={fuelPerLap}
              onChange={setFuelPerLap}
              step={0.1}
            />
            <NumberField
              label="Tank capacity (L)"
              value={tankCapacity}
              onChange={setTankCapacity}
            />
            <label className="col-span-2 block text-sm font-medium">
              Drivers (comma-separated)
              <input
                className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
                value={drivers}
                onChange={(e) => setDrivers(e.target.value)}
              />
            </label>
            <NumberField
              label="Max stint (min)"
              value={maxStintMinutes}
              onChange={setMaxStintMinutes}
            />
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Fuel strategy</CardTitle>
            </CardHeader>
            <CardContent>
              {fuel ? (
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <Stat label="Total laps" value={fuel.totalLaps} />
                  <Stat
                    label="Total fuel"
                    value={`${fuel.totalFuelLitres} L`}
                  />
                  <Stat label="Pit stops" value={fuel.stops} />
                  <Stat label="Laps per stint" value={fuel.lapsPerStint} />
                  <Stat
                    label="Fuel per stint"
                    value={`${fuel.fuelPerStintLitres} L`}
                  />
                </dl>
              ) : (
                <p className="text-sm text-brand-red">
                  Check your inputs — all values must be positive and fuel per
                  lap must fit the tank.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Driver rotation</CardTitle>
            </CardHeader>
            <CardContent>
              {rotation ? (
                <ul className="space-y-1 text-sm">
                  {rotation.map((stint, i) => (
                    <li
                      key={i}
                      className="flex justify-between border-b border-brand-black/5 py-1 last:border-0"
                    >
                      <span className="font-medium">{stint.driver}</span>
                      <span className="text-brand-black/60">
                        {stint.startMinute}–{stint.endMinute} min
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-brand-red">
                  Add at least one driver and positive durations.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  step?: number;
}) {
  return (
    <label className="block text-sm font-medium">
      {label}
      <input
        type="number"
        step={step}
        className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-brand-black/60">{label}</dt>
      <dd className="text-lg font-semibold">{value}</dd>
    </div>
  );
}
