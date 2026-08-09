"use client";

import { use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/trpc/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MediaPanel } from "@/components/media-panel";
import { PageSkeleton } from "@/components/ui/skeleton";

/** A single race report. The author gets publish/unpublish and delete here. */
export default function ReportPage({
  params,
}: {
  params: Promise<{ reportId: string }>;
}) {
  const { reportId } = use(params);
  const router = useRouter();
  const utils = api.useUtils();
  const report = api.report.byId.useQuery(
    { reportId },
    { meta: { silenceError: true } },
  );

  const update = api.report.update.useMutation({
    meta: { silenceError: true },
    onSuccess: () => utils.report.byId.invalidate({ reportId }),
  });
  const remove = api.report.remove.useMutation({
    onSuccess: () => router.push("/reports"),
  });

  if (report.isLoading) return <PageSkeleton />;
  if (report.error)
    return <p className="text-brand-red">{report.error.message}</p>;
  const data = report.data!;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/reports"
          className="text-sm text-brand-red hover:underline"
        >
          ← Race reports
        </Link>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-3xl font-bold">{data.title}</h1>
          {!data.published && <Badge>Draft</Badge>}
        </div>
        <p className="mt-1 text-sm text-brand-black/60">
          {data.author.profile?.displayName ?? "Unnamed"} ·{" "}
          {new Date(data.createdAt).toLocaleDateString()}
          {data.event ? " · " : ""}
          {data.event && (
            <Link
              href={`/events/${data.event.id}`}
              className="text-brand-red hover:underline"
            >
              {data.event.name}
            </Link>
          )}
        </p>
      </div>

      {data.tags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {data.tags.map((tag) => (
            <Badge key={tag}>{tag}</Badge>
          ))}
        </div>
      )}

      <article className="max-w-3xl whitespace-pre-wrap text-sm leading-relaxed text-brand-black/85">
        {data.body}
      </article>

      {data.isAuthor && (
        <div className="flex flex-wrap items-center gap-2 border-t border-brand-black/10 pt-4">
          <Button
            size="sm"
            variant="outline"
            disabled={update.isPending}
            onClick={() =>
              update.mutate({ reportId, published: !data.published })
            }
          >
            {data.published ? "Unpublish" : "Publish"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={remove.isPending}
            onClick={() => remove.mutate({ reportId })}
          >
            Delete report
          </Button>
          {(update.error ?? remove.error) && (
            <p className="text-sm text-brand-red">
              {update.error?.message ?? remove.error?.message}
            </p>
          )}
        </div>
      )}

      <MediaPanel
        scope={{ reportId }}
        title="Media"
        description="Photos, video and telemetry from the race."
        canManage={data.isAuthor}
      />
    </div>
  );
}
