import { NextResponse } from "next/server";
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isProtectedRoute = createRouteMatcher([
  "/profile(.*)",
  "/teams(.*)",
  "/opportunities(.*)",
  "/strategy(.*)",
  "/community(.*)",
  "/search(.*)",
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
      return new NextResponse(
        [
          "RaceOps deployment is missing its authentication configuration.",
          "",
          "Set the following environment variables (Vercel: Project Settings -> Environment Variables), then redeploy:",
          "  - NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
          "  - CLERK_SECRET_KEY",
          "  - DATABASE_URL",
          "",
          "NEXT_PUBLIC_* values are inlined at build time, so a redeploy after setting them is required.",
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
