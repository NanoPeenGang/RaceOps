"use client";

import Link from "next/link";
import { api } from "@/lib/trpc/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ListSkeleton } from "@/components/ui/skeleton";
import { EmptyState, PageHeader } from "@/components/ui/page";

/** Public feed of published race reports. */
export default function ReportsPage() {
  const feed = api.report.feed.useInfiniteQuery(
    {},
    { getNextPageParam: (page) => page.nextCursor },
  );

  const reports = feed.data?.pages.flatMap((page) => page.reports) ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Race reports"
        description="Post-race writeups from the paddock."
        actions={
          <>
            <Link href="/reports/new">
              <Button variant="primary">Write a report</Button>
            </Link>
          </>
        }
      />

      {feed.isLoading && <ListSkeleton />}
      {!feed.isLoading && reports.length === 0 && (
        <EmptyState
          title="Nothing written up yet"
          description="Race reports are how a weekend gets remembered by people who were not there."
          action={
            <Link href="/reports/new">
              <Button variant="primary">Write the first one</Button>
            </Link>
          }
        />
      )}

      <div className="space-y-3">
        {reports.map((report) => (
          <Card key={report.id}>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <CardTitle>
                  <Link
                    href={`/reports/${report.id}`}
                    className="hover:text-brand-red"
                  >
                    {report.title}
                  </Link>
                </CardTitle>
                <span className="text-xs text-brand-black/60">
                  {new Date(report.createdAt).toLocaleDateString()}
                </span>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-xs text-brand-black/60">
                {report.author.profile?.displayName ?? "Unnamed"}
                {report.event ? ` · ${report.event.name}` : ""}
                {report._count.mediaAttachments > 0
                  ? ` · ${report._count.mediaAttachments} media`
                  : ""}
              </p>
              <p className="line-clamp-3 text-sm text-brand-black/80">
                {report.body}
              </p>
              {report.tags.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {report.tags.map((tag) => (
                    <Badge key={tag}>{tag}</Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {feed.hasNextPage && (
        <Button
          variant="outline"
          disabled={feed.isFetchingNextPage}
          onClick={() => feed.fetchNextPage()}
        >
          {feed.isFetchingNextPage ? "Loading…" : "Load more"}
        </Button>
      )}
    </div>
  );
}
