"use client";

import {
  MAX_ROLE_TAGS_PER_DOMAIN,
  toggleRole,
  type RoleGroup,
} from "@/lib/roles";

/**
 * Grouped chip picker for role tags. Generic over the role enum so the sim and
 * real-world sets share one implementation.
 */
export function RoleTagPicker<T extends string>({
  label,
  description,
  groups,
  labels,
  selected,
  onChange,
}: {
  label: string;
  description?: string;
  groups: RoleGroup<T>[];
  labels: Record<T, string>;
  selected: T[];
  onChange: (next: T[]) => void;
}) {
  const atCap = selected.length >= MAX_ROLE_TAGS_PER_DOMAIN;

  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium">{label}</legend>
      {description && (
        <p className="text-xs text-brand-black/60">{description}</p>
      )}

      {groups.map((group) => (
        <div key={group.label} className="space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-black/50">
            {group.label}
          </p>
          <div className="flex flex-wrap gap-2">
            {group.roles.map((role) => {
              const isSelected = selected.includes(role);
              return (
                <button
                  key={role}
                  type="button"
                  aria-pressed={isSelected}
                  // At the cap, only deselecting stays available.
                  disabled={!isSelected && atCap}
                  onClick={() => onChange(toggleRole(selected, role))}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    isSelected
                      ? "border-brand-red bg-brand-red text-on-red"
                      : atCap
                        ? "cursor-not-allowed border-brand-black/10 text-brand-black/40"
                        : "border-brand-black/20 hover:border-brand-red"
                  }`}
                >
                  {labels[role]}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <p className="text-xs text-brand-black/50">
        {selected.length}/{MAX_ROLE_TAGS_PER_DOMAIN} selected
        {atCap ? " — remove one to pick another." : ""}
      </p>
    </fieldset>
  );
}
