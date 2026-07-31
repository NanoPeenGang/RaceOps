import { themeStyle, type ResolvedBranding } from "@/lib/branding";
import { Avatar } from "@/components/ui/avatar";

/**
 * Applies a resolved theme to a subtree.
 *
 * Custom properties on an element rather than a global stylesheet: a series
 * card and a team card can then sit in the same list carrying different
 * colours, which a global theme could not do. Utilities elsewhere read
 * `var(--brand-primary)` and pick this up automatically.
 */
export function BrandTheme({
  branding,
  children,
  className,
}: {
  branding: ResolvedBranding;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className} style={themeStyle(branding)}>
      {children}
    </div>
  );
}

/**
 * The top of a branded landing page: banner, logo, name and tagline.
 *
 * Falls back cleanly at every level — no banner gives a tinted band in the
 * brand colour, no logo gives initials — so a page that has had nothing
 * uploaded still looks deliberate rather than broken.
 */
export function BrandHeader({
  branding,
  name,
  eyebrow,
  meta,
  actions,
}: {
  branding: ResolvedBranding;
  name: string;
  eyebrow?: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="overflow-hidden rounded-xl border border-brand-black/10">
      <div
        className="relative h-32 sm:h-44"
        style={
          branding.bannerUrl
            ? undefined
            : {
                // A flat band in the brand colour reads as intentional; an
                // empty grey box reads as a missing image.
                background: `linear-gradient(135deg, ${branding.primary}, ${branding.accent})`,
              }
        }
      >
        {branding.bannerUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={branding.bannerUrl}
            alt=""
            className="h-full w-full object-cover"
          />
        )}
      </div>

      <div className="flex flex-wrap items-end justify-between gap-4 bg-white p-4 sm:p-6">
        <div className="flex min-w-0 items-center gap-4">
          {/* Pulled up over the banner, the convention people expect. */}
          <div className="-mt-12 shrink-0 rounded-xl border-4 border-white bg-white shadow-sm sm:-mt-16">
            <Avatar src={branding.logoUrl} name={name} size="lg" />
          </div>
          <div className="min-w-0">
            {eyebrow && (
              <div className="text-xs font-semibold uppercase tracking-widest text-brand-black/50">
                {eyebrow}
              </div>
            )}
            <h1 className="truncate text-2xl font-bold sm:text-3xl">{name}</h1>
            {branding.tagline && (
              <p className="text-sm text-brand-black/70">{branding.tagline}</p>
            )}
            {meta && (
              <p className="text-sm text-brand-black/60">{meta}</p>
            )}
          </div>
        </div>
        {actions && (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        )}
      </div>
    </header>
  );
}
