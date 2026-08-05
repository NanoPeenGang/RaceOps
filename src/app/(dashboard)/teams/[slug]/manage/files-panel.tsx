"use client";

import { useState } from "react";
import { GarageFileKind } from "@prisma/client";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/trpc/root";
import { api } from "@/lib/trpc/client";
import {
  GARAGE_FILE_DESCRIPTIONS,
  GARAGE_FILE_LABELS,
  GARAGE_FILE_ORDER,
  formatFileSize,
  formatLapTime,
  groupByKind,
  parseLapTime,
} from "@/lib/garage-files";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Telemetry, setups and the rest of the crew's file library.
 *
 * Filterable by car and circuit because the query this exists for is never
 * "list the files" — it is "the setup we ran here last time, and what came out
 * of it". A flat list sorted by date answers that only by accident.
 */
export function FilesPanel({ teamId }: { teamId: string }) {
  const utils = api.useUtils();
  const [carId, setCarId] = useState<string>("");
  const [kind, setKind] = useState<GarageFileKind | "">("");
  const [adding, setAdding] = useState(false);

  const cars = api.car.forTeam.useQuery({ teamId });
  const library = api.garage.files.useQuery({
    teamId,
    ...(carId ? { carId } : {}),
    ...(kind ? { kind } : {}),
  });

  const refresh = () => utils.garage.files.invalidate();

  const files = library.data?.files ?? [];
  const canWrite = library.data?.canWrite ?? false;
  const groups = groupByKind(files);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold">Telemetry &amp; setups</h2>
          <p className="text-sm text-brand-black/60">
            Data and setup sheets, filed against the car and the circuit they
            came from.
          </p>
        </div>
        {canWrite && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setAdding((open) => !open)}
          >
            {adding ? "Cancel" : "Add a file"}
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <select
          className="rounded-md border border-brand-black/20 px-3 py-1.5 text-sm"
          value={kind}
          onChange={(event) =>
            setKind(event.target.value as GarageFileKind | "")
          }
        >
          <option value="">All kinds</option>
          {GARAGE_FILE_ORDER.map((option) => (
            <option key={option} value={option}>
              {GARAGE_FILE_LABELS[option]}
            </option>
          ))}
        </select>
        <select
          className="rounded-md border border-brand-black/20 px-3 py-1.5 text-sm"
          value={carId}
          onChange={(event) => setCarId(event.target.value)}
        >
          <option value="">All cars</option>
          {(cars.data ?? []).map((car) => (
            <option key={car.id} value={car.id}>
              {car.name}
            </option>
          ))}
        </select>
      </div>

      {adding && (
        <FileForm
          teamId={teamId}
          cars={cars.data ?? []}
          onSaved={() => {
            setAdding(false);
            refresh();
          }}
        />
      )}

      {library.isLoading && (
        <p className="text-sm text-brand-black/60">Loading files…</p>
      )}
      {library.error && (
        <p className="text-sm text-brand-red">{library.error.message}</p>
      )}

      {!library.isLoading && files.length === 0 && !adding && (
        <p className="rounded-lg border border-dashed border-brand-black/20 p-6 text-center text-sm text-brand-black/55">
          Nothing filed yet. A setup with the circuit and the lap time on it is
          worth more in six months than the file itself.
        </p>
      )}

      {groups.map((group) => (
        <div key={group.kind} className="space-y-2">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-brand-black/50">
              {GARAGE_FILE_LABELS[group.kind]}
            </h3>
            <p className="text-xs text-brand-black/50">
              {GARAGE_FILE_DESCRIPTIONS[group.kind]}
            </p>
          </div>
          {group.files.map((file) => (
            <FileRow
              key={file.id}
              file={file}
              canWrite={canWrite}
              onChanged={refresh}
            />
          ))}
        </div>
      ))}
    </section>
  );
}

type GarageFile =
  inferRouterOutputs<AppRouter>["garage"]["files"]["files"][number];

