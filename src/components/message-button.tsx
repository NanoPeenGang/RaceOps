"use client";

import { useRouter } from "next/navigation";
import { api } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";

/**
 * "Message" next to somebody's name.
 *
 * Opens the existing conversation if there is one and starts it if there is
 * not — the server's `pairKey` makes that idempotent, so pressing this from
 * three different pages lands in one thread rather than three.
 *
 * Renders nothing for your own row: a button to message yourself is noise
 * everywhere it appears.
 */
export function MessageButton({
  userId,
  myUserId,
  label = "Message",
  size = "sm",
}: {
  userId: string;
  myUserId?: string | null;
  label?: string;
  size?: "sm" | "default";
}) {
  const router = useRouter();
  const open = api.message.openWith.useMutation({
    onSuccess: (result) => router.push(`/messages?thread=${result.threadId}`),
  });

  if (myUserId && myUserId === userId) return null;

  return (
    <Button
      size={size}
      variant="outline"
      disabled={open.isPending}
      onClick={() => open.mutate({ userIds: [userId] })}
    >
      {open.isPending ? "Opening…" : label}
    </Button>
  );
}
