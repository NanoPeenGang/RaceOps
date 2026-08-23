"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { inferRouterOutputs } from "@trpc/server";
import { api } from "@/lib/trpc/client";
import type { AppRouter } from "@/server/trpc/root";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { SearchInput } from "@/components/ui/form";
import { EmptyState, PageHeader } from "@/components/ui/page";
import { Skeleton } from "@/components/ui/skeleton";
import { isSettling, useDebounced } from "@/lib/use-debounced";
import {
  appliedFilters,
  DISCIPLINES,
  DISCIPLINE_LABELS,
  EXPLORE_TYPES,
  exploreHref,
  hasAnyFilter,
  parseFilters,
  TRACK_KINDS,
  TRACK_KIND_LABELS,
  TYPE_LABELS,
  TYPE_LABELS_ONE,
  toggleType,
  WHEN_LABELS,
  WHEN_OPTIONS,
  withFilter,
  type ExploreFilters,
  type ExploreType,
} from "@/lib/explore";

/**
 * Explore: one search instead of four directories.
 *
 * Everything lives in the query string, so a search survives a reload and —
 * the part that matters — can be sent to somebody. "Endurance racing in
 * Georgia next month" should be a link, not a set of instructions.
 */
export default function ExplorePage() {
  return (
    <Suspense fallback={<ResultSkeleton />}>
      <Explore />
    </Suspense>
  );
}

function Explore() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const filters = useMemo(
    () => parseFilters(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );

  /*
   * The text box is local and the rest of the filters are not. Pushing a route
   * on every keystroke would fill the back button with half-typed words; the
   * facets are single deliberate clicks and belong in history.
   */
  const [typed, setTyped] = useState(filters.q);
  const settled = useDebounced(typed);
  const typing = isSettling(typed, settled);

  const go = (next: ExploreFilters) => router.push(exploreHref(next), { scroll: false });

  const facets = api.explore.facets.useQuery(undefined, {
    staleTime: 5 * 60_000,
    meta: { silenceError: true },
  });
  const results = api.explore.search.useQuery(
    { ...filters, q: settled },
    { meta: { silenceError: true } },
  );

  const seriesName = facets.data?.series.find(
    (entry) => entry.value === filters.seriesSlug,
  )?.label;
  const chips = appliedFilters(filters, { seriesName });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Explore"
        description="Events, series, teams and tracks — one search across all of them."
      />

      <SearchInput
        className="w-full rounded-lg border border-brand-black/20 bg-surface px-4 py-2.5 text-sm"
        placeholder="Search events, series, teams and tracks…"
        value={typed}
        onChange={(event) => {
          setTyped(event.target.value);
          router.replace(exploreHref(withFilter(filters, { q: event.target.value })), {
            scroll: false,
          });
        }}
      />

      <div className="flex flex-col gap-6 lg:flex-row">
        <FacetRail
          filters={filters}
          facets={facets.data}
          counts={results.data?.counts}
          onChange={go}
        />

        <div className="min-w-0 flex-1 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {EXPLORE_TYPES.map((type) => (
              <TypeChip
                key={type}
                type={type}
                filters={filters}
                count={results.data?.counts[type]}
                onChange={go}
              />
            ))}
            <span className="ml-auto text-xs text-brand-black/60">
              {typing || results.isLoading
                ? "Searching…"
                : `${results.data?.total ?? 0} match${results.data?.total === 1 ? "" : "es"}`}
            </span>
          </div>

          {chips.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-brand-black/60">Showing</span>
              {chips.map((chip) => (
                <button
                  key={chip.label}
                  type="button"
                  onClick={() => go(chip.without)}
                  className="inline-flex items-center gap-1.5 rounded-full bg-brand-black/10 px-2.5 py-0.5 text-xs font-semibold text-brand-black hover:bg-brand-black/20"
                >
                  {chip.label}
                  <span aria-hidden="true">×</span>
                  <span className="sr-only">Remove this filter</span>
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  setTyped("");
                  router.push("/explore", { scroll: false });
                }}
                className="text-xs font-semibold text-brand-red hover:underline"
              >
                Clear all
              </button>
            </div>
          )}

          <Results filters={filters} data={results.data} loading={results.isLoading || typing} onChange={go} />
        </div>
      </div>
    </div>
  );
}

type ExploreOutputs = inferRouterOutputs<AppRouter>["explore"];
type Facets = ExploreOutputs["facets"];
type SearchData = ExploreOutputs["search"];

