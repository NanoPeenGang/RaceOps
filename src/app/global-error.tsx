"use client";

/**
 * The last resort: the root layout itself failed.
 *
 * Replaces `<html>` and `<body>`, so it cannot use the app's header, fonts or
 * providers — none of them exist by the time this renders. That is why the
 * styles here are inline rather than Tailwind classes: a failure in the layout
 * is exactly the failure that can take the stylesheet with it.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          margin: 0,
          padding: "3rem 1.5rem",
          textAlign: "center",
          background: "#FAFAFA",
          color: "#111",
        }}
      >
        <h1 style={{ fontSize: "1.5rem", margin: "0 0 0.5rem" }}>
          RaceOps could not start
        </h1>
        <p style={{ color: "#555", margin: "0 0 1.5rem" }}>
          Something failed before the page could load. Reloading usually fixes
          it.
        </p>
        <button
          type="button"
          onClick={reset}
          style={{
            padding: "0.6rem 1.2rem",
            borderRadius: "0.375rem",
            border: "none",
            background: "#E10600",
            color: "#fff",
            fontSize: "1rem",
            cursor: "pointer",
          }}
        >
          Reload
        </button>
        {error.digest && (
          <p style={{ color: "#888", fontSize: "0.75rem", marginTop: "1.5rem" }}>
            Reference {error.digest}
          </p>
        )}
      </body>
    </html>
  );
}
