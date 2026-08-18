"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/trpc/client";
import {
  contrastWarnings,
  normalizeHex,
  resolveBranding,
} from "@/lib/branding";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ImageUpload } from "@/components/image-upload";
import { BrandHeader } from "@/components/brand-theme";

/**
 * The branding editor, with a live preview.
 *
 * The preview is the point: colour pickers are guesswork without seeing the
 * page, and the thing most people get wrong — a pale brand colour that makes
 * links invisible — is only obvious once rendered. Warnings sit under the
 * field they apply to and say which use is affected, rather than refusing the
 * colour outright. It is their brand.
 */
export type BrandScope =
  | { organizationId: string }
  | { seriesId: string }
  | { eventId: string }
  | { teamId: string };

export function BrandingEditor({
  scope,
  name,
  description,
}: {
  scope: BrandScope;
  name: string;
  description?: string;
}) {
  const utils = api.useUtils();
  const stored = api.branding.own.useQuery(scope, { retry: false });

  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [bannerUrl, setBannerUrl] = useState<string | null>(null);
  const [primaryColor, setPrimaryColor] = useState("");
  const [accentColor, setAccentColor] = useState("");
  const [tagline, setTagline] = useState("");

  // Seeded from what this scope sets *itself*, never from the resolved theme:
  // showing an inherited colour in the form would make it look chosen here,
  // and clearing it would then appear to do nothing.
  useEffect(() => {
    const own = stored.data?.own;
    setLogoUrl(own?.logoUrl ?? null);
    setBannerUrl(own?.bannerUrl ?? null);
    setPrimaryColor(own?.primaryColor ?? "");
    setAccentColor(own?.accentColor ?? "");
    setTagline(own?.tagline ?? "");
  }, [stored.data]);

  const refresh = () => {
    utils.branding.own.invalidate();
    utils.branding.resolved.invalidate();
  };
  const save = api.branding.update.useMutation({
    meta: { silenceError: true, successMessage: "Branding saved." },
    onSuccess: refresh,
  });
  const reset = api.branding.reset.useMutation({ onSuccess: refresh });

  if (stored.error) return null;

  const inherited = stored.data?.inherited;
  const preview = resolveBranding(
    { logoUrl, bannerUrl, primaryColor, accentColor, tagline },
    inherited
      ? {
          logoUrl: inherited.logoUrl,
          bannerUrl: inherited.bannerUrl,
          primaryColor: inherited.primary,
          accentColor: inherited.accent,
          tagline: inherited.tagline,
        }
      : null,
  );

  const primaryWarnings = normalizeHex(primaryColor)
    ? contrastWarnings(normalizeHex(primaryColor)!)
    : [];
  const invalidPrimary =
    primaryColor.trim() !== "" && !normalizeHex(primaryColor);
  const invalidAccent = accentColor.trim() !== "" && !normalizeHex(accentColor);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold">Look and feel</h2>
          <p className="text-sm text-brand-black/60">
            {description ??
              "Anything left blank is inherited. Set it once higher up and everything below picks it up."}
          </p>
        </div>
        {stored.data?.own && (
          <Button
            size="sm"
            variant="outline"
            disabled={reset.isPending}
            onClick={() => reset.mutate(scope)}
          >
            {reset.isPending ? "Resetting…" : "Reset to inherited"}
          </Button>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="space-y-5 p-4">
            <ImageUpload
              purpose="logo"
              value={logoUrl}
              onChange={setLogoUrl}
              label="Logo"
              hint="Square works best. Shown on cards, headers and entry lists."
            />
            <ImageUpload
              purpose="banner"
              value={bannerUrl}
              onChange={setBannerUrl}
              label="Banner"
              hint="Wide image across the top of the landing page."
              aspect="wide"
            />

            <label className="block text-sm font-medium">
              Tagline
              <input
                className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
                value={tagline}
                onChange={(e) => setTagline(e.target.value)}
                placeholder="One line under the name"
                maxLength={160}
              />
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <ColourField
                label="Primary colour"
                value={primaryColor}
                onChange={setPrimaryColor}
                invalid={invalidPrimary}
                warnings={primaryWarnings}
                inheritedFrom={inherited?.primary}
              />
              <ColourField
                label="Accent colour"
                value={accentColor}
                onChange={setAccentColor}
                invalid={invalidAccent}
                warnings={
                  normalizeHex(accentColor)
                    ? contrastWarnings(normalizeHex(accentColor)!)
                    : []
                }
                inheritedFrom={inherited?.accent}
              />
            </div>

            {save.error && (
              <p className="text-sm text-brand-red">{save.error.message}</p>
            )}
            <Button
              variant="primary"
              disabled={save.isPending || invalidPrimary || invalidAccent}
              onClick={() =>
                save.mutate({
                  ...scope,
                  logoUrl: logoUrl || null,
                  bannerUrl: bannerUrl || null,
                  primaryColor: primaryColor.trim() || null,
                  accentColor: accentColor.trim() || null,
                  tagline: tagline.trim() || null,
                })
              }
            >
              {save.isPending ? "Saving…" : "Save branding"}
            </Button>
          </CardContent>
        </Card>

        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-black/50">
            Preview
          </p>
          <BrandHeader
            branding={preview}
            name={name}
            eyebrow="Preview"
            meta="This is how your page header will look."
          />
          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="flex flex-wrap gap-2">
                <span
                  className="rounded-md px-3 py-1.5 text-sm font-semibold"
                  style={{
                    background: preview.primary,
                    color: preview.onPrimary,
                  }}
                >
                  Primary button
                </span>
                <span
                  className="rounded-full px-3 py-1 text-xs font-semibold"
                  style={{
                    background: preview.primarySoft,
                    color: preview.accent,
                  }}
                >
                  Chip
                </span>
              </div>
              <p className="text-sm">
                Body text with{" "}
                <span
                  style={{ color: preview.primary }}
                  className="font-medium"
                >
                  a link in your colour
                </span>{" "}
                to check it is readable on the page.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}

function ColourField({
  label,
  value,
  onChange,
  invalid,
  warnings,
  inheritedFrom,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  invalid: boolean;
  warnings: string[];
  inheritedFrom?: string;
}) {
  const normalized = normalizeHex(value);
  return (
    <div className="space-y-1">
      <label className="block text-sm font-medium">
        {label}
        <div className="mt-1 flex items-center gap-2">
          {/* A native swatch alongside the text field: people arrive either
              with a hex from a brand guide or with only a rough idea. */}
          <input
            type="color"
            aria-label={`${label} swatch`}
            className="h-9 w-9 shrink-0 cursor-pointer rounded border border-brand-black/20 bg-surface"
            value={normalized ?? inheritedFrom ?? "#D91E1E"}
            onChange={(e) => onChange(e.target.value.toUpperCase())}
          />
          <input
            className={`min-w-0 flex-1 rounded-md border px-3 py-2 font-mono text-sm ${
              invalid ? "border-brand-red" : "border-brand-black/20"
            }`}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={
              inheritedFrom ? `${inheritedFrom} (inherited)` : "#D91E1E"
            }
          />
        </div>
      </label>
      {invalid && (
        <p className="text-xs text-brand-red">Use a hex colour like #D91E1E.</p>
      )}
      {warnings.map((warning) => (
        <p key={warning} className="text-xs text-brand-black/70">
          {warning}
        </p>
      ))}
    </div>
  );
}