function TypeChip({
  type,
  filters,
  count,
  onChange,
}: {
  type: ExploreType;
  filters: ExploreFilters;
  count: number | undefined;
  onChange: (next: ExploreFilters) => void;
}) {
  const on = filters.types.includes(type);
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => onChange(toggleType(filters, type))}
      className={cn(
        "rounded-full px-3 py-1 text-xs font-semibold transition-colors",
        on
          ? "bg-brand-red text-on-red"
          : "border border-brand-black/20 text-brand-black hover:bg-brand-black/5",
      )}
    >
      {TYPE_LABELS[type]}
      {count !== undefined && (
        <span className="ml-1.5 tabular-nums opacity-70">{count}</span>
      )}
    </button>
  );
}

function FacetRail({
  filters,
  facets,
  counts,
  onChange,
}: {
  filters: ExploreFilters;
  facets: Facets | undefined;
  counts: SearchData["counts"] | undefined;
  onChange: (next: ExploreFilters) => void;
}) {
  return (
    <aside className="w-full shrink-0 space-y-5 lg:w-56">
      <FacetGroup title="Discipline">
        {DISCIPLINES.map((discipline) => (
          <Facet
            key={discipline}
            label={DISCIPLINE_LABELS[discipline]}
            on={filters.discipline === discipline}
            onClick={() =>
              onChange(
                withFilter(filters, {
                  discipline: filters.discipline === discipline ? null : discipline,
                }),
              )
            }
          />
        ))}
      </FacetGroup>

      <FacetGroup title="When" note="Events only">
        {WHEN_OPTIONS.map((when) => (
          <Facet
            key={when}
            label={WHEN_LABELS[when]}
            on={filters.when === when}
            onClick={() =>
              onChange(withFilter(filters, { when: filters.when === when ? null : when }))
            }
          />
        ))}
      </FacetGroup>

      {facets && facets.regions.length > 0 && (
        <FacetGroup title="Region">
          {facets.regions.map((region) => (
            <Facet
              key={region.value}
              label={region.value}
              count={region.count}
              on={filters.region === region.value}
              onClick={() =>
                onChange(
                  withFilter(filters, {
                    region: filters.region === region.value ? null : region.value,
                  }),
                )
              }
            />
          ))}
        </FacetGroup>
      )}

      {facets && facets.series.length > 0 && (
        <FacetGroup title="Series" note="Events only">
          {facets.series.map((series) => (
            <Facet
              key={series.value}
              label={series.label}
              count={series.count}
              on={filters.seriesSlug === series.value}
              onClick={() =>
                onChange(
                  withFilter(filters, {
                    seriesSlug: filters.seriesSlug === series.value ? null : series.value,
                  }),
                )
              }
            />
          ))}
        </FacetGroup>
      )}

      {(counts === undefined || counts.track > 0 || filters.trackKind) && (
        <FacetGroup title="Track type" note="Tracks only">
          {TRACK_KINDS.map((kind) => (
            <Facet
              key={kind}
              label={TRACK_KIND_LABELS[kind]}
              on={filters.trackKind === kind}
              onClick={() =>
                onChange(
                  withFilter(filters, {
                    trackKind: filters.trackKind === kind ? null : kind,
                  }),
                )
              }
            />
          ))}
        </FacetGroup>
      )}
    </aside>
  );
}

