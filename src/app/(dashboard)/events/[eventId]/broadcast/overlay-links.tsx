"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * The overlay URL for a session, ready to paste into OBS.
 *
 * A client island because the absolute URL depends on where the app is
 * actually served from — an organizer copying a relative path into a browser
 * source gets nothing, and hard-coding a production host would break every
 * preview deployment.
 */
export function OverlayLinks({ sessionId }: { sessionId: string }) {
  const [copied, setCopied] = useState(false);
  const url =
    typeof window === "undefined"
      ? ""
      : `${window.location.origin}/api/broadcast/${sessionId}`;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <code className="max-w-full truncate rounded bg-brand-black/5 px-2 py-1 text-xs">
        /api/broadcast/{sessionId}
      </code>
      <Button
        size="sm"
        variant="outline"
        onClick={async () => {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
      >
        {copied ? "Copied" : "Copy URL"}
      </Button>
      <a href={url || "#"} target="_blank" rel="noreferrer">
        <Button size="sm" variant="outline">
          Open feed
        </Button>
      </a>
    </div>
  );
}
