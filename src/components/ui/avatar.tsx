import { cn } from "@/lib/utils";

/**
 * A person's picture, or their initials.
 *
 * Initials rather than a stock silhouette: a grid of identical grey figures
 * tells you nothing, whereas initials remain scannable in a roster of thirty
 * people where most have not uploaded anything.
 */

const SIZES = {
  sm: "h-8 w-8 text-xs",
  md: "h-12 w-12 text-sm",
  lg: "h-20 w-20 text-xl",
} as const;

export function Avatar({
  src,
  name,
  size = "md",
  className,
}: {
  src?: string | null;
  name?: string | null;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const label = name?.trim() || "";
  const base = cn(
    "shrink-0 overflow-hidden rounded-full",
    SIZES[size],
    className,
  );

  if (src) {
    return (
      <span className={cn(base, "block bg-brand-black/5")}>
        {/* Arbitrary user URLs on arbitrary hosts, which next/image cannot
            optimise without every host being configured up front. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={label ? `${label}'s picture` : ""}
          className="h-full w-full object-cover"
          loading="lazy"
        />
      </span>
    );
  }

  return (
    <span
      className={cn(
        base,
        "flex items-center justify-center bg-brand-black/10 font-semibold text-brand-black/70",
      )}
      aria-hidden={label ? undefined : true}
      title={label || undefined}
    >
      {initialsOf(label)}
    </span>
  );
}

/**
 * Up to two initials from a name.
 *
 * Takes the first and last word so "Jean-Luc van der Berg" reads as "JB"
 * rather than "JV" — the family name is the part people recognise.
 */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}
