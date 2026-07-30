"use client";

import { use, useEffect, useState } from "react";
import { TrackDirection } from "@prisma/client";
import { api } from "@/lib/trpc/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatLapTime } from "@/lib/lap-time";
import {
  formatLength,
  TRACK_DIRECTION_LABELS,
  TRACK_KIND_LABELS,
  turnLabel,
} from "@/lib/tracks";

export default function TrackPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const track = api.track.bySlug.useQuery({ slug });
  const me = api.user.me.useQuery();
  const [openLayout, setOpenLayout] = useState<string | null>(null);

  if (track.isLoading) return <p className="text-brand-black/60">Loading…</p>;
  if (!track.data) return <p className="text-brand-black/60">Track not found.</p>;

  const data = track.data;
  const canCurate = Boolean(
    me.data?.id && data.createdById && me.data.id === data.createdById,
  );

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-bold">{data.name}</h1>
          <Badge>{TRACK_KIND_LABELS[data.kind]}</Badge>
          {data.licenceGrade && (
            <Badge variant="outline">{data.licenceGrade}</Badge>
          )}
        </div>
        <p className="text-sm text-brand-black/60">
          {[data.city, data.region, data.country].filter(Boolean).join(", ") ||
            "Location not given"}
          {data.pitBoxCount ? ` · ${data.pitBoxCount} pit boxes` : ""}
          {data.garageCount ? ` · ${data.garageCount} garages` : ""}
        </p>
        {data.notes && <p className="max-w-3xl text-sm">{data.notes}</p>}
        {!canCurate && (
          <p className="text-xs text-brand-black/50">
            Curated by{" "}
            {data.createdBy?.profile?.displayName ?? "someone who has left"}.
            Anyone can use these layouts on an event.
          </p>
        )}
      </header>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-semibold">Layouts</h2>
          {canCurate && <AddLayoutForm trackId={data.id} />}
        </div>

        <div className="space-y-3">
          {data.layouts.map((layout) => (
            <Card key={layout.id}>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="flex flex-wrap items-center gap-2">
                    {layout.name}
                    {layout.isPrimary && <Badge variant="verified">Default</Badge>}
                    {!layout.active && <Badge variant="outline">Inactive</Badge>}
                    {layout.platform && (
                      <Badge variant="outline">{layout.platform}</Badge>
                    )}
                  </CardTitle>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setOpenLayout((open) =>
                        open === layout.id ? null : layout.id,
                      )
                    }
                  >
                    {openLayout === layout.id ? "Hide" : "Turns & records"}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-brand-black/60">
                  {[
                    formatLength(layout.lengthMeters),
                    TRACK_DIRECTION_LABELS[layout.direction],
                    `${layout.turns.length} turn${layout.turns.length === 1 ? "" : "s"}`,
                    layout.sectors.length > 0
                      ? `${layout.sectors.length} sectors`
                      : null,
                    `${layout._count.events} event${layout._count.events === 1 ? "" : "s"}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>

                {openLayout === layout.id && (
                  <div className="space-y-5 border-t border-brand-black/10 pt-4">
                    <LapRecords layoutId={layout.id} />
                    {canCurate ? (
                      <TurnEditor
                        layoutId={layout.id}
                        turns={layout.turns}
                        onSaved={() => track.refetch()}
                      />
                    ) : (
                      <TurnList turns={layout.turns} />
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}

/** Read-only corner list, for everyone who does not curate the track. */
function TurnList({
  turns,
}: {
  turns: { id: string; number: number; name: string | null; sector: number | null }[];
}) {
  if (turns.length === 0) {
    return (
      <p className="text-sm text-brand-black/60">
        No corners defined yet, so incidents here fall back to free text.
      </p>
    );
  }
  return (
    <div>
      <h3 className="text-sm font-semibold">Corners</h3>
      <ul className="mt-2 flex flex-wrap gap-2">
        {turns.map((turn) => (
          <li
            key={turn.id}
            className="rounded-full bg-brand-black/5 px-3 py-1 text-xs"
          >
            {turnLabel(turn)}
            {turn.sector ? ` · S${turn.sector}` : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}

interface DraftTurn {
  number: number;
  name: string;
  sector: string;
  marshalPost: string;
}

/**
 * Corner numbering is edited as a set rather than row by row: adding a chicane
 * renumbers everything after it, and a half-applied renumber is worse than no
 * numbering at all.
 */
function TurnEditor({
  layoutId,
  turns,
  onSaved,
}: {
  layoutId: string;
  turns: {
    number: number;
    name: string | null;
    sector: number | null;
    marshalPost: string | null;
  }[];
  onSaved: () => void;
}) {
  const toDraft = (): DraftTurn[] =>
    turns.map((turn) => ({
      number: turn.number,
      name: turn.name ?? "",
      sector: turn.sector ? String(turn.sector) : "",
      marshalPost: turn.marshalPost ?? "",
    }));

  const [draft, setDraft] = useState<DraftTurn[]>(toDraft);
  // Re-seed when the saved turns change under us (another tab, a refetch).
  useEffect(() => {
    setDraft(
      turns.map((turn) => ({
        number: turn.number,
        name: turn.name ?? "",
        sector: turn.sector ? String(turn.sector) : "",
        marshalPost: turn.marshalPost ?? "",
      })),
    );
  }, [turns]);

  const save = api.track.setTurns.useMutation({ onSuccess: onSaved });

  const update = (index: number, patch: Partial<DraftTurn>) =>
    setDraft((rows) =>
      rows.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">Corners</h3>
      <p className="text-xs text-brand-black/60">
        Marshals report corners by name; stewards read them by number. Naming
        them here is what lets an incident point at one.
      </p>

      <div className="space-y-2">
        {draft.map((turn, index) => (
          <div
            key={index}
            className="grid gap-2 sm:grid-cols-[4rem_1fr_5rem_6rem_auto]"
          >
            <input
              type="number"
              min={1}
              aria-label="Turn number"
              className="rounded-md border border-brand-black/20 px-2 py-1 text-sm"
              value={turn.number}
              onChange={(e) =>
                update(index, { number: Number(e.target.value) || 1 })
              }
            />
            <input
              aria-label="Turn name"
              placeholder="Eau Rouge"
              className="rounded-md border border-brand-black/20 px-2 py-1 text-sm"
              value={turn.name}
              onChange={(e) => update(index, { name: e.target.value })}
            />
            <input
              type="number"
              min={1}
              aria-label="Sector"
              placeholder="S"
              className="rounded-md border border-brand-black/20 px-2 py-1 text-sm"
              value={turn.sector}
              onChange={(e) => update(index, { sector: e.target.value })}
            />
            <input
              aria-label="Marshal post"
              placeholder="Post 12"
              className="rounded-md border border-brand-black/20 px-2 py-1 text-sm"
              value={turn.marshalPost}
              onChange={(e) => update(index, { marshalPost: e.target.value })}
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                setDraft((rows) => rows.filter((_, i) => i !== index))
              }
            >
              Remove
            </Button>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            setDraft((rows) => [
              ...rows,
              {
                number:
                  rows.reduce((max, row) => Math.max(max, row.number), 0) + 1,
                name: "",
                sector: "",
                marshalPost: "",
              },
            ])
          }
        >
          Add corner
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={save.isPending}
          onClick={() =>
            save.mutate({
              layoutId,
              turns: draft.map((turn) => ({
                number: turn.number,
                name: turn.name.trim() || null,
                sector: turn.sector ? Number(turn.sector) : null,
                marshalPost: turn.marshalPost.trim() || null,
              })),
            })
          }
        >
          {save.isPending ? "Saving…" : "Save corners"}
        </Button>
      </div>
      {save.error && <p className="text-sm text-brand-red">{save.error.message}</p>}
    </div>
  );
}

/** Fastest admissible lap on this layout, overall and per class. */
function LapRecords({ layoutId }: { layoutId: string }) {
  const [dryOnly, setDryOnly] = useState(false);
  const records = api.track.records.useQuery({ layoutId, dryOnly });

  if (records.isLoading)
    return <p className="text-sm text-brand-black/60">Loading records…</p>;
  if (!records.data) return null;

  const { overall, byClass, lapsConsidered } = records.data;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Lap records</h3>
        <label className="flex items-center gap-2 text-xs text-brand-black/60">
          <input
            type="checkbox"
            checked={dryOnly}
            onChange={(e) => setDryOnly(e.target.checked)}
          />
          Dry sessions only
        </label>
      </div>

      {!overall ? (
        <p className="text-sm text-brand-black/60">
          No qualifying or race laps recorded here yet.
        </p>
      ) : (
        <>
          <p className="text-xs text-brand-black/50">
            From {lapsConsidered} best-lap record
            {lapsConsidered === 1 ? "" : "s"} across finished sessions.
          </p>
          <ul className="space-y-1 text-sm">
            <li className="flex flex-wrap items-baseline justify-between gap-2 rounded-md bg-brand-black/5 px-3 py-2">
              <span className="font-medium">
                Outright · {overall.competitorLabel}
              </span>
              <span className="tabular-nums">{formatLapTime(overall.lapMs)}</span>
              <span className="w-full text-xs text-brand-black/60">
                {overall.eventName} · {overall.sessionName} ·{" "}
                {new Date(overall.eventDate).toLocaleDateString()}
              </span>
            </li>
            {byClass.map((record) => (
              <li
                key={record.seriesClassKey}
                className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-1"
              >
                <span>
                  {record.seriesClassName} · {record.competitorLabel}
                </span>
                <span className="tabular-nums">
                  {formatLapTime(record.lapMs)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function AddLayoutForm({ trackId }: { trackId: string }) {
  const utils = api.useUtils();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [platform, setPlatform] = useState("");
  const [lengthMeters, setLengthMeters] = useState("");
  const [direction, setDirection] = useState<TrackDirection>(
    TrackDirection.CLOCKWISE,
  );

  const add = api.track.addLayout.useMutation({
    onSuccess: async () => {
      await utils.track.bySlug.invalidate();
      setOpen(false);
      setName("");
    },
  });

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Add layout
      </Button>
    );
  }

  return (
    <Card className="w-full">
      <CardContent className="space-y-3 p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-medium">
            Layout name
            <input
              className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Endurance"
            />
          </label>
          <label className="block text-sm font-medium">
            Sim platform
            <input
              className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
              placeholder="Leave blank for the real circuit"
            />
          </label>
          <label className="block text-sm font-medium">
            Length (metres)
            <input
              type="number"
              min={1}
              className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
              value={lengthMeters}
              onChange={(e) => setLengthMeters(e.target.value)}
            />
          </label>
          <label className="block text-sm font-medium">
            Direction
            <select
              className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
              value={direction}
              onChange={(e) => setDirection(e.target.value as TrackDirection)}
            >
              {Object.entries(TRACK_DIRECTION_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {add.error && <p className="text-sm text-brand-red">{add.error.message}</p>}
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="primary"
            disabled={add.isPending || name.trim().length === 0}
            onClick={() =>
              add.mutate({
                trackId,
                name: name.trim(),
                platform: platform.trim() || undefined,
                lengthMeters: lengthMeters ? Number(lengthMeters) : undefined,
                direction,
              })
            }
          >
            {add.isPending ? "Adding…" : "Add layout"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
