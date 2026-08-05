"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/trpc/client";
import {
  relativeTime,
  sortInbox,
  threadTitle,
} from "@/lib/direct-messages";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/page";
import { DirectThread } from "@/components/direct-thread";

/**
 * Direct messages.
 *
 * A two-pane inbox on a wide screen and a stack on a phone — an engineer
 * reading this in a paddock has a phone, and a list that has to be scrolled
 * past to reach the conversation is a list in the way.
 */
export default function MessagesPage() {
  return (
    <Suspense fallback={<p className="text-brand-black/60">Loading\u2026</p>}>
      <Inbox />
    </Suspense>
  );
}

function Inbox() {
  const utils = api.useUtils();
  // Deep link from a "Message" button elsewhere: the thread is already open by
  // the time the inbox loads, which is the whole point of pressing it.
  const requested = useSearchParams().get("thread");
  const inbox = api.message.inbox.useQuery(
    {},
    { refetchInterval: 30_000 },
  );
  const [picked, setPicked] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const openId = picked ?? requested;
  const setOpenId = setPicked;

  const threads = sortInbox(inbox.data?.threads ?? []);
  const myUserId = inbox.data?.myUserId ?? "";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Messages"
        description="Conversations with anyone on RaceOps — no team, series or event required. This is where you ask another team's engineer what they ran, or sort out a seat for next month."
        actions={
          <Button
            variant="primary"
            onClick={() => setStarting((open) => !open)}
          >
            {starting ? "Cancel" : "New message"}
          </Button>
        }
      />

      {starting && (
        <NewMessage
          onOpened={(threadId) => {
            setStarting(false);
            setOpenId(threadId);
            utils.message.inbox.invalidate();
          }}
        />
      )}

      {inbox.isLoading && <p className="text-brand-black/60">Loading…</p>}

      {!inbox.isLoading && threads.length === 0 && !starting && (
        <EmptyState
          title="No messages yet"
          description="Start one from here, or from anybody's profile."
        />
      )}

      {threads.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <div className="space-y-2">
            {threads.map((thread) => (
              <button
                key={thread.id}
                type="button"
                className={`w-full rounded-lg border p-3 text-left transition-colors ${
                  openId === thread.id
                    ? "border-brand-red bg-brand-red/[0.04]"
                    : "border-brand-black/10 hover:bg-brand-black/[0.03]"
                }`}
                onClick={() => setOpenId(thread.id)}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span
                    className={`truncate text-sm ${
                      thread.unread > 0 ? "font-semibold" : "font-medium"
                    }`}
                  >
                    {threadTitle(thread, myUserId)}
                  </span>
                  <span className="shrink-0 text-xs text-brand-black/50">
                    {relativeTime(thread.lastMessageAt)}
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-xs text-brand-black/60">
                    {thread.lastMessage?.body ?? "No messages yet"}
                  </span>
                  {thread.unread > 0 && (
                    <span className="shrink-0 rounded-full bg-brand-red px-1.5 text-xs font-semibold text-white">
                      {thread.unread}
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>

          <div>
            {openId ? (
              <DirectThread threadId={openId} />
            ) : (
              <Card>
                <CardContent className="p-8 text-center text-sm text-brand-black/55">
                  Pick a conversation.
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Starting a conversation.
 *
 * Search rather than a dropdown of "people you know": the platform has no such
 * list, and inventing one from teams and entries would quietly make it
 * impossible to message the person you have not met yet — which is most of the
 * reason this feature exists.
 */
function NewMessage({
  onOpened,
}: {
  onOpened: (threadId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const candidates = api.search.profiles.useQuery(
    { query, limit: 8 },
    { enabled: query.trim().length >= 2 },
  );
  const open = api.message.openWith.useMutation({
    onSuccess: (result) => onOpened(result.threadId),
  });

  return (
    <Card className="max-w-xl">
      <CardContent className="space-y-3 p-5">
        <label className="block text-sm font-medium">
          Who do you want to message?
          <input
            className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name"
          />
        </label>

        {query.trim().length >= 2 && (
          <ul className="space-y-1">
            {(candidates.data?.users ?? []).map((person) => (
              <li key={person.id}>
                <button
                  type="button"
                  className="w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-brand-black/5 disabled:opacity-50"
                  disabled={open.isPending}
                  onClick={() => open.mutate({ userIds: [person.id] })}
                >
                  {person.profile?.displayName ?? "Unnamed"}
                  {person.profile?.location && (
                    <span className="ml-2 text-xs text-brand-black/50">
                      {person.profile.location}
                    </span>
                  )}
                </button>
              </li>
            ))}
            {candidates.data?.users.length === 0 && (
              <li className="px-2 text-sm text-brand-black/55">
                Nobody by that name.
              </li>
            )}
          </ul>
        )}

        {open.error && (
          <p className="text-sm text-brand-red">{open.error.message}</p>
        )}
      </CardContent>
    </Card>
  );
}
