"use client";

import { useState } from "react";
import { api } from "@/lib/trpc/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Classes and championship rules.
 *
 * Classes are whatever the series says they are. A pro grid declares GT3 and
 * GT4; a club autocross region declares thirty with names only that region
 * uses; a single-grid series declares none and scores everyone together.
 */
export function ClassesPanel({
  seriesId,
  canManage,
}: {
  seriesId: string;
  canManage: boolean;
}) {
  const utils = api.useUtils();
  const classes = api.series.classes.useQuery({ seriesId });
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [grouping, setGrouping] = useState("");

  const refresh = () => {
    utils.series.classes.invalidate({ seriesId });
    utils.series.standings.invalidate({ seriesId });
  };
  const createClass = api.series.createClass.useMutation({
    onSuccess: () => {
      setName("");
      setCode("");
      refresh();
    },
  });
  const updateClass = api.series.updateClass.useMutation({ onSuccess: refresh });
  const deleteClass = api.series.deleteClass.useMutation({ onSuccess: refresh });

  const rows = classes.data ?? [];
  const error = createClass.error ?? updateClass.error ?? deleteClass.error;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold">Classes</h2>
          <p className="mt-1 text-xs text-brand-black/60">
            {rows.length === 0
              ? "No classes declared — every entry is scored in one championship."
              : `${rows.length} class${rows.length === 1 ? "" : "es"}, each with its own championship table.`}
          </p>
        </div>
        {canManage && (
          <Button
            size="sm"
            variant="primary"
            onClick={() => setShowForm((v) => !v)}
          >
            {showForm ? "Done" : "Add class"}
          </Button>
        )}
      </div>

      {showForm && canManage && (
        <Card className="max-w-2xl">
          <CardContent className="space-y-4 p-5">
            <div className="grid gap-4 sm:grid-cols-3">
              <label className="block text-sm font-medium sm:col-span-2">
                Name
                <input
                  className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Spec Miata · GT3 · Improved Production <2L"
                />
              </label>
              <label className="block text-sm font-medium">
                Code <span className="text-brand-black/50">(optional)</span>
                <input
                  className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="SM"
                />
              </label>
              <label className="block text-sm font-medium sm:col-span-3">
                Run group{" "}
                <span className="text-brand-black/50">
                  (optional — groups classes that run together)
                </span>
                <input
                  className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
                  value={grouping}
                  onChange={(e) => setGrouping(e.target.value)}
                  placeholder="Group 2 · Novice"
                />
              </label>
            </div>
            <Button
              variant="primary"
              disabled={createClass.isPending || name.trim().length < 1}
              onClick={() =>
                createClass.mutate({
                  seriesId,
                  name: name.trim(),
                  code: code.trim() || undefined,
                  grouping: grouping.trim() || undefined,
                  sortOrder: rows.length,
                })
              }
            >
              {createClass.isPending ? "Adding…" : "Add class"}
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {rows.map((seriesClass) => (
          <Card key={seriesClass.id}>
            <CardContent className="flex flex-wrap items-center justify-between gap-2 p-4">
              <div>
                <p className="font-medium">
                  {seriesClass.name}
                  {seriesClass.code && (
                    <span className="ml-2 text-xs text-brand-black/50">
                      {seriesClass.code}
                    </span>
                  )}
                </p>
                <p className="text-xs text-brand-black/60">
                  {[
                    seriesClass.grouping,
                    `${seriesClass._count.registrations} entr${seriesClass._count.registrations === 1 ? "y" : "ies"}`,
                    seriesClass.pointsScheme ? "own points scale" : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {!seriesClass.active && <Badge>Retired</Badge>}
                {canManage && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={updateClass.isPending}
                      onClick={() =>
                        updateClass.mutate({
                          classId: seriesClass.id,
                          active: !seriesClass.active,
                        })
                      }
                    >
                      {seriesClass.active ? "Retire" : "Reinstate"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={deleteClass.isPending}
                      onClick={() =>
                        deleteClass.mutate({ classId: seriesClass.id })
                      }
                    >
                      Delete
                    </Button>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {error && <p className="text-sm text-brand-red">{error.message}</p>}

      {canManage && <ChampionshipRulesForm seriesId={seriesId} />}
    </section>
  );
}

/** Dropped scores and title eligibility. */
function ChampionshipRulesForm({ seriesId }: { seriesId: string }) {
  const utils = api.useUtils();
  const [open, setOpen] = useState(false);
  const [countBestRounds, setCountBestRounds] = useState("");
  const [minStarts, setMinStarts] = useState("");

  const setRules = api.series.setChampionshipRules.useMutation({
    onSuccess: () => {
      setOpen(false);
      utils.series.standings.invalidate({ seriesId });
      utils.series.bySlug.invalidate();
    },
  });

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Championship rules
      </Button>
    );
  }

  const numeric = (raw: string) =>
    raw.trim() === "" ? null : Number(raw) || null;

  return (
    <Card className="max-w-2xl">
      <CardContent className="space-y-4 p-5">
        <p className="text-xs text-brand-black/60">
          Leave blank to count every round and let everyone contest the title.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium">
            Count best N rounds
            <input
              inputMode="numeric"
              className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
              value={countBestRounds}
              onChange={(e) => setCountBestRounds(e.target.value)}
              placeholder="8"
            />
          </label>
          <label className="block text-sm font-medium">
            Starts needed for the title
            <input
              inputMode="numeric"
              className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
              value={minStarts}
              onChange={(e) => setMinStarts(e.target.value)}
              placeholder="6"
            />
          </label>
        </div>
        {setRules.error && (
          <p className="text-sm text-brand-red">{setRules.error.message}</p>
        )}
        <div className="flex gap-2">
          <Button
            variant="primary"
            disabled={setRules.isPending}
            onClick={() =>
              setRules.mutate({
                seriesId,
                countBestRounds: numeric(countBestRounds),
                minStartsForTitle: numeric(minStarts),
              })
            }
          >
            {setRules.isPending ? "Saving…" : "Save rules"}
          </Button>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