function FileRow({
  file,
  canWrite,
  onChanged,
}: {
  file: GarageFile;
  canWrite: boolean;
  onChanged: () => void;
}) {
  const remove = api.garage.removeFile.useMutation({ onSuccess: onChanged });
  const lap = formatLapTime(file.bestLapMs);

  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <a
              href={file.url}
              target="_blank"
              rel="noreferrer noopener"
              className="font-medium text-brand-red hover:underline"
            >
              {file.name} ↗
            </a>
            <p className="text-xs text-brand-black/60">
              {[
                file.car?.name,
                file.trackLayout &&
                  `${file.trackLayout.track.name} — ${file.trackLayout.name}`,
                file.event?.name,
                file.driver?.profile?.displayName,
                file.conditions,
              ]
                .filter(Boolean)
                .join(" · ") || "No context recorded"}
            </p>
          </div>
          {lap && <Badge variant="verified">{lap}</Badge>}
        </div>

        {file.notes && (
          <p className="whitespace-pre-wrap text-sm text-brand-black/75">
            {file.notes}
          </p>
        )}

        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-brand-black/50">
          <span>{formatFileSize(file.sizeBytes)}</span>
          <span>{new Date(file.createdAt).toLocaleDateString()}</span>
          {file.uploadedBy?.profile?.displayName && (
            <span>{file.uploadedBy.profile.displayName}</span>
          )}
          {file.tags.map((tag) => (
            <span key={tag} className="rounded bg-brand-black/5 px-1.5 py-0.5">
              {tag}
            </span>
          ))}
          {canWrite && (
            <button
              type="button"
              className="hover:text-brand-red"
              disabled={remove.isPending}
              onClick={() => remove.mutate({ fileId: file.id })}
            >
              Remove
            </button>
          )}
        </p>
        {remove.error && (
          <p className="text-xs text-brand-red">{remove.error.message}</p>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Adding a file.
 *
 * Upload when the deployment has a bucket, paste a link when it does not —
 * the same fallback the rest of the platform uses, because a file picker that
 * always fails is worse than an honest URL box.
 */
function FileForm({
  teamId,
  cars,
  onSaved,
}: {
  teamId: string;
  cars: { id: string; name: string }[];
  onSaved: () => void;
}) {
  const [kind, setKind] = useState<GarageFileKind>(GarageFileKind.SETUP);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [carId, setCarId] = useState("");
  const [conditions, setConditions] = useState("");
  const [lap, setLap] = useState("");
  const [notes, setNotes] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const config = api.upload.config.useQuery();
  const presign = api.upload.createUploadUrl.useMutation();
  const add = api.garage.addFile.useMutation({ onSuccess: onSaved });

  const bestLapMs = parseLapTime(lap);
  const lapTyped = lap.trim().length > 0;

  async function upload(file: File) {
    setUploadError(null);
    setUploading(true);
    try {
      const signed = await presign.mutateAsync({
        purpose: "garage",
        contentType: file.type || "application/octet-stream",
        fileName: file.name,
        sizeBytes: file.size,
      });
      const response = await fetch(signed.uploadUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type || "application/octet-stream" },
      });
      if (!response.ok) throw new Error(`Upload failed (${response.status})`);
      setUrl(signed.publicUrl);
      if (!name.trim()) setName(file.name);
    } catch (error) {
      setUploadError(
        error instanceof Error ? error.message : "That upload did not finish.",
      );
    } finally {
      setUploading(false);
    }
  }

  return (
    <Card className="max-w-3xl">
      <CardContent className="space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="block text-sm font-medium">
            Kind
            <select
              className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
              value={kind}
              onChange={(event) =>
                setKind(event.target.value as GarageFileKind)
              }
            >
              {GARAGE_FILE_ORDER.map((option) => (
                <option key={option} value={option}>
                  {GARAGE_FILE_LABELS[option]}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium sm:col-span-2">
            Name
            <input
              className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Sebring race setup, softer rear bar"
            />
          </label>
        </div>

        {config.data?.enabled && (
          <label className="block text-sm font-medium">
            Upload a file
            <input
              type="file"
              className="mt-1 block w-full text-sm"
              disabled={uploading}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload(file);
              }}
            />
          </label>
        )}

        <label className="block text-sm font-medium">
          {config.data?.enabled ? "…or paste a link" : "Link to the file"}
          <input
            className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://…"
          />
        </label>

        <div className="grid gap-4 sm:grid-cols-3">
          <label className="block text-sm font-medium">
            Car
            <select
              className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
              value={carId}
              onChange={(event) => setCarId(event.target.value)}
            >
              <option value="">—</option>
              {cars.map((car) => (
                <option key={car.id} value={car.id}>
                  {car.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium">
            Conditions
            <input
              className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
              value={conditions}
              onChange={(event) => setConditions(event.target.value)}
              placeholder="damp, 12°C, green"
            />
          </label>
          <label className="block text-sm font-medium">
            Best lap
            <input
              className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
              value={lap}
              onChange={(event) => setLap(event.target.value)}
              placeholder="1:43.271"
            />
            {lapTyped && bestLapMs === null && (
              <span className="mt-1 block text-xs text-brand-red">
                Try 1:43.271 or 103.271.
              </span>
            )}
          </label>
        </div>

        <label className="block text-sm font-medium">
          Notes
          <textarea
            rows={3}
            className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="What changed, and what it did."
          />
        </label>

        {uploadError && <p className="text-sm text-brand-red">{uploadError}</p>}
        {add.error && (
          <p className="text-sm text-brand-red">{add.error.message}</p>
        )}

        <Button
          variant="primary"
          disabled={
            add.isPending ||
            uploading ||
            name.trim().length < 1 ||
            url.trim().length < 1 ||
            (lapTyped && bestLapMs === null)
          }
          onClick={() =>
            add.mutate({
              teamId,
              kind,
              name: name.trim(),
              url: url.trim(),
              carId: carId || null,
              conditions: conditions.trim() || null,
              bestLapMs,
              notes: notes.trim() || null,
              tags: [],
            })
          }
        >
          {uploading ? "Uploading…" : add.isPending ? "Saving…" : "Add file"}
        </Button>
      </CardContent>
    </Card>
  );
}
