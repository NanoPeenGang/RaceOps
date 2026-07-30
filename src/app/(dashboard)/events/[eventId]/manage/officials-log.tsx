"use client";

import { useState } from "react";
import Link from "next/link";
import { LogCategory } from "@prisma/client";
import { api } from "@/lib/trpc/client";
import { LOG_CATEGORY_LABELS, logTime } from "@/lib/officials-log";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Race control's log.
 *
 * Flag changes, session states, incident decisions and penalties write
 * themselves as they happen — reconstructing "when did the safety car come
 * out" afterwards is impossible, because the session row only holds the
 * current flag. Everything the system cannot see is typed in.
 *
 * The log is append-only. An entry can be moved in or out of the bulletin,
 * which changes who can read it, but never edited or deleted: a log someone
 * can rewrite is not a log.
 */
export function OfficialsLogPanel({ eventId }: { eventId: string }) {
  const utils = api.useUtils();
  const log = api.log.forEvent.useQuery({ eventId });
  const [adding, setAdding] = useState(false);

  const refresh = () => utils.log.forEvent.invalidate({ eventId });
  const setPublished = api.log.setPublished.useMutation({ onSuccess: refresh });
  const publishAll = api.log.publishBulletin.useMutation({
    onSuccess: refresh,
  });

  if (!log.data?.isOfficial) return null;
  const { entries, summary } = log.data;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold">Race control log</h2>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-brand-black/60">
            {summary.total} entr{summary.total === 1 ? "y" : "ies"} ·{" "}
            {summary.published} in the bulletin
          </span>
          <Link href={`/events/${eventId}/bulletin`}>
            <Button size="sm" variant="outline">
              View bulletin
            </Button>
          </Link>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setAdding((open) => !open)}
          >
            {adding ? "Cancel" : "Add entry"}
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={publishAll.isPending}
            onClick={() => publishAll.mutate({ eventId })}
          >
            {publishAll.isPending ? "Publishing…" : "Publish bulletin"}
          </Button>
        </div>
      </div>

      {adding && (
        <AddEntryForm
          eventId={eventId}
          onSaved={() => {
            refresh();
            setAdding(false);
          }}
        />
      )}

      {publishAll.error && (
        <p className="text-sm text-brand-red">{publishAll.error.message}</p>
      )}

      {entries.length === 0 ? (
        <p className="text-sm text-brand-black/60">
          Nothing logged yet. Flag changes, session states and stewards&rsquo;
          decisions appear here on their own.
        </p>
      ) : (
        <Card>
          <CardContent className="divide-y divide-brand-black/5 p-0">
            {entries.map((entry) => (
              <div
                key={entry.id}
                className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2 text-sm"
              >
                <span className="flex flex-wrap items-baseline gap-2">
                  <span className="font-mono text-xs tabular-nums text-brand-black/60">
                    {logTime(new Date(entry.occurredAt))}
                  </span>
                  <Badge variant="outline">
                    {LOG_CATEGORY_LABELS[entry.category]}
                  </Badge>
                  <span>
                    {entry.summary}
                    {entry.detail ? (
                      <span className="block text-xs text-brand-black/60">
                        {entry.detail}
                      </span>
                    ) : null}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  {!entry.automatic && entry.official?.profile && (
                    <span className="text-xs text-brand-black/50">
                      {entry.official.profile.displayName}
                    </span>
                  )}
                  <Button
                    size="sm"
                    variant={entry.published ? "primary" : "outline"}
                    disabled={setPublished.isPending}
                    onClick={() =>
                      setPublished.mutate({
                        entryId: entry.id,
                        published: !entry.published,
                      })
                    }
                  >
                    {entry.published ? "In bulletin" : "Internal"}
                  </Button>
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </section>
  );
}

function AddEntryForm({
  eventId,
  onSaved,
}: {
  eventId: string;
  onSaved: () => void;
}) {
  const sessions = api.session.forEvent.useQuery({ eventId });
  const [category, setCategory] = useState<LogCategory>(LogCategory.NOTE);
  const [sessionId, setSessionId] = useState("");
  const [summary, setSummary] = useState("");
  const [detail, setDetail] = useState("");
  const [published, setPublished] = useState(false);

  const add = api.log.add.useMutation({ onSuccess: onSaved });

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <p className="text-xs text-brand-black/60">
          The things the system cannot see: &ldquo;driver briefing held&rdquo;,
          &ldquo;circuit inspected after rain&rdquo;, &ldquo;clerk of the course
          spoke to car 42&rdquo;.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-medium">
            Category
            <select
              className="mt-1 w-full rounded-md border border-brand-black/20 px-2 py-1.5 text-sm"
              value={category}
              onChange={(e) => setCategory(e.target.value as LogCategory)}
            >
              {Object.entries(LOG_CATEGORY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium">
            Session
            <select
              className="mt-1 w-full rounded-md border border-brand-black/20 px-2 py-1.5 text-sm"
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
            >
              <option value="">Not session-specific</option>
              {sessions.data?.map((session) => (
                <option key={session.id} value={session.id}>
                  {session.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="block text-sm font-medium">
          What happened
          <input
            className="mt-1 w-full rounded-md border border-brand-black/20 px-2 py-1.5 text-sm"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="Circuit inspected after rain, track declared fit"
          />
        </label>
        <label className="block text-sm font-medium">
          Detail <span className="text-brand-black/50">(optional)</span>
          <textarea
            rows={2}
            className="mt-1 w-full rounded-md border border-brand-black/20 px-2 py-1.5 text-sm"
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={published}
            onChange={(e) => setPublished(e.target.checked)}
          />
          Put this in the public bulletin
        </label>
        {add.error && <p className="text-sm text-brand-red">{add.error.message}</p>}
        <Button
          size="sm"
          variant="primary"
          disabled={add.isPending || summary.trim().length < 3}
          onClick={() =>
            add.mutate({
              eventId,
              category,
              sessionId: sessionId || undefined,
              summary: summary.trim(),
              detail: detail.trim() || undefined,
              published,
            })
          }
        >
          {add.isPending ? "Logging…" : "Add to log"}
        </Button>
      </CardContent>
    </Card>
  );
}
