"use client";

import { useState } from "react";
import { DocumentType, DocumentVisibility } from "@prisma/client";
import { api } from "@/lib/trpc/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  RULEBOOK: "Rule book",
  SUPPLEMENTARY_REGS: "Supplementary regulations",
  TECH_SHEET: "Technical sheet",
  BULLETIN: "Race control bulletin",
  ENTRY_LIST: "Entry list",
  SCHEDULE: "Schedule",
  APPROVED_MEDIA: "Approved media",
  OTHER: "Other",
};

const VISIBILITY_LABELS: Record<DocumentVisibility, string> = {
  PUBLIC: "Public",
  COMPETITORS: "Entrants only",
  ORGANIZERS: "Organizers only",
};

type Scope = { seriesId?: string; eventId?: string };

/**
 * Regulations library for a series or an event: rule books, supplementary
 * regs, tech sheets, bulletins and approved media kits.
 *
 * Files are registered by URL — upload to your storage and paste the delivered
 * URL, the same pattern the media library uses.
 */
export function DocumentsPanel({
  scope,
  canManage,
  title = "Documents",
}: {
  scope: Scope;
  canManage: boolean;
  title?: string;
}) {
  const utils = api.useUtils();
  const documents = api.document.list.useQuery(scope);
  const [showForm, setShowForm] = useState(false);

  const invalidate = () => utils.document.list.invalidate(scope);
  const publish = api.document.publish.useMutation({
    meta: { silenceError: true },
    onSuccess: () => {
      setShowForm(false);
      setDocTitle("");
      setFileUrl("");
      setVersion("");
      setDescription("");
      invalidate();
    },
  });
  const supersede = api.document.supersede.useMutation({
    onSuccess: invalidate,
  });
  const remove = api.document.remove.useMutation({ onSuccess: invalidate });

  const [type, setType] = useState<DocumentType>(DocumentType.RULEBOOK);
  const [docTitle, setDocTitle] = useState("");
  const [description, setDescription] = useState("");
  const [fileUrl, setFileUrl] = useState("");
  const [version, setVersion] = useState("");
  const [visibility, setVisibility] = useState<DocumentVisibility>(
    DocumentVisibility.PUBLIC,
  );
  const [notify, setNotify] = useState(false);
  const [supersedesId, setSupersedesId] = useState("");

  const current = documents.data?.filter((d) => d.supersededAt === null) ?? [];
  const archived = documents.data?.filter((d) => d.supersededAt !== null) ?? [];

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold">{title}</h2>
        {canManage && (
          <Button
            size="sm"
            variant="primary"
            onClick={() => setShowForm((v) => !v)}
          >
            {showForm ? "Cancel" : "Publish document"}
          </Button>
        )}
      </div>

      {showForm && canManage && (
        <Card className="max-w-2xl">
          <CardContent className="space-y-4 p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-medium">
                Type
                <select
                  className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
                  value={type}
                  onChange={(e) => setType(e.target.value as DocumentType)}
                >
                  {Object.values(DocumentType).map((t) => (
                    <option key={t} value={t}>
                      {DOCUMENT_TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium">
                Title
                <input
                  className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
                  value={docTitle}
                  onChange={(e) => setDocTitle(e.target.value)}
                  placeholder="2026 Sporting Regulations"
                />
              </label>
              <label className="block text-sm font-medium sm:col-span-2">
                File URL
                <input
                  className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
                  value={fileUrl}
                  onChange={(e) => setFileUrl(e.target.value)}
                  placeholder="https://…/regulations-v2.pdf"
                />
              </label>
              <label className="block text-sm font-medium">
                Revision <span className="text-brand-black/50">(optional)</span>
                <input
                  className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                  placeholder="v2.1"
                />
              </label>
              <label className="block text-sm font-medium">
                Who can see it
                <select
                  className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
                  value={visibility}
                  onChange={(e) =>
                    setVisibility(e.target.value as DocumentVisibility)
                  }
                >
                  {Object.values(DocumentVisibility).map((v) => (
                    <option key={v} value={v}>
                      {VISIBILITY_LABELS[v]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium sm:col-span-2">
                Notes <span className="text-brand-black/50">(optional)</span>
                <textarea
                  rows={3}
                  className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What changed in this revision"
                />
              </label>
              {current.length > 0 && (
                <label className="block text-sm font-medium sm:col-span-2">
                  Replaces{" "}
                  <span className="text-brand-black/50">(optional)</span>
                  <select
                    className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
                    value={supersedesId}
                    onChange={(e) => setSupersedesId(e.target.value)}
                  >
                    <option value="">Nothing — this is new</option>
                    {current.map((doc) => (
                      <option key={doc.id} value={doc.id}>
                        {doc.title}
                        {doc.version ? ` (${doc.version})` : ""}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={notify}
                onChange={(e) => setNotify(e.target.checked)}
              />
              Notify everyone entered
            </label>

            {publish.error && (
              <p className="text-sm text-brand-red">{publish.error.message}</p>
            )}
            <Button
              variant="primary"
              disabled={
                publish.isPending ||
                docTitle.trim().length < 2 ||
                !fileUrl.trim()
              }
              onClick={() =>
                publish.mutate({
                  scope,
                  type,
                  title: docTitle.trim(),
                  description: description.trim() || undefined,
                  fileUrl: fileUrl.trim(),
                  version: version.trim() || undefined,
                  visibility,
                  supersedesId: supersedesId || undefined,
                  notifyCompetitors: notify,
                })
              }
            >
              {publish.isPending ? "Publishing…" : "Publish"}
            </Button>
          </CardContent>
        </Card>
      )}

      {documents.isLoading && <p className="text-brand-black/60">Loading…</p>}
      {documents.data?.length === 0 && (
        <p className="text-brand-black/60">
          No documents published yet.
          {canManage ? " Publish the rule book so entrants can find it." : ""}
        </p>
      )}

      <div className="space-y-2">
        {current.map((doc) => (
          <DocumentRow
            key={doc.id}
            doc={doc}
            canManage={canManage}
            onSupersede={() => supersede.mutate({ documentId: doc.id })}
            onRemove={() => remove.mutate({ documentId: doc.id })}
            isPending={supersede.isPending || remove.isPending}
          />
        ))}
      </div>

      {archived.length > 0 && (
        <details className="rounded-md border border-brand-black/10 p-3">
          <summary className="cursor-pointer text-sm font-medium text-brand-black/70">
            Superseded revisions ({archived.length})
          </summary>
          <div className="mt-3 space-y-2">
            {archived.map((doc) => (
              <DocumentRow
                key={doc.id}
                doc={doc}
                canManage={canManage}
                onRemove={() => remove.mutate({ documentId: doc.id })}
                isPending={remove.isPending}
              />
            ))}
          </div>
        </details>
      )}

      {(supersede.error ?? remove.error) && (
        <p className="text-sm text-brand-red">
          {supersede.error?.message ?? remove.error?.message}
        </p>
      )}
    </section>
  );
}

function DocumentRow({
  doc,
  canManage,
  onSupersede,
  onRemove,
  isPending,
}: {
  doc: {
    id: string;
    type: DocumentType;
    title: string;
    description: string | null;
    fileUrl: string;
    version: string | null;
    visibility: DocumentVisibility;
    supersededAt: Date | null;
    createdAt: Date;
  };
  canManage: boolean;
  onSupersede?: () => void;
  onRemove: () => void;
  isPending: boolean;
}) {
  return (
    <Card className={doc.supersededAt ? "opacity-60" : undefined}>
      <CardContent className="space-y-2 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <a
              href={doc.fileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-brand-red hover:underline"
            >
              {doc.title}
            </a>
            <p className="text-xs text-brand-black/60">
              {[
                DOCUMENT_TYPE_LABELS[doc.type],
                doc.version,
                new Date(doc.createdAt).toLocaleDateString(),
                doc.supersededAt && "Superseded",
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {doc.visibility !== DocumentVisibility.PUBLIC && (
              <Badge>{VISIBILITY_LABELS[doc.visibility]}</Badge>
            )}
            {canManage && onSupersede && !doc.supersededAt && (
              <Button
                size="sm"
                variant="ghost"
                disabled={isPending}
                onClick={onSupersede}
              >
                Retire
              </Button>
            )}
            {canManage && (
              <Button
                size="sm"
                variant="ghost"
                disabled={isPending}
                onClick={onRemove}
              >
                Delete
              </Button>
            )}
          </div>
        </div>
        {doc.description && (
          <p className="text-sm text-brand-black/80">{doc.description}</p>
        )}
      </CardContent>
    </Card>
  );
}
