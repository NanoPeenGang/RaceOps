"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/trpc/client";
import { threadTitle } from "@/lib/direct-messages";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * One direct conversation.
 *
 * Separate from `PaddockChat` rather than another scope on it, because a
 * thread carries things a room does not: a read mark, participants who can
 * leave, and no moderator. Squeezing it into the room component would mean
 * half that component's controls being inert here and the read mark being
 * nobody's job.
 */
export function DirectThread({ threadId }: { threadId: string }) {
  const utils = api.useUtils();
  const thread = api.message.thread.useQuery(
    { threadId },
    { refetchInterval: 15_000, retry: false },
  );
  const [body, setBody] = useState("");
  const scroller = useRef<HTMLDivElement>(null);

  const markRead = api.message.markRead.useMutation({
    onSuccess: () => {
      utils.message.inbox.invalidate();
      utils.message.unreadTotal.invalidate();
    },
  });
  const send = api.message.send.useMutation({
    meta: { silenceError: true },
    onSuccess: () => {
      setBody("");
      utils.message.thread.invalidate({ threadId });
      utils.message.inbox.invalidate();
    },
  });
  const leave = api.message.leave.useMutation({
    onSuccess: () => utils.message.inbox.invalidate(),
  });

  const messages = thread.data?.messages;
  const unread = thread.data?.unread ?? 0;

  useEffect(() => {
    const node = scroller.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages]);

  // Opening a thread reads it. Fired only when there is something to clear, so
  // scrolling an inbox does not write a row per thread per poll.
  const markReadMutate = markRead.mutate;
  useEffect(() => {
    if (unread > 0) markReadMutate({ threadId });
  }, [unread, threadId, markReadMutate]);

  if (thread.error) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-brand-black/60">
          {thread.error.message}
        </CardContent>
      </Card>
    );
  }

  const data = thread.data;
  const others =
    data?.thread.participants.filter(
      (participant) => participant.userId !== data.myUserId,
    ) ?? [];

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-brand-black/10 pb-2">
          <div>
            <p className="font-semibold">
              {data
                ? threadTitle(
                    {
                      subject: data.thread.subject,
                      participants: data.thread.participants,
                    },
                    data.myUserId,
                  )
                : "Loading…"}
            </p>
            {others.length > 1 && (
              <p className="text-xs text-brand-black/50">
                {others.length + 1} people
              </p>
            )}
          </div>
          {data && (
            <button
              type="button"
              className="text-xs text-brand-black/50 hover:text-brand-red"
              disabled={leave.isPending}
              onClick={() => leave.mutate({ threadId })}
              title="Hides this conversation for you. The other side keeps theirs, and a reply brings it back."
            >
              Leave
            </button>
          )}
        </div>

        <div
          ref={scroller}
          className="max-h-96 space-y-3 overflow-y-auto"
          aria-live="polite"
        >
          {thread.isLoading && <p className="text-brand-black/60">Loading…</p>}
          {messages?.length === 0 && (
            <p className="text-sm text-brand-black/55">
              Nothing here yet — say what you need.
            </p>
          )}
          {messages?.map((message) => {
            const mine = message.userId === data?.myUserId;
            return (
              <div key={message.id} className="text-sm">
                <div className="flex items-baseline gap-2">
                  <span className="font-medium">
                    {mine
                      ? "You"
                      : (message.user.profile?.displayName ?? "Unnamed")}
                  </span>
                  <span className="text-xs text-brand-black/50">
                    {new Date(message.createdAt).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                <p className="whitespace-pre-wrap text-brand-black/80">
                  {message.body}
                </p>
              </div>
            );
          })}
        </div>

        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (body.trim()) send.mutate({ threadId, body: body.trim() });
          }}
        >
          <input
            className="flex-1 rounded-md border border-brand-black/20 px-3 py-2 text-sm"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Write a message"
            maxLength={4000}
          />
          <Button
            type="submit"
            variant="primary"
            disabled={send.isPending || body.trim().length === 0}
          >
            Send
          </Button>
        </form>
        {send.error && (
          <p className="text-sm text-brand-red">{send.error.message}</p>
        )}
      </CardContent>
    </Card>
  );
}
