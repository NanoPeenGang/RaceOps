"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type ChatScope = { eventId?: string; teamId?: string };

/**
 * A chat room. Access is enforced on the server — event paddock chat is for
 * entrants, volunteers and organizers; team chat is for the current roster —
 * so a FORBIDDEN response is the normal case for everyone else and renders as
 * a quiet notice rather than an error.
 */
export function PaddockChat({
  scope,
  title = "Paddock chat",
  placeholder = "Message the paddock",
}: {
  scope: ChatScope;
  title?: string;
  placeholder?: string;
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
        <h2 className="text-xl font-semibold">{title}</h2>
        <p className="text-sm text-brand-black/60">{chat.error.message}</p>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold">{title}</h2>
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
          {send.error && (
            <p className="text-sm text-brand-red">{send.error.message}</p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
