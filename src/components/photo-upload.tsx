"use client";

import { useRef, useState } from "react";
import { api } from "@/lib/trpc/client";
import { prepareUpload, UndecodableImageError } from "@/lib/image-resize";
import { checkUpload, formatBytes, UPLOAD_RULES, type UploadPurpose } from "@/lib/upload";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Pick photos from a camera roll and upload them.
 *
 * The difference from `ImageUpload`, which fills one field with one picture:
 * this is for adding *photos*, plural, which is how anybody who has just come
 * off a race weekend has them — thirty on a phone, picked in one go.
 *
 * Two details do the actual work of making a camera roll usable.
 *
 * There is no `capture` attribute, deliberately. It sounds like the thing you
 * want and it is the opposite: `capture` tells the phone to open the camera
 * *instead of* the library, so adding it would remove the camera roll rather
 * than reach it. Left off, iOS and Android both offer Photo Library, Take
 * Photo and Browse, which is the whole menu.
 *
 * And the accepted list names HEIC, because that is what an iPhone writes.
 * A picker that does not name it greys out every photo somebody is looking
 * at. Naming it is safe because the file is converted to JPEG here, before
 * upload — see `prepareUpload`.
 */

export interface UploadedPhoto {
  url: string;
  /** The original filename, minus its extension — a usable default title. */
  name: string;
  contentType: string;
}

type Status =
  | { state: "waiting" }
  | { state: "working"; step: string }
  | { state: "done" }
  | { state: "failed"; message: string };

interface Row {
  id: string;
  name: string;
  status: Status;
}

export function PhotoUpload({
  purpose = "media",
  onUploaded,
  label = "Add photos",
  className,
}: {
  purpose?: UploadPurpose;
  /** Called once per file, as each finishes, rather than once at the end. */
  onUploaded: (photo: UploadedPhoto) => void;
  label?: string;
  className?: string;
}) {
  const config = api.upload.config.useQuery();
  const createUrl = api.upload.createUploadUrl.useMutation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);

  const rules = UPLOAD_RULES[purpose];
  const enabled = config.data?.enabled ?? false;

  function update(id: string, status: Status) {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, status } : row)));
  }

  async function uploadOne(file: File, id: string) {
    update(id, { state: "working", step: "Preparing" });

    // Type is checked after preparing, not before: a HEIC is not storable as
    // picked but is perfectly fine once converted, and rejecting it up front
    // would refuse exactly the photos this exists to accept.
    const prepared = await prepareUpload(file, purpose);

    const rejection = checkUpload(purpose, {
      type: prepared.contentType,
      size: prepared.blob.size,
    });
    if (rejection) throw new Error(rejection.message);

    update(id, { state: "working", step: "Uploading" });
    const signed = await createUrl.mutateAsync({
      purpose,
      contentType: prepared.contentType,
      fileName: file.name,
      sizeBytes: prepared.blob.size,
    });

    const response = await fetch(signed.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": prepared.contentType },
      body: prepared.blob,
    });
    if (!response.ok) {
      throw new Error(`Storage rejected the upload (${response.status}).`);
    }

    onUploaded({
      url: signed.publicUrl,
      name: file.name.replace(/\.[^.]+$/, ""),
      contentType: prepared.contentType,
    });
    update(id, { state: "done" });
  }

  async function handleFiles(files: FileList) {
    const picked = Array.from(files);
    if (picked.length === 0) return;

    const fresh: Row[] = picked.map((file, index) => ({
      id: `${Date.now()}-${index}`,
      name: file.name,
      status: { state: "waiting" },
    }));
    setRows(fresh);
    setBusy(true);

    /*
     * One at a time. Thirty photos uploaded in parallel over paddock wifi is
     * thirty stalled requests and no finished pictures; sequentially, the
     * first ones land and stay landed even if the connection gives out.
     */
    for (const [index, file] of picked.entries()) {
      const id = fresh[index]!.id;
      try {
        await uploadOne(file, id);
      } catch (caught) {
        // One bad photo must not abandon the other twenty-nine.
        update(id, {
          state: "failed",
          message:
            caught instanceof UndecodableImageError
              ? caught.message
              : caught instanceof Error
                ? caught.message
                : "That upload did not work.",
        });
      }
    }

    setBusy(false);
    // Lets the same photo be picked again after a failure.
    if (inputRef.current) inputRef.current.value = "";
  }

  if (config.isFetched && !enabled) {
    return (
      <p className={cn("text-xs text-brand-black/60", className)}>
        File upload is not configured on this deployment, so a link is the only
        way to add a photo here.
      </p>
    );
  }

  const done = rows.filter((row) => row.status.state === "done").length;

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          accept={rules.accept.join(",")}
          onChange={(event) => {
            if (event.target.files) void handleFiles(event.target.files);
          }}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? `Uploading ${done + 1} of ${rows.length}…` : label}
        </Button>
        <span className="text-xs text-brand-black/50">
          Pick as many as you like · up to {formatBytes(rules.maxBytes)} each
        </span>
      </div>

      {rows.length > 0 && (
        <ul className="space-y-1" aria-live="polite">
          {rows.map((row) => (
            <li key={row.id} className="flex items-start gap-2 text-xs">
              <span
                aria-hidden="true"
                className={cn(
                  "mt-[3px] h-2 w-2 shrink-0 rounded-full",
                  row.status.state === "done" && "bg-brand-red",
                  row.status.state === "failed" && "bg-brand-red/40",
                  row.status.state === "working" && "animate-pulse bg-brand-black/40",
                  row.status.state === "waiting" && "bg-brand-black/15",
                )}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-brand-black/70">{row.name}</span>
                {row.status.state === "failed" && (
                  <span className="block text-brand-red">{row.status.message}</span>
                )}
              </span>
              <span className="shrink-0 text-brand-black/50">
                {row.status.state === "working"
                  ? row.status.step
                  : row.status.state === "done"
                    ? "Added"
                    : row.status.state === "failed"
                      ? "Failed"
                      : "Waiting"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
