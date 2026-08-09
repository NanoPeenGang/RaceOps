import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { TRPCError } from "@trpc/server";
import { serverApi } from "@/server/trpc/server-caller";
import { ScanStation } from "./scan-station";

/**
 * Scanning parts in and out of the trailer.
 *
 * Its own page rather than a tab on the team console, for the same reason gate
 * control is: it is used standing up, on a phone, by somebody with a gearbox
 * in the other hand. Nothing else belongs on it, and the console's seven tabs
 * would be actively in the way.
 *
 * Authorization is checked here and again on every scan, so a crew member
 * whose membership ends does not keep a working scanner open in a tab.
 */

export const metadata: Metadata = {
  title: "Scan parts · RaceOps",
  robots: { index: false, follow: false },
};

export default async function ScanPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const api = await serverApi();

  let team;
  try {
    team = await api.team.bySlug({ slug });
  } catch (error) {
    if (error instanceof TRPCError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  if (!team) notFound();

  // The garage read is the authorization check; it also warms the cache for
  // the item list the station falls back to when a camera will not start.
  try {
    await api.garage.inventory({ teamId: team.id });
  } catch (error) {
    if (
      error instanceof TRPCError &&
      (error.code === "FORBIDDEN" || error.code === "UNAUTHORIZED")
    ) {
      return (
        <div className="mx-auto max-w-md space-y-3 p-4 text-center">
          <h1 className="text-xl font-semibold">Scan parts</h1>
          <p className="text-sm text-brand-black/60">
            The garage is for {team.name}&rsquo;s current members. Ask a manager
            to add you, then reload.
          </p>
          <Link
            href={`/teams/${slug}`}
            className="inline-block text-sm text-brand-red hover:underline"
          >
            ← Back to the team
          </Link>
        </div>
      );
    }
    throw error;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <header className="space-y-1">
        <Link
          href={`/teams/${slug}/manage?tab=garage`}
          className="text-sm text-brand-red hover:underline"
        >
          ← {team.name} garage
        </Link>
        <h1 className="text-xl font-semibold">Scan parts</h1>
      </header>
      <ScanStation teamId={team.id} teamSlug={slug} />
    </div>
  );
}
