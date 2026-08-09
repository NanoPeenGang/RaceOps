import { PageSkeleton } from "@/components/ui/skeleton";

/**
 * What every dashboard route shows while its server components resolve.
 *
 * One boundary for the whole group rather than a file per route. A generic
 * header-plus-list is right for most of the consoles, and the pages whose
 * shape is genuinely different — timing, standings — can add their own
 * `loading.tsx` next to themselves without this being in the way.
 *
 * Without any boundary at all, Next holds the previous page on screen until
 * the new one is ready, so a tap on a slow link looks like a tap that did
 * nothing.
 */
export default function DashboardLoading() {
  return <PageSkeleton />;
}
