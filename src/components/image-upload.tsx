"use client";

import { useRef, useState } from "react";
import { api } from "@/lib/trpc/client";
import { prepareUpload } from "@/lib/image-resize";
import { checkUpload, formatBytes, UPLOAD_RULES, type UploadPurpose } from "@/lib/upload";
import { Button } from "@/components/ui/button";

/**
 * Pick a file from a phone or a computer and upload it.
 *
 * Three things make this work away from a desk. The file input accepts a
 * camera capture, so on a phone it offers "Take photo" alongside the library.
 * Images are downscaled in the browser first, so a 6 MB camera JPEG becomes a
 * few hundred kilobytes before it touches circuit wifi. And the bytes go
 * straight to object storage rather than through the app.
 *
 * Where no bucket is configured, this falls back to pasting a link — the
 * platform has always worked that way and must keep working.
 */
export function ImageUpload({
  purpose,
  value,
  onChange,
  label,
  hint,
  /**
   * Rendered preview shape. A banner and an avatar want different frames, and
   * a track map wants a third: `map` fits the whole image inside the frame
   * instead of cropping to fill it, because a centre-cropped circuit diagram
   * shows you the infield and none of the corners.
   */
  aspect = "square",
}: {
  purpose: UploadPurpose;
  value: string | null;
  onChange: (url: string | null) => void;
  label: string;
  hint?: string;
  aspect?: "square" | "wide" | "map";
}) {
  const config = api.upload.config.useQuery();
  const createUrl = api.upload.createUploadUrl.useMutation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [linkMode, setLinkMode] = useState(false);
  const [link, setLink] = useState("");

  const rules = UPLOAD_RULES[purpose];
  const uploadEnabled = config.data?.enabled ?? false;

  async function handleFile(file: File) {
    setError(null);
    setBusy(true);
    try {
      // Checked before the resize so an obviously wrong file fails instantly
      // with a message about the file the person actually picked.
      const rejection = checkUpload(purpose, file);
      if (rejection && rejection.reason === "type") {
        setError(rejection.message);
        return;
      }

      setProgress("Preparing…");
      const prepared = await prepareUpload(file, purpose);

      const sizeCheck = checkUpload(purpose, {
        type: prepared.contentType,
        size: prepared.blob.size,
      });
      if (sizeCheck) {
        setError(sizeCheck.message);
        return;
      }

      setProgress("Uploading…");
      const signed = await createUrl.mutateAsync({
        purpose,
        contentType: prepared.contentType,
        fileName: file.name,
        sizeBytes: prepared.blob.size,
      });

      const response = await fetch(signed.uploadUrl, {
        method: "PUT",
        // Must match the signed type exactly or the signature is rejected.
        headers: { "Content-Type": prepared.contentType },
        body: prepared.blob,
      });
      if (!response.ok) {
        throw new Error(
          `Storage rejected the upload (${response.status}). Try again.`,
        );
      }

      onChange(signed.publicUrl);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "That upload did not work.",
      );
    } finally {
      setBusy(false);
      setProgress(null);
      // Clearing lets the same file be picked again after a failure.
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium">{label}</p>
          {hint && <p className="text-xs text-brand-black/60">{hint}</p>}
        </div>
        {value && (
          <Button size="sm" variant="outline" onClick={() => onChange(null)}>
            Remove
          </Button>
        )}
      </div>

      {value && (
        <div
          className={`overflow-hidden rounded-lg border border-brand-black/10 bg-brand-black/[0.03] ${
            aspect === "wide"
              ? "aspect-[4/1]"
              : aspect === "map"
                // White regardless of theme: a preview of an image with a
                  // transparent background has to show what it will look like
                  // where it is used, not where it is being uploaded.
                  ? "max-h-64 w-full bg-white"
                : "h-24 w-24"
          }`}
        >
          {/* A plain img: these are arbitrary user URLs on arbitrary hosts,
              which next/image cannot optimise without configuring each one. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={value}
            alt=""
            className={
              aspect === "map"
                ? "max-h-64 w-full object-contain"
                : "h-full w-full object-cover"
            }
            loading="lazy"
          />
        </div>
      )}

      {uploadEnabled && !linkMode ? (
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            accept={rules.accept.join(",")}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
            }}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? (progress ?? "Working…") : value ? "Replace" : "Choose file"}
          </Button>
          <span className="text-xs text-brand-black/50">
            up to {formatBytes(rules.maxBytes)}
          </span>
          <button
            type="button"
            className="text-xs text-brand-red hover:underline"
            onClick={() => setLinkMode(true)}
          >
            or paste a link
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="min-w-0 flex-1 rounded-md border border-brand-black/20 px-2 py-1.5 text-sm"
            placeholder="https://…"
            value={link}
            onChange={(e) => setLink(e.target.value)}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={!link.trim()}
            onClick={() => {
              onChange(link.trim());
              setLink("");
              if (uploadEnabled) setLinkMode(false);
            }}
          >
            Use link
          </Button>
          {uploadEnabled && (
            <button
              type="button"
              className="text-xs text-brand-red hover:underline"
              onClick={() => setLinkMode(false)}
            >
              upload instead
            </button>
          )}
        </div>
      )}

      {!uploadEnabled && config.isFetched && (
        <p className="text-xs text-brand-black/50">
          File upload is not configured on this deployment, so links are the
          only option here.
        </p>
      )}
      {error && <p className="text-sm text-brand-red">{error}</p>}
    </div>
  );
}
