"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * What somebody sees when a dashboard page throws.
 *
 * There was no boundary anywhere in the app: an unhandled error rendered a
 * blank white page with no heading, no navigation and no way back except the
 * browser's own back button. On a phone, with the header gone, that is
 * genuinely a dead end.
 *
 * Deliberately does not show the error text. It is a stack trace or a database
 * message — of no use to the person reading it, and occasionally revealing.
 * The digest is shown because it is the one thing that makes a support
 * conversation possible: it matches this render to a line in the server log.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The server log has the server-side ones; this catches the rest.
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-md space-y-4 py-10 text-center">
      <h1 className="text-2xl font-bold">That page did not load</h1>
      <p className="text-sm text-brand-black/60">
        Something went wrong on our side, not yours. Nothing you had already
        saved is affected.
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        {/* Retries the failed render rather than reloading the whole app,
            which is what fixes the common case of one slow query timing out. */}
        <Button variant="primary" onClick={reset}>
          Try again
        </Button>
        <Link href="/home">
          <Button variant="outline">Back to home</Button>
        </Link>
      </div>
      {error.digest && (
        <p className="text-xs text-brand-black/40">
          If you tell us about this, quote{" "}
          <code className="font-mono">{error.digest}</code> — it matches this
          page to a line in our logs.
        </p>
      )}
    </div>
  );
}
