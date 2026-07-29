"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/** Write a race report, optionally against an event on the calendar. */
export default function NewReportPage() {
  const router = useRouter();
  const events = api.event.listPublished.useQuery({ limit: 50 });

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [eventId, setEventId] = useState("");
  const [tags, setTags] = useState("");

  const create = api.report.create.useMutation({
    onSuccess: (report) => router.push(`/reports/${report.id}`),
  });

  const submit = (published: boolean) =>
    create.mutate({
      title: title.trim(),
      body: body.trim(),
      eventId: eventId || undefined,
      tags: tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
      published,
    });

  return (
    <div className="space-y-6">
      <div>
        <Link href="/reports" className="text-sm text-brand-red hover:underline">
          ← Race reports
        </Link>
        <h1 className="mt-1 text-3xl font-bold">Write a report</h1>
      </div>

      <Card className="max-w-3xl">
        <CardContent className="space-y-4 p-5">
          <label className="block text-sm font-medium">
            Title
            <input
              className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Six hours in the rain at Spa"
            />
          </label>

          <label className="block text-sm font-medium">
            Event <span className="text-brand-black/50">(optional)</span>
            <select
              className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
              value={eventId}
              onChange={(e) => setEventId(e.target.value)}
            >
              <option value="">Not tied to an event</option>
              {events.data?.items.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.name} · {new Date(event.date).toLocaleDateString()}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm font-medium">
            Report
            <textarea
              rows={16}
              className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="How the race went…"
            />
          </label>

          <label className="block text-sm font-medium">
            Tags <span className="text-brand-black/50">(comma separated)</span>
            <input
              className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="endurance, gt3, spa"
            />
          </label>

          {create.error && (
            <p className="text-sm text-brand-red">{create.error.message}</p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              disabled={
                create.isPending || title.trim().length < 3 || !body.trim()
              }
              onClick={() => submit(true)}
            >
              {create.isPending ? "Publishing…" : "Publish"}
            </Button>
            <Button
              variant="outline"
              disabled={
                create.isPending || title.trim().length < 3 || !body.trim()
              }
              onClick={() => submit(false)}
            >
              Save as draft
            </Button>
          </div>
          <p className="text-xs text-brand-black/60">
            Media can be attached once the report exists.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
