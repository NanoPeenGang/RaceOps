import Link from "next/link";
import {
  DOCUMENT_DESCRIPTIONS,
  DOCUMENT_TITLES,
  GENERATED_DOCUMENTS,
  isOrganizerOnly,
} from "@/lib/race-documents";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Links to the documents built from the event's own data.
 *
 * Deliberately separate from the uploaded-documents panel: these are views,
 * not files. An uploaded entry list is wrong the moment somebody withdraws and
 * nobody re-uploads it; a generated one cannot be.
 */
export function GeneratedDocuments({
  eventId,
  /** Organizer-only sheets are hidden unless the reader is one. */
  canManage = false,
}: {
  eventId: string;
  canManage?: boolean;
}) {
  const documents = GENERATED_DOCUMENTS.filter(
    (document) => canManage || !isOrganizerOnly(document),
  );

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-xl font-semibold">Printable sheets</h2>
        <p className="text-sm text-brand-black/60">
          Built from the entries and schedule as they stand right now — they
          cannot go stale between revisions.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {documents.map((document) => (
          <Card key={document}>
            <CardContent className="p-4">
              <Link
                href={`/events/${eventId}/print/${document}`}
                className="font-medium hover:text-brand-red"
              >
                {DOCUMENT_TITLES[document]}
              </Link>
              <p className="mt-1 text-xs text-brand-black/60">
                {DOCUMENT_DESCRIPTIONS[document]}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
