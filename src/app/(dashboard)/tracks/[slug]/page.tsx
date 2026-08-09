"use client";

import { use, useEffect, useState } from "react";
import { LayoutShape, TrackDirection, TrackRuleKind } from "@prisma/client";
import { api } from "@/lib/trpc/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrackDiagram } from "@/components/track-diagram";
import { TrackGallery } from "@/components/track-gallery";
import { formatLapTime } from "@/lib/lap-time";
import { placeLabel } from "@/lib/regions";
import { imagesForFacility, imagesForLayout } from "@/lib/track-images";
import {
  formatBanking,
  formatCoordinates,
  formatTurns,
  shapeLabel,
  venueMapUrl,
} from "@/lib/track-diagram";
import {
  groupRules,
  isStale,
  TRACK_RULE_DESCRIPTIONS,
  TRACK_RULE_LABELS,
  TRACK_RULE_ORDER,
  verifiedLabel,
} from "@/lib/track-rules";
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
  if (!track.data)
    return <p className="text-brand-black/60">Track not found.</p>;

  const data = track.data;
  const signedIn = Boolean(me.data?.id);
  // A reference track has no creator, so the "only whoever added it" rule
  // would freeze it forever — a typo in a shipped circuit could never be
  // fixed. Those are open to anyone signed in, and every edit is audited.
  const canCurate = data.isReference
    ? signedIn
    : Boolean(
        me.data?.id && data.createdById && me.data.id === data.createdById,
      );

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-bold">{data.name}</h1>
          <Badge>{TRACK_KIND_LABELS[data.kind]}</Badge>
          {data.isReference && <Badge variant="outline">Reference</Badge>}
          {data.licenceGrade && (
            <Badge variant="outline">{data.licenceGrade}</Badge>
          )}
        </div>
        <p className="text-sm text-brand-black/60">
          {[data.addressLine, placeLabel(data), data.postalCode]
            .filter(Boolean)
            .join(", ") || "Location not given"}
          {data.pitBoxCount ? ` · ${data.pitBoxCount} pit boxes` : ""}
          {data.garageCount ? ` · ${data.garageCount} garages` : ""}
        </p>
        <p className="flex flex-wrap items-center gap-3 text-xs">
          <a
            href={venueMapUrl({ ...data, name: data.name })}
            target="_blank"
            rel="noreferrer noopener"
            className="text-brand-red hover:underline"
          >
            Open in maps ↗
          </a>
          {formatCoordinates(data) && (
            <span className="tabular-nums text-brand-black/50">
              {formatCoordinates(data)}
            </span>
          )}
          {data.websiteUrl && (
            <a
              href={data.websiteUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="text-brand-red hover:underline"
            >
              Circuit website ↗
            </a>
          )}
        </p>
        {data.notes && <p className="max-w-3xl text-sm">{data.notes}</p>}
        {data.isReference ? (
          <p className="text-xs text-brand-black/50">
            {signedIn
              ? "Shipped with RaceOps and shared by everyone. If something here is wrong — a repave, a new configuration, a name change — correct it. Changes are recorded against your name."
              : "Shipped with RaceOps and shared by everyone. Sign in to correct it."}
          </p>
        ) : (
          !canCurate && (
            <p className="text-xs text-brand-black/50">
              Curated by{" "}
              {data.createdBy?.profile?.displayName ?? "someone who has left"}.
              Anyone can use these layouts on an event.
            </p>
          )
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
                    {layout.isPrimary && (
                      <Badge variant="verified">Default</Badge>
                    )}
                    {!layout.active && (
                      <Badge variant="outline">Inactive</Badge>
                    )}
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
                <div className="grid gap-4 sm:grid-cols-[minmax(0,200px)_1fr]">
                  <div>
                    <TrackDiagram layout={layout} images={data.images} />
                    {!hasImage(data.images, layout.id) && !layout.shape && (
                      <button
                        type="button"
                        className="w-full rounded-lg border border-dashed border-brand-black/20 p-4 text-center text-xs text-brand-black/55 hover:border-brand-red hover:text-brand-red"
                        onClick={() => setOpenLayout(layout.id)}
                      >
                        No map yet.
                        {canCurate
                          ? " Add a photo of one →"
                          : " Sign in to add one."}
                      </button>
                    )}
                  </div>

                  <dl className="grid max-w-2xl grid-cols-2 gap-x-6 gap-y-3 self-start text-xs sm:grid-cols-3">
                    <Spec
                      label="Length"
                      value={formatLength(layout.lengthMeters)}
                    />
                    <Spec label="Turns" value={formatTurns(layout.turnCount)} />
                    <Spec
                      label="Direction"
                      value={TRACK_DIRECTION_LABELS[layout.direction]}
                    />
                    <Spec
                      label="Banking"
                      value={formatBanking(layout.bankingDegrees)}
                    />
                    <Spec
                      label="Shape"
                      value={layout.shape ? shapeLabel(layout.shape) : null}
                    />
                    <Spec
                      label="Elevation"
                      value={
                        layout.elevationMeters
                          ? `${layout.elevationMeters} m`
                          : null
                      }
                    />
                    <Spec
                      label="Named corners"
                      value={
                        layout.turns.length > 0
                          ? String(layout.turns.length)
                          : null
                      }
                    />
                    <Spec
                      label="Sectors"
                      value={
                        layout.sectors.length > 0
                          ? String(layout.sectors.length)
                          : null
                      }
                    />
                    <Spec
                      label="Events"
                      value={
                        layout._count.events > 0
                          ? String(layout._count.events)
                          : null
                      }
                    />
                  </dl>
                </div>

                {openLayout === layout.id && (
                  <div className="space-y-5 border-t border-brand-black/10 pt-4">
                    <TrackGallery
                      trackId={data.id}
                      layoutId={layout.id}
                      images={imagesForLayout(data.images, layout.id)}
                      canCurate={canCurate}
                      onChanged={() => track.refetch()}
                      title={`Photos of ${layout.name}`}
                      description="The circuit's own map, an aerial, a shot of the board in the paddock — whatever shows what this layout looks like."
                    />
                    <LapRecords layoutId={layout.id} />
                    {canCurate && (
                      <LayoutDetailsForm
                        layout={layout}
                        onSaved={() => track.refetch()}
                      />
                    )}
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

      <section className="space-y-4">
        <h2 className="text-xl font-semibold">The facility</h2>
        <TrackGallery
          trackId={data.id}
          layoutId={null}
          images={imagesForFacility(data.images)}
          canCurate={canCurate}
          onChanged={() => track.refetch()}
          title="Paddock plans and site photos"
          description="Images of the venue rather than of one configuration — the paddock plan, the gates, the scrutineering bay."
        />
      </section>

      <TrackRules
        trackId={data.id}
        rules={data.rules}
        canCurate={canCurate}
        onChanged={() => track.refetch()}
      />
    </div>
  );
}

/** Whether this layout already has a picture, so we can offer to add one. */
function hasImage(
  images: readonly { layoutId: string | null }[],
  layoutId: string,
): boolean {
  return images.some((image) => image.layoutId === layoutId);
}

/** One figure in a layout's spec grid. Renders nothing when unknown. */
function Spec({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div>
      <dt className="font-semibold uppercase tracking-wide text-brand-black/45">
        {label}
      </dt>
      <dd className="tabular-nums text-brand-black/80">{value}</dd>
    </div>
  );
}

/** Read-only corner list, for everyone who does not curate the track. */
function TurnList({
  turns,
}: {
  turns: {
    id: string;
    number: number;
    name: string | null;
    sector: number | null;
  }[];
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

  const save = api.track.setTurns.useMutation({
    meta: { silenceError: true },
    onSuccess: onSaved,
  });

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
      {save.error && (
        <p className="text-sm text-brand-red">{save.error.message}</p>
      )}
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
              <span className="tabular-nums">
                {formatLapTime(overall.lapMs)}
              </span>
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
        {add.error && (
          <p className="text-sm text-brand-red">{add.error.message}</p>
        )}
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

/**
 * What the facility itself imposes, as opposed to what a series regulates.
 *
 * Deliberately its own section rather than a line in the notes: a sound limit
 * or a Sunday curfew changes whether you load the trailer at all, and burying
 * it in prose is how people find out at the gate. Sources and a last-checked
 * date are shown because an uncited limit from an anonymous edit is not
 * something anyone should plan a weekend around.
 */
function TrackRules({
  trackId,
  rules,
  canCurate,
  onChanged,
}: {
  trackId: string;
  rules: {
    id: string;
    kind: TrackRuleKind;
    title: string;
    detail: string | null;
    source: string | null;
    sourceUrl: string | null;
    verifiedOn: Date | string | null;
  }[];
  canCurate: boolean;
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const verify = api.track.verifyRule.useMutation({
    meta: { successMessage: "Marked as checked." },
    onSuccess: onChanged,
  });
  const remove = api.track.deleteRule.useMutation({ onSuccess: onChanged });
  const groups = groupRules(rules);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold">Rules & ordinances</h2>
          <p className="text-sm text-brand-black/60">
            What this facility requires, on top of whatever your series
            regulates.
          </p>
        </div>
        {canCurate && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setAdding((open) => !open)}
          >
            {adding ? "Cancel" : "Add a rule"}
          </Button>
        )}
      </div>

      {adding && (
        <RuleForm
          trackId={trackId}
          onSaved={() => {
            setAdding(false);
            onChanged();
          }}
        />
      )}

      {groups.length === 0 && !adding && (
        <p className="rounded-lg border border-dashed border-brand-black/20 p-6 text-center text-sm text-brand-black/55">
          Nothing recorded yet. If you run here, the sound limit and the running
          hours are the two worth adding first — they are what turn people away
          at the gate.
        </p>
      )}

      {groups.map((group) => (
        <div key={group.kind} className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-brand-black/50">
            {TRACK_RULE_LABELS[group.kind]}
          </h3>
          {group.rules.map((rule) => (
            <Card key={rule.id}>
              <CardContent className="space-y-2 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="font-medium">{rule.title}</p>
                  {isStale(rule.verifiedOn) && (
                    <Badge variant="outline">May be out of date</Badge>
                  )}
                </div>
                {rule.detail && (
                  <p className="text-sm leading-relaxed text-brand-black/75">
                    {rule.detail}
                  </p>
                )}
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-brand-black/50">
                  {rule.source && <span>{rule.source}</span>}
                  {rule.sourceUrl && (
                    <a
                      href={rule.sourceUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-brand-red hover:underline"
                    >
                      Source ↗
                    </a>
                  )}
                  <span>{verifiedLabel(rule.verifiedOn)}</span>
                  {canCurate && (
                    <>
                      <button
                        type="button"
                        className="hover:text-brand-black"
                        onClick={() => verify.mutate({ ruleId: rule.id })}
                      >
                        Still current
                      </button>
                      <button
                        type="button"
                        className="hover:text-brand-red"
                        onClick={() => remove.mutate({ ruleId: rule.id })}
                      >
                        Remove
                      </button>
                    </>
                  )}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      ))}
    </section>
  );
}

function RuleForm({
  trackId,
  onSaved,
}: {
  trackId: string;
  onSaved: () => void;
}) {
  const [kind, setKind] = useState<TrackRuleKind>("SOUND");
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [source, setSource] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const add = api.track.addRule.useMutation({ onSuccess: onSaved });

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="grid gap-3 sm:grid-cols-[200px_1fr]">
          <label className="block text-sm font-medium">
            Kind
            <select
              className="mt-1 w-full rounded-md border border-brand-black/20 px-2 py-1.5 text-sm"
              value={kind}
              onChange={(e) => setKind(e.target.value as TrackRuleKind)}
            >
              {TRACK_RULE_ORDER.map((value) => (
                <option key={value} value={value}>
                  {TRACK_RULE_LABELS[value]}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium">
            The rule, in one line
            <input
              className="mt-1 w-full rounded-md border border-brand-black/20 px-2 py-1.5 text-sm"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="103 dBA at 50 ft"
            />
          </label>
        </div>
        <p className="text-xs text-brand-black/55">
          {TRACK_RULE_DESCRIPTIONS[kind]}
        </p>
        <label className="block text-sm font-medium">
          Detail
          <textarea
            rows={3}
            className="mt-1 w-full rounded-md border border-brand-black/20 px-2 py-1.5 text-sm"
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            placeholder="What a competitor needs to know before they load the trailer."
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-medium">
            Where this comes from
            <input
              className="mt-1 w-full rounded-md border border-brand-black/20 px-2 py-1.5 text-sm"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="County use permit; circuit regulations"
            />
          </label>
          <label className="block text-sm font-medium">
            Link (optional)
            <input
              className="mt-1 w-full rounded-md border border-brand-black/20 px-2 py-1.5 text-sm"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="https://"
            />
          </label>
        </div>
        {add.error && (
          <p className="text-sm text-brand-red">{add.error.message}</p>
        )}
        <Button
          size="sm"
          variant="primary"
          disabled={add.isPending || title.trim().length < 3}
          onClick={() =>
            add.mutate({
              trackId,
              kind,
              title: title.trim(),
              detail: detail.trim() || undefined,
              source: source.trim() || undefined,
              sourceUrl: sourceUrl.trim() || undefined,
              // Somebody adding a rule has just looked it up. Recording that
              // is what keeps the staleness warning meaningful later.
              verifiedOn: new Date(),
            })
          }
        >
          {add.isPending ? "Saving…" : "Add rule"}
        </Button>
      </CardContent>
    </Card>
  );
}

/** Curator form for the figures and the map that describe a layout. */
function LayoutDetailsForm({
  layout,
  onSaved,
}: {
  layout: {
    id: string;
    turnCount: number | null;
    shape: LayoutShape | null;
    bankingDegrees: number | null;
    elevationMeters: number | null;
  };
  onSaved: () => void;
}) {
  const [turnCount, setTurnCount] = useState(
    layout.turnCount?.toString() ?? "",
  );
  const [shape, setShape] = useState<LayoutShape | "">(layout.shape ?? "");
  const [banking, setBanking] = useState(
    layout.bankingDegrees?.toString() ?? "",
  );
  const [elevation, setElevation] = useState(
    layout.elevationMeters?.toString() ?? "",
  );
  const save = api.track.updateLayout.useMutation({ onSuccess: onSaved });

  const numberOrNull = (value: string) =>
    value.trim() === "" ? null : Number(value);

  return (
    <div className="space-y-3 rounded-lg border border-brand-black/10 p-4">
      <p className="text-sm font-medium">Layout details</p>
      <div className="grid gap-3 sm:grid-cols-4">
        <label className="block text-xs font-medium">
          Turns
          <input
            type="number"
            min={1}
            className="mt-1 w-full rounded-md border border-brand-black/20 px-2 py-1.5 text-sm"
            value={turnCount}
            onChange={(e) => setTurnCount(e.target.value)}
          />
        </label>
        <label className="block text-xs font-medium">
          Shape
          <select
            className="mt-1 w-full rounded-md border border-brand-black/20 px-2 py-1.5 text-sm"
            value={shape}
            onChange={(e) => setShape(e.target.value as LayoutShape | "")}
          >
            <option value="">Not an oval</option>
            {Object.values(LayoutShape).map((value) => (
              <option key={value} value={value}>
                {shapeLabel(value)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-medium">
          Banking (°)
          <input
            type="number"
            min={0}
            max={60}
            className="mt-1 w-full rounded-md border border-brand-black/20 px-2 py-1.5 text-sm"
            value={banking}
            onChange={(e) => setBanking(e.target.value)}
          />
        </label>
        <label className="block text-xs font-medium">
          Elevation (m)
          <input
            type="number"
            min={0}
            className="mt-1 w-full rounded-md border border-brand-black/20 px-2 py-1.5 text-sm"
            value={elevation}
            onChange={(e) => setElevation(e.target.value)}
          />
        </label>
      </div>

      {save.error && (
        <p className="text-sm text-brand-red">{save.error.message}</p>
      )}
      <Button
        size="sm"
        variant="primary"
        disabled={save.isPending}
        onClick={() =>
          save.mutate({
            layoutId: layout.id,
            turnCount: numberOrNull(turnCount),
            shape: shape === "" ? null : shape,
            bankingDegrees: numberOrNull(banking),
            elevationMeters: numberOrNull(elevation),
          })
        }
      >
        {save.isPending ? "Saving…" : "Save details"}
      </Button>
    </div>
  );
}
