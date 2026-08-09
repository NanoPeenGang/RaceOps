"use client";

import Link from "next/link";
import { api } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ListSkeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/ui/page";

export default function NotificationsPage() {
  const utils = api.useUtils();
  const notifications = api.notification.list.useQuery({});
  const markAllRead = api.notification.markAllRead.useMutation({
    onSuccess: () => {
      utils.notification.list.invalidate();
      utils.notification.unreadCount.invalidate();
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <PageHeader title="Notifications" />
        <Button
          variant="outline"
          size="sm"
          disabled={markAllRead.isPending}
          onClick={() => markAllRead.mutate()}
        >
          Mark all read
        </Button>
      </div>
      {notifications.isLoading && <ListSkeleton />}
      {notifications.data?.items.length === 0 && (
        <p className="text-brand-black/60">Nothing yet.</p>
      )}
      <div className="space-y-3">
        {notifications.data?.items.map((notification) => (
          <Card
            key={notification.id}
            className={notification.readAt ? "opacity-70" : ""}
          >
            <CardContent className="flex items-center justify-between p-4">
              <div>
                <p className="text-sm font-medium">{notification.title}</p>
                {notification.body && (
                  <p className="mt-1 line-clamp-2 text-xs text-brand-black/60">
                    {notification.body}
                  </p>
                )}
                <p className="mt-1 text-xs text-brand-black/40">
                  {new Date(notification.createdAt).toLocaleString()}
                </p>
              </div>
              {notification.linkUrl && (
                <Link
                  href={notification.linkUrl}
                  className="text-sm font-medium text-brand-red hover:underline"
                >
                  View
                </Link>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