function FacetGroup({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h2 className="pb-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-brand-black/50">
        {title}
        {/* Said once, here, rather than leaving somebody to work out why
            checking it emptied the page. */}
        {note && <span className="ml-1.5 font-medium normal-case tracking-normal">· {note}</span>}
      </h2>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function Facet({
  label,
  count,
  on,
  onClick,
}: {
  label: string;
  count?: number;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-brand-black/5"
    >
      <span
        aria-hidden="true"
        className={cn(
          "flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded",
          on ? "bg-brand-red text-on-red" : "border border-brand-black/20",
        )}
      >
        {on && (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" className="h-2.5 w-2.5">
            <path d="m5 12.4 4.6 4.6L19 7.2" />
          </svg>
        )}
      </span>
      <span className={cn("min-w-0 flex-1 truncate text-[12.5px]", on ? "font-semibold text-brand-black" : "text-brand-black/70")}>
        {label}
      </span>
      {count !== undefined && (
        <span className="shrink-0 text-[11px] tabular-nums text-brand-black/50">{count}</span>
      )}
    </button>
  );
}

function Results({
  filters,
  data,
  loading,
  onChange,
}: {
  filters: ExploreFilters;
  data: SearchData | undefined;
  loading: boolean;
  onChange: (next: ExploreFilters) => void;
}) {
  if (loading && !data) return <ResultSkeleton />;
  if (!data) return null;

  if (data.total === 0) {
    return (
      <EmptyState
        title="Nothing matches that yet"
        description={
          hasAnyFilter(filters)
            ? "Try removing a filter — the chips above show what is narrowing this."
            : "There is nothing published to show here."
        }
      />
    );
  }

  interface Section {
    type: ExploreType;
    rows: React.ReactNode[];
    count: number;
  }

  const sections: Section[] = ([
    {
      type: "event" as const,
      count: data.counts.event,
      rows: data.events.map((event) => (
        <ResultCard
          key={event.id}
          type="event"
          href={event.href}
          name={event.name}
          detail={[event.series, event.where].filter(Boolean).join(" · ")}
          statLabel={`${event.entries} ${event.entries === 1 ? "entry" : "entries"}`}
          stat={event.when}
        />
      )),
    },
    {
      type: "series" as const,
      count: data.counts.series,
      rows: data.series.map((entry) => (
        <ResultCard
          key={entry.slug}
          type="series"
          href={entry.href}
          name={entry.name}
          detail={[entry.platform, entry.season].filter(Boolean).join(" · ")}
          stat={`${entry.events} ${entry.events === 1 ? "event" : "events"}`}
          statLabel={entry.discipline === "SIM" ? "Sim racing" : "Real world"}
        />
      )),
    },
    {
      type: "team" as const,
      count: data.counts.team,
      rows: data.teams.map((team) => (
        <ResultCard
          key={team.slug}
          type="team"
          href={team.href}
          name={team.name}
          detail={team.homeBase ?? "No home base listed"}
          stat={`${team.members} ${team.members === 1 ? "person" : "people"}`}
        />
      )),
    },
    {
      type: "track" as const,
      count: data.counts.track,
      rows: data.tracks.map((track) => (
        <ResultCard
          key={track.slug}
          type="track"
          href={track.href}
          name={track.name}
          detail={track.where || "Location not listed"}
          stat={track.miles ? `${track.miles.toFixed(2)} mi` : "—"}
          statLabel={track.turns ? `${track.turns} turns` : undefined}
        />
      )),
    },
  ] satisfies Section[]).filter((section) => section.rows.length > 0);

  const mixed = data.sole === null;

  return (
    <div className="space-y-6">
      {sections.map((section) => (
        <section key={section.type} className="space-y-2">
          {mixed && (
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-semibold text-brand-black">
                {TYPE_LABELS[section.type]}
              </h2>
              {section.count > section.rows.length && (
                <button
                  type="button"
                  onClick={() => onChange(withFilter(filters, { types: [section.type] }))}
                  className="text-xs font-semibold text-brand-red hover:underline"
                >
                  See all {section.count}
                </button>
              )}
            </div>
          )}
          <div className="space-y-2">{section.rows}</div>
        </section>
      ))}

      {data.sole && <Pager filters={filters} total={data.counts[data.sole]} onChange={onChange} />}
    </div>
  );
}

function Pager({
  filters,
  total,
  onChange,
}: {
  filters: ExploreFilters;
  total: number;
  onChange: (next: ExploreFilters) => void;
}) {
  const pages = Math.ceil(total / 24);
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between border-t border-brand-black/10 pt-4">
      <button
        type="button"
        disabled={filters.page === 0}
        onClick={() => onChange({ ...filters, page: filters.page - 1 })}
        className="text-sm font-medium text-brand-black disabled:opacity-40"
      >
        ← Previous
      </button>
      <span className="text-xs tabular-nums text-brand-black/60">
        Page {filters.page + 1} of {pages}
      </span>
      <button
        type="button"
        disabled={filters.page + 1 >= pages}
        onClick={() => onChange({ ...filters, page: filters.page + 1 })}
        className="text-sm font-medium text-brand-black disabled:opacity-40"
      >
        Next →
      </button>
    </div>
  );
}

function ResultCard({
  type,
  href,
  name,
  detail,
  stat,
  statLabel,
}: {
  type: ExploreType;
  href: string;
  name: string;
  detail: string;
  stat: string;
  statLabel?: string;
}) {
  return (
    <Card className="transition-colors hover:border-brand-black/20">
      <Link href={href} className="flex items-center gap-4 p-4">
        <span className="min-w-0 flex-1">
          <Badge variant={type === "event" ? "verified" : "default"} className="text-[9.5px] uppercase tracking-[0.09em]">
            {TYPE_LABELS_ONE[type]}
          </Badge>
          <span className="mt-1.5 block truncate text-[15px] font-semibold text-brand-black">
            {name}
          </span>
          <span className="mt-0.5 block truncate text-xs text-brand-black/60">{detail}</span>
        </span>
        <span className="shrink-0 text-right">
          <span className="block text-sm font-semibold tabular-nums text-brand-black">{stat}</span>
          {statLabel && <span className="mt-0.5 block text-xs text-brand-black/60">{statLabel}</span>}
        </span>
      </Link>
    </Card>
  );
}

function ResultSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 6 }, (_, index) => (
        <Skeleton key={index} className="h-[74px] w-full rounded-xl" />
      ))}
    </div>
  );
}
