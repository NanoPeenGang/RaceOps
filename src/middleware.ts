import { NextResponse } from "next/server";
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isProtectedRoute = createRouteMatcher([
  "/profile(.*)",
  "/teams(.*)",
  "/opportunities(.*)",
  "/strategy(.*)",
  "/community(.*)",
  "/search(.*)",
  "/applications(.*)",
  "/billing(.*)",
  "/notifications(.*)",
]);

/**
 * Without Clerk keys, clerkMiddleware throws on every request and the
 * deployment surfaces an opaque MIDDLEWARE_INVOCATION_FAILED 500. Fail with
 * an explicit message instead so misconfigured deploys are diagnosable.
 */
const clerkConfigured = Boolean(
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY,
);

export default clerkConfigured
  ? clerkMiddleware(async (auth, req) => {
      if (isProtectedRoute(req)) {
        await auth.protect();
      }
    })
  : function missingAuthConfig() {
      const missing = [
        !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY &&
          "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
        !process.env.CLERK_SECRET_KEY && "CLERK_SECRET_KEY",
        !process.env.DATABASE_URL && "DATABASE_URL",
      ].filter((name): name is string => Boolean(name));
      return new NextResponse(
        [
          "RaceOps deployment is missing its authentication configuration.",
          "",
          "Environment variables NOT visible to this deployment:",
          ...missing.map((name) => `  - ${name}`),
          "",
          "Checklist (Vercel: Project Settings -> Environment Variables):",
          "  1. The variable names match exactly (no typos, no surrounding quotes in the value).",
          "  2. Each variable is enabled for the Production environment.",
          "  3. After adding/changing them, trigger a NEW deployment and, in the",
          "     Redeploy dialog, UNCHECK 'Use existing Build Cache' —",
          "     NEXT_PUBLIC_* values are baked in at build time, so a cached",
          "     build keeps the old (empty) value.",
          "",
          "See README.md -> 'Deploying to Vercel'.",
        ].join("\n"),
        { status: 503, headers: { "content-type": "text/plain" } },
      );
    };

export const config = {
  matcher: [
    // Skip Next.js internals and static files
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
    // Clerk auto-proxy path (Clerk CLI / proxy setup)
    "/__clerk/:path*",
  ],
};
