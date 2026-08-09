"use client";

import { useState } from "react";
import { AnnouncementUrgency } from "@prisma/client";
import { api } from "@/lib/trpc/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const URGENCY_LABELS: Record<AnnouncementUrgency, string> = {
  INFO: "Info",
  IMPORTANT: "Important",
  URGENT: "Urgent",
};

/** Urgent notices must read at a glance from a marshal post. */
const URGENCY_STYLES: Record<AnnouncementUrgency, string> = {
  INFO: "border-brand-black/10",
  IMPORTANT: "border-yellow-500/50 bg-yellow-50",
  URGENT: "border-brand-red/50 bg-brand-red/5",
};

type Scope = { seriesId?: string; eventId?: string };

/**
 * Organizer notices for a series or event — schedule changes, paddock notes,
 * anything competitors need pushed to them rather than left in a document.
 */
export function AnnouncementsPanel({
  scope,
  canManage,
  title = "Announcements",
}: {
  scope: Scope;
  canManage: boolean;
  title?: string;
}) {
  const utils = api.useUtils();
  const announcements = api.document.listAnnouncements.useQuery(scope);
  const [showForm, setShowForm] = useState(false);

  const invalidate = () => utils.document.listAnnouncements.invalidate(scope);
  const post = api.document.postAnnouncement.useMutation({
    meta: { silenceError: true },
    onSuccess: () => {
      setShowForm(false);
      setNoticeTitle("");
      setBody("");
      invalidate();
    },
  });
  const remove = api.document.removeAnnouncement.useMutation({
    onSuccess: invalidate,
  });

  const [noticeTitle, setNoticeTitle] = useState("");
  const [body, setBody] = useState("");
  const [urgency, setUrgency] = useState<AnnouncementUrgency>(
    AnnouncementUrgency.INFO,
  );
  const [pinned, setPinned] = useState(false);
  const [notify, setNotify] = useState(true);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold">{title}</h2>
        {canManage && (
          <Button
            size="sm"
            variant="primary"
            onClick={() => setShowForm((v) => !v)}
          >
            {showForm ? "Cancel" : "Post notice"}
          </Button>
        )}
      </div>

      {showForm && canManage && (
        <Card className="max-w-2xl">
          <CardContent className="space-y-4 p-5">
            <label className="block text-sm font-medium">
              Title
              <input
                className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
                value={noticeTitle}
                onChange={(e) => setNoticeTitle(e.target.value)}
                placeholder="Sunday warm-up moved to 09:15"
              />
            </label>
            <label className="block text-sm font-medium">
              Notice
              <textarea
                rows={4}
                className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-medium">
                Urgency
                <select
                  className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
                  value={urgency}
                  onChange={(e) =>
                    setUrgency(e.target.value as AnnouncementUrgency)
                  }
                >
                  {Object.values(AnnouncementUrgency).map((u) => (
                    <option key={u} value={u}>
                      {URGENCY_LABELS[u]}
                    </option>
                  ))}
                </select>
              </label>
              <div className="space-y-2 pt-6">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={pinned}
                    onChange={(e) => setPinned(e.target.checked)}
                  />
                  Pin to the top
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={notify}
                    onChange={(e) => setNotify(e.target.checked)}
                  />
                  Notify everyone entered
                </label>
              </div>
            </div>
            {post.error && (
              <p className="text-sm text-brand-red">{post.error.message}</p>
            )}
            <Button
              variant="primary"
              disabled={
                post.isPending ||
                noticeTitle.trim().length < 2 ||
                body.trim().length < 1
              }
              onClick={() =>
                post.mutate({
                  scope,
                  title: noticeTitle.trim(),
                  body: body.trim(),
                  urgency,
                  pinned,
                  notifyCompetitors: notify,
                })
              }
            >
              {post.isPending ? "Posting…" : "Post notice"}
            </Button>
          </CardContent>
        </Card>
      )}

      {announcements.isLoading && (
        <p className="text-brand-black/60">Loading…</p>
      )}
      {announcements.data?.length === 0 && (
        <p className="text-brand-black/60">No notices posted.</p>
      )}

      <div className="space-y-2">
        {announcements.data?.map((notice) => (
          <Card key={notice.id} className={URGENCY_STYLES[notice.urgency]}>
            <CardContent className="space-y-2 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{notice.title}</p>
                  <p className="text-xs text-brand-black/60">
                    {notice.author.profile?.displayName ?? "Organizer"} ·{" "}
                    {new Date(notice.createdAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {notice.pinned && <Badge>Pinned</Badge>}
                  {notice.urgency !== AnnouncementUrgency.INFO && (
                    <Badge variant="verified">
                      {URGENCY_LABELS[notice.urgency]}
                    </Badge>
                  )}
                  {canManage && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={remove.isPending}
                      onClick={() =>
                        remove.mutate({ announcementId: notice.id })
                      }
                    >
                      Delete
                    </Button>
                  )}
                </div>
              </div>
              <p className="whitespace-pre-wrap text-sm text-brand-black/80">
                {notice.body}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
      {remove.error && (
        <p className="text-sm text-brand-red">{remove.error.message}</p>
      )}
    </section>
  );
}
