"use client";

import { useState } from "react";
import { ServiceKind, ServiceStatus } from "@prisma/client";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/trpc/root";
import { api } from "@/lib/trpc/client";
import {
  SERVICE_KIND_LABELS,
  SERVICE_STATUS_LABELS,
  SERVICE_URGENCY_LABELS,
  assessDue,
  isOpen,
} from "@/lib/service";
import type { ServiceUrgency } from "@/lib/service";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Car servicing: the work log, and what is coming due.
 *
 * Grouped by car rather than by date, because "is this car ready to load" is
 * the question, and it is asked one car at a time.
 */
export function ServicePanel({ teamId }: { teamId: string }) {
  const utils = api.useUtils();
  const services = api.garage.services.useQuery(
    { teamId },
    { meta: { silenceError: true } },
  );
  const [loggingFor, setLoggingFor] = useState<string | null>(null);

  const refresh = () => utils.garage.services.invalidate({ teamId });

  if (services.isLoading) {
    return <p className="text-sm text-brand-black/60">Loading service log…</p>;
  }
  if (services.error) {
    return <p className="text-sm text-brand-red">{services.error.message}</p>;
  }

  const cars = services.data?.cars ?? [];
  const canWrite = services.data?.canWrite ?? false;

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Car services</h2>
        <p className="text-sm text-brand-black/60">
          What has been done, and what is due — on the calendar or on running
          hours.
        </p>
      </div>

      {cars.length === 0 && (
        <p className="rounded-lg border border-dashed border-brand-black/20 p-6 text-center text-sm text-brand-black/55">
          No cars on this team yet. Add one in the garage above and its service
          history will live here.
        </p>
      )}

      {cars.map((car) => (
        <Card key={car.id}>
          <CardContent className="space-y-3 p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-medium">{car.name}</p>
                <HoursLine
                  carId={car.id}
                  runningHours={car.runningHours}
                  canWrite={canWrite}
                  onChanged={refresh}
                />
              </div>
              {canWrite && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setLoggingFor((current) =>
                      current === car.id ? null : car.id,
                    )
                  }
                >
                  {loggingFor === car.id ? "Cancel" : "Log work"}
                </Button>
              )}
            </div>

            {loggingFor === car.id && (
              <ServiceForm
                carId={car.id}
                onSaved={() => {
                  setLoggingFor(null);
                  refresh();
                }}
              />
            )}

            {car.due.length > 0 && (
              <ul className="space-y-1 rounded-lg bg-brand-black/[0.03] p-3 text-sm">
                {car.due.map(({ service, assessment }) => (
                  <li
                    key={service.id}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <UrgencyBadge urgency={assessment.urgency} />
                    <span className="font-medium">{service.component}</span>
                    <span className="text-brand-black/60">
                      {assessment.summary}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {car.services.length === 0 ? (
              <p className="text-sm text-brand-black/55">
                Nothing logged for this car yet.
              </p>
            ) : (
              <ul className="space-y-2">
                {car.services.map((service) => (
                  <ServiceRow
                    key={service.id}
                    service={service}
                    runningHours={car.runningHours}
                    canWrite={canWrite}
                    onChanged={refresh}
                  />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ))}
    </section>
  );
}

const URGENCY_TONE: Record<ServiceUrgency, string> = {
  overdue: "bg-brand-red text-on-red",
  "due-soon": "bg-amber-500 text-white",
  scheduled: "bg-brand-black/10 text-brand-black",
  unknown: "bg-brand-black/5 text-brand-black/60",
};

function UrgencyBadge({ urgency }: { urgency: ServiceUrgency }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${URGENCY_TONE[urgency]}`}
    >
      {SERVICE_URGENCY_LABELS[urgency]}
    </span>
  );
}

type ServiceCar =
  inferRouterOutputs<AppRouter>["garage"]["services"]["cars"][number];
type ServiceRecord = ServiceCar["services"][number];

function ServiceRow({
  service,
  runningHours,
  canWrite,
  onChanged,
}: {
  service: ServiceRecord;
  runningHours: number | null;
  canWrite: boolean;
  onChanged: () => void;
}) {
  const update = api.garage.updateService.useMutation({
    meta: { silenceError: true },
    onSuccess: onChanged,
  });
  const assessment = assessDue(service, runningHours);

  return (
    <li className="rounded-lg border border-brand-black/10 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium">
            {service.component}
            <span className="ml-2 text-xs font-normal text-brand-black/50">
              {SERVICE_KIND_LABELS[service.kind]}
            </span>
          </p>
          {service.description && (
            <p className="text-sm text-brand-black/70">{service.description}</p>
          )}
        </div>
        <Badge variant={isOpen(service.status) ? "verified" : "outline"}>
          {SERVICE_STATUS_LABELS[service.status]}
        </Badge>
      </div>

      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-brand-black/50">
        {service.performedOn && (
          <span>{new Date(service.performedOn).toLocaleDateString()}</span>
        )}
        {service.performedBy?.profile?.displayName && (
          <span>{service.performedBy.profile.displayName}</span>
        )}
        {service.event && <span>at {service.event.name}</span>}
        {service.hoursAtService != null && (
          <span>{service.hoursAtService.toFixed(1)}h on the car</span>
        )}
        {service._count.partsUsed > 0 && (
          <span>{service._count.partsUsed} parts used</span>
        )}
        {assessment.urgency !== "unknown" && <span>{assessment.summary}</span>}

        {canWrite && isOpen(service.status) && (
          <button
            type="button"
            className="hover:text-brand-black"
            disabled={update.isPending}
            onClick={() =>
              update.mutate({
                serviceId: service.id,
                status: ServiceStatus.DONE,
                performedOn: service.performedOn
                  ? new Date(service.performedOn)
                  : new Date(),
              })
            }
          >
            Mark done
          </button>
        )}
        {canWrite && service.status === ServiceStatus.PLANNED && (
          <button
            type="button"
            className="hover:text-brand-black"
            disabled={update.isPending}
            onClick={() =>
              update.mutate({
                serviceId: service.id,
                status: ServiceStatus.DEFERRED,
              })
            }
          >
            Defer
          </button>
        )}
      </p>
      {update.error && (
        <p className="text-xs text-brand-red">{update.error.message}</p>
      )}
    </li>
  );
}

/**
 * Running hours, editable inline.
 *
 * An interval quoted in hours means nothing without this figure, so the panel
 * says plainly when it is missing rather than quietly reporting every
 * hours-based job as fine.
 */
function HoursLine({
  carId,
  runningHours,
  canWrite,
  onChanged,
}: {
  carId: string;
  runningHours: number | null;
  canWrite: boolean;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(runningHours?.toString() ?? "");
  const save = api.garage.setRunningHours.useMutation({
    meta: { successMessage: "Running hours updated." },
    onSuccess: () => {
      setEditing(false);
      onChanged();
    },
  });

  if (editing) {
    return (
      <span className="mt-1 flex items-center gap-2 text-xs">
        <input
          type="number"
          step="0.1"
          min={0}
          className="w-24 rounded-md border border-brand-black/20 px-2 py-1"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          aria-label="Running hours"
        />
        <button
          type="button"
          className="text-brand-red hover:underline"
          disabled={save.isPending}
          onClick={() =>
            save.mutate({
              carId,
              runningHours: value.trim() ? Number(value) : null,
            })
          }
        >
          Save
        </button>
        <button
          type="button"
          className="text-brand-black/50 hover:underline"
          onClick={() => setEditing(false)}
        >
          Cancel
        </button>
      </span>
    );
  }

  return (
    <p className="text-xs text-brand-black/60">
      {runningHours == null
        ? "No running hours recorded"
        : `${runningHours.toFixed(1)} running hours`}
      {canWrite && (
        <button
          type="button"
          className="ml-2 hover:text-brand-black hover:underline"
          onClick={() => setEditing(true)}
        >
          edit
        </button>
      )}
    </p>
  );
}

function ServiceForm({
  carId,
  onSaved,
}: {
  carId: string;
  onSaved: () => void;
}) {
  const [component, setComponent] = useState("");
  const [kind, setKind] = useState<ServiceKind>(ServiceKind.SCHEDULED);
  const [status, setStatus] = useState<ServiceStatus>(ServiceStatus.DONE);
  const [description, setDescription] = useState("");
  const [nextDueOn, setNextDueOn] = useState("");
  const [nextDueHours, setNextDueHours] = useState("");

  const log = api.garage.logService.useMutation({ onSuccess: onSaved });

  return (
    <div className="space-y-3 rounded-lg border border-brand-black/10 p-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-sm font-medium sm:col-span-1">
          Component
          <input
            className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
            value={component}
            onChange={(event) => setComponent(event.target.value)}
            placeholder="Gearbox"
          />
        </label>
        <label className="block text-sm font-medium">
          Kind
          <select
            className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
            value={kind}
            onChange={(event) => setKind(event.target.value as ServiceKind)}
          >
            {Object.values(ServiceKind).map((option) => (
              <option key={option} value={option}>
                {SERVICE_KIND_LABELS[option]}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium">
          Status
          <select
            className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
            value={status}
            onChange={(event) => setStatus(event.target.value as ServiceStatus)}
          >
            {Object.values(ServiceStatus).map((option) => (
              <option key={option} value={option}>
                {SERVICE_STATUS_LABELS[option]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="block text-sm font-medium">
        What was done
        <textarea
          rows={2}
          className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-medium">
          Next due on <span className="text-brand-black/50">(optional)</span>
          <input
            type="date"
            className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
            value={nextDueOn}
            onChange={(event) => setNextDueOn(event.target.value)}
          />
        </label>
        <label className="block text-sm font-medium">
          …or at running hours
          <input
            type="number"
            step="0.1"
            min={0}
            className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
            value={nextDueHours}
            onChange={(event) => setNextDueHours(event.target.value)}
            placeholder="40"
          />
        </label>
      </div>

      {log.error && (
        <p className="text-sm text-brand-red">{log.error.message}</p>
      )}
      <Button
        size="sm"
        variant="primary"
        disabled={log.isPending || component.trim().length < 1}
        onClick={() =>
          log.mutate({
            carId,
            component: component.trim(),
            kind,
            status,
            description: description.trim() || null,
            performedOn: status === ServiceStatus.DONE ? new Date() : null,
            nextDueOn: nextDueOn ? new Date(`${nextDueOn}T00:00:00`) : null,
            nextDueHours: nextDueHours.trim() ? Number(nextDueHours) : null,
          })
        }
      >
        {log.isPending ? "Saving…" : "Log it"}
      </Button>
    </div>
  );
}
