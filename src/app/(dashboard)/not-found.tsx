import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * A dashboard route that does not exist, or a record that does not.
 *
 * The consoles call `notFound()` for both — a mistyped URL and an event
 * somebody deleted look the same from here, and deliberately so: telling
 * somebody a record exists but is not theirs is how a directory of private
 * teams gets enumerated one id at a time.
 *
 * The links are the point. A 404 with nothing on it is where a session ends.
 */
export default function DashboardNotFound() {
  return (
    <div className="mx-auto max-w-md space-y-4 py-10 text-center">
      <h1 className="text-2xl font-bold">Not here</h1>
      <p className="text-sm text-brand-black/60">
        This page does not exist, or what was on it has been removed. If you
        followed a link from somewhere else, it may be out of date.
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <Link href="/home">
          <Button variant="primary">Home</Button>
        </Link>
        <Link href="/events">
          <Button variant="outline">Browse events</Button>
        </Link>
        <Link href="/search">
          <Button variant="outline">Discover people</Button>
        </Link>
      </div>
    </div>
  );
}
