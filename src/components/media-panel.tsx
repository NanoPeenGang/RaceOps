"use client";

import { useState } from "react";
import { MediaVisibility } from "@prisma/client";
import { api } from "@/lib/trpc/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Scope = {
  seriesId?: string;
  eventId?: string;
  teamId?: string;
  penaltyId?: string;
  appealId?: string;
  reportId?: string;
  incidentId?: string;
};

/**
 * Media library for one scope. Items are registered by URL — upload the file
 * to your storage (Cloudflare Images / R2 / S3) and paste the delivered URL.
 */
export function MediaPanel({
  scope,
  title = "Media",
  description,
  canManage,
  allowOrganizerOnly = false,
}: {
  scope: Scope;
  title?: string;
  description?: string;
  canManage: boolean;
  allowOrganizerOnly?: boolean;
}) {
  const utils = api.useUtils();
  const media = api.media.forScope.useQuery(scope);
  const [showForm, setShowForm] = useState(false);
  const [url, setUrl] = useState("");
  const [mediaTitle, setMediaTitle] = useState("");
  const [kind, setKind] = useState<"image" | "video" | "telemetry" | "document">(
    "image",
  );
  const [visibility, setVisibility] = useState<MediaVisibility>(
    MediaVisibility.PUBLIC,
  );

  const invalidate = () => utils.media.forScope.invalidate(scope);
  const attach = api.media.attach.useMutation({
    onSuccess: () => {
      setUrl("");
      setMediaTitle("");
      setShowForm(false);
      invalidate();
    },
  });
  const remove = api.media.remove.useMutation({ onSuccess: invalidate });

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>{title}</CardTitle>
          {canManage && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowForm((v) => !v)}
            >
              {showForm ? "Cancel" : "Add media"}
            </Button>
          )}
        </div>
        {description && (
          <p className="text-xs text-brand-black/60">{description}</p>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {showForm && canManage && (
          <div className="space-y-3 rounded-lg border border-brand-black/10 p-3">
            <label className="block text-sm font-medium">
              Media URL
              <input
                className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://imagedelivery.net/…"
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm font-medium">
                Title
                <input
                  className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
                  value={mediaTitle}
                  onChange={(e) => setMediaTitle(e.target.value)}
                  placeholder="Turn 4 incident — onboard"
                />
              </label>
              <label className="block text-sm font-medium">
                Type
                <select
                  className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
                  value={kind}
                  onChange={(e) =>
                    setKind(e.target.value as typeof kind)
                  }
                >
                  <option value="image">Image</option>
                  <option value="video">Video</option>
                  <option value="telemetry">Telemetry</option>
                  <option value="document">Document</option>
                </select>
              </label>
            </div>
            {allowOrganizerOnly && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={visibility === MediaVisibility.ORGANIZERS_ONLY}
                  onChange={(e) =>
                    setVisibility(
                      e.target.checked
                        ? MediaVisibility.ORGANIZERS_ONLY
                        : MediaVisibility.PUBLIC,
                    )
                  }
                />
                Organizers only (hide from the public record)
              </label>
            )}
            {attach.error && (
              <p className="text-xs text-brand-red">{attach.error.message}</p>
            )}
            <Button
              size="sm"
              variant="primary"
              disabled={attach.isPending || !url.trim()}
              onClick={() =>
                attach.mutate({
                  url: url.trim(),
                  kind,
                  title: mediaTitle.trim() || undefined,
                  visibility,
                  scope,
                })
              }
            >
              {attach.isPending ? "Adding…" : "Attach"}
            </Button>
          </div>
        )}

        {media.isLoading && (
          <p className="text-sm text-brand-black/60">Loading…</p>
        )}
        {media.data?.length === 0 && (
          <p className="text-sm text-brand-black/60">No media yet.</p>
        )}
        <ul className="space-y-2">
          {media.data?.map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-brand-black/10 p-3"
            >
              <div className="min-w-0">
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-all text-sm font-medium text-brand-red hover:underline"
                >
                  {item.title || item.url}
                </a>
                <p className="text-xs text-brand-black/60">
                  {item.kind} · {item.owner.profile?.displayName ?? "Unknown"} ·{" "}
                  {new Date(item.createdAt).toLocaleDateString()}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {item.visibility === MediaVisibility.ORGANIZERS_ONLY && (
                  <Badge>Organizers only</Badge>
                )}
                {canManage && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate({ mediaId: item.id })}
                  >
                    Remove
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
        {remove.error && (
          <p className="text-xs text-brand-red">{remove.error.message}</p>
        )}
      </CardContent>
    </Card>
  );
}
