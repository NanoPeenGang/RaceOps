"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export type ChatScope = {
  eventId?: string;
  teamId?: string;
  channelId?: string;
};

/**
 * A chat room. Access is enforced on the server — event paddock chat is for
 * entrants, volunteers and organizers; team chat is for the current roster;
 * a department channel is for whoever holds its roles — so a FORBIDDEN
 * response is the normal case for everyone else and renders as a quiet notice
 * rather than an error.
 *
 * Direct threads are deliberately not a scope here: they carry read marks and
 * an inbox, so they have their own view rather than being squeezed into this
 * one with half its features inert.
 */
export function PaddockChat({
  scope,
  title = "Paddock chat",
  placeholder = "Message the paddock",
  heading = true,
  readOnly = false,
  readOnlyNotice,
}: {
  scope: ChatScope;
  title?: string;
  placeholder?: string;
  /** Off when the room already sits under a heading of its own. */
  heading?: boolean;
  readOnly?: boolean;
  readOnlyNotice?: string;
}) {
  const utils = api.useUtils();
  const chat = api.chat.forRoom.useQuery(
    { scope },
    { refetchInterval: 10000, retry: false },
  );
  const [body, setBody] = useState("");
  const scroller = useRef<HTMLDivElement>(null);

  const refresh = () => utils.chat.forRoom.invalidate({ scope });
  const send = api.chat.send.useMutation({
    onSuccess: () => {
      setBody("");
      refresh();
    },
  });
  const remove = api.chat.remove.useMutation({ onSuccess: refresh });

  const messages = chat.data?.messages;
  useEffect(() => {
    // Keep the newest message in view as the transcript grows.
    const node = scroller.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages]);

  if (chat.error) {
    return (
      <section className="space-y-2">
        {heading && <h2 className="text-xl font-semibold">{title}</h2>}
        <p className="text-sm text-brand-black/60">{chat.error.message}</p>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      {heading && <h2 className="text-xl font-semibold">{title}</h2>}
      <Card>
        <CardContent className="space-y-3 p-4">
          <div
            ref={scroller}
            className="max-h-80 space-y-3 overflow-y-auto"
            aria-live="polite"
          >
            {chat.isLoading && <p className="text-brand-black/60">Loading…</p>}
            {messages?.length === 0 && (
              <p className="text-brand-black/60">
                Nothing posted yet — say hello.
              </p>
            )}
            {messages?.map((message) => {
              const isMine = message.userId === chat.data?.myUserId;
              return (
                <div key={message.id} className="group text-sm">
                  <div className="flex items-baseline gap-2">
                    <span className="font-medium">
                      {message.user.profile?.displayName ?? "Unnamed"}
                    </span>
                    <span className="text-xs text-brand-black/50">
                      {new Date(message.createdAt).toLocaleTimeString(
                        undefined,
                        { hour: "2-digit", minute: "2-digit" },
                      )}
                    </span>
                    {(isMine || chat.data?.canModerate) && (
                      <button
                        type="button"
                        className="text-xs text-brand-black/40 hover:text-brand-red"
                        disabled={remove.isPending}
                        onClick={() =>
                          remove.mutate({ messageId: message.id })
                        }
                      >
                        Delete
                      </button>
                    )}
                  </div>
                  <p className="whitespace-pre-wrap text-brand-black/80">
                    {message.body}
                  </p>
                </div>
              );
            })}
          </div>

          {readOnly ? (
            <p className="rounded-md bg-brand-black/[0.03] px-3 py-2 text-sm text-brand-black/60">
              {readOnlyNotice ??
                "This room is archived. It can be read but not posted to."}
            </p>
          ) : (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (body.trim()) send.mutate({ scope, body: body.trim() });
            }}
          >
            <input
              className="flex-1 rounded-md border border-brand-black/20 px-3 py-2 text-sm"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={placeholder}
              maxLength={2000}
            />
            <Button
              type="submit"
              variant="primary"
              disabled={send.isPending || body.trim().length === 0}
            >
              Send
            </Button>
          </form>
          )}
          {send.error && (
            <p className="text-sm text-brand-red">{send.error.message}</p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
