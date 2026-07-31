import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Page furniture: headers, sections, empty states.
 *
 * These exist because the consoles had drifted — every page invented its own
 * heading markup, its own spacing and its own way of saying "nothing here
 * yet". Someone learning the platform had to re-read each screen instead of
 * recognising it, which is exactly the training cost this is meant to remove.
 */

export interface Crumb {
  label: string;
  href?: string;
}

/**
 * The top of a page: where you are, what it is, and what you can do here.
 *
 * Breadcrumbs are not decoration. The consoles nest three deep — organization,
 * series, event — and without a trail people navigate by the back button and
 * lose their place.
 */
export function PageHeader({
  title,
  description,
  breadcrumbs,
  actions,
  status,
}: {
  title: string;
  description?: React.ReactNode;
  breadcrumbs?: Crumb[];
  actions?: React.ReactNode;
  status?: React.ReactNode;
}) {
  return (
    <header className="space-y-3 border-b border-brand-black/10 pb-5">
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav aria-label="Breadcrumb">
          <ol className="flex flex-wrap items-center gap-1 text-sm text-brand-black/60">
            {breadcrumbs.map((crumb, index) => (
              <li key={`${crumb.label}-${index}`} className="flex items-center gap-1">
                {index > 0 && <span aria-hidden="true">/</span>}
                {crumb.href ? (
                  <Link href={crumb.href} className="hover:text-brand-red">
                    {crumb.label}
                  </Link>
                ) : (
                  <span>{crumb.label}</span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
              {title}
            </h1>
            {status}
          </div>
          {description && (
            <div className="mt-1 text-sm text-brand-black/60">{description}</div>
          )}
        </div>
        {actions && (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        )}
      </div>
    </header>
  );
}

/**
 * A titled block of a page.
 *
 * `description` is encouraged rather than optional-by-habit: a section whose
 * purpose is not obvious from its title is where people get stuck, and one
 * sentence there removes a support question.
 */
export function Section({
  title,
  description,
  actions,
  children,
  id,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">{title}</h2>
          {description && (
            <p className="text-sm text-brand-black/60">{description}</p>
          )}
        </div>
        {actions && (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        )}
      </div>
      {children}
    </section>
  );
}

/**
 * What to show where there is nothing.
 *
 * Always with the action that fixes it. An empty list saying only "no entries"
 * leaves someone to work out what to do; one that says "no entries yet —
 * publish the event so people can enter" does not.
 */
export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-dashed border-brand-black/20 p-6 text-center",
        className,
      )}
    >
      <p className="font-medium">{title}</p>
      {description && (
        <p className="mx-auto mt-1 max-w-md text-sm text-brand-black/60">
          {description}
        </p>
      )}
      {action && <div className="mt-3 flex justify-center">{action}</div>}
    </div>
  );
}

/** A single number with its label — the top of a dashboard. */
export function Stat({
  label,
  value,
  hint,
  href,
  tone = "default",
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  href?: string;
  /** `alert` marks a number that needs someone to act on it. */
  tone?: "default" | "alert";
}) {
  const body = (
    <div
      className={cn(
        "rounded-lg border p-4",
        tone === "alert"
          ? "border-brand-red/40 bg-brand-red/[0.03]"
          : "border-brand-black/10",
        href && "transition-colors hover:border-brand-black/25",
      )}
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-brand-black/50">
        {label}
      </p>
      <p
        className={cn(
          "mt-1 text-2xl font-bold tabular-nums",
          tone === "alert" && "text-brand-red",
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-brand-black/60">{hint}</p>}
    </div>
  );
  return href ? (
    <Link href={href} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}
